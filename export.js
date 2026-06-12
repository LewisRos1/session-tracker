// ============================================================
// EXPORT.JS — Excel export via ExcelJS (loaded globally as ExcelJS)
// One .xlsx per student: a Summary sheet + one sheet per target.
// ============================================================

import { getAllSessionsForStudent, sanitizeKey } from "./firebase-service.js";

// Strip HTML tags from remark text (stored as HTML for visual bold support)
function stripRemarkHtml(s) {
  return (s || "").replace(/<[^>]*>/g, "");
}

// ─── STYLE CONSTANTS ─────────────────────────────────────────
// Palette: Bright Periwinkle — cheerful, child-friendly, single-hue graduated
//
// Visual hierarchy (saturated → near-white):
//   Monthly  ──► Bright periwinkle  #5B8EC4  ← clear top anchor
//   Session  ──► Medium periwinkle  #A8C8E8  ← section break
//   Col hdr  ──► Light periwinkle   #C8DFF2  ← label row
//   Act hdg  ──► Pale periwinkle    #E4F0F8  ← subtle section
//   Daily avg──► Near-white blue    #F2F7FC  ← unobtrusive summary
//
// All fonts dark navy for maximum readability on every light fill.
//
// Monthly header: bright periwinkle, dark navy text
const STYLE_MONTH = {
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B8EC4" } },
  font: { bold: true, size: 12, color: { argb: "FF0F2340" } },
  alignment: { horizontal: "center", vertical: "middle" }
};
// Session header: medium periwinkle, dark navy text
const STYLE_SESSION = {
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFA8C8E8" } },
  font: { bold: true, color: { argb: "FF1A2E4A" } },
  alignment: { horizontal: "center", vertical: "middle" }
};
// Column header: light periwinkle, dark navy text
const STYLE_COL_HEADER = {
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFC8DFF2" } },
  font: { bold: true, color: { argb: "FF1A2E4A" } },
  alignment: { horizontal: "center", vertical: "middle" }
};
// Activity section heading: pale periwinkle, muted navy text
const STYLE_ACT_HEADING = {
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4F0F8" } },
  font: { bold: true, color: { argb: "FF2A4060" } }
};
// Daily Average: near-white blue, soft navy text
const STYLE_DAILY_AVG = {
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F7FC" } },
  font: { bold: true, italic: true, color: { argb: "FF3A5470" } }
};
// Reference note: soft warm cream, warm amber text
const STYLE_NOTE = {
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8ED" } },
  font: { italic: true, color: { argb: "FF7A5030" } }
};
// Thin border: soft periwinkle-gray for clean print separation
const CELL_BORDER = {
  top:    { style: "thin", color: { argb: "FFB0C8E0" } },
  left:   { style: "thin", color: { argb: "FFB0C8E0" } },
  bottom: { style: "thin", color: { argb: "FFB0C8E0" } },
  right:  { style: "thin", color: { argb: "FFB0C8E0" } },
};

// ─── PUBLIC ENTRY POINT ──────────────────────────────────────

function getAllTargets(student) {
  return student.targets || [];
}

async function buildStudentWorkbook(student, sessions) {
  const allTargets = getAllTargets(student).slice().sort((a, b) => a.name.localeCompare(b.name));
  const wb = new ExcelJS.Workbook();

  // ── Monthly Summary ──────────────────────────────────────────
  const summaryRows = buildSummarySheet(allTargets, sessions);
  const summaryWs   = wb.addWorksheet("Monthly Summary");
  summaryRows.forEach(row => summaryWs.addRow(row));
  summaryWs.getColumn(1).width = 30;
  const summaryMaxCols = summaryRows[0]?.length || 1;
  for (let c = 2; c <= summaryMaxCols; c++) {
    summaryWs.getColumn(c).width = 12;
  }
  applyBorders(summaryWs, summaryMaxCols);

  // ── Detailed Summary ─────────────────────────────────────────
  const { rows: detRows, monthHeaderRows: detMonthHdrs, colHeaderRows: detColHdrs, amberCells } =
    buildDetailedSummarySheet(allTargets, sessions);
  const detWs = wb.addWorksheet("Detailed Summary");
  detRows.forEach(row => detWs.addRow(row));
  detWs.getColumn(1).width = 30;
  const detMaxCols = Math.max(...detRows.map(r => r.length), 1);
  for (let c = 2; c <= detMaxCols; c++) detWs.getColumn(c).width = 12;
  detWs.getColumn(1).alignment = { vertical: "middle" };
  for (let c = 2; c <= detMaxCols; c++) {
    detWs.getColumn(c).alignment = { horizontal: "center", vertical: "middle" };
  }
  for (const rowIdx of detMonthHdrs) {
    const n = rowIdx + 1;
    for (let c = 1; c <= detMaxCols; c++) {
      const cell = detWs.getRow(n).getCell(c);
      cell.fill = STYLE_MONTH.fill;
      cell.font = STYLE_MONTH.font;
    }
  }
  for (const rowIdx of detColHdrs) {
    const n = rowIdx + 1;
    for (let c = 1; c <= detMaxCols; c++) {
      const cell = detWs.getRow(n).getCell(c);
      cell.fill = STYLE_COL_HEADER.fill;
      cell.font = STYLE_COL_HEADER.font;
      cell.alignment = STYLE_COL_HEADER.alignment;
    }
  }
  for (const { rowIdx, col } of amberCells) {
    const cell = detWs.getRow(rowIdx + 1).getCell(col);
    cell.fill = STYLE_DAILY_AVG.fill;
    cell.font = STYLE_DAILY_AVG.font;
    cell.alignment = { horizontal: "center" };
  }
  mergeAndCenterRows(detWs, detMonthHdrs, detMaxCols);
  applyBorders(detWs, detMaxCols);

  for (const target of allTargets) {
    const { rows, monthHeaderRows, sessionHeaderRows, columnHeaderRows, activityHeadingRows, noteRows, dailyAvgRows } =
      buildTargetSheet(target, sessions);
    const ws = wb.addWorksheet(target.name.slice(0, 31));
    rows.forEach(row => ws.addRow(row));
    ws.getColumn(1).width     = 45;
    ws.getColumn(2).width     = 52;
    ws.getColumn(3).width     = 16;
    ws.getColumn(4).width     = 10;
    ws.getColumn(1).alignment = { wrapText: true, vertical: "top" };
    ws.getColumn(2).alignment = { wrapText: true, vertical: "top" };
    ws.getColumn(3).alignment = { horizontal: "center", vertical: "top", wrapText: true };
    ws.getColumn(4).alignment = { horizontal: "center", vertical: "top" };

    applyRowStyles(ws, monthHeaderRows,    STYLE_MONTH);
    applyRowStyles(ws, sessionHeaderRows,  STYLE_SESSION);
    applyRowStyles(ws, columnHeaderRows,   STYLE_COL_HEADER);
    mergeAndCenterRows(ws, monthHeaderRows,  4);
    mergeAndCenterRows(ws, sessionHeaderRows, 4);

    for (const rowIdx of activityHeadingRows) {
      const n = rowIdx + 1;
      ws.mergeCells(`A${n}:D${n}`);
      const cell = ws.getRow(n).getCell(1);
      cell.fill = STYLE_ACT_HEADING.fill;
      cell.font = STYLE_ACT_HEADING.font;
    }

    for (const rowIdx of noteRows) {
      const n = rowIdx + 1;
      ws.mergeCells(`A${n}:D${n}`);
      const cell = ws.getRow(n).getCell(1);
      cell.fill = STYLE_NOTE.fill;
      cell.font = STYLE_NOTE.font;
      cell.alignment = { wrapText: true, vertical: "top" };
      const text = (cell.value || "").toString();
      const visLines = text.split("\n").reduce((sum, seg) =>
        sum + Math.max(1, Math.ceil((seg.length || 1) / 52)), 0);
      ws.getRow(n).height = Math.max(18, visLines * 15);
    }

    applyRowStyles(ws, dailyAvgRows, STYLE_DAILY_AVG);
    applySessionRowHeights(ws, sessionHeaderRows);
    applyBorders(ws, 4);
  }

  return wb.xlsx.writeBuffer();
}

function makeFilename(studentName, now) {
  const monNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const dd   = String(now.getDate()).padStart(2, "0");
  const mon  = monNames[now.getMonth()];
  const yyyy = now.getFullYear();
  const hh   = String(now.getHours()).padStart(2, "0");
  const mm   = String(now.getMinutes()).padStart(2, "0");
  return `${studentName}_${dd}-${mon}-${yyyy}_${hh}${mm}.xlsx`;
}

export async function exportStudentData(student) {
  if (!student) return;

  const sessions = await getAllSessionsForStudent(student.id);
  if (sessions.length === 0) {
    alert("No session data found for " + student.name);
    return;
  }

  const now    = new Date();
  const buffer = await buildStudentWorkbook(student, sessions);
  const blob   = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement("a");
  a.href       = url;
  a.download   = makeFilename(student.name, now);
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportAllStudents(students) {
  if (!students || students.length === 0) return;

  const zip = new JSZip();
  const now = new Date();
  let exported = 0;

  for (const student of students) {
    const sessions = await getAllSessionsForStudent(student.id);
    if (sessions.length === 0) continue;
    const buffer = await buildStudentWorkbook(student, sessions);
    zip.file(makeFilename(student.name, now), buffer);
    exported++;
  }

  if (exported === 0) {
    alert("No session data found for any student.");
    return;
  }

  const monNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const dd   = String(now.getDate()).padStart(2, "0");
  const mon  = monNames[now.getMonth()];
  const yyyy = now.getFullYear();
  const zipBlob = await zip.generateAsync({ type: "blob" });
  const url     = URL.createObjectURL(zipBlob);
  const a       = document.createElement("a");
  a.href        = url;
  a.download    = `All_Students_${dd}-${mon}-${yyyy}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── STYLE HELPER ────────────────────────────────────────────

function applyRowStyles(ws, rowIndices, style, numCols = 4) {
  for (const rowIdx of rowIndices) {
    const row = ws.getRow(rowIdx + 1);
    for (let c = 1; c <= numCols; c++) {
      const cell = row.getCell(c);
      if (style.fill)      cell.fill      = style.fill;
      if (style.font)      cell.font      = style.font;
      if (style.alignment) cell.alignment = style.alignment;
    }
  }
}

// Apply thin borders to every cell in the used range for print readability
function applyBorders(ws, numCols) {
  ws.eachRow(row => {
    for (let c = 1; c <= numCols; c++) {
      row.getCell(c).border = CELL_BORDER;
    }
  });
}

// Give session header rows a slightly taller height so they stand out
function applySessionRowHeights(ws, sessionHeaderRowIndices) {
  for (const rowIdx of sessionHeaderRowIndices) {
    ws.getRow(rowIdx + 1).height = 22;
  }
}

// Merge a set of rows across numCols columns and force centered alignment
function mergeAndCenterRows(ws, rowIndices, numCols) {
  const colLetter = String.fromCharCode(64 + numCols); // e.g. 4 → 'D'
  for (const rowIdx of rowIndices) {
    const n = rowIdx + 1;
    try { ws.mergeCells(`A${n}:${colLetter}${n}`); } catch (_) {}
    const cell = ws.getRow(n).getCell(1);
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: false };
  }
}

// ─── SUMMARY SHEET ───────────────────────────────────────────

function buildSummarySheet(allTargets, sessions) {
  const monthSet = new Set(sessions.map(s => s.month));
  const months   = [...monthSet].sort((a, b) => {
    const [ma, ya] = parseMonth(a);
    const [mb, yb] = parseMonth(b);
    return ya !== yb ? ya - yb : ma - mb;
  });

  const rows = [];
  rows.push(["Target", ...months]);

  for (const target of allTargets) {
    const row = [target.name];
    for (const month of months) {
      const monthSessions = sessions.filter(s => s.month === month);
      const dailyAvgs = monthSessions
        .map(s => {
          const snap = (s.targetsSnapshot || []).find(t => t.name === target.name);
          const eff  = snap ? { ...target, maxPoints: snap.maxPoints } : target;
          return calcDailyAverage(s, eff);
        })
        .filter(v => v !== null);
      row.push(dailyAvgs.length > 0 ? pct(avg(dailyAvgs)) : "");
    }
    rows.push(row);
  }

  return rows;
}

// ─── DETAILED SUMMARY SHEET ──────────────────────────────────
// Rows = targets, columns = individual session dates (grouped by month).
// Last column of each month block = Monthly Avg.

function buildDetailedSummarySheet(allTargets, sessions) {
  const months = [...new Set(sessions.map(s => s.month))].sort((a, b) => {
    const [ma, ya] = parseMonth(a);
    const [mb, yb] = parseMonth(b);
    return ya !== yb ? ya - yb : ma - mb;
  });

  const rows = [];
  const monthHeaderRows = new Set();
  const colHeaderRows   = new Set();
  const amberCells      = []; // {rowIdx, col} — Monthly Avg header + data cells

  let firstMonth = true;
  for (const month of months) {
    const monthSessions = sessions
      .filter(s => s.month === month)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (!firstMonth) rows.push([]);
    firstMonth = false;

    monthHeaderRows.add(rows.length);
    rows.push([month]);

    const avgColIdx = 1 + monthSessions.length + 1; // 1-indexed column for Monthly Avg

    colHeaderRows.add(rows.length);
    amberCells.push({ rowIdx: rows.length, col: avgColIdx });
    rows.push(["Target", ...monthSessions.map(s => fmtDate(s.date)), "Monthly Avg"]);

    for (const target of allTargets) {
      const sessionAvgs = monthSessions.map(session => {
        const snap = (session.targetsSnapshot || []).find(t => t.name === target.name);
        const eff  = snap ? { ...target, maxPoints: snap.maxPoints } : target;
        return calcDailyAverage(session, eff);
      });
      const validAvgs  = sessionAvgs.filter(v => v !== null);
      const monthlyAvg = validAvgs.length > 0 ? avg(validAvgs) : null;

      amberCells.push({ rowIdx: rows.length, col: avgColIdx });
      rows.push([
        target.name,
        ...sessionAvgs.map(v => v !== null ? pct(v) : ""),
        monthlyAvg !== null ? pct(monthlyAvg) : ""
      ]);
    }
  }

  return { rows, monthHeaderRows, colHeaderRows, amberCells };
}

function parseMonth(monthStr) {
  const names = ["January","February","March","April","May","June",
                 "July","August","September","October","November","December"];
  const [name, year] = monthStr.split(" ");
  return [names.indexOf(name) + 1, parseInt(year, 10)];
}

// ─── TARGET DETAIL SHEET ─────────────────────────────────────

function buildTargetSheet(target, sessions) {
  const byMonth = new Map();
  for (const s of sessions) {
    if (!byMonth.has(s.month)) byMonth.set(s.month, []);
    byMonth.get(s.month).push(s);
  }

  const rows = [];
  const monthHeaderRows     = new Set();
  const sessionHeaderRows   = new Set();
  const columnHeaderRows    = new Set();
  const activityHeadingRows = new Set();
  const noteRows            = new Set();
  const dailyAvgRows        = new Set();
  let firstMonth = true;

  for (const [month, monthSessions] of byMonth) {
    const dailyAvgsForMonth = monthSessions
      .map(s => {
        const snap = (s.targetsSnapshot || []).find(t => t.name === target.name);
        const eff  = snap
          ? { ...target, maxPoints: snap.maxPoints, predefinedActivities: snap.predefinedActivities || target.predefinedActivities || [] }
          : target;
        return calcDailyAverage(s, eff);
      })
      .filter(v => v !== null);
    const monthlyAvg = dailyAvgsForMonth.length > 0 ? avg(dailyAvgsForMonth) : null;

    if (!firstMonth) rows.push([]);
    firstMonth = false;

    monthHeaderRows.add(rows.length);
    rows.push([`${month}  —  Monthly Average: ${monthlyAvg !== null ? pct(monthlyAvg) : "N/A"}`]);
    rows.push([]);

    for (const session of monthSessions) {
      const snap = (session.targetsSnapshot || []).find(t => t.name === target.name);
      const effectiveTarget = snap ? { ...target, maxPoints: snap.maxPoints } : target;
      appendSessionRows(rows, sessionHeaderRows, columnHeaderRows, activityHeadingRows, noteRows, dailyAvgRows, session, effectiveTarget);
    }
  }

  return { rows, monthHeaderRows, sessionHeaderRows, columnHeaderRows, activityHeadingRows, noteRows, dailyAvgRows };
}

// ─── SESSION ROWS ────────────────────────────────────────────

function appendSessionRows(rows, sessionHeaderRows, columnHeaderRows, activityHeadingRows, noteRows, dailyAvgRows, session, target) {
  const monthName = session.month.split(" ")[0];

  sessionHeaderRows.add(rows.length);
  rows.push([`Session ${session.sessionNumber} of ${monthName}  —  ${fmtDate(session.date)}`]);

  columnHeaderRows.add(rows.length);
  rows.push(["Activity", "Remark", "Trials", "Avg"]);

  const activities = getAllActivitiesForTarget(session, target);

  if (activities.length === 0) {
    rows.push(["(no data recorded)", "", "", ""]);
  } else {
    for (const act of activities) {
      if (act.isHeading) {
        activityHeadingRows.add(rows.length);
        rows.push([act.activityName, "", "", ""]);
        continue;
      }

      if (act.isNote) {
        noteRows.add(rows.length);
        const noteText = (act.activityName || "")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/div>/gi, "\n").replace(/<div>/gi, "")
          .replace(/<\/p>/gi, "\n").replace(/<p>/gi, "")
          .replace(/<[^>]*>/g, "")
          .replace(/\*\*/g, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        rows.push([noteText, "", "", ""]);
        continue;
      }

      if (act.empty) {
        rows.push([act.activityName, "", "", ""]);
        continue;
      }

      const remarks = getRemarksForActivity(session, act.id);
      const starter = (target.predefinedActivities || []).find(
        p => !p.isHeading && !p.isNote && p.name === act.activityName
      )?.sentenceStarter || null;

      if (remarks.length === 0) {
        rows.push([act.activityName, "", "", ""]);
        continue;
      }

      let firstRemark = true;
      for (const rem of remarks) {
        const validTrials = (rem.trials || []).filter(t => t !== -1);
        const remarkAvg   = calcRemarkAvg(validTrials, target.maxPoints);
        const masteryNote = stripRemarkHtml(rem.masteryNote || "");
        const baseText    = starter ? `${starter} ${stripRemarkHtml(rem.text)}`.trim() : stripRemarkHtml(rem.text);
        const remarkText  = masteryNote ? `${baseText} — ${masteryNote}` : baseText;
        rows.push([
          firstRemark ? act.activityName : "",
          remarkText,
          validTrials.join(", "),
          remarkAvg !== null ? pct(remarkAvg) : ""
        ]);
        firstRemark = false;
      }
    }

    if (target.hasComment) {
      const commentText = (session.fedcComments || {})[sanitizeKey(target.name)] || "";
      if (commentText) rows.push(["Comment", commentText, "", ""]);
    }
  }

  // Daily Average always present; empty if no trial data
  const daily = calcDailyAverage(session, target);
  dailyAvgRows.add(rows.length);
  rows.push(["Daily Average", "", "", daily !== null ? pct(daily) : ""]);

  rows.push([]);
}

// ─── DATA HELPERS ────────────────────────────────────────────

/**
 * Returns predefined activities in their original order (headings included),
 * with { empty: true } for predefined items with no session data, plus any
 * custom (non-predefined) activities appended at the end.
 */
function getAllActivitiesForTarget(session, target) {
  const sessionActs = Object.entries(session.activities || {})
    .filter(([, a]) => a.targetName === target.name)
    .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0))
    .map(([id, a]) => ({ id, ...a }));

  const result = [];
  const usedIds = new Set();

  for (const pa of (target.predefinedActivities || [])) {
    if (!pa.name && !pa.isNote && !pa.isHeading) continue;
    if (pa.isNote) {
      result.push({ isNote: true, activityName: pa.text || "" });
      continue;
    }
    if (!pa.name) continue;
    if (pa.isHeading) {
      result.push({ isHeading: true, activityName: pa.name });
      continue;
    }
    const sessionAct = sessionActs.find(a => a.activityName === pa.name && a.isPredefined);
    if (sessionAct) {
      usedIds.add(sessionAct.id);
      result.push(sessionAct);
    } else {
      result.push({ id: null, activityName: pa.name, isPredefined: true, empty: true });
    }
  }

  for (const act of sessionActs) {
    if (!usedIds.has(act.id)) result.push(act);
  }

  return result;
}

function getRemarksForActivity(session, actId) {
  if (!actId) return [];
  return Object.entries(session.remarks || {})
    .filter(([, r]) => r.activityId === actId)
    .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0))
    .map(([id, r]) => ({ id, ...r }));
}

// ─── CALCULATIONS ────────────────────────────────────────────

function calcRemarkAvg(trials, maxPoints) {
  if (!trials || trials.length === 0) return null;
  const valid = trials.filter(t => t !== -1);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / (valid.length * maxPoints) * 100;
}

function calcDailyAverage(session, target) {
  const avgs = [];
  for (const act of getAllActivitiesForTarget(session, target)) {
    if (act.isHeading || act.isNote || act.empty) continue;
    for (const rem of getRemarksForActivity(session, act.id)) {
      const validTrials = (rem.trials || []).filter(t => t !== -1);
      const a = calcRemarkAvg(validTrials, target.maxPoints);
      if (a !== null) avgs.push(a);
    }
  }
  return avgs.length > 0 ? avg(avgs) : null;
}

function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

// ─── FORMAT HELPERS ──────────────────────────────────────────

function pct(v) { return Math.round(v) + "%"; }

function fmtDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}
