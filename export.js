// ============================================================
// EXPORT.JS — Excel export via SheetJS (loaded globally as XLSX)
// One .xlsx per student: a Summary sheet + one sheet per target.
// ============================================================

import { getAllSessionsForStudent, sanitizeKey } from "./firebase-service.js";

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

  const wb = XLSX.utils.book_new();

  // ── Summary sheet (monthly averages grid) ──────────────
  const summaryRows = buildSummarySheet(allTargets, sessions);
  const summaryWs   = XLSX.utils.aoa_to_sheet(summaryRows);
  summaryWs["!cols"] = [{ wch: 30 }, ...Array(50).fill({ wch: 12 })];
  XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");

  // ── One sheet per target ───────────────────────────────
  for (const target of allTargets) {
    const { rows, boldRows } = buildTargetSheet(target, sessions);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 45 }, { wch: 52 }, { wch: 22 }, { wch: 10 }];
    applyBoldRows(ws, boldRows);
    XLSX.utils.book_append_sheet(wb, ws, target.name);
  }

  // Filename: StudentName_DD-Mon-YYYY_HHmm.xlsx
  const now    = new Date();
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const dd     = String(now.getDate()).padStart(2, "0");
  const mon    = months[now.getMonth()];
  const yyyy   = now.getFullYear();
  const hh     = String(now.getHours()).padStart(2, "0");
  const mm     = String(now.getMinutes()).padStart(2, "0");
  XLSX.writeFile(wb, `${student.name}_${dd}-${mon}-${yyyy}_${hh}${mm}.xlsx`, { cellStyles: true });
}

// ─── BOLD HELPER ─────────────────────────────────────────────

function applyBoldRows(ws, boldRows) {
  const colLetters = ["A", "B", "C", "D"];
  for (const rowIdx of boldRows) {
    for (const col of colLetters) {
      const ref = col + (rowIdx + 1);
      if (!ws[ref]) ws[ref] = { v: "", t: "s" };
      ws[ref].s = { font: { bold: true } };
    }
  }
}

// ─── SUMMARY SHEET ───────────────────────────────────────────
// Layout:
//   Target       | Jan 2026 | Feb 2026 | Mar 2026 | ...
//   Ex. Function |   78%    |   82%    |          |
//   FEDC 1       |   71%    |   74%    |          |

function buildSummarySheet(allTargets, sessions) {
  // Collect all months, sorted chronologically
  const monthSet = new Set(sessions.map(s => s.month));
  const months   = [...monthSet].sort((a, b) => {
    const [ma, ya] = parseMonth(a);
    const [mb, yb] = parseMonth(b);
    return ya !== yb ? ya - yb : ma - mb;
  });

  const rows = [];

  // Header row
  rows.push(["Target", ...months]);

  // One row per target
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
  const boldRows = new Set();
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

    rows.push([`${month}  —  Monthly Average: ${monthlyAvg !== null ? pct(monthlyAvg) : "N/A"}`]);
    rows.push([]);

    for (const session of monthSessions) {
      const snap = (session.targetsSnapshot || []).find(t => t.name === target.name);
      const effectiveTarget = snap
        ? { ...target, maxPoints: snap.maxPoints, predefinedActivities: snap.predefinedActivities || target.predefinedActivities || [] }
        : target;
      appendSessionRows(rows, boldRows, session, effectiveTarget);
    }
  }

  return { rows, boldRows };
}

// ─── SESSION ROWS ────────────────────────────────────────────

function appendSessionRows(rows, boldRows, session, target) {
  const monthName = session.month.split(" ")[0];

  // Session header — bold
  boldRows.add(rows.length);
  rows.push([`Session ${session.sessionNumber} of ${monthName}  —  ${fmtDate(session.date)}`]);

  // Column headers — bold
  boldRows.add(rows.length);
  rows.push(["Activity", "Remark", "Trials", "Avg"]);

  const activities = getAllActivitiesForTarget(session, target);

  if (activities.length === 0) {
    rows.push(["(no data recorded)", "", "", ""]);
  } else {
    for (const act of activities) {
      if (act.empty) {
        // Predefined activity with no session entry
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

    // FEDC free-text comment — once, after all activities
    if (target.hasComment) {
      const commentText = (session.fedcComments || {})[sanitizeKey(target.name)] || "";
      if (commentText) rows.push(["Comment", commentText, "", ""]);
    }

    const daily = calcDailyAverage(session, target);
    if (daily !== null) rows.push(["Daily Average", "", "", pct(daily)]);
  }

  rows.push([]);
}

// ─── DATA HELPERS ────────────────────────────────────────────

/**
 * Returns a complete ordered activity list for a target in a session:
 * - All predefined activities (non-heading) appear in order, with
 *   { empty: true } when no session entry exists for that activity.
 * - Non-predefined (custom) activities appended after.
 */
function getAllActivitiesForTarget(session, target) {
  const predefinedNames = (target.predefinedActivities || [])
    .filter(pa => !pa.isHeading && pa.name)
    .map(pa => pa.name);

  const sessionActs = Object.entries(session.activities || {})
    .filter(([, a]) => a.targetName === target.name)
    .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0))
    .map(([id, a]) => ({ id, ...a }));

  const result = [];
  const usedIds = new Set();

  for (const name of predefinedNames) {
    const sessionAct = sessionActs.find(a => a.activityName === name && a.isPredefined);
    if (sessionAct) {
      usedIds.add(sessionAct.id);
      result.push(sessionAct);
    } else {
      result.push({ id: null, activityName: name, isPredefined: true, empty: true });
    }
  }

  // Append any custom (non-predefined) activities not already included
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
    if (act.empty) continue;
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
