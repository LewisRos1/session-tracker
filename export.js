// ============================================================
// EXPORT.JS — Excel export via SheetJS (loaded globally as XLSX)
// Generates one .xlsx per student, one sheet per target.
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

  for (const target of student.targets) {
    const rows = buildTargetSheet(target, sessions);
    const ws   = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 45 }, { wch: 52 }, { wch: 22 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, target.name);
  }

  XLSX.writeFile(wb, `${student.name}_therapy_data.xlsx`);
}

// ─── SHEET BUILDER ───────────────────────────────────────────

function buildTargetSheet(target, sessions) {
  // Group sessions by month (sessions already sorted oldest-first)
  const byMonth = new Map();
  for (const s of sessions) {
    if (!byMonth.has(s.month)) byMonth.set(s.month, []);
    byMonth.get(s.month).push(s);
  }

  const rows = [];
  let firstMonth = true;

  for (const [month, monthSessions] of byMonth) {
    // Calculate monthly average (only sessions with at least one trial)
    const dailyAvgsForMonth = monthSessions
      .map(s => calcDailyAverage(s, target))
      .filter(v => v !== null);
    const monthlyAvg = dailyAvgsForMonth.length > 0
      ? avg(dailyAvgsForMonth) : null;

    if (!firstMonth) rows.push([]); // blank row between months
    firstMonth = false;

    rows.push([`${month}  —  Monthly Average: ${monthlyAvg !== null ? pct(monthlyAvg) : "N/A"}`]);
    rows.push([]); // blank after month header

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
        const trials   = rem.trials || [];
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

    // FEDC free-text comment — rendered ONCE after all activities
    if (target.hasComment) {
      const commentText = (session.fedcComments || {})[sanitizeKey(target.name)] || "";
      if (commentText) {
        rows.push(["Comment", commentText, "", ""]);
      }
    }

    // Daily average row (only when there are trials)
    const daily = calcDailyAverage(session, target);
    if (daily !== null) {
      rows.push(["Daily Average", "", "", pct(daily)]);
    }
  }

  rows.push([]); // blank row between sessions
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

// Average for one remark: sum(trials) / (count × maxPoints)
function calcRemarkAvg(trials, maxPoints) {
  if (!trials || trials.length === 0) return null;
  return trials.reduce((a, b) => a + b, 0) / (trials.length * maxPoints) * 100;
}

// Daily average: mean of all remark averages that have trials (null if none)
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

function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ─── FORMAT HELPERS ──────────────────────────────────────────

function pct(v) { return Math.round(v) + "%"; }

function fmtDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}
