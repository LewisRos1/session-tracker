// ============================================================
// APP.JS — Main application controller
// ============================================================

import { CONFIG } from "./config.js";
import {
  getOrCreateTodaySession,
  listenToSession,
  finishSession,
  addActivity,
  deleteActivity,
  updateActivityName,
  addRemark,
  updateRemarkText,
  deleteRemark,
  addTrial,
  deleteTrial,
  getTodayUnfinishedStudentIds,
  getRecentSessionsForStudent,
  loadStudentsConfig,
  saveStudent,
  deleteStudentConfig,
  loadTemplates,
  saveTemplate,
  deleteTemplate,
  sanitizeKey,
  getTodayString
} from "./firebase-service.js";
import { exportStudentData } from "./export.js";

const APP_VERSION = "v26";

// ─── STATE ───────────────────────────────────────────────────
const state = {
  authenticated:      false,
  students:           [],
  templates:          [],
  unfinishedIds:      new Set(),
  searchQuery:        "",
  currentStudent:     null,
  currentSessionId:   null,
  sessionData:        null,
  selectedTargetName: null,
  fbUnsubscribe:      null,
  renderPending:      false,
  flashActive:        false,
  _flashTimer:        null,
  scorePicker:        { open: false, remId: null },
  pendingNewRemark:   null,
  pendingNewActivity: null
};

const $ = id => document.getElementById(id);

// ─── INIT ────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  document.addEventListener("focusout", () => {
    if (state.renderPending) {
      state.renderPending = false;
      renderTargetContent();
    }
  });

  // Load student config from Firebase (seeds from INITIAL_STUDENTS if empty)
  try {
    let students = await loadStudentsConfig();
    if (students.length === 0) {
      for (const s of CONFIG.INITIAL_STUDENTS) await saveStudent(s);
      students = CONFIG.INITIAL_STUDENTS;
    }
    state.students = students;
  } catch (_) {
    state.students = CONFIG.INITIAL_STUDENTS;
  }

  // Load templates
  try {
    state.templates = await loadTemplates();
  } catch (_) {}

  if (sessionStorage.getItem("auth") === "1") {
    showHome();
  } else {
    initPin();
  }

  registerServiceWorker();
});

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    window.location.reload();
  });
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// ============================================================
// PIN SCREEN
// ============================================================

function initPin() {
  showScreen("screen-pin");
  const input  = $("pin-input");
  const errMsg = $("pin-error");

  const check = () => {
    if (input.value.trim().toUpperCase() === CONFIG.PIN) {
      sessionStorage.setItem("auth", "1");
      input.value = "";
      errMsg.classList.add("hidden");
      showHome();
    } else {
      errMsg.classList.remove("hidden");
      input.value = "";
      input.focus();
    }
  };

  $("pin-submit").addEventListener("click", check);
  input.addEventListener("keydown", e => { if (e.key === "Enter") check(); });
  setTimeout(() => input.focus(), 100);
}

// ============================================================
// HOME SCREEN
// ============================================================

async function showHome() {
  showScreen("screen-home");
  const verEl = document.getElementById("app-version");
  if (verEl) verEl.textContent = `Made by Lewis · ${APP_VERSION}`;
  // Clear search when returning home
  state.searchQuery = "";
  const searchEl = $("home-search");
  if (searchEl) searchEl.value = "";
  renderExistingStudentButtons(state.unfinishedIds);
  renderAssessmentStudentButtons(state.unfinishedIds);
  renderTemplateButtons();
  renderExportButtons();
  try {
    const unfinished = await getTodayUnfinishedStudentIds();
    state.unfinishedIds = unfinished;
    renderExistingStudentButtons(unfinished);
    renderAssessmentStudentButtons(unfinished);
  } catch (_) {}
}

// ── Add student / template from home screen ───────────────────

$("btn-add-existing-student").addEventListener("click", () => addNewStudent("existing"));
$("btn-add-assessment-student").addEventListener("click", () => addNewStudent("assessment"));
$("btn-add-template").addEventListener("click", addNewTemplate);

$("home-search").addEventListener("input", e => {
  state.searchQuery = e.target.value;
  renderExistingStudentButtons(state.unfinishedIds);
  renderAssessmentStudentButtons(state.unfinishedIds);
  renderTemplateButtons();
});

async function addNewStudent(type) {
  const label = type === "assessment" ? "Assessment student name:" : "Student name:";
  const name = prompt(label);
  if (!name?.trim()) return;
  const s = {
    id: cfgId("s"),
    name: name.trim(),
    type,
    order: state.students.length,
    targets: []
  };
  state.students.push(s);
  await saveStudent(s);
  if (type === "existing") renderExistingStudentButtons(state.unfinishedIds);
  else renderAssessmentStudentButtons(state.unfinishedIds);
}

async function addNewTemplate() {
  const name = prompt("Template name:");
  if (!name?.trim()) return;
  const t = {
    id: cfgId("tmpl"),
    name: name.trim(),
    order: state.templates.length,
    predefinedActivities: [],
    notes: [],
    maxPoints: 3
  };
  state.templates.push(t);
  await saveTemplate(t);
  renderTemplateButtons();
  openManageModal(null, null, t);
}

// ── Render helpers ────────────────────────────────────────────

function renderStudentList(container, students, unfinishedIds) {
  if (!container) return;
  const q = state.searchQuery.toLowerCase();
  const filtered = students
    .filter(s => !q || s.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (filtered.length === 0) {
    container.innerHTML = q
      ? `<p class="empty-hint">No matches.</p>`
      : `<p class="empty-hint">None yet.</p>`;
    return;
  }
  container.innerHTML = `<div class="roster-list">` +
    filtered.map(s => `
      <button class="roster-item" data-id="${s.id}">
        <span class="roster-item-name">${escHtml(s.name)}</span>
        ${unfinishedIds.has(s.id)
          ? `<span class="session-indicator" title="Unfinished session today"></span>`
          : ""}
      </button>
    `).join("") +
    `</div>`;
  container.querySelectorAll(".roster-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const student = state.students.find(s => s.id === btn.dataset.id);
      if (student) showStudentChoice(student);
    });
  });
}

function renderExistingStudentButtons(unfinishedIds) {
  const students = state.students.filter(s => !s.type || s.type === "existing");
  renderStudentList($("existing-student-buttons"), students, unfinishedIds);
}

function renderAssessmentStudentButtons(unfinishedIds) {
  const students = state.students.filter(s => s.type === "assessment");
  renderStudentList($("assessment-student-buttons"), students, unfinishedIds);
}

function renderTemplateButtons() {
  const container = $("template-buttons");
  if (!container) return;
  const q = state.searchQuery.toLowerCase();
  const filtered = state.templates
    .filter(t => !q || t.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  let html = "";
  if (filtered.length === 0 && !q) {
    html = `<p class="empty-hint">No templates yet.</p>`;
  } else if (filtered.length === 0) {
    html = `<p class="empty-hint">No matches.</p>`;
  } else {
    html = `<div class="roster-list">` +
      filtered.map(t => `
        <button class="roster-item" data-id="${t.id}">
          <span class="roster-item-name">${escHtml(t.name)}</span>
        </button>
      `).join("") +
      `</div>`;
  }
  container.innerHTML = html;

  container.querySelectorAll(".roster-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const tmpl = state.templates.find(t => t.id === btn.dataset.id);
      if (tmpl) openManageModal(null, null, tmpl);
    });
  });
}

function renderExportButtons() {
  const container = $("export-buttons");
  if (!container) return;
  container.innerHTML = state.students.map(s => `
    <button class="export-btn" data-id="${s.id}">Export ${escHtml(s.name)}</button>
  `).join("");
  container.querySelectorAll(".export-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const student = state.students.find(s => s.id === btn.dataset.id);
      if (!student) return;
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Generating…";
      try {
        await exportStudentData(student);
      } catch (err) {
        alert("Export failed: " + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = orig;
      }
    });
  });
}

// ============================================================
// SESSION PICKER
// ============================================================

// Show three-choice sheet: Today's Session | Edit Past Sessions | Manage Student
function showStudentChoice(student) {
  $("session-picker-title").textContent = student.name;
  $("session-picker-list").innerHTML = `
    <div class="choice-list">
      <button class="choice-btn choice-today">
        <span class="choice-icon">▶</span>
        <div class="choice-text">
          <div class="choice-label">Today's Session</div>
        </div>
      </button>
      <button class="choice-btn choice-other">
        <span class="choice-icon">🗂</span>
        <div class="choice-text">
          <div class="choice-label">Edit Past Sessions</div>
        </div>
      </button>
      <button class="choice-btn choice-manage">
        <span class="choice-icon">✏</span>
        <div class="choice-text">
          <div class="choice-label">Manage Student</div>
        </div>
      </button>
    </div>`;
  $("session-picker-modal").classList.remove("hidden");

  $("session-picker-list").querySelector(".choice-today").addEventListener("click", () => {
    closeSessionPicker();
    openSession(student, null);
  });
  $("session-picker-list").querySelector(".choice-other").addEventListener("click", () => {
    showSessionPicker(student);
  });
  $("session-picker-list").querySelector(".choice-manage").addEventListener("click", () => {
    closeSessionPicker();
    openManageModal(student, null);
  });
}

// Page 1: month grid
async function showSessionPicker(student) {
  $("session-picker-title").textContent = student.name;
  $("session-picker-list").innerHTML =
    `<div class="session-picker-loading">Loading sessions…</div>`;
  $("session-picker-modal").classList.remove("hidden");

  let sessions = [];
  try { sessions = await getRecentSessionsForStudent(student.id); } catch (_) {}

  const today = getTodayString();
  const byMonth = new Map();
  for (const s of sessions) {
    if (!byMonth.has(s.month)) byMonth.set(s.month, []);
    byMonth.get(s.month).push(s);
  }

  if (byMonth.size === 0) {
    $("session-picker-list").innerHTML =
      `<div class="session-picker-loading">No sessions found.</div>`;
    return;
  }

  renderMonthGrid(student, byMonth, today);
}

function renderMonthGrid(student, byMonth, today) {
  $("session-picker-title").textContent = student.name;

  let html = `<div class="month-grid">`;
  for (const month of byMonth.keys()) {
    const [name, year] = month.split(" ");
    const abbr = name.slice(0, 3);
    html += `<button class="month-grid-btn" data-month="${escHtml(month)}">
      <span class="mgb-month">${escHtml(abbr)}</span>
      <span class="mgb-year">${escHtml(year)}</span>
    </button>`;
  }
  html += `</div>`;

  const list = $("session-picker-list");
  list.innerHTML = html;

  list.querySelectorAll(".month-grid-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const month = btn.dataset.month;
      renderSessionsForMonth(student, month, byMonth.get(month), byMonth, today);
    });
  });
}

// Page 2: sessions for chosen month
function renderSessionsForMonth(student, month, monthSessions, byMonth, today) {
  $("session-picker-title").textContent = month;

  const list = $("session-picker-list");
  let html = `<button class="btn-picker-back">← Back</button>`;

  for (const s of monthSessions) {
    const isToday    = s.date === today;
    const badge      = isToday ? (s.finished ? "Finished" : "In Progress")
                               : (s.finished ? "Finished" : "Unfinished");
    const badgeClass = s.finished ? "badge-finished" : "badge-inprogress";
    const dateLabel  = isToday ? `Today · ${formatDate(s.date)}` : formatDate(s.date);
    html += `<div class="session-list-item" data-session-id="${s.id}">
      <div class="session-list-meta">
        <div class="session-list-label">Session ${s.sessionNumber} of ${s.month.split(" ")[0]}</div>
        <div class="session-list-date">${dateLabel}</div>
      </div>
      <span class="session-list-badge ${badgeClass}">${badge}</span>
    </div>`;
  }

  list.innerHTML = html;

  list.querySelector(".btn-picker-back").addEventListener("click", () => {
    renderMonthGrid(student, byMonth, today);
  });

  list.querySelectorAll(".session-list-item").forEach(item => {
    item.addEventListener("click", () => {
      closeSessionPicker();
      openSession(student, item.dataset.sessionId);
    });
  });
}

function closeSessionPicker() {
  $("session-picker-modal").classList.add("hidden");
}

$("session-picker-close").addEventListener("click",    closeSessionPicker);
$("session-picker-backdrop").addEventListener("click", closeSessionPicker);

// ============================================================
// SESSION SCREEN
// ============================================================

async function openSession(student, existingSessionId = null) {
  state.currentStudent     = student;
  state.selectedTargetName = student.targets[0]?.name || null;
  state.sessionData        = null;
  state.pendingNewActivity = null;
  state.pendingNewRemark   = null;
  state.renderPending      = false;

  showScreen("screen-session");
  $("session-student-name").textContent = student.name;
  $("session-meta").textContent = "";
  $("target-content").innerHTML = `<div class="loading">Loading…</div>`;

  if (state.fbUnsubscribe) { state.fbUnsubscribe(); state.fbUnsubscribe = null; }

  try {
    const sessionId = existingSessionId
      ? existingSessionId
      : await getOrCreateTodaySession(student.id);
    state.currentSessionId = sessionId;

    state.fbUnsubscribe = listenToSession(sessionId, data => {
      state.sessionData = data;
      const active = document.activeElement;
      const busy   = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
      if (busy || state.flashActive) {
        state.renderPending = true;
      } else {
        renderTargetContent();
      }
    });

    populateTargetDropdown(student.targets);

  } catch (err) {
    $("target-content").innerHTML =
      `<div class="error-msg">Could not load session.<br>${escHtml(err.message)}</div>`;
  }
}

function leaveSession() {
  if (state.fbUnsubscribe) { state.fbUnsubscribe(); state.fbUnsubscribe = null; }
  state.currentSessionId   = null;
  state.sessionData        = null;
  state.currentStudent     = null;
  state.pendingNewActivity = null;
  state.pendingNewRemark   = null;
  state.renderPending      = false;
  showHome();
}

function updateSessionHeader() {
  const d = state.sessionData;
  if (!d) return;
  $("session-meta").textContent =
    `Session ${d.sessionNumber} of ${d.month.split(" ")[0]} · ${formatDate(d.date)}`;
  const finishBtn = $("btn-finish-session");
  if (d.finished) {
    finishBtn.textContent = "Session Finished";
    finishBtn.disabled    = true;
    finishBtn.classList.add("finished");
  } else {
    finishBtn.textContent = "Finish Session";
    finishBtn.disabled    = false;
    finishBtn.classList.remove("finished");
  }
}

function populateTargetDropdown(targets) {
  const sel = $("target-select");
  sel.innerHTML = targets.map(t =>
    `<option value="${escHtml(t.name)}">${escHtml(t.name)}</option>`
  ).join("") + `<option value="__add_target__">+ Add Target…</option>`;

  sel.value = state.selectedTargetName || targets[0]?.name || "";

  sel.onchange = async () => {
    if (sel.value === "__add_target__") {
      sel.value = state.selectedTargetName || targets[0]?.name || "";
      showAddTargetPicker(state.currentStudent);
      return;
    }
    state.selectedTargetName = sel.value;
    state.pendingNewActivity = null;
    state.pendingNewRemark   = null;
    renderTargetContent();
  };
}

$("btn-back").addEventListener("click", leaveSession);
$("btn-finish-session").addEventListener("click", async () => {
  if (!state.currentSessionId) return;
  if (!confirm("Mark this session as finished?")) return;
  await finishSession(state.currentSessionId);
});

// ============================================================
// TARGET CONTENT RENDERING
// ============================================================

function calcDaysAverage(target) {
  let totalScore = 0;
  let totalPossible = 0;
  for (const act of getActivitiesForTarget(target.name)) {
    for (const rem of getRemarksForActivity(act.id)) {
      const trials = rem.trials || [];
      if (trials.length === 0) continue;
      totalScore    += trials.reduce((a, b) => a + b, 0);
      totalPossible += trials.length * (target.maxPoints || 3);
    }
  }
  return totalPossible > 0 ? Math.round(totalScore / totalPossible * 100) : null;
}

function renderTargetContent() {
  if (!state.sessionData || !state.selectedTargetName) return;
  const target = state.currentStudent.targets.find(
    t => t.name === state.selectedTargetName
  );
  if (!target) return;

  updateSessionHeader();

  const avg = calcDaysAverage(target);
  const avgEl = $("days-average-value");
  if (avgEl) avgEl.textContent = avg !== null ? avg + "%" : "—";

  const container = $("target-content");
  container.innerHTML = target.predefinedActivities?.length > 0
    ? renderFedcTarget(target)
    : renderRegularTarget(target);

  attachTargetListeners(target);
}

// ─── FEDC TARGET ─────────────────────────────────────────────

function renderFedcTarget(target) {
  let html = "";

  const letters = "abcdefghij";
  let lastGroup = null;
  target.predefinedActivities.forEach((pa, idx) => {
    // New format: explicit heading row
    if (pa.isHeading) {
      html += `<div class="activity-group-heading">${escHtml(pa.name)}</div>`;
      return;
    }

    // Old format: group field per activity (backward compat)
    if (pa.group && pa.group !== lastGroup) {
      lastGroup = pa.group;
      html += `<div class="activity-group-heading">${escHtml(pa.group)}</div>`;
    } else if (!pa.group) {
      lastGroup = null;
    }

    const pendingKey = pa.name;
    const actData    = findActivityByName(target.name, pa.name);
    const actId      = actData ? actData.id : null;
    const remarks    = actId ? getRemarksForActivity(actId) : [];
    const isPending  = state.pendingNewRemark?.pendingKey === pendingKey;

    html += `<div class="entry-block entry-block-predefined">
      <div class="entry-field">
        <span class="field-label">Activity</span>
        <span class="field-value-fixed">${escHtml(pa.name)}</span>
      </div>`;

    // Reference notes (a, b, c… sub-items)
    if (pa.note && pa.note.length > 0) {
      const noteHtml = pa.note.map((line, i) =>
        `${letters[i]}) ${escHtml(line)}`
      ).join("<br>");
      html += `<div class="activity-note">${noteHtml}</div>`;
    }

    if (pa.predefinedRemarks) {
      for (const predRemName of pa.predefinedRemarks) {
        const rem = actId ? findRemarkByPredefinedKey(actId, predRemName) : null;
        if (rem) {
          html += renderPredefinedRemarkFields(rem, predRemName, target);
        } else {
          html += renderGhostRemarkFields(predRemName, actId, pa, idx, target);
        }
      }
    } else {
      for (const rem of remarks) {
        html += renderRemarkFields(rem, target);
      }
      if (isPending) {
        html += renderPendingRemarkFields(pendingKey, actId, pa.name, idx, target);
      } else {
        html += `<button class="btn-add-remark"
          data-pending-key="${escHtml(pendingKey)}"
          data-act-id="${actId || ""}"
          data-pa-name="${escHtml(pa.name)}"
          data-pa-order="${idx}"
          data-target="${escHtml(target.name)}">+ Add Remark</button>`;
      }
    }

    html += `</div>`;
  });

  // Target-level reference notes
  if (target.notes?.length > 0) {
    html += `<div class="target-notes">`;
    for (const n of target.notes) {
      if (n.text) html += `<div class="target-note-item">📌 ${escHtml(n.text)}</div>`;
    }
    html += `</div>`;
  }

  // One-off activities added just for this session (white, same as free-form)
  const manualActivities = getActivitiesForTarget(target.name).filter(a => !a.isPredefined);
  for (const act of manualActivities) {
    const pendingKey = act.id;
    const isPending  = state.pendingNewRemark?.pendingKey === pendingKey;
    const remarks    = getRemarksForActivity(act.id);

    html += `<div class="entry-block" data-act-id="${act.id}">
      <div class="entry-field">
        <span class="field-label">Activity</span>
        <input class="field-input activity-name-input"
          type="text"
          value="${escHtml(act.activityName)}"
          data-act-id="${act.id}"
          data-original="${escHtml(act.activityName)}" />
        <button class="btn-icon btn-delete-activity"
          data-act-id="${act.id}" title="Delete activity">🗑</button>
      </div>`;

    for (const rem of remarks) {
      html += renderRemarkFields(rem, target);
    }
    if (isPending) {
      html += renderPendingRemarkFields(pendingKey, act.id, null, null, target);
    } else {
      html += `<button class="btn-add-remark"
        data-pending-key="${escHtml(pendingKey)}"
        data-act-id="${act.id}"
        data-target="${escHtml(target.name)}">+ Add Remark</button>`;
    }
    html += `</div>`;
  }

  // Pending new one-off activity
  if (state.pendingNewActivity?.targetName === target.name) {
    html += `<div class="entry-block">
      <div class="entry-field">
        <span class="field-label">Activity</span>
        <input id="new-activity-input" class="field-input"
          type="text" placeholder="Type activity name…" maxlength="200" />
        <button class="btn-icon btn-cancel-new-activity" title="Cancel">✕</button>
      </div>
    </div>`;
  }

  html += `<button class="btn-add-activity"
    data-target="${escHtml(target.name)}">+ Add Activity</button>`;

  return html;
}

// ─── REGULAR TARGET ──────────────────────────────────────────

function renderRegularTarget(target) {
  const activities = getActivitiesForTarget(target.name);
  let html = "";

  if (target.notes?.length > 0) {
    html += `<div class="target-notes">`;
    for (const n of target.notes) {
      if (n.text) html += `<div class="target-note-item">📌 ${escHtml(n.text)}</div>`;
    }
    html += `</div>`;
  }

  for (const act of activities) {
    const pendingKey = act.id;
    const isPending  = state.pendingNewRemark?.pendingKey === pendingKey;
    const remarks    = getRemarksForActivity(act.id);

    html += `<div class="entry-block" data-act-id="${act.id}">
      <div class="entry-field">
        <span class="field-label">Activity</span>
        <input class="field-input activity-name-input"
          type="text"
          value="${escHtml(act.activityName)}"
          data-act-id="${act.id}"
          data-original="${escHtml(act.activityName)}" />
        <button class="btn-icon btn-delete-activity"
          data-act-id="${act.id}" title="Delete activity">🗑</button>
      </div>`;

    for (const rem of remarks) {
      html += renderRemarkFields(rem, target);
    }

    if (isPending) {
      html += renderPendingRemarkFields(pendingKey, act.id, null, null, target);
    } else {
      html += `<button class="btn-add-remark"
        data-pending-key="${escHtml(pendingKey)}"
        data-act-id="${act.id}"
        data-target="${escHtml(target.name)}">+ Add Remark</button>`;
    }

    html += `</div>`;
  }

  // Pending new activity block
  if (state.pendingNewActivity?.targetName === target.name) {
    html += `<div class="entry-block">
      <div class="entry-field">
        <span class="field-label">Activity</span>
        <input id="new-activity-input" class="field-input"
          type="text" placeholder="Type activity name…" maxlength="200" />
        <button class="btn-icon btn-cancel-new-activity" title="Cancel">✕</button>
      </div>
    </div>`;
  }

  html += `<button class="btn-add-activity"
    data-target="${escHtml(target.name)}">+ Add Activity</button>`;

  return html;
}

// ─── REMARK FIELDS ───────────────────────────────────────────

function renderRemarkFields(rem, target) {
  const trials = rem.trials || [];
  const badgesHtml = trials.map((score, idx) =>
    `<span class="trial-badge">${score}<button class="btn-trial-delete"
      data-rem-id="${rem.id}" data-idx="${idx}">×</button></span>`
  ).join("");

  return `
    <div class="entry-divider"></div>
    <div class="entry-field">
      <span class="field-label">Remark</span>
      <textarea class="field-input remark-text-input"
        data-rem-id="${rem.id}"
        data-original="${escHtml(rem.text || "")}"
        rows="2">${escHtml(rem.text || "")}</textarea>
      <button class="btn-icon btn-delete-remark"
        data-rem-id="${rem.id}" title="Delete remark">🗑</button>
    </div>
    <div class="entry-field">
      <span class="field-label">Trials</span>
      <div class="trials-row">
        <div class="trials-badges">${badgesHtml}</div>
        <button class="btn-add-trial btn-primary-sm"
          data-rem-id="${rem.id}"
          data-target="${escHtml(target.name)}">+ Trial</button>
      </div>
    </div>`;
}

function renderPendingRemarkFields(pendingKey, actId, paName, paOrder, target) {
  return `
    <div class="entry-divider"></div>
    <div class="entry-field">
      <span class="field-label">Remark</span>
      <textarea id="new-remark-textarea" class="field-input"
        placeholder="Type remark… (Enter to save, Shift+Enter for new line)" rows="2"></textarea>
      <button class="btn-icon btn-cancel-remark" title="Cancel">✕</button>
    </div>`;
}

// Predefined remark that exists in Firebase — label as field-label, editable text input
function renderPredefinedRemarkFields(rem, predRemName, target) {
  const trials = rem.trials || [];
  const badgesHtml = trials.map((score, idx) =>
    `<span class="trial-badge">${score}<button class="btn-trial-delete"
      data-rem-id="${rem.id}" data-idx="${idx}">×</button></span>`
  ).join("");
  return `
    <div class="entry-divider"></div>
    <div class="entry-field">
      <span class="field-label">${escHtml(predRemName)}</span>
      <input class="field-input predef-remark-input-live"
        type="text"
        value="${escHtml(rem.text || "")}"
        data-rem-id="${rem.id}"
        data-original="${escHtml(rem.text || "")}"
        placeholder="e.g. 80%" />
    </div>
    <div class="entry-field">
      <span class="field-label">Trials</span>
      <div class="trials-row">
        <div class="trials-badges">${badgesHtml}</div>
        <button class="btn-add-trial btn-primary-sm"
          data-rem-id="${rem.id}"
          data-target="${escHtml(target.name)}">+ Trial</button>
      </div>
    </div>`;
}

// Predefined remark not yet in Firebase — label + empty text input
function renderGhostRemarkFields(predRemName, actId, pa, paIdx, target) {
  return `
    <div class="entry-divider"></div>
    <div class="entry-field">
      <span class="field-label">${escHtml(predRemName)}</span>
      <input class="field-input predef-remark-input"
        type="text"
        placeholder="e.g. 80%"
        data-rem-name="${escHtml(predRemName)}"
        data-act-id="${actId || ""}"
        data-pa-name="${escHtml(pa.name)}"
        data-pa-order="${paIdx}"
        data-target="${escHtml(target.name)}" />
    </div>
    <div class="entry-field">
      <span class="field-label">Trials</span>
      <div class="trials-row">
        <div class="trials-badges"></div>
        <button class="btn-primary-sm btn-init-predef-remark"
          data-rem-name="${escHtml(predRemName)}"
          data-act-id="${actId || ""}"
          data-pa-name="${escHtml(pa.name)}"
          data-pa-order="${paIdx}"
          data-target="${escHtml(target.name)}">+ Trial</button>
      </div>
    </div>`;
}

// ─── ATTACH LISTENERS ────────────────────────────────────────

function attachTargetListeners(target) {
  const c = $("target-content");

  // ── Activity name: auto-save on blur ─────────────────────
  c.querySelectorAll(".activity-name-input").forEach(input => {
    input.addEventListener("blur", async () => {
      const newName = input.value.trim();
      const original = input.dataset.original;
      if (!newName) { input.value = original; return; }
      if (newName !== original) {
        input.dataset.original = newName;
        flashSaved(input);
        await updateActivityName(state.currentSessionId, input.dataset.actId, newName);
      }
    });
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    });
  });

  // ── New activity input ───────────────────────────────────
  c.querySelector(".btn-add-activity")?.addEventListener("click", () => {
    state.pendingNewActivity = { targetName: target.name };
    state.pendingNewRemark   = null;
    renderTargetContent();
    setTimeout(() => $("new-activity-input")?.focus(), 50);
  });

  $("new-activity-input")?.addEventListener("keydown", e => {
    if (e.key === "Enter") confirmNewActivity(target);
    if (e.key === "Escape") cancelPendingActivity();
  });

  $("new-activity-input")?.addEventListener("blur", e => {
    // Small delay so cancel button click can fire first
    setTimeout(() => {
      const input = $("new-activity-input");
      if (!input) return; // already removed by cancel
      const name = input.value.trim();
      state.pendingNewActivity = null;
      if (name) {
        addActivity(state.currentSessionId, target.name, name, Date.now(), false);
      } else {
        renderTargetContent();
      }
    }, 150);
  });

  c.querySelector(".btn-cancel-new-activity")?.addEventListener("click", cancelPendingActivity);

  // ── Delete activity ───────────────────────────────────────
  c.querySelectorAll(".btn-delete-activity").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this activity and all its remarks?")) return;
      const remIds = getRemarksForActivity(btn.dataset.actId).map(r => r.id);
      await deleteActivity(state.currentSessionId, btn.dataset.actId, remIds);
    });
  });

  // ── Remark text: Enter saves, Shift+Enter = new line, blur saves ──
  c.querySelectorAll(".remark-text-input").forEach(ta => {
    ta.addEventListener("blur", async () => {
      const newText  = ta.value.trim();
      const original = ta.dataset.original;
      if (newText !== original) {
        ta.dataset.original = newText;
        flashSaved(ta);
        await updateRemarkText(state.currentSessionId, ta.dataset.remId, newText);
      }
    });
    ta.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ta.blur(); }
    });
  });

  // ── Add remark ────────────────────────────────────────────
  c.querySelectorAll(".btn-add-remark").forEach(btn => {
    btn.addEventListener("click", () => {
      state.pendingNewRemark = {
        pendingKey: btn.dataset.pendingKey,
        actId:      btn.dataset.actId   || null,
        paName:     btn.dataset.paName  || null,
        paOrder:    btn.dataset.paOrder !== undefined ? Number(btn.dataset.paOrder) : null
      };
      state.pendingNewActivity = null;
      renderTargetContent();
      setTimeout(() => $("new-remark-textarea")?.focus(), 50);
    });
  });

  // ── New remark: Enter saves, Shift+Enter = new line, blur also saves ──
  const newRemTa = $("new-remark-textarea");
  if (newRemTa) {
    newRemTa.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveNewRemark(target); }
    });
    newRemTa.addEventListener("blur", () => {
      setTimeout(() => {
        if (!state.pendingNewRemark) return; // already saved by Enter
        saveNewRemark(target);
      }, 150);
    });
  }

  // ── Cancel new remark ─────────────────────────────────────
  c.querySelectorAll(".btn-cancel-remark").forEach(btn => {
    btn.addEventListener("click", () => {
      state.pendingNewRemark = null;
      renderTargetContent();
    });
  });

  // ── Delete remark ─────────────────────────────────────────
  c.querySelectorAll(".btn-delete-remark").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this remark and its trials?")) return;
      await deleteRemark(state.currentSessionId, btn.dataset.remId);
    });
  });

  // ── Ghost predefined remark input: save text on blur ──────
  c.querySelectorAll(".predef-remark-input").forEach(input => {
    input.addEventListener("blur", async () => {
      const text = input.value.trim();
      if (!text) return;
      const paOrder = input.dataset.paOrder !== "" ? Number(input.dataset.paOrder) : 0;
      const actId = await ensureFedcActivity(input.dataset.target, input.dataset.paName, paOrder);
      const remId = await ensurePredefinedRemark(actId, input.dataset.remName, text);
      await updateRemarkText(state.currentSessionId, remId, text);
    });
  });

  // ── Live predefined remark input: auto-save on blur ────────
  c.querySelectorAll(".predef-remark-input-live").forEach(input => {
    input.addEventListener("blur", async () => {
      const text = input.value.trim();
      const original = input.dataset.original;
      if (text !== original) {
        input.dataset.original = text;
        flashSaved(input);
        await updateRemarkText(state.currentSessionId, input.dataset.remId, text);
      }
    });
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    });
  });

  // ── Init predefined remark + open score picker ────────────
  c.querySelectorAll(".btn-init-predef-remark").forEach(btn => {
    btn.addEventListener("click", async () => {
      const tgt = state.currentStudent.targets.find(t => t.name === btn.dataset.target);
      if (!tgt) return;
      const paOrder = btn.dataset.paOrder !== "" ? Number(btn.dataset.paOrder) : 0;
      const actId = await ensureFedcActivity(tgt.name, btn.dataset.paName, paOrder);
      // Capture any text the boss already typed in the ghost input
      const ghostInput = [...c.querySelectorAll(".predef-remark-input")].find(
        inp => inp.dataset.remName === btn.dataset.remName
      );
      const initialText = ghostInput?.value.trim() || "";
      const remId = await ensurePredefinedRemark(actId, btn.dataset.remName, initialText);
      if (initialText) await updateRemarkText(state.currentSessionId, remId, initialText);
      openScorePicker(remId, tgt.maxPoints || 3);
    });
  });

  // ── Add trial ─────────────────────────────────────────────
  c.querySelectorAll(".btn-add-trial").forEach(btn => {
    btn.addEventListener("click", () => {
      const tgt = state.currentStudent.targets.find(t => t.name === btn.dataset.target);
      openScorePicker(btn.dataset.remId, tgt?.maxPoints || 3);
    });
  });

  // ── Delete trial ──────────────────────────────────────────
  c.querySelectorAll(".btn-trial-delete").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.stopPropagation();
      const rem = state.sessionData?.remarks?.[btn.dataset.remId];
      if (!rem) return;
      await deleteTrial(state.currentSessionId, btn.dataset.remId,
        Number(btn.dataset.idx), rem.trials || []);
    });
  });

}

// ─── ACTION HELPERS ──────────────────────────────────────────

async function confirmNewActivity(target) {
  const input = $("new-activity-input");
  if (!input) return;
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  state.pendingNewActivity = null;
  flashSaved(input);
  input.value = "";  // blur handler sees empty → calls renderTargetContent at +150ms
  input.blur();      // dismiss keyboard; flash shows for ~150ms then input removed
  await addActivity(state.currentSessionId, target.name, name, Date.now(), false);
}

function cancelPendingActivity() {
  state.pendingNewActivity = null;
  renderTargetContent();
}

async function saveNewRemark(target) {
  const ta = $("new-remark-textarea");
  if (!ta || !state.pendingNewRemark) return;

  const text    = ta.value;
  const p       = state.pendingNewRemark;
  const paName  = p.paName || null;
  const paOrder = p.paOrder ?? 0;
  let   actId   = p.actId  || null;

  state.pendingNewRemark = null; // prevent blur-handler double-save
  flashSaved(ta);
  ta.blur(); // clear focus so Firebase snapshot can trigger re-render

  if (paName) actId = await ensureFedcActivity(target.name, paName, paOrder);
  if (!actId) return;
  await addRemark(state.currentSessionId, actId, text);
}

async function ensureFedcActivity(targetName, activityName, order) {
  const existing = findActivityByName(targetName, activityName);
  if (existing) return existing.id;
  return await addActivity(state.currentSessionId, targetName, activityName, order, true);
}

async function ensurePredefinedRemark(actId, remarkName, initialText = "") {
  const existing = findRemarkByPredefinedKey(actId, remarkName);
  if (existing) return existing.id;
  return await addRemark(state.currentSessionId, actId, initialText, remarkName);
}

function findRemarkByPredefinedKey(actId, key) {
  const found = Object.entries(state.sessionData?.remarks || {}).find(
    ([, r]) => r.activityId === actId && r.predefinedKey === key
  );
  return found ? { id: found[0], ...found[1] } : null;
}

// ─── SCORE PICKER MODAL ──────────────────────────────────────

function openScorePicker(remId, maxPoints) {
  state.scorePicker = { open: true, remId };
  const labels = CONFIG.SCORE_LABELS[maxPoints] || CONFIG.SCORE_LABELS[3];

  $("score-buttons").innerHTML = Object.entries(labels).map(([score, label]) =>
    `<button class="score-btn" data-score="${score}">
      <span class="score-num">${score}</span>
      <span class="score-label">${escHtml(label)}</span>
    </button>`
  ).join("");

  $("score-buttons").querySelectorAll(".score-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const rem = state.sessionData?.remarks?.[remId];
      if (!rem) return;
      closeScorePicker();
      await addTrial(state.currentSessionId, remId, Number(btn.dataset.score), rem.trials || []);
    });
  });

  $("score-modal").classList.remove("hidden");
}

function closeScorePicker() {
  state.scorePicker = { open: false, remId: null };
  $("score-modal").classList.add("hidden");
}

$("score-modal-close").addEventListener("click",    closeScorePicker);
$("score-modal-backdrop").addEventListener("click", closeScorePicker);

// ============================================================
// MANAGE MODAL (inline student / target / template config editing)
// ============================================================

function cfgId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── Open / close ──────────────────────────────────────────────

function openManageModal(student, targetOrNull, templateOrNull = null) {
  $("manage-modal").classList.remove("hidden");
  if (templateOrNull) {
    renderTemplateManageContent(templateOrNull);
  } else if (targetOrNull) {
    renderTargetManageContent(student, targetOrNull);
  } else {
    renderStudentManageContent(student);
  }
}

function closeManageModal() {
  $("manage-modal").classList.add("hidden");
  // Refresh session dropdown / content if a session is active
  if (state.currentStudent) {
    populateTargetDropdown(state.currentStudent.targets);
    if (state.currentSessionId && state.selectedTargetName) renderTargetContent();
  }
  // Always refresh all home screen sections
  renderExistingStudentButtons(state.unfinishedIds);
  renderAssessmentStudentButtons(state.unfinishedIds);
  renderTemplateButtons();
  renderExportButtons();
}

$("manage-modal-close").addEventListener("click",    closeManageModal);
$("manage-modal-backdrop").addEventListener("click", closeManageModal);

// ── Session-screen ⚙ button ───────────────────────────────────

$("btn-manage-targets").addEventListener("click", () => {
  const student = state.currentStudent;
  if (!student) return;
  const target = student.targets.find(t => t.name === state.selectedTargetName) || null;
  openManageModal(student, target);
});

// ── Add Target picker (replaces confirm/prompt flow) ──────────

function showAddTargetPicker(student) {
  $("manage-modal-title").textContent = "Add Target";
  $("manage-modal").classList.remove("hidden");

  let html = `<div style="margin-bottom:.75rem">
    <button class="btn-admin-add" id="btn-add-custom-target">+ Custom Target (blank)</button>
  </div>`;

  if (state.templates.length > 0) {
    html += `<div class="admin-section-title">From Template</div>
    <div class="admin-list" id="template-picker-list">`;
    state.templates.forEach(tmpl => {
      html += `<label class="admin-list-item" style="cursor:pointer;gap:.75rem">
        <input type="checkbox" class="tmpl-checkbox" data-tmpl-id="${escHtml(tmpl.id)}"
          style="width:20px;height:20px;flex-shrink:0;cursor:pointer" />
        <span class="admin-item-name">${escHtml(tmpl.name)}</span>
      </label>`;
    });
    html += `</div>
    <button class="btn-primary-sm" id="btn-add-from-templates"
      style="width:100%;margin-top:.5rem;padding:.75rem">
      Add Selected Templates
    </button>`;
  } else {
    html += `<p style="color:var(--text-muted);font-size:.88rem;margin-top:.5rem">
      No templates available. Create templates from the home screen.</p>`;
  }

  $("manage-modal-body").innerHTML = html;

  $("btn-add-custom-target").addEventListener("click", async () => {
    $("manage-modal").classList.add("hidden");
    const name = prompt("Target name:");
    if (!name?.trim()) return;
    const t = {
      id: cfgId("t"), name: name.trim(),
      maxPoints: 3, hasComment: false, fullName: "",
      order: student.targets.length,
      predefinedActivities: [], notes: [],
      templateId: null
    };
    student.targets.push(t);
    const si = state.students.findIndex(s => s.id === student.id);
    if (si >= 0) state.students[si] = student;
    await saveStudent(student);
    state.selectedTargetName = t.name;
    populateTargetDropdown(student.targets);
    renderTargetContent();
  });

  $("btn-add-from-templates")?.addEventListener("click", async () => {
    const checked = [...$("manage-modal-body").querySelectorAll(".tmpl-checkbox:checked")];
    if (checked.length === 0) { alert("Select at least one template."); return; }

    for (const cb of checked) {
      const tmpl = state.templates.find(t => t.id === cb.dataset.tmplId);
      if (!tmpl) continue;
      // Skip if this template is already a target for this student
      if (student.targets.find(t => t.templateId === tmpl.id)) continue;
      const t = {
        id: cfgId("t"), name: tmpl.name,
        maxPoints: tmpl.maxPoints || 3,
        hasComment: false, fullName: "",
        order: student.targets.length,
        predefinedActivities: JSON.parse(JSON.stringify(tmpl.predefinedActivities || [])),
        notes: JSON.parse(JSON.stringify(tmpl.notes || [])),
        templateId: tmpl.id
      };
      student.targets.push(t);
    }

    const si = state.students.findIndex(s => s.id === student.id);
    if (si >= 0) state.students[si] = student;
    await saveStudent(student);

    $("manage-modal").classList.add("hidden");
    const lastTarget = student.targets[student.targets.length - 1];
    if (lastTarget) state.selectedTargetName = lastTarget.name;
    populateTargetDropdown(student.targets);
    renderTargetContent();
  });
}

// ── Student management content ────────────────────────────────

function renderStudentManageContent(student) {
  $("manage-modal-title").textContent = student.name;
  const isAssessment = student.type === "assessment";
  const html = `
    <div class="admin-section">
      <label class="admin-label">Student Name</label>
      <div style="display:flex;gap:.5rem;align-items:center">
        <input class="admin-input" id="mn-s-name" value="${escHtml(student.name)}" style="flex:1" />
        <button class="btn-primary-sm" id="btn-mn-rename">Save</button>
      </div>
    </div>
    ${isAssessment ? `
    <div class="admin-section">
      <button class="btn-adm-edit" id="btn-mn-move-to-existing"
        style="width:100%;padding:.75rem;justify-content:center;display:flex">
        Move to Existing Students
      </button>
    </div>` : ""}
    <div style="margin-top:1.5rem;padding-bottom:.5rem">
      <button class="btn-adm-danger" id="btn-mn-del-student">Delete Student</button>
    </div>`;

  $("manage-modal-body").innerHTML = html;

  $("btn-mn-rename").addEventListener("click", async () => {
    const v = $("mn-s-name").value.trim();
    if (!v || v === student.name) return;
    student.name = v;
    await saveStudent(student);
    $("manage-modal-title").textContent = v;
    flashSaved($("mn-s-name"));
  });
  $("mn-s-name").addEventListener("keydown", e => {
    if (e.key === "Enter") $("btn-mn-rename").click();
  });

  $("btn-mn-move-to-existing")?.addEventListener("click", async () => {
    if (!confirm(`Move "${student.name}" to Existing Students?`)) return;
    student.type = "existing";
    await saveStudent(student);
    closeManageModal();
  });

  $("btn-mn-del-student").addEventListener("click", async () => {
    if (!confirm(`Delete "${student.name}"? Session data is kept in Firebase.`)) return;
    await deleteStudentConfig(student.id);
    state.students = state.students.filter(s => s.id !== student.id);
    closeManageModal();
  });
}

// ── Drag-to-reorder for the activity list ─────────────────────
// Uses Pointer Events so it works on mouse, iPad, and iPhone.
function initDragSort(listEl, onReorder) {
  let dragEl = null;
  let placeholder = null;
  let offsetY = 0;

  listEl.addEventListener('pointerdown', e => {
    if (!e.target.closest('.drag-handle')) return;
    const item = e.target.closest('.admin-list-item');
    if (!item) return;
    e.preventDefault();

    const rect = item.getBoundingClientRect();
    offsetY = e.clientY - rect.top;

    placeholder = document.createElement('div');
    placeholder.className = 'drag-placeholder';
    placeholder.style.height = rect.height + 'px';
    item.after(placeholder);

    dragEl = item;
    dragEl.style.cssText =
      `position:fixed;left:${rect.left}px;width:${rect.width}px;` +
      `top:${rect.top}px;z-index:9999;opacity:.85;` +
      `box-shadow:0 4px 16px rgba(0,0,0,.2);pointer-events:none;`;

    listEl.setPointerCapture(e.pointerId);
  });

  listEl.addEventListener('pointermove', e => {
    if (!dragEl) return;
    dragEl.style.top = (e.clientY - offsetY) + 'px';

    const items = [...listEl.querySelectorAll('.admin-list-item')].filter(el => el !== dragEl);
    let inserted = false;
    for (const item of items) {
      const { top, height } = item.getBoundingClientRect();
      if (e.clientY < top + height / 2) {
        listEl.insertBefore(placeholder, item);
        inserted = true;
        break;
      }
    }
    if (!inserted) listEl.appendChild(placeholder);
  });

  const endDrag = () => {
    if (!dragEl) return;
    dragEl.style.cssText = '';
    if (placeholder?.parentNode) placeholder.parentNode.insertBefore(dragEl, placeholder);
    placeholder?.remove();
    const newOrder = [...listEl.querySelectorAll('.admin-list-item')]
      .map(el => Number(el.dataset.idx));
    dragEl = null;
    placeholder = null;
    onReorder(newOrder);
  };

  listEl.addEventListener('pointerup',     endDrag);
  listEl.addEventListener('pointercancel', endDrag);
}

// Converts old group-field format to heading-row format in place.
// Called once when the manage modal opens; saved on next boss action.
function normalizeActivitiesFormat(acts) {
  const hasOldFormat = acts.some(a => !a.isHeading && a.group);
  if (!hasOldFormat) return acts;

  const result = [];
  let lastGroup = null;
  for (const a of acts) {
    if (a.isHeading) { result.push(a); continue; }
    const g = a.group || "";
    if (g && g !== lastGroup) {
      result.push({ id: cfgId("h"), isHeading: true, name: g, order: 0 });
      lastGroup = g;
    } else if (!g) {
      lastGroup = null;
    }
    const { group, ...rest } = a;
    result.push(rest);
  }
  result.forEach((item, i) => item.order = i);
  return result;
}

// ── Target management content ─────────────────────────────────

function renderTargetManageContent(student, target) {
  $("manage-modal-title").textContent = target.name;
  // Migrate old group-field format to heading-row format (saved on next boss action)
  target.predefinedActivities = normalizeActivitiesFormat(target.predefinedActivities || []);
  const acts  = target.predefinedActivities;
  const notes = target.notes || [];

  let html = `
    <div class="admin-section">
      <label class="admin-label">Target Name</label>
      <input class="admin-input" id="mn-t-name" value="${escHtml(target.name)}" />
    </div>
    <div class="admin-section admin-row">
      <label class="admin-label">Max Points</label>
      <div class="admin-pts-group">
        <button class="admin-pts-btn ${target.maxPoints !== 4 ? "active" : ""}" data-pts="3">3</button>
        <button class="admin-pts-btn ${target.maxPoints === 4 ? "active" : ""}" data-pts="4">4</button>
      </div>
    </div>

    <div class="admin-section-title">Predefined Activities</div>
    <div class="admin-list" id="mn-act-list">`;

  acts.forEach((a, idx) => {
    if (a.isHeading) {
      html += `<div class="admin-list-item mn-heading-item" data-idx="${idx}">
        <span class="drag-handle">⠿</span>
        <input class="admin-input mn-heading-input" id="mn-act-name-${idx}" data-idx="${idx}"
          value="${escHtml(a.name)}" placeholder="Section heading name" />
        <button class="btn-adm-del mn-del-act" data-idx="${idx}">🗑</button>
      </div>`;
    } else {
      html += `<div class="admin-list-item" data-idx="${idx}">
        <span class="drag-handle">⠿</span>
        <input class="admin-input" id="mn-act-name-${idx}" data-idx="${idx}"
          value="${escHtml(a.name)}" placeholder="Activity name" style="flex:1" />
        <button class="btn-adm-del mn-del-act" data-idx="${idx}">🗑</button>
      </div>`;
    }
  });

  html += `</div>
    <div style="display:flex;gap:.5rem;margin-top:.25rem">
      <button class="btn-admin-add" id="btn-mn-add-act" style="flex:1">+ Add Activity</button>
      <button class="btn-admin-add" id="btn-mn-add-heading" style="flex:1">+ Add Section Heading</button>
    </div>

    <div class="admin-section-title" style="margin-top:1.25rem">Reference Notes</div>
    <div class="admin-list" id="mn-notes-list">`;

  notes.forEach((n, idx) => {
    html += `<div class="admin-list-item admin-note-item">
      <textarea class="admin-input mn-note-text" data-idx="${idx}" rows="2">${escHtml(n.text)}</textarea>
      <button class="btn-adm-del mn-del-note" data-idx="${idx}">🗑</button>
    </div>`;
  });

  html += `</div>
    <button class="btn-admin-add" id="btn-mn-add-note">+ Add Note</button>
    <div style="margin-top:2rem;padding-bottom:1.5rem">
      <button class="btn-adm-danger" id="btn-mn-del-target">Delete This Target</button>
    </div>`;

  $("manage-modal-body").innerHTML = html;

  const saveTarget = async () => {
    const i = student.targets.findIndex(t => t.id === target.id);
    if (i >= 0) student.targets[i] = target;
    const si = state.students.findIndex(s => s.id === student.id);
    if (si >= 0) state.students[si] = student;
    await saveStudent(student);
  };

  initDragSort($("mn-act-list"), async newOrder => {
    const reordered = newOrder.map(oldIdx => acts[oldIdx]);
    reordered.forEach((a, i) => a.order = i);
    target.predefinedActivities = reordered;
    await saveTarget();
    renderTargetManageContent(student, target);
  });

  $("mn-t-name").addEventListener("blur", async () => {
    const v = $("mn-t-name").value.trim();
    if (!v || v === target.name) return;
    target.name = v;
    $("manage-modal-title").textContent = v;
    await saveTarget();
    flashSaved($("mn-t-name"));
  });
  $("mn-t-name").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); $("mn-t-name").blur(); }
  });

  $("manage-modal-body").querySelectorAll(".admin-pts-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const newPts = Number(btn.dataset.pts);
      if (newPts === target.maxPoints) return;
      if (!confirm(`Change max points to ${newPts}? This will affect how scores are calculated for this target.`)) return;
      target.maxPoints = newPts;
      $("manage-modal-body").querySelectorAll(".admin-pts-btn").forEach(b =>
        b.classList.toggle("active", b.dataset.pts === btn.dataset.pts));
      await saveTarget();
    });
  });

  acts.forEach((a, idx) => {
    const input = $(`mn-act-name-${idx}`);
    input?.addEventListener("blur", async () => {
      const v = input.value.trim();
      if (!v || v === a.name) return;
      a.name = v;
      await saveTarget();
      flashSaved(input);
    });
    input?.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    });
  });

  $("manage-modal-body").querySelectorAll(".mn-del-act").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.idx);
      const label = acts[idx]?.isHeading ? "section heading" : "activity";
      if (!confirm(`Delete this ${label}?`)) return;
      acts.splice(idx, 1);
      acts.forEach((a, i) => a.order = i);
      target.predefinedActivities = acts;
      await saveTarget();
      renderTargetManageContent(student, target);
    });
  });

  $("btn-mn-add-act").addEventListener("click", async () => {
    acts.push({ id: cfgId("a"), name: "New Activity", order: acts.length });
    target.predefinedActivities = acts;
    await saveTarget();
    renderTargetManageContent(student, target);
  });

  $("btn-mn-add-heading").addEventListener("click", async () => {
    acts.push({ id: cfgId("h"), isHeading: true, name: "Section Heading", order: acts.length });
    target.predefinedActivities = acts;
    await saveTarget();
    renderTargetManageContent(student, target);
  });

  $("manage-modal-body").querySelectorAll(".mn-note-text").forEach(ta => {
    ta.addEventListener("blur", async () => {
      const idx = Number(ta.dataset.idx);
      if (ta.value === notes[idx].text) return;
      notes[idx].text = ta.value;
      target.notes = notes;
      await saveTarget();
      flashSaved(ta);
    });
  });

  $("manage-modal-body").querySelectorAll(".mn-del-note").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.idx);
      if (!confirm("Delete this note?")) return;
      notes.splice(idx, 1);
      target.notes = notes;
      await saveTarget();
      renderTargetManageContent(student, target);
    });
  });

  $("btn-mn-add-note").addEventListener("click", async () => {
    notes.push({ id: cfgId("n"), text: "", order: notes.length });
    target.notes = notes;
    await saveTarget();
    renderTargetManageContent(student, target);
  });

  $("btn-mn-del-target").addEventListener("click", async () => {
    if (!confirm(`Delete target "${target.name}"?`)) return;
    student.targets = student.targets.filter(t => t.id !== target.id);
    student.targets.forEach((t, i) => t.order = i);
    await saveStudent(student);
    const si = state.students.findIndex(s => s.id === student.id);
    if (si >= 0) state.students[si] = student;
    renderStudentManageContent(student);
  });
}

// ── Template management content ───────────────────────────────

function renderTemplateManageContent(template) {
  $("manage-modal-title").textContent = template.name;
  template.predefinedActivities = normalizeActivitiesFormat(template.predefinedActivities || []);
  const acts  = template.predefinedActivities;
  const notes = template.notes || [];

  let html = `
    <div class="admin-section">
      <label class="admin-label">Template Name</label>
      <input class="admin-input" id="mn-t-name" value="${escHtml(template.name)}" />
    </div>
    <div class="admin-section admin-row">
      <label class="admin-label">Max Points</label>
      <div class="admin-pts-group">
        <button class="admin-pts-btn ${(template.maxPoints || 3) !== 4 ? "active" : ""}" data-pts="3">3</button>
        <button class="admin-pts-btn ${(template.maxPoints || 3) === 4 ? "active" : ""}" data-pts="4">4</button>
      </div>
    </div>

    <div class="admin-section-title">Predefined Activities</div>
    <div class="admin-list" id="mn-act-list">`;

  acts.forEach((a, idx) => {
    if (a.isHeading) {
      html += `<div class="admin-list-item mn-heading-item" data-idx="${idx}">
        <span class="drag-handle">⠿</span>
        <input class="admin-input mn-heading-input" id="mn-act-name-${idx}" data-idx="${idx}"
          value="${escHtml(a.name)}" placeholder="Section heading name" />
        <button class="btn-adm-del mn-del-act" data-idx="${idx}">🗑</button>
      </div>`;
    } else {
      html += `<div class="admin-list-item" data-idx="${idx}">
        <span class="drag-handle">⠿</span>
        <input class="admin-input" id="mn-act-name-${idx}" data-idx="${idx}"
          value="${escHtml(a.name)}" placeholder="Activity name" style="flex:1" />
        <button class="btn-adm-del mn-del-act" data-idx="${idx}">🗑</button>
      </div>`;
    }
  });

  html += `</div>
    <div style="display:flex;gap:.5rem;margin-top:.25rem">
      <button class="btn-admin-add" id="btn-mn-add-act" style="flex:1">+ Add Activity</button>
      <button class="btn-admin-add" id="btn-mn-add-heading" style="flex:1">+ Add Section Heading</button>
    </div>

    <div class="admin-section-title" style="margin-top:1.25rem">Reference Notes</div>
    <div class="admin-list" id="mn-notes-list">`;

  notes.forEach((n, idx) => {
    html += `<div class="admin-list-item admin-note-item">
      <textarea class="admin-input mn-note-text" data-idx="${idx}" rows="2">${escHtml(n.text)}</textarea>
      <button class="btn-adm-del mn-del-note" data-idx="${idx}">🗑</button>
    </div>`;
  });

  html += `</div>
    <button class="btn-admin-add" id="btn-mn-add-note">+ Add Note</button>
    <div style="margin-top:2rem;padding-bottom:1.5rem;display:flex;gap:.75rem">
      <button class="btn-adm-success" id="btn-mn-save-template">Save Template</button>
      <button class="btn-adm-danger" id="btn-mn-del-template">Delete Template</button>
    </div>`;

  $("manage-modal-body").innerHTML = html;

  const saveTemplateFn = async () => {
    const idx = state.templates.findIndex(t => t.id === template.id);
    if (idx >= 0) state.templates[idx] = template;
    await saveTemplate(template);
    await syncTemplateToStudents(template);
  };

  initDragSort($("mn-act-list"), async newOrder => {
    const reordered = newOrder.map(oldIdx => acts[oldIdx]);
    reordered.forEach((a, i) => a.order = i);
    template.predefinedActivities = reordered;
    await saveTemplateFn();
    renderTemplateManageContent(template);
  });

  $("mn-t-name").addEventListener("blur", async () => {
    const v = $("mn-t-name").value.trim();
    if (!v || v === template.name) return;
    template.name = v;
    $("manage-modal-title").textContent = v;
    await saveTemplateFn();
    flashSaved($("mn-t-name"));
  });
  $("mn-t-name").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); $("mn-t-name").blur(); }
  });

  $("manage-modal-body").querySelectorAll(".admin-pts-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const newPts = Number(btn.dataset.pts);
      if (newPts === (template.maxPoints || 3)) return;
      template.maxPoints = newPts;
      $("manage-modal-body").querySelectorAll(".admin-pts-btn").forEach(b =>
        b.classList.toggle("active", b.dataset.pts === btn.dataset.pts));
      await saveTemplateFn();
    });
  });

  acts.forEach((a, idx) => {
    const input = $(`mn-act-name-${idx}`);
    input?.addEventListener("blur", async () => {
      const v = input.value.trim();
      if (!v || v === a.name) return;
      a.name = v;
      await saveTemplateFn();
      flashSaved(input);
    });
    input?.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    });
  });

  $("manage-modal-body").querySelectorAll(".mn-del-act").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.idx);
      const label = acts[idx]?.isHeading ? "section heading" : "activity";
      if (!confirm(`Delete this ${label}?`)) return;
      acts.splice(idx, 1);
      acts.forEach((a, i) => a.order = i);
      template.predefinedActivities = acts;
      await saveTemplateFn();
      renderTemplateManageContent(template);
    });
  });

  $("btn-mn-add-act").addEventListener("click", async () => {
    acts.push({ id: cfgId("a"), name: "New Activity", order: acts.length });
    template.predefinedActivities = acts;
    await saveTemplateFn();
    renderTemplateManageContent(template);
  });

  $("btn-mn-add-heading").addEventListener("click", async () => {
    acts.push({ id: cfgId("h"), isHeading: true, name: "Section Heading", order: acts.length });
    template.predefinedActivities = acts;
    await saveTemplateFn();
    renderTemplateManageContent(template);
  });

  $("manage-modal-body").querySelectorAll(".mn-note-text").forEach(ta => {
    ta.addEventListener("blur", async () => {
      const idx = Number(ta.dataset.idx);
      if (ta.value === notes[idx].text) return;
      notes[idx].text = ta.value;
      template.notes = notes;
      await saveTemplateFn();
      flashSaved(ta);
    });
  });

  $("manage-modal-body").querySelectorAll(".mn-del-note").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.idx);
      if (!confirm("Delete this note?")) return;
      notes.splice(idx, 1);
      template.notes = notes;
      await saveTemplateFn();
      renderTemplateManageContent(template);
    });
  });

  $("btn-mn-add-note").addEventListener("click", async () => {
    notes.push({ id: cfgId("n"), text: "", order: notes.length });
    template.notes = notes;
    await saveTemplateFn();
    renderTemplateManageContent(template);
  });

  $("btn-mn-save-template").addEventListener("click", async () => {
    const btn = $("btn-mn-save-template");
    btn.disabled = true;
    btn.textContent = "Saving…";
    await saveTemplateFn();
    btn.textContent = "✓ Saved!";
    setTimeout(() => {
      if ($("btn-mn-save-template")) {
        btn.disabled = false;
        btn.textContent = "Save Template";
      }
    }, 1500);
  });

  $("btn-mn-del-template").addEventListener("click", async () => {
    if (!confirm(`Delete template "${template.name}"? Students using this template will keep their activities.`)) return;
    await deleteTemplate(template.id);
    state.templates = state.templates.filter(t => t.id !== template.id);
    closeManageModal();
  });
}

// ── Sync template changes to all students using it ────────────

async function syncTemplateToStudents(template) {
  const toSave = [];
  for (const student of state.students) {
    let changed = false;
    for (const target of student.targets) {
      if (target.templateId !== template.id) continue;
      target.predefinedActivities = JSON.parse(JSON.stringify(template.predefinedActivities || []));
      target.notes                = JSON.parse(JSON.stringify(template.notes || []));
      target.maxPoints            = template.maxPoints || 3;
      changed = true;
    }
    if (changed) toSave.push(student);
  }
  for (const student of toSave) await saveStudent(student);
}

// ─── SAVED FLASH ─────────────────────────────────────────────

function flashSaved(inputEl) {
  if (!inputEl) return;
  inputEl.classList.remove("input-saved");
  void inputEl.offsetWidth;
  inputEl.classList.add("input-saved");
  state.flashActive = true;
  clearTimeout(state._flashTimer);
  state._flashTimer = setTimeout(() => {
    inputEl.classList.remove("input-saved");
    state.flashActive = false;
    if (state.renderPending) {
      state.renderPending = false;
      renderTargetContent();
    }
  }, 900);
}

// ─── SCREEN MANAGEMENT ───────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => {
    s.classList.toggle("hidden", s.id !== id);
    s.classList.toggle("active", s.id === id);
  });
}

// ─── LOCAL DATA QUERIES ──────────────────────────────────────

function getActivitiesForTarget(targetName) {
  return Object.entries(state.sessionData?.activities || {})
    .filter(([, a]) => a.targetName === targetName)
    .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0))
    .map(([id, a]) => ({ id, ...a }));
}

function getRemarksForActivity(actId) {
  return Object.entries(state.sessionData?.remarks || {})
    .filter(([, r]) => r.activityId === actId)
    .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0))
    .map(([id, r]) => ({ id, ...r }));
}

function findActivityByName(targetName, activityName) {
  const found = Object.entries(state.sessionData?.activities || {}).find(
    ([, a]) => a.targetName === targetName && a.activityName === activityName
  );
  return found ? { id: found[0], ...found[1] } : null;
}

// ─── UTILITIES ───────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}
