// ============================================================
// EXPORT.JS — Excel export via ExcelJS (loaded globally as ExcelJS)
// One .xlsx per student: a Summary sheet + one sheet per target.
// ============================================================

import { getAllSessionsForStudent, sanitizeKey } from "./firebase-service.js";

// ─── STYLE CONSTANTS ─────────────────────────────────────────
const STYLE_MONTH = {
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF6366F1" } },
  font: { bold: true, color: { argb: "FFFFFFFF" } }
};
const STYLE_SESSION = {
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } },
  font: { bold: true }
};
const STYLE_COL_HEADER = {
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } },
  font: { bold: true },
  alignment: { horizontal: "center", vertical: "middle" }
};
// Activity section heading: light indigo tint, bold, merged across all columns
const STYLE_ACT_HEADING = {
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E7FF" } },
  font: { bold: true }
};
// Daily Average: bright amber, bold
const STYLE_DAILY_AVG = {
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFBBF24" } },
  font: { bold: true }
};

// ─── PUBLIC ENTRY POINT ──────────────────────────────────────

function getAllTargets(student) {
  return student.targets || [];
}

export async function exportStudentData(student) {
  if (!student) return;

  const sessions = await getAllSessionsForStudent(student.id);
  if (sessions.length === 0) {
    alert("No session data found for " + student.name);
    return;
  }

  const allTargets = getAllTargets(student);

  const wb = new ExcelJS.Workbook();

  // ── Summary sheet (monthly averages grid) ──────────────
  const summaryRows = buildSummarySheet(allTargets, sessions);
  const summaryWs   = wb.addWorksheet("Summary");
  summaryRows.forEach(row => summaryWs.addRow(row));
  summaryWs.getColumn(1).width = 30;
  for (let c = 2; c <= (summaryRows[0]?.length || 1); c++) {
    summaryWs.getColumn(c).width = 12;
  }

  // ── One sheet per target ───────────────────────────────
  for (const target of allTargets) {
    const { rows, monthHeaderRows, sessionHeaderRows, columnHeaderRows, activityHeadingRows, dailyAvgRows } =
      buildTargetSheet(target, sessions);
    const ws = wb.addWorksheet(target.name.slice(0, 31));
    rows.forEach(row => ws.addRow(row));
    ws.getColumn(1).width     = 45;
    ws.getColumn(2).width     = 52;
    ws.getColumn(3).width     = 22;
    ws.getColumn(4).width     = 10;
    ws.getColumn(1).alignment = { wrapText: true, vertical: "top" };
    ws.getColumn(2).alignment = { wrapText: true, vertical: "top" };
    ws.getColumn(3).alignment = { horizontal: "center", vertical: "top" };
    ws.getColumn(4).alignment = { horizontal: "center", vertical: "top" };

    applyRowStyles(ws, monthHeaderRows,    STYLE_MONTH);
    applyRowStyles(ws, sessionHeaderRows,  STYLE_SESSION);
    applyRowStyles(ws, columnHeaderRows,   STYLE_COL_HEADER);

    // Activity section headings: merge A:D + style
    for (const rowIdx of activityHeadingRows) {
      const n = rowIdx + 1;
      ws.mergeCells(`A${n}:D${n}`);
      const cell = ws.getRow(n).getCell(1);
      cell.fill = STYLE_ACT_HEADING.fill;
      cell.font = STYLE_ACT_HEADING.font;
    }

    // Daily Average rows: bright amber across all 4 columns
    applyRowStyles(ws, dailyAvgRows, STYLE_DAILY_AVG);
  }

  // Filename: StudentName_DD-Mon-YYYY_HHmm.xlsx
  const now      = new Date();
  const monNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const dd       = String(now.getDate()).padStart(2, "0");
  const mon      = monNames[now.getMonth()];
  const yyyy     = now.getFullYear();
  const hh       = String(now.getHours()).padStart(2, "0");
  const mm       = String(now.getMinutes()).padStart(2, "0");
  const filename = `${student.name}_${dd}-${mon}-${yyyy}_${hh}${mm}.xlsx`;

  const buffer = await wb.xlsx.writeBuffer();
  const blob   = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement("a");
  a.href       = url;
  a.download   = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── STYLE HELPER ────────────────────────────────────────────

function applyRowStyles(ws, rowIndices, style) {
  for (const rowIdx of rowIndices) {
    for (let c = 1; c <= 4; c++) {
      const cell = ws.getRow(rowIdx + 1).getCell(c);
      if (style.fill)      cell.fill      = style.fill;
      if (style.font)      cell.font      = style.font;
      if (style.alignment) cell.alignment = style.alignment;
    }
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
          const eff  = snap
            ? { ...target, maxPoints: snap.maxPoints, predefinedActivities: snap.predefinedActivities || target.predefinedActivities || [] }
            : target;
          return calcDailyAverage(s, eff);
        })
        .filter(v => v !== null);
      row.push(dailyAvgs.length > 0 ? pct(avg(dailyAvgs)) : "");
    }
    rows.push(row);
  }

  return rows;
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
      const effectiveTarget = snap
        ? { ...target, maxPoints: snap.maxPoints, predefinedActivities: snap.predefinedActivities || target.predefinedActivities || [] }
        : target;
      appendSessionRows(rows, sessionHeaderRows, columnHeaderRows, activityHeadingRows, dailyAvgRows, session, effectiveTarget);
    }
  }

  return { rows, monthHeaderRows, sessionHeaderRows, columnHeaderRows, activityHeadingRows, dailyAvgRows };
}

// ─── SESSION ROWS ────────────────────────────────────────────

function appendSessionRows(rows, sessionHeaderRows, columnHeaderRows, activityHeadingRows, dailyAvgRows, session, target) {
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

      if (act.empty) {
        rows.push([act.activityName, "", "", ""]);
        continue;
      }

      const remarks = getRemarksForActivity(session, act.id);

      if (remarks.length === 0) {
        rows.push([act.activityName, "", "", ""]);
        continue;
      }

      let firstRemark = true;
      for (const rem of remarks) {
        const validTrials = (rem.trials || []).filter(t => t !== -1);
        const remarkAvg   = calcRemarkAvg(validTrials, target.maxPoints);
        rows.push([
          firstRemark ? act.activityName : "",
          rem.text || "",
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
    if (pa.isNote) continue;
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
    if (act.isHeading || act.empty) continue;
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
