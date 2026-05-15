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
  updateFedcComment,
  getTodayUnfinishedStudentIds,
  getRecentSessionsForStudent,
  loadStudentsConfig,
  saveStudent,
  deleteStudentConfig,
  sanitizeKey,
  getTodayString
} from "./firebase-service.js";
import { exportStudentData } from "./export.js";

// ─── STATE ───────────────────────────────────────────────────
const state = {
  authenticated:      false,
  students:           [],     // loaded from Firebase
  currentStudent:     null,
  currentSessionId:   null,
  sessionData:        null,
  selectedTargetName: null,
  fbUnsubscribe:      null,
  renderPending:      false,
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
  renderStudentButtons(new Set());
  renderExportButtons();
  try {
    const unfinished = await getTodayUnfinishedStudentIds();
    renderStudentButtons(unfinished);
  } catch (_) {}
}

async function reloadStudents() {
  try { state.students = await loadStudentsConfig(); } catch (_) {}
}

function renderStudentButtons(unfinishedIds) {
  const container = $("student-buttons");
  let html = state.students.map(s => `
    <div class="student-btn-wrap">
      <button class="student-btn" data-id="${s.id}">
        <span class="student-btn-name">${escHtml(s.name)}</span>
        ${unfinishedIds.has(s.id)
          ? `<span class="session-indicator" title="Unfinished session today"></span>`
          : ""}
      </button>
      <button class="student-edit-btn" data-id="${s.id}" title="Edit student">✏</button>
    </div>
  `).join("");
  html += `<button class="btn-admin-add" id="btn-home-add-student">+ Add Student</button>`;
  container.innerHTML = html;

  container.querySelectorAll(".student-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const student = state.students.find(s => s.id === btn.dataset.id);
      if (student) showStudentChoice(student);
    });
  });

  container.querySelectorAll(".student-edit-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const student = state.students.find(s => s.id === btn.dataset.id);
      if (student) openManageModal(student, null);
    });
  });

  $("btn-home-add-student").addEventListener("click", async () => {
    const name = prompt("New student name:");
    if (!name?.trim()) return;
    const s = { id: cfgId("s"), name: name.trim(), order: state.students.length, targets: [] };
    await saveStudent(s);
    state.students.push(s);
    renderStudentButtons(new Set());
    renderExportButtons();
  });
}

function renderExportButtons() {
  const container = $("export-buttons");
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

// Show two-choice sheet: Today's Session | Edit Other Sessions
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
    </div>`;
  $("session-picker-modal").classList.remove("hidden");

  $("session-picker-list").querySelector(".choice-today").addEventListener("click", () => {
    closeSessionPicker();
    openSession(student, null);
  });
  $("session-picker-list").querySelector(".choice-other").addEventListener("click", () => {
    showSessionPicker(student);
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
      if (busy) {
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
  ).join("");
  sel.value    = state.selectedTargetName || targets[0]?.name || "";
  sel.onchange = () => {
    state.selectedTargetName = sel.value;
    state.pendingNewActivity = null;
    state.pendingNewRemark   = null;
    renderTargetContent();
  };
}

$("btn-back").addEventListener("click", leaveSession);
$("btn-session-nav").addEventListener("click", () => {
  if (state.currentStudent) showStudentChoice(state.currentStudent);
});
$("btn-finish-session").addEventListener("click", async () => {
  if (!state.currentSessionId) return;
  if (!confirm("Mark this session as finished?")) return;
  await finishSession(state.currentSessionId);
});

// ============================================================
// TARGET CONTENT RENDERING
// ============================================================

function renderTargetContent() {
  if (!state.sessionData || !state.selectedTargetName) return;
  const target = state.currentStudent.targets.find(
    t => t.name === state.selectedTargetName
  );
  if (!target) return;

  updateSessionHeader();
  const container = $("target-content");
  container.innerHTML = target.predefinedActivities?.length > 0
    ? renderFedcTarget(target)
    : renderRegularTarget(target);

  attachTargetListeners(target);
}

// ─── FEDC TARGET ─────────────────────────────────────────────

function renderFedcTarget(target) {
  let html = `<div class="fedc-header">
    <span class="fedc-title">${escHtml(target.name)}</span>
    <span class="fedc-subtitle">${escHtml(target.fullName || "")}</span>
  </div>`;

  const letters = "abcdefghij";
  let lastGroup = null;
  target.predefinedActivities.forEach((pa, idx) => {
    if (pa.group && pa.group !== lastGroup) {
      lastGroup = pa.group;
      html += `<div class="activity-group-heading">${escHtml(pa.group)}</div>`;
    }

    const pendingKey = pa.name;
    const actData    = findActivityByName(target.name, pa.name);
    const actId      = actData ? actData.id : null;
    const remarks    = actId ? getRemarksForActivity(actId) : [];
    const isPending  = state.pendingNewRemark?.pendingKey === pendingKey;

    html += `<div class="entry-block">
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
      // Predefined remarks mode (e.g. Self Management)
      for (const predRemName of pa.predefinedRemarks) {
        const rem = actId ? findRemarkByPredefinedKey(actId, predRemName) : null;
        if (rem) {
          html += renderPredefinedRemarkFields(rem, predRemName, target);
        } else {
          html += renderGhostRemarkFields(predRemName, actId, pa, idx, target);
        }
      }
    } else {
      // Normal mode: show existing remarks + add remark button
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

  if (target.hasComment) {
    const commentText = (state.sessionData.fedcComments || {})[sanitizeKey(target.name)] || "";
    html += `<div class="entry-block">
      <div class="entry-field">
        <span class="field-label">Comment</span>
        <textarea class="field-input fedc-comment-input"
          data-target="${escHtml(target.name)}"
          placeholder="Free-text comment (no scoring)…"
          rows="3">${escHtml(commentText)}</textarea>
      </div>
    </div>`;
  }

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
  const p = state.pendingNewRemark;
  return `
    <div class="entry-divider"></div>
    <div class="entry-field">
      <span class="field-label">Remark</span>
      <textarea id="new-remark-textarea" class="field-input"
        placeholder="Type remark…" rows="2"></textarea>
      <button class="btn-icon btn-cancel-remark" title="Cancel">✕</button>
    </div>
    <div class="entry-field">
      <span class="field-label"></span>
      <button class="btn-save-remark btn-primary-sm"
        data-act-id="${actId || ""}"
        data-pa-name="${escHtml(paName || "")}"
        data-pa-order="${paOrder !== null && paOrder !== undefined ? paOrder : ""}"
        data-target="${escHtml(target.name)}">Save Remark</button>
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
        await updateActivityName(state.currentSessionId, input.dataset.actId, newName);
      }
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

  // ── Remark text: auto-save on blur ───────────────────────
  c.querySelectorAll(".remark-text-input").forEach(ta => {
    ta.addEventListener("blur", async () => {
      const newText  = ta.value.trim();
      const original = ta.dataset.original;
      if (newText !== original) {
        ta.dataset.original = newText;
        await updateRemarkText(state.currentSessionId, ta.dataset.remId, newText);
      }
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

  // ── Save new remark ───────────────────────────────────────
  c.querySelectorAll(".btn-save-remark").forEach(btn => {
    btn.addEventListener("click", () => saveNewRemark(btn, target));
  });

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
        await updateRemarkText(state.currentSessionId, input.dataset.remId, text);
      }
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

  // ── FEDC comment auto-save ────────────────────────────────
  c.querySelectorAll(".fedc-comment-input").forEach(ta => {
    let timer;
    ta.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() =>
        updateFedcComment(state.currentSessionId, ta.dataset.target, ta.value), 800);
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
  await addActivity(state.currentSessionId, target.name, name, Date.now(), false);
}

function cancelPendingActivity() {
  state.pendingNewActivity = null;
  renderTargetContent();
}

async function saveNewRemark(btn, target) {
  const ta = $("new-remark-textarea");
  if (!ta) return;
  const text   = ta.value.trim();

  const paName  = btn.dataset.paName  || null;
  const paOrder = btn.dataset.paOrder !== undefined && btn.dataset.paOrder !== ""
    ? Number(btn.dataset.paOrder) : null;
  let   actId   = btn.dataset.actId   || null;

  if (paName) {
    actId = await ensureFedcActivity(target.name, paName, paOrder ?? 0);
  }

  if (!actId) return;
  state.pendingNewRemark = null;
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
// MANAGE MODAL (inline student / target config editing)
// ============================================================

function cfgId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── Open / close ──────────────────────────────────────────────

function openManageModal(student, targetOrNull) {
  $("manage-modal").classList.remove("hidden");
  if (targetOrNull) {
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
  renderStudentButtons(new Set());
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

// ── Student management content ────────────────────────────────

function renderStudentManageContent(student) {
  $("manage-modal-title").textContent = student.name;
  let html = `
    <div class="admin-section">
      <label class="admin-label">Student Name</label>
      <div style="display:flex;gap:.5rem;align-items:center">
        <input class="admin-input" id="mn-s-name" value="${escHtml(student.name)}" style="flex:1" />
        <button class="btn-primary-sm" id="btn-mn-rename">Save</button>
      </div>
    </div>
    <div class="admin-section-title">Targets</div>
    <div class="admin-list">`;

  for (const t of student.targets) {
    html += `<div class="admin-list-item">
      <span class="admin-item-name">${escHtml(t.name)}
        <span class="admin-item-sub">(${t.maxPoints}pt)</span>
      </span>
      <div class="admin-item-actions">
        <button class="btn-adm-edit mn-edit-target" data-id="${t.id}">Edit</button>
        <button class="btn-adm-del  mn-del-target"  data-id="${t.id}">🗑</button>
      </div>
    </div>`;
  }

  html += `</div>
    <button class="btn-admin-add" id="btn-mn-add-target">+ Add Target</button>
    <div style="margin-top:1.75rem;padding-bottom:.5rem">
      <button class="btn-adm-danger" id="btn-mn-del-student">Delete Student</button>
    </div>`;

  $("manage-modal-body").innerHTML = html;

  $("btn-mn-rename").addEventListener("click", async () => {
    const v = $("mn-s-name").value.trim();
    if (!v || v === student.name) return;
    student.name = v;
    await saveStudent(student);
    $("manage-modal-title").textContent = v;
  });

  $("manage-modal-body").querySelectorAll(".mn-edit-target").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = student.targets.find(t => t.id === btn.dataset.id);
      if (t) renderTargetManageContent(student, t);
    });
  });

  $("manage-modal-body").querySelectorAll(".mn-del-target").forEach(btn => {
    btn.addEventListener("click", async () => {
      const t = student.targets.find(t => t.id === btn.dataset.id);
      if (!confirm(`Delete target "${t?.name}"? Session data is kept.`)) return;
      student.targets = student.targets.filter(t => t.id !== btn.dataset.id);
      student.targets.forEach((t, i) => t.order = i);
      await saveStudent(student);
      renderStudentManageContent(student);
    });
  });

  $("btn-mn-add-target").addEventListener("click", async () => {
    const name = prompt("Target name:");
    if (!name?.trim()) return;
    const t = {
      id: cfgId("t"), name: name.trim(),
      maxPoints: 3, hasComment: false, fullName: "",
      order: student.targets.length, predefinedActivities: [], notes: []
    };
    student.targets.push(t);
    await saveStudent(student);
    renderTargetManageContent(student, t);
  });

  $("btn-mn-del-student").addEventListener("click", async () => {
    if (!confirm(`Delete "${student.name}"? Session data is kept in Firebase.`)) return;
    await deleteStudentConfig(student.id);
    state.students = state.students.filter(s => s.id !== student.id);
    closeManageModal();
  });
}

// ── Target management content ─────────────────────────────────

function renderTargetManageContent(student, target) {
  $("manage-modal-title").textContent = target.name;
  const acts  = target.predefinedActivities || [];
  const notes = target.notes || [];

  let html = `
    <button class="btn-picker-back" id="btn-mn-back">← ${escHtml(student.name)}</button>
    <div class="admin-section">
      <label class="admin-label">Target Name</label>
      <input class="admin-input" id="mn-t-name" value="${escHtml(target.name)}" />
    </div>
    <div class="admin-section">
      <label class="admin-label">Subtitle <span style="font-weight:400;font-size:.8rem">(optional)</span></label>
      <input class="admin-input" id="mn-t-fullname" value="${escHtml(target.fullName || "")}"
        placeholder="e.g. Stage 1 — Shared Attention…" />
    </div>
    <div class="admin-section admin-row">
      <label class="admin-label">Max Points</label>
      <div class="admin-pts-group">
        <button class="admin-pts-btn ${target.maxPoints !== 4 ? "active" : ""}" data-pts="3">3</button>
        <button class="admin-pts-btn ${target.maxPoints === 4 ? "active" : ""}" data-pts="4">4</button>
      </div>
      <label class="admin-label-inline">
        <input type="checkbox" id="mn-t-comment" ${target.hasComment ? "checked" : ""} />
        Comment field
      </label>
    </div>

    <div class="admin-section-title">
      Activities
      <span style="font-weight:400;font-size:.8rem;text-transform:none;letter-spacing:0">
        — pre-populated each session (leave empty to add manually)
      </span>
    </div>
    <p class="admin-hint">Group heading is optional (e.g. "Eating Etiquette").</p>
    <div class="admin-list" id="mn-act-list">`;

  acts.forEach((a, idx) => {
    html += `<div class="admin-list-item admin-act-item">
      <div class="admin-act-fields">
        <input class="admin-input" id="mn-act-name-${idx}" data-idx="${idx}"
          value="${escHtml(a.name)}" placeholder="Activity name" />
        <input class="admin-input admin-group-input" id="mn-act-group-${idx}" data-idx="${idx}"
          value="${escHtml(a.group || "")}" placeholder="Group heading (optional)" />
      </div>
      <button class="btn-adm-del mn-del-act" data-idx="${idx}">🗑</button>
    </div>`;
  });

  html += `</div>
    <button class="btn-admin-add" id="btn-mn-add-act">+ Add Activity</button>

    <div class="admin-section-title" style="margin-top:1.75rem">Reference Notes</div>
    <p class="admin-hint">Read-only reminders shown in session as 📌. No scoring.</p>
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

  $("btn-mn-back").addEventListener("click", () => renderStudentManageContent(student));

  $("mn-t-name").addEventListener("blur", async () => {
    const v = $("mn-t-name").value.trim();
    if (!v || v === target.name) return;
    target.name = v;
    $("manage-modal-title").textContent = v;
    await saveTarget();
  });

  $("mn-t-fullname").addEventListener("blur", async () => {
    target.fullName = $("mn-t-fullname").value.trim();
    await saveTarget();
  });

  $("manage-modal-body").querySelectorAll(".admin-pts-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      target.maxPoints = Number(btn.dataset.pts);
      $("manage-modal-body").querySelectorAll(".admin-pts-btn").forEach(b =>
        b.classList.toggle("active", b.dataset.pts === btn.dataset.pts));
      await saveTarget();
    });
  });

  $("mn-t-comment").addEventListener("change", async () => {
    target.hasComment = $("mn-t-comment").checked;
    await saveTarget();
  });

  acts.forEach((a, idx) => {
    $(`mn-act-name-${idx}`)?.addEventListener("blur", async () => {
      const v = $(`mn-act-name-${idx}`).value.trim();
      if (v) { a.name = v; await saveTarget(); }
    });
    $(`mn-act-group-${idx}`)?.addEventListener("blur", async () => {
      a.group = $(`mn-act-group-${idx}`).value.trim();
      await saveTarget();
    });
  });

  $("manage-modal-body").querySelectorAll(".mn-del-act").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.idx);
      if (!confirm(`Delete activity "${acts[idx]?.name}"?`)) return;
      acts.splice(idx, 1);
      acts.forEach((a, i) => a.order = i);
      target.predefinedActivities = acts;
      await saveTarget();
      renderTargetManageContent(student, target);
    });
  });

  $("btn-mn-add-act").addEventListener("click", async () => {
    acts.push({ id: cfgId("a"), name: "New Activity", group: "", order: acts.length });
    target.predefinedActivities = acts;
    await saveTarget();
    renderTargetManageContent(student, target);
  });

  $("manage-modal-body").querySelectorAll(".mn-note-text").forEach(ta => {
    ta.addEventListener("blur", async () => {
      notes[Number(ta.dataset.idx)].text = ta.value;
      target.notes = notes;
      await saveTarget();
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
