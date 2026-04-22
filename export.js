// ============================================================
// EXPORT.JS — Excel export via SheetJS (loaded globally as XLSX)
// One .xlsx per student: a Summary sheet + one sheet per target.
// ============================================================

import { CONFIG } from "./config.js";
import { getAllSessionsForStudent, sanitizeKey } from "./firebase-service.js";

// ─── PUBLIC ENTRY POINT ──────────────────────────────────────

export async function exportStudentData(studentId) {
  const student = CONFIG.STUDENTS.find(s => s.id === studentId);
  if (!student) return;

  const sessions = await getAllSessionsForStudent(studentId);
  if (sessions.length === 0) {
    alert("No session data found for " + student.name);
    return;
  }

  const wb = XLSX.utils.book_new();

  // ── Summary sheet (monthly averages grid) ──────────────
  const summaryRows = buildSummarySheet(student, sessions);
  const summaryWs   = XLSX.utils.aoa_to_sheet(summaryRows);
  summaryWs["!cols"] = [{ wch: 30 }, ...Array(50).fill({ wch: 12 })];
  XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");

  // ── One sheet per target ───────────────────────────────
  for (const target of student.targets) {
    const rows = buildTargetSheet(target, sessions);
    const ws   = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 45 }, { wch: 52 }, { wch: 22 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, target.name);
  }

  // Filename: StudentName_YYYY-MM-DD.xlsx
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${student.name}_${today}.xlsx`);
}

// ─── SUMMARY SHEET ───────────────────────────────────────────
// Layout:
//   Target       | Jan 2026 | Feb 2026 | Mar 2026 | ...
//   Ex. Function |   78%    |   82%    |          |
//   FEDC 1       |   71%    |   74%    |          |
//   ...

function buildSummarySheet(student, sessions) {
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
  for (const target of student.targets) {
    const row = [target.name];
    for (const month of months) {
      const monthSessions = sessions.filter(s => s.month === month);
      const dailyAvgs = monthSessions
        .map(s => calcDailyAverage(s, target))
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
  let firstMonth = true;

  for (const [month, monthSessions] of byMonth) {
    const dailyAvgsForMonth = monthSessions
      .map(s => calcDailyAverage(s, target))
      .filter(v => v !== null);
    const monthlyAvg = dailyAvgsForMonth.length > 0
      ? avg(dailyAvgsForMonth) : null;

    if (!firstMonth) rows.push([]);
    firstMonth = false;

    rows.push([`${month}  —  Monthly Average: ${monthlyAvg !== null ? pct(monthlyAvg) : "N/A"}`]);
    rows.push([]);

    for (const session of monthSessions) {
      appendSessionRows(rows, session, target);
    }
  }

  return rows;
}

// ─── SESSION ROWS ────────────────────────────────────────────

function appendSessionRows(rows, session, target) {
  const monthName = session.month.split(" ")[0];
  rows.push([`Session ${session.sessionNumber} of ${monthName}  —  ${fmtDate(session.date)}`]);
  rows.push(["Activity", "Remark", "Trials", "Avg"]);

  const activities = getActivitiesForTarget(session, target);

  if (activities.length === 0) {
    rows.push(["(no data recorded)", "", "", ""]);
  } else {
    for (const act of activities) {
      const remarks = getRemarksForActivity(session, act.id);

      if (remarks.length === 0) {
        rows.push([act.activityName, "(no remarks)", "", ""]);
        continue;
      }

      let firstRemark = true;
      for (const rem of remarks) {
        const trials    = rem.trials || [];
        const remarkAvg = calcRemarkAvg(trials, target.maxPoints);
        rows.push([
          firstRemark ? act.activityName : "",
          rem.text || "",
          trials.join(", "),
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

function getActivitiesForTarget(session, target) {
  return Object.entries(session.activities || {})
    .filter(([, a]) => a.targetName === target.name)
    .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0))
    .map(([id, a]) => ({ id, ...a }));
}

function getRemarksForActivity(session, actId) {
  return Object.entries(session.remarks || {})
    .filter(([, r]) => r.activityId === actId)
    .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0))
    .map(([id, r]) => ({ id, ...r }));
}

// ─── CALCULATIONS ────────────────────────────────────────────

function calcRemarkAvg(trials, maxPoints) {
  if (!trials || trials.length === 0) return null;
  return trials.reduce((a, b) => a + b, 0) / (trials.length * maxPoints) * 100;
}

function calcDailyAverage(session, target) {
  const avgs = [];
  for (const act of getActivitiesForTarget(session, target)) {
    for (const rem of getRemarksForActivity(session, act.id)) {
      const a = calcRemarkAvg(rem.trials, target.maxPoints);
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
