// ============================================================
// APP.JS — Main application controller
// ============================================================

import { CONFIG } from "./config.js";
import {
  getOrCreateTodaySession,
  listenToSession,
  addActivity,
  deleteActivity,
  updateActivityName,
  addRemark,
  updateRemarkText,
  deleteRemark,
  addTrial,
  deleteTrial,
  getRecentSessionsForStudent,
  loadStudentsConfig,
  saveStudent,
  deleteStudentConfig,
  loadTemplates,
  saveTemplate,
  deleteTemplate,
  loadRemarkPresets,
  saveRemarkPreset,
  deleteRemarkPreset,
  updateFedcComment,
  setTrials,
  sanitizeKey,
  getTodayString,
  getOrCreateSessionForDate,
  deleteSession,
  updateSessionDate,
  deleteTargetDataFromSessions
} from "./firebase-service.js";
import { exportStudentData } from "./export.js";

// ── SW update detection — must run at parse time, before DOMContentLoaded,
//   so the listener is in place before the new SW can fire controllerchange.
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // Only reload for updates, not for the very first SW install.
    if (hadController) window.location.reload();
  });
}

const APP_VERSION = "174";

// ─── STATE ───────────────────────────────────────────────────
const state = {
  authenticated:      false,
  students:           [],
  templates:          [],
  remarkPresets:      [],
  searchExisting:     "",
  searchAssessment:   "",
  searchTemplate:     "",
  searchRemarkPreset: "",
  searchExport:       "",
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
  pendingNewActivity: null,
  viewStudent:        null,
  viewSessionId:      null,
  viewSessionData:    null,
  fbViewUnsubscribe:    null,
  viewRenderPending:    false,
  viewPickerTargetName: null
};

const $ = id => document.getElementById(id);

// ─── INIT ────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  // Register SW immediately — don't wait for Firebase so updates are never blocked.
  registerServiceWorker();

  document.addEventListener("focusout", () => {
    if (state.renderPending) {
      state.renderPending = false;
      renderTargetContent();
    }
    if (state.viewRenderPending) {
      state.viewRenderPending = false;
      renderSessionView();
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

  // Load remark presets
  try {
    state.remarkPresets = await loadRemarkPresets();
  } catch (_) {}

  initPin();
});

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const promptSkip = sw => sw.postMessage("skipWaiting");
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
    .then(reg => {
      if (reg.waiting) promptSkip(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        sw.addEventListener("statechange", () => {
          if (sw.state === "installed") promptSkip(sw);
        });
      });
      reg.update();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update();
      });
    })
    .catch(() => {});
}

// ============================================================
// PIN SCREEN
// ============================================================

function initPin() {
  showScreen("screen-pin");
  const vEl = $("pin-version");
  if (vEl) vEl.textContent = `Made by Lewis · Version ${APP_VERSION}`;
  const errMsg = $("pin-error");
  const dotsEl = $("pin-dots");
  const keypad = $("pin-keypad");
  const pinLen = CONFIG.PIN.length;
  let value = "";

  dotsEl.innerHTML = Array.from({ length: pinLen }, () =>
    '<span class="pin-dot"></span>'
  ).join("");
  const dots = dotsEl.querySelectorAll(".pin-dot");

  function renderDots() {
    dots.forEach((d, i) => d.classList.toggle("filled", i < value.length));
  }

  function shake() {
    dotsEl.classList.remove("shake");
    void dotsEl.offsetWidth;
    dotsEl.classList.add("shake");
  }

  function submit() {
    if (value === CONFIG.PIN) {
      document.removeEventListener("keydown", onKeyDown);
      showHome();
    } else {
      shake();
      errMsg.classList.remove("hidden");
      value = "";
      renderDots();
    }
  }

  function pressKey(key) {
    if (key === "back") {
      value = value.slice(0, -1);
      errMsg.classList.add("hidden");
      renderDots();
      return;
    }
    if (value.length >= pinLen) return;
    value += key;
    renderDots();
    if (value.length === pinLen) setTimeout(submit, 120);
  }

  keypad.addEventListener("click", e => {
    const btn = e.target.closest(".pin-key");
    if (!btn || btn.disabled) return;
    pressKey(btn.dataset.key);
  });

  function onKeyDown(e) {
    if (e.key >= "0" && e.key <= "9") pressKey(e.key);
    else if (e.key === "Backspace") pressKey("back");
    else if (e.key === "Enter" && value.length === pinLen) submit();
  }
  document.addEventListener("keydown", onKeyDown);
}

// ============================================================
// HOME SCREEN
// ============================================================

async function showHome() {
  showScreen("screen-home");
  const verEl = document.getElementById("app-version");
  if (verEl) verEl.textContent = `Made by Lewis · Version ${APP_VERSION}`;
  // Clear section searches when returning home
  state.searchExisting = ""; state.searchAssessment = ""; state.searchTemplate = "";
  state.searchRemarkPreset = ""; state.searchExport = "";
  [$("search-existing"), $("search-assessment"), $("search-template"), $("search-remark-preset"), $("search-export")]
    .forEach(el => { if (el) el.value = ""; });
  renderExistingStudentButtons();
  renderAssessmentStudentButtons();
  renderTemplateButtons();
  renderRemarkPresetButtons();
  renderExportButtons();
}

// ── Add student / template from home screen ───────────────────

$("btn-add-existing-student").addEventListener("click", () => addNewStudent("existing"));
$("btn-add-assessment-student").addEventListener("click", () => addNewStudent("assessment"));
$("btn-add-template").addEventListener("click", addNewTemplate);
$("btn-add-remark-preset").addEventListener("click", addNewRemarkPreset);

$("search-existing").addEventListener("input", e => {
  state.searchExisting = e.target.value;
  renderExistingStudentButtons();
});
$("search-assessment").addEventListener("input", e => {
  state.searchAssessment = e.target.value;
  renderAssessmentStudentButtons();
});
$("search-template").addEventListener("input", e => {
  state.searchTemplate = e.target.value;
  renderTemplateButtons();
});
$("search-remark-preset").addEventListener("input", e => {
  state.searchRemarkPreset = e.target.value;
  renderRemarkPresetButtons();
});
$("search-export").addEventListener("input", e => {
  state.searchExport = e.target.value;
  renderExportButtons();
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
  if (type === "existing") renderExistingStudentButtons();
  else renderAssessmentStudentButtons();
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

function renderStudentList(container, students, query = "") {
  if (!container) return;
  const q = query.toLowerCase();
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

function renderExistingStudentButtons() {
  const students = state.students.filter(s => !s.type || s.type === "existing");
  renderStudentList($("existing-student-buttons"), students, state.searchExisting);
}

function renderAssessmentStudentButtons() {
  const students = state.students.filter(s => s.type === "assessment");
  renderStudentList($("assessment-student-buttons"), students, state.searchAssessment);
}

function renderTemplateButtons() {
  const container = $("template-buttons");
  if (!container) return;
  const q = state.searchTemplate.toLowerCase();
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
  const q = (state.searchExport || "").toLowerCase();
  const filtered = q ? state.students.filter(s => s.name.toLowerCase().includes(q)) : state.students;
  container.innerHTML = filtered.map(s => `
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

function renderRemarkPresetButtons() {
  const container = $("remark-preset-buttons");
  if (!container) return;
  const q = state.searchRemarkPreset.toLowerCase();
  const filtered = state.remarkPresets
    .filter(p => !q || p.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (filtered.length === 0) {
    container.innerHTML = `<p class="empty-hint">${q ? "No matches." : "No fixed options yet."}</p>`;
    return;
  }
  container.innerHTML = `<div class="roster-list">` +
    filtered.map(p => `
      <button class="roster-item" data-id="${escHtml(p.id)}">
        <span class="roster-item-name">${escHtml(p.name)}</span>
        <span class="roster-item-sub">${escHtml((p.options || []).join(" / "))}</span>
      </button>
    `).join("") +
    `</div>`;

  container.querySelectorAll(".roster-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const preset = state.remarkPresets.find(p => p.id === btn.dataset.id);
      if (preset) openManageModal(null, null, null, preset);
    });
  });
}

async function addNewRemarkPreset() {
  const preset = {
    id: cfgId("rp"),
    name: "New Preset",
    options: [],
    order: state.remarkPresets.length
  };
  state.remarkPresets.push(preset);
  await saveRemarkPreset(preset);
  renderRemarkPresetButtons();
  openManageModal(null, null, null, preset);
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
          <div class="choice-label">Start Session</div>
        </div>
      </button>
      <button class="choice-btn choice-other">
        <span class="choice-icon">🗂</span>
        <div class="choice-text">
          <div class="choice-label">View/Edit Past Sessions</div>
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
    const today = getTodayString();
    const yesterday = (() => {
      const d = new Date(today + "T00:00:00"); d.setDate(d.getDate() - 1);
      const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    })();
    const fmtShort = dateStr => {
      const [, m, d] = dateStr.split("-").map(Number);
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return `${d} ${months[m - 1]}`;
    };

    $("session-picker-list").innerHTML = `
      <div class="session-date-step">
        <p class="session-date-prompt">What date is this session for?</p>
        <div class="date-quick-btns">
          <button class="btn-date-quick" data-date="${yesterday}">Yesterday (${fmtShort(yesterday)})</button>
          <button class="btn-date-quick" data-date="${today}">Today (${fmtShort(today)})</button>
          <button class="btn-date-other">Pick a date…</button>
        </div>
      </div>`;

    $("session-picker-list").querySelectorAll(".btn-date-quick").forEach(btn => {
      btn.addEventListener("click", () => {
        closeSessionPicker();
        openSession(student, null, btn.dataset.date);
      });
    });

    $("session-picker-list").querySelector(".btn-date-other").addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "date";
      input.max = today;
      input.style.cssText = "position:fixed;opacity:0;top:0;left:0;width:1px;height:1px;";
      document.body.appendChild(input);
      const cleanup = () => { if (document.body.contains(input)) document.body.removeChild(input); };
      input.addEventListener("change", () => {
        const d = input.value;
        cleanup();
        if (!d || d > today) return;
        closeSessionPicker();
        openSession(student, null, d);
      });
      input.addEventListener("blur", () => setTimeout(cleanup, 500));
      try { input.showPicker(); } catch (_) { input.click(); }
    });
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

  // Auto-delete sessions with no remarks for any currently existing target
  const currentTargetNames = new Set((student.targets || []).map(t => t.name));
  const hasUsefulData = s => {
    const remarks = Object.values(s.remarks || {});
    if (!remarks.length) return false;
    return remarks.some(r => {
      const act = (s.activities || {})[r.activityId];
      return act && currentTargetNames.has(act.targetName);
    });
  };
  const emptySessions = sessions.filter(s => !hasUsefulData(s));
  emptySessions.forEach(s => deleteSession(s.id).catch(() => {}));
  sessions = sessions.filter(s => !emptySessions.some(e => e.id === s.id));

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

  const sorted = [...monthSessions].sort((a, b) => a.date.localeCompare(b.date));
  for (const s of monthSessions) {
    const sessionNum = sorted.findIndex(x => x.id === s.id) + 1;
    const isToday    = s.date === today;
    const dateLabel = isToday ? `Today · ${formatDate(s.date)}` : formatDate(s.date);
    html += `<div class="session-list-item" data-session-id="${s.id}">
      <div class="session-list-meta">
        <div class="session-list-label">Session ${sessionNum} of ${s.month.split(" ")[0]}</div>
        <div class="session-list-date">${dateLabel}</div>
      </div>
    </div>`;
  }

  list.innerHTML = html;

  list.querySelector(".btn-picker-back").addEventListener("click", () => {
    renderMonthGrid(student, byMonth, today);
  });

  list.querySelectorAll(".session-list-item").forEach(item => {
    item.addEventListener("click", () => {
      closeSessionPicker();
      openSessionView(student, item.dataset.sessionId);
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

function getEffectiveTargets() {
  return state.currentStudent?.targets || [];
}

async function openSession(student, existingSessionId = null, dateStr = null) {
  state.currentStudent     = student;
  state.selectedTargetName = null;
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
      : await getOrCreateSessionForDate(student.id, dateStr || getTodayString(), student.targets);
    state.currentSessionId = sessionId;

    state.fbUnsubscribe = listenToSession(sessionId, data => {
      const firstLoad = state.sessionData === null;
      state.sessionData = data;
      if (firstLoad) {
        const eff = getEffectiveTargets();
        state.selectedTargetName = eff[0]?.name || null;
        populateTargetDropdown(eff);
      }
      const active = document.activeElement;
      const busy   = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
      if (busy) {
        state.renderPending = true;
      } else {
        renderTargetContent();
      }
    });

  } catch (err) {
    $("target-content").innerHTML =
      `<div class="error-msg">Could not load session.<br>${escHtml(err.message)}</div>`;
  }
}

function leaveSession() {
  if (state.fbUnsubscribe) { state.fbUnsubscribe(); state.fbUnsubscribe = null; }
  const sessionId = state.currentSessionId;
  const data      = state.sessionData;
  const student   = state.currentStudent;
  state.currentSessionId   = null;
  state.sessionData        = null;
  state.currentStudent     = null;
  state.pendingNewActivity = null;
  state.pendingNewRemark   = null;
  state.renderPending      = false;

  if (sessionId && data) {
    const currentTargetNames = new Set((student?.targets || []).map(t => t.name));
    const remarks = Object.values(data.remarks || {});
    const hasUsefulData = remarks.some(r => {
      const act = (data.activities || {})[r.activityId];
      return act && currentTargetNames.has(act.targetName);
    });
    if (!hasUsefulData) deleteSession(sessionId).catch(() => {});
  }

  showHome();
}

function updateSessionHeader() {
  const d = state.sessionData;
  if (!d) return;
  $("session-meta").textContent =
    `Session ${d.sessionNumber} of ${d.month.split(" ")[0]} · ${formatDate(d.date)}`;
}


function populateTargetDropdown(targets) {
  const sel = $("target-select");
  const sorted = [...targets].sort((a, b) => a.name.localeCompare(b.name));
  const placeholder = sorted.length === 0
    ? `<option value="" disabled selected>— no targets yet —</option>` : "";
  sel.innerHTML = placeholder +
    sorted.map(t =>
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
  if (!state.sessionData) return;
  updateSessionHeader();
  if (!state.selectedTargetName) {
    const mb = $("btn-manage-targets");
    if (mb) mb.classList.add("hidden");
    $("target-type-chip")?.classList.add("hidden");
    $("target-content").innerHTML =
      `<p class="empty-hint" style="padding:2rem;text-align:center">
        No targets added yet. Use the dropdown above to add one.
      </p>`;
    return;
  }
  const target = getEffectiveTargets().find(t => t.name === state.selectedTargetName);
  const manageBtn = $("btn-manage-targets");
  if (!target) {
    if (manageBtn) manageBtn.classList.add("hidden");
    $("target-type-chip")?.classList.add("hidden");
    return;
  }

  if (manageBtn) {
    manageBtn.classList.toggle("hidden", target.isStructured !== true);
  }

  const typeChip  = $("target-type-chip");
  const typeBadge = $("target-type-badge");
  if (typeChip && typeBadge) {
    const label = target.templateId ? "Standard Template" : target.isStructured ? "Individual Template" : "Blank";
    const cls   = target.templateId ? "badge-template" : target.isStructured ? "badge-structured" : "badge-blank";
    typeBadge.textContent = label;
    typeBadge.className   = `target-type-value ${cls}`;
    typeChip.classList.remove("hidden");
  }

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
    // Note item — render inline in order, styled like a section heading
    if (pa.isNote) {
      if (pa.text) html += `<div class="activity-note-heading">${renderNoteText(pa.text)}</div>`;
      return;
    }

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
        html += renderRemarkFields(rem, target, pa.remarkPresetId || null, pa.sentenceStarter || null);
      }
      if (isPending) {
        html += renderPendingRemarkFields(pendingKey, actId, pa.name, idx, target);
      } else {
        html += `<button class="btn-add-remark"
          data-pending-key="${escHtml(pendingKey)}"
          data-act-id="${actId || ""}"
          data-pa-name="${escHtml(pa.name)}"
          data-pa-order="${idx}"
          data-target="${escHtml(target.name)}">+ Add Remark &amp; Trials</button>`;
      }
    }

    html += `</div>`;
  });

  // One-off activities added just for this session (white, same as free-form)
  const manualActivities = getActivitiesForTarget(target.name).filter(a => !a.isPredefined);
  for (const act of manualActivities) {
    const pendingKey = act.id;
    const isPending  = state.pendingNewRemark?.pendingKey === pendingKey;
    const remarks    = getRemarksForActivity(act.id);

    html += `<div class="entry-block" data-act-id="${act.id}">
      <div class="entry-field">
        <span class="field-label">Activity</span>
        <textarea class="field-input activity-name-input"
          rows="2"
          data-act-id="${act.id}"
          data-original="${escHtml(act.activityName)}">${escHtml(act.activityName)}</textarea>
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
        data-target="${escHtml(target.name)}">+ Add Remark &amp; Trials</button>`;
    }
    html += `</div>`;
  }

  // Pending new one-off activity
  if (state.pendingNewActivity?.targetName === target.name) {
    html += `<div class="entry-block">
      <div class="entry-field">
        <span class="field-label">Activity</span>
        <textarea id="new-activity-textarea" class="field-input"
          placeholder="Type activity name… (Enter = new line · Ctrl+Enter to save)" rows="2"></textarea>
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
        <textarea class="field-input activity-name-input"
          rows="2"
          data-act-id="${act.id}"
          data-original="${escHtml(act.activityName)}">${escHtml(act.activityName)}</textarea>
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
        data-target="${escHtml(target.name)}">+ Add Remark &amp; Trials</button>`;
    }

    html += `</div>`;
  }

  // Pending new activity block
  if (state.pendingNewActivity?.targetName === target.name) {
    html += `<div class="entry-block">
      <div class="entry-field">
        <span class="field-label">Activity</span>
        <textarea id="new-activity-textarea" class="field-input"
          placeholder="Type activity name… (Enter = new line · Ctrl+Enter to save)" rows="2"></textarea>
        <button class="btn-icon btn-cancel-new-activity" title="Cancel">✕</button>
      </div>
    </div>`;
  }

  html += `<button class="btn-add-activity"
    data-target="${escHtml(target.name)}">+ Add Activity</button>`;

  return html;
}

// ─── REMARK FIELDS ───────────────────────────────────────────

function renderRemarkFields(rem, target, remarkPresetId = null, sentenceStarter = null) {
  const preset = remarkPresetId
    ? state.remarkPresets.find(p => p.id === remarkPresetId)
    : null;

  const trials = rem.trials || [];
  const badgesHtml = trials.map((score, idx) =>
    `<span class="trial-badge">${score}<button class="btn-trial-delete"
      data-rem-id="${rem.id}" data-idx="${idx}">×</button></span>`
  ).join("");

  let remarkContent;
  if (sentenceStarter) {
    remarkContent = `<div class="remark-starter-wrap">
      <span class="remark-starter-prefix">${escHtml(sentenceStarter)}</span>
      <textarea class="field-input remark-text-input"
        data-rem-id="${rem.id}"
        data-original="${escHtml(rem.text || "")}"
        rows="1">${escHtml(rem.text || "")}</textarea>
    </div>`;
  } else if (preset) {
    remarkContent = `<div class="remark-preset-opts">
        ${(preset.options || []).map(opt =>
          `<button class="btn-remark-opt${rem.text === opt ? " active" : ""}"
            data-rem-id="${rem.id}"
            data-opt="${escHtml(opt)}">${escHtml(opt)}</button>`
        ).join("")}
       </div>`;
  } else {
    remarkContent = `<textarea class="field-input remark-text-input"
        data-rem-id="${rem.id}"
        data-original="${escHtml(rem.text || "")}"
        rows="2">${escHtml(rem.text || "")}</textarea>`;
  }

  return `
    <div class="entry-divider"></div>
    <div class="entry-field">
      <span class="field-label">Remark</span>
      ${remarkContent}
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
        placeholder="Type remark… (Enter = new line · Ctrl+Enter to save)" rows="2"></textarea>
    </div>
    <div class="pending-remark-actions">
      <button class="btn-cancel-remark btn-remark-cancel">✕ Cancel</button>
      <button class="btn-save-remark btn-remark-save">✓ Save</button>
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
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); input.blur(); }
    });
  });

  // ── New activity input ───────────────────────────────────
  c.querySelector(".btn-add-activity")?.addEventListener("click", () => {
    state.pendingNewActivity = { targetName: target.name };
    state.pendingNewRemark   = null;
    renderTargetContent();
    setTimeout(() => $("new-activity-textarea")?.focus(), 50);
  });

  $("new-activity-textarea")?.addEventListener("keydown", e => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); confirmNewActivity(target); }
    if (e.key === "Escape") cancelPendingActivity();
  });

  $("new-activity-textarea")?.addEventListener("blur", e => {
    // Small delay so cancel button click can fire first
    setTimeout(() => {
      const input = $("new-activity-textarea");
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

  // ── Remark text: Enter = new line, blur auto-saves ──
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
  });

  // ── Add remark (immediate creation) ──────────────────────
  c.querySelectorAll(".btn-add-remark").forEach(btn => {
    btn.addEventListener("click", async () => {
      const paName  = btn.dataset.paName || null;
      const paOrder = Number(btn.dataset.paOrder) || 0;
      let   actId   = btn.dataset.actId  || null;
      state.pendingNewActivity = null;
      if (paName) actId = await ensureFedcActivity(target.name, paName, paOrder);
      if (!actId) return;
      await addRemark(state.currentSessionId, actId, "");
    });
  });

  // ── Remark preset option buttons ──────────────────────────
  c.querySelectorAll(".btn-remark-opt").forEach(btn => {
    btn.addEventListener("click", async () => {
      btn.closest(".remark-preset-opts")?.querySelectorAll(".btn-remark-opt").forEach(b => {
        b.classList.toggle("active", b === btn);
      });
      await updateRemarkText(state.currentSessionId, btn.dataset.remId, btn.dataset.opt);
    });
  });


  // ── New remark: ✓ Save button or Ctrl/Cmd+Enter saves ───
  c.querySelectorAll(".btn-save-remark").forEach(btn => {
    btn.addEventListener("click", () => saveNewRemark(target));
  });
  const newRemTa = $("new-remark-textarea");
  if (newRemTa) {
    newRemTa.addEventListener("keydown", e => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveNewRemark(target); }
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
  const input = $("new-activity-textarea");
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
// SESSION VIEW SCREEN (table-based view/edit for past sessions)
// ============================================================

function getViewEffectiveTargets() {
  const d = state.viewSessionData;
  const currentTargets = state.viewStudent?.targets || [];
  if (!d) return currentTargets;
  if (d.date === getTodayString()) return currentTargets;
  if (d.targetsSnapshot?.length) {
    // Only show snapshot targets that still exist in the current student config.
    // Deleted targets are excluded so their data doesn't appear.
    const currentNames = new Set(currentTargets.map(t => t.name));
    return d.targetsSnapshot.filter(t => currentNames.has(t.name));
  }
  return currentTargets;
}

async function openSessionView(student, sessionId) {
  state.viewStudent        = student;
  state.viewSessionId      = sessionId;
  state.viewSessionData    = null;
  state.viewRenderPending  = false;

  showScreen("screen-session-view");
  $("view-student-name").textContent = student.name;
  $("view-session-meta").textContent = "";
  $("session-view-body").innerHTML = `<div class="loading">Loading…</div>`;

  if (state.fbViewUnsubscribe) { state.fbViewUnsubscribe(); state.fbViewUnsubscribe = null; }

  try {
    state.fbViewUnsubscribe = listenToSession(sessionId, data => {
      state.viewSessionData = data;
      const active = document.activeElement;
      const busy   = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
      if (busy) { state.viewRenderPending = true; }
      else      { renderSessionView(); }
    });
  } catch (err) {
    $("session-view-body").innerHTML =
      `<div class="error-msg">Could not load session.<br>${escHtml(err.message)}</div>`;
  }
}

function leaveSessionView() {
  state.viewPickerTargetName = null;
  if (state.fbViewUnsubscribe) { state.fbViewUnsubscribe(); state.fbViewUnsubscribe = null; }
  const sessionId = state.viewSessionId;
  const data      = state.viewSessionData;
  const student   = state.viewStudent;
  state.viewSessionId     = null;
  state.viewSessionData   = null;
  state.viewStudent       = null;
  state.viewRenderPending = false;

  if (sessionId && data) {
    const currentTargetNames = new Set((student?.targets || []).map(t => t.name));
    const remarks = Object.values(data.remarks || {});
    const hasUsefulData = remarks.some(r => {
      const act = (data.activities || {})[r.activityId];
      return act && currentTargetNames.has(act.targetName);
    });
    if (!hasUsefulData) deleteSession(sessionId).catch(() => {});
  }

  showHome();
}

$("btn-view-back").addEventListener("click", leaveSessionView);

function renderSessionView() {
  const data    = state.viewSessionData;
  const student = state.viewStudent;
  if (!data || !student) return;

  $("view-session-meta").innerHTML =
    `Session ${data.sessionNumber} of ${data.month.split(" ")[0]} · ${formatDate(data.date)}`
    + ` <button class="btn-edit-session-date" title="Change date">✏</button>`;

  $("view-session-meta").querySelector(".btn-edit-session-date").addEventListener("click", () => {
    const today = getTodayString();
    const input = document.createElement("input");
    input.type = "date";
    input.value = data.date;
    input.max = today;
    input.style.cssText = "position:fixed;opacity:0;top:0;left:0;width:1px;height:1px;";
    document.body.appendChild(input);
    const cleanup = () => { if (document.body.contains(input)) document.body.removeChild(input); };
    input.addEventListener("change", async () => {
      const newDate = input.value;
      cleanup();
      if (!newDate || newDate === data.date) return;
      try {
        await updateSessionDate(state.viewSessionId, newDate, state.viewStudent.id);
      } catch (err) {
        alert(err.message);
      }
    });
    input.addEventListener("blur", () => setTimeout(cleanup, 500));
    try { input.showPicker(); } catch (_) { input.click(); }
  });

  const targets = getViewEffectiveTargets();
  const sorted  = [...targets].sort((a, b) => a.name.localeCompare(b.name));

  $("session-view-body").innerHTML = sorted.length
    ? sorted.map(t => buildTargetViewTable(t, data)).join("")
    : `<p style="color:var(--text-muted);padding:1rem">No targets recorded.</p>`;

  attachViewListeners();
}

function buildViewActList(target, data) {
  const actList = [];
  const targetName = target.name;
  let no = 0;
  if (target.predefinedActivities?.length > 0) {
    target.predefinedActivities.filter(pa => !pa.isHeading).forEach(pa => {
      no++;
      const entry = Object.entries(data.activities || {}).find(([, a]) => a.targetName === targetName && a.activityName === pa.name);
      actList.push({ name: pa.name, actId: entry?.[0] || null, isPredefined: true, no });
    });
  }
  Object.entries(data.activities || {})
    .filter(([, a]) => a.targetName === targetName && !a.isPredefined)
    .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0))
    .forEach(([actId, act]) => {
      no++;
      actList.push({ name: act.activityName, actId, isPredefined: false, no });
    });
  return actList;
}

function buildTargetViewTable(target, data) {
  const dayAvg = calcViewDayAvg(data, target);

  let rows = "";
  if (target.predefinedActivities?.length > 0) {
    let no = 0;
    for (const pa of target.predefinedActivities) {
      if (pa.isHeading) {
        rows += `<tr class="view-heading-row"><td colspan="6">${escHtml(pa.name)}</td></tr>`;
        continue;
      }
      if (pa.isNote) {
        rows += `<tr class="view-note-row"><td colspan="6">${renderNoteText(pa.text)}</td></tr>`;
        continue;
      }
      no++;
      const entry = Object.entries(data.activities || {})
        .find(([, a]) => a.targetName === target.name && a.activityName === pa.name);
      rows += viewActivityRows(no, pa.name, entry?.[0] || null, data, target, true);
    }
    // manual (non-predefined) activities added during session
    Object.entries(data.activities || {})
      .filter(([, a]) => a.targetName === target.name && !a.isPredefined)
      .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0))
      .forEach(([actId, act]) => {
        no++;
        rows += viewActivityRows(no, act.activityName, actId, data, target, false);
      });
  } else {
    let no = 0;
    Object.entries(data.activities || {})
      .filter(([, a]) => a.targetName === target.name)
      .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0))
      .forEach(([actId, act]) => {
        no++;
        rows += viewActivityRows(no, act.activityName, actId, data, target, false);
      });
  }

  rows += `<tr class="view-add-activity-row">
    <td colspan="6">
      <button class="btn-view-add-activity" data-target-name="${escHtml(target.name)}">＋ Activity</button>
      <button class="btn-view-add-remark" data-target-name="${escHtml(target.name)}">＋ Remark</button>
    </td>
  </tr>`;

  if (state.viewPickerTargetName === target.name) {
    const actList = buildViewActList(target, data);
    rows += `<tr class="view-act-picker-row">
      <td colspan="6">
        <div class="view-act-picker">
          <span class="view-act-picker-label">Add remark to:</span>
          ${actList.map((a, i) => `<button class="btn-view-act-pick" data-idx="${i}" data-target-name="${escHtml(target.name)}">${a.no} ${escHtml(a.name)}</button>`).join("")}
          <button class="btn-view-cancel-picker">Cancel</button>
        </div>
      </td>
    </tr>`;
  }

  if (target.hasComment) {
    const key     = sanitizeKey(target.name);
    const comment = (data.fedcComments || {})[key] || "";
    rows += `<tr class="view-comment-row">
      <td colspan="2" class="view-comment-label">Comment</td>
      <td colspan="4">
        <textarea class="view-comment-edit" data-target-key="${escHtml(key)}" rows="3"
        >${escHtml(comment)}</textarea>
      </td>
    </tr>`;
  }

  if (dayAvg !== null) {
    rows += `<tr class="view-dayavg-row">
      <td colspan="5" style="text-align:right">Day's Average</td>
      <td class="vcol-score">${dayAvg}%</td>
    </tr>`;
  }

  return `<div class="target-view-section">
    <div class="target-view-header">
      <span class="target-view-name">${escHtml(target.name)}</span>
      ${dayAvg !== null ? `<span class="target-view-avg">${dayAvg}%</span>` : ""}
    </div>
    <div class="view-table-wrapper">
      <table class="view-table">
        <thead><tr>
          <th class="vcol-no">No.</th>
          <th class="vcol-act">Activity</th>
          <th class="vcol-rem">Remark</th>
          <th class="vcol-trials">Trials</th>
          <th class="vcol-total">Total</th>
          <th class="vcol-score">% Score</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function viewActivityRows(no, actName, actId, data, target, isPredefined = true) {
  const remarks = actId ? viewGetRemarks(data, actId) : [];

  const actCell = isPredefined
    ? escHtml(actName)
    : `<div style="display:flex;align-items:center;gap:.3rem">
        <input class="view-act-edit" type="text" value="${escHtml(actName)}"
          data-act-id="${escHtml(actId || "")}" data-original="${escHtml(actName)}" />
        <button class="view-act-del" data-act-id="${escHtml(actId || "")}"
          data-target-name="${escHtml(target.name)}" title="Delete activity">×</button>
       </div>`;

  const paEntry = isPredefined
    ? target.predefinedActivities?.find(pa => pa.name === actName)
    : null;
  const remarkPresetId  = paEntry?.remarkPresetId  || null;
  const sentenceStarter = paEntry?.sentenceStarter || null;

  if (remarks.length === 0) {
    return `<tr>
      <td class="vcol-no">${no}</td>
      <td class="vcol-act">${actCell}</td>
      <td class="vcol-rem"></td>
      <td class="vcol-trials"></td>
      <td class="vcol-total"></td>
      <td class="vcol-score"></td>
    </tr>`;
  }
  return remarks.map((rem, ri) => viewRemarkRow(
    ri === 0 ? no : null,
    ri === 0 ? actCell : null,
    rem, target, remarkPresetId, sentenceStarter
  )).join("");
}

function viewRemarkRow(no, actName, rem, target, remarkPresetId = null, sentenceStarter = null) {
  const allTrials  = rem.trials || [];
  const maxPts     = target.maxPoints || 3;
  const validTrials = allTrials.filter(t => t !== -1);
  const total      = validTrials.reduce((a, b) => a + b, 0);
  const scorePct   = validTrials.length > 0
    ? Math.round(total / (validTrials.length * maxPts) * 100) + "%" : "";

  const trialCells = allTrials.map((t, ti) => `
    <span class="trial-cell">
      <select class="view-trial-select" data-rem-id="${escHtml(rem.id)}" data-trial-idx="${ti}">
        <option value="-1"${t === -1 ? " selected" : ""}>—</option>
        ${Array.from({ length: maxPts + 1 }, (_, i) => maxPts - i)
          .map(v => `<option value="${v}"${v === t ? " selected" : ""}>${v}</option>`).join("")}
      </select>
      <button class="view-trial-del" data-rem-id="${escHtml(rem.id)}" data-trial-idx="${ti}">×</button>
    </span>`).join("") +
    `<button class="view-add-trial" data-rem-id="${escHtml(rem.id)}">+</button>`;

  const preset = remarkPresetId ? state.remarkPresets.find(p => p.id === remarkPresetId) : null;
  let remarkCell;
  if (sentenceStarter) {
    remarkCell = `<div class="view-starter-wrap">
      <span class="view-starter-prefix">${escHtml(sentenceStarter)}</span>
      <input type="text" class="view-starter-input" data-rem-id="${escHtml(rem.id)}"
        value="${escHtml(rem.text || "")}">
    </div>`;
  } else if (preset) {
    remarkCell = `<select class="view-remark-preset-select" data-rem-id="${escHtml(rem.id)}">
      <option value="">— select —</option>
      ${(preset.options || []).map(opt =>
        `<option value="${escHtml(opt)}"${rem.text === opt ? " selected" : ""}>${escHtml(opt)}</option>`
      ).join("")}
     </select>`;
  } else {
    remarkCell = `<textarea class="view-remark-edit" data-rem-id="${escHtml(rem.id)}"
      rows="2">${escHtml(rem.text || "")}</textarea>`;
  }

  return `<tr>
    <td class="vcol-no">${no !== null ? no : ""}</td>
    <td class="vcol-act">${actName !== null ? actName : ""}</td>
    <td class="vcol-rem">${remarkCell}</td>
    <td class="vcol-trials"><div class="trial-cells">${trialCells}</div></td>
    <td class="vcol-total">${validTrials.length > 0 ? total : ""}</td>
    <td class="vcol-score">
      <div style="display:flex;align-items:center;gap:.3rem;justify-content:flex-end">
        <span>${scorePct}</span>
        <button class="view-rem-del" data-rem-id="${escHtml(rem.id)}" title="Delete remark">×</button>
      </div>
    </td>
  </tr>`;
}

function viewGetRemarks(data, actId) {
  return Object.entries(data.remarks || {})
    .filter(([, r]) => r.activityId === actId)
    .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0))
    .map(([id, r]) => ({ id, ...r }));
}

function calcViewDayAvg(data, target) {
  const avgs = [];
  Object.entries(data.activities || {})
    .filter(([, a]) => a.targetName === target.name)
    .forEach(([actId]) => {
      viewGetRemarks(data, actId).forEach(rem => {
        const trials = (rem.trials || []).filter(t => t !== -1);
        if (!trials.length) return;
        avgs.push(trials.reduce((a, b) => a + b, 0) / (trials.length * (target.maxPoints || 3)) * 100);
      });
    });
  return avgs.length ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length) : null;
}

function attachViewListeners() {
  const body = $("session-view-body");

  body.querySelectorAll(".view-trial-select").forEach(sel => {
    sel.addEventListener("change", async () => {
      const rem = state.viewSessionData?.remarks?.[sel.dataset.remId];
      if (!rem) return;
      const trials = [...(rem.trials || [])];
      trials[Number(sel.dataset.trialIdx)] = Number(sel.value);
      await setTrials(state.viewSessionId, sel.dataset.remId, trials);
    });
  });

  body.querySelectorAll(".view-trial-del").forEach(btn => {
    btn.addEventListener("click", async () => {
      const rem = state.viewSessionData?.remarks?.[btn.dataset.remId];
      if (!rem) return;
      const trials = (rem.trials || []).filter((_, i) => i !== Number(btn.dataset.trialIdx));
      await setTrials(state.viewSessionId, btn.dataset.remId, trials);
    });
  });

  body.querySelectorAll(".view-add-trial").forEach(btn => {
    btn.addEventListener("click", async () => {
      const rem = state.viewSessionData?.remarks?.[btn.dataset.remId];
      if (!rem) return;
      const act    = state.viewSessionData?.activities?.[rem.activityId];
      const target = act
        ? getViewEffectiveTargets().find(t => t.name === act.targetName)
        : null;
      const maxPts = target?.maxPoints || 3;
      await setTrials(state.viewSessionId, btn.dataset.remId, [...(rem.trials || []), -1]);
    });
  });

  body.querySelectorAll(".view-remark-edit").forEach(ta => {
    ta.addEventListener("blur", async () => {
      const rem = state.viewSessionData?.remarks?.[ta.dataset.remId];
      if (!rem || ta.value === (rem.text || "")) return;
      await updateRemarkText(state.viewSessionId, ta.dataset.remId, ta.value);
    });
  });

  body.querySelectorAll(".view-remark-preset-select").forEach(sel => {
    sel.addEventListener("change", async () => {
      if (!sel.value) return;
      await updateRemarkText(state.viewSessionId, sel.dataset.remId, sel.value);
    });
  });

  body.querySelectorAll(".view-starter-input").forEach(input => {
    input.addEventListener("blur", async () => {
      const rem = state.viewSessionData?.remarks?.[input.dataset.remId];
      if (!rem || input.value === (rem.text || "")) return;
      await updateRemarkText(state.viewSessionId, input.dataset.remId, input.value);
    });
  });

  body.querySelectorAll(".btn-view-add-activity").forEach(btn => {
    btn.addEventListener("click", async () => {
      const name = prompt("Activity name:");
      if (!name?.trim()) return;
      await addActivity(state.viewSessionId, btn.dataset.targetName, name.trim(), Date.now(), false);
    });
  });

  body.querySelectorAll(".btn-view-add-remark").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetName = btn.dataset.targetName;
      const target = getViewEffectiveTargets().find(t => t.name === targetName);
      const actList = buildViewActList(target, state.viewSessionData);
      if (actList.length === 0) { alert("Add an activity first."); return; }

      state.viewPickerTargetName = targetName;
      body.querySelectorAll(".view-act-picker-row").forEach(r => r.remove());

      const pickerRow = document.createElement("tr");
      pickerRow.className = "view-act-picker-row";
      pickerRow.innerHTML = `<td colspan="6">
        <div class="view-act-picker">
          <span class="view-act-picker-label">Add remark to:</span>
          ${actList.map((a, i) => `<button class="btn-view-act-pick" data-idx="${i}" data-target-name="${escHtml(targetName)}">${a.no} ${escHtml(a.name)}</button>`).join("")}
          <button class="btn-view-cancel-picker">Cancel</button>
        </div>
      </td>`;
      btn.closest("tr").after(pickerRow);

      pickerRow.querySelectorAll(".btn-view-act-pick").forEach(pickBtn => {
        pickBtn.addEventListener("click", async () => {
          const chosen = actList[Number(pickBtn.dataset.idx)];
          state.viewPickerTargetName = null;
          pickerRow.remove();
          let actId = chosen.actId;
          if (!actId) actId = await addActivity(state.viewSessionId, targetName, chosen.name, Date.now(), chosen.isPredefined);
          await addRemark(state.viewSessionId, actId, "", null);
        });
      });

      pickerRow.querySelector(".btn-view-cancel-picker").addEventListener("click", () => {
        state.viewPickerTargetName = null;
        pickerRow.remove();
      });
    });
  });

  // Handles picker buttons rebuilt by Firebase re-renders (state-driven)
  body.querySelectorAll(".btn-view-act-pick").forEach(pickBtn => {
    pickBtn.addEventListener("click", async () => {
      const targetName = pickBtn.dataset.targetName;
      const target = getViewEffectiveTargets().find(t => t.name === targetName);
      const actList = buildViewActList(target, state.viewSessionData);
      const chosen = actList[Number(pickBtn.dataset.idx)];
      state.viewPickerTargetName = null;
      let actId = chosen.actId;
      if (!actId) actId = await addActivity(state.viewSessionId, targetName, chosen.name, Date.now(), chosen.isPredefined);
      await addRemark(state.viewSessionId, actId, "", null);
    });
  });

  body.querySelectorAll(".btn-view-cancel-picker").forEach(btn => {
    btn.addEventListener("click", () => {
      state.viewPickerTargetName = null;
      renderSessionView();
    });
  });

  body.querySelectorAll(".view-remark-new").forEach(ta => {
    ta.addEventListener("blur", async () => {
      const text = ta.value.trim();
      if (!text) return;
      let actId = ta.dataset.actId;
      if (!actId) actId = await addActivity(state.viewSessionId, ta.dataset.targetName, ta.dataset.actName, Date.now(), true);
      await addRemark(state.viewSessionId, actId, text, null);
    });
  });

  body.querySelectorAll(".view-add-trial-new").forEach(btn => {
    btn.addEventListener("click", async () => {
      const target = getViewEffectiveTargets().find(t => t.name === btn.dataset.targetName);
      const maxPts = target?.maxPoints || 3;
      let actId = btn.dataset.actId;
      if (!actId) actId = await addActivity(state.viewSessionId, btn.dataset.targetName, btn.dataset.actName, Date.now(), true);
      const remId = await addRemark(state.viewSessionId, actId, "", null);
      await setTrials(state.viewSessionId, remId, [-1]);
    });
  });

  body.querySelectorAll(".view-act-edit").forEach(input => {
    input.addEventListener("blur", async () => {
      const newName = input.value.trim();
      if (!newName || newName === input.dataset.original) return;
      if (!input.dataset.actId) return;
      input.dataset.original = newName;
      await updateActivityName(state.viewSessionId, input.dataset.actId, newName);
    });
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    });
  });

  body.querySelectorAll(".view-act-del").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this activity and all its remarks?")) return;
      const actId = btn.dataset.actId;
      if (!actId) return;
      const remIds = viewGetRemarks(state.viewSessionData, actId).map(r => r.id);
      await deleteActivity(state.viewSessionId, actId, remIds);
    });
  });

  body.querySelectorAll(".view-rem-del").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this remark?")) return;
      await deleteRemark(state.viewSessionId, btn.dataset.remId);
    });
  });

  body.querySelectorAll(".view-comment-edit").forEach(ta => {
    ta.addEventListener("blur", async () => {
      const key    = ta.dataset.targetKey;
      const target = getViewEffectiveTargets().find(t => sanitizeKey(t.name) === key);
      if (!target) return;
      const current = (state.viewSessionData?.fedcComments || {})[key] || "";
      if (ta.value === current) return;
      await updateFedcComment(state.viewSessionId, target.name, ta.value);
    });
  });
}

// ============================================================
// MANAGE MODAL (inline student / target / template config editing)
// ============================================================

function cfgId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── Open / close ──────────────────────────────────────────────

function openManageModal(student, targetOrNull, templateOrNull = null, remarkPresetOrNull = null) {
  $("manage-modal").classList.remove("hidden");
  if (remarkPresetOrNull) {
    renderRemarkPresetManageContent(remarkPresetOrNull);
  } else if (templateOrNull) {
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
    if (state.currentSessionId) renderTargetContent();
  }
  // Always refresh all home screen sections
  renderExistingStudentButtons();
  renderAssessmentStudentButtons();
  renderTemplateButtons();
  renderRemarkPresetButtons();
  renderExportButtons();
}

$("manage-modal-close").addEventListener("click",    closeManageModal);
$("manage-modal-backdrop").addEventListener("click", closeManageModal);

// Delegated handler: Enter/Ctrl+B in note textareas
$("manage-modal-body").addEventListener("keydown", e => {
  const ta = e.target;
  if (!ta.closest(".admin-note-item")) return;
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ta.blur(); return; }
  if (e.key === "Enter") {
    e.preventDefault();
    e.stopImmediatePropagation();
    const s = ta.selectionStart, en = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + "\n" + ta.value.slice(en);
    ta.selectionStart = ta.selectionEnd = s + 1;
    autoResizeTextarea(ta);
    return;
  }
  if (e.key === "b" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    const s = ta.selectionStart, en = ta.selectionEnd;
    const selected = ta.value.slice(s, en);
    const replacement = `**${selected}**`;
    ta.value = ta.value.slice(0, s) + replacement + ta.value.slice(en);
    if (selected.length === 0) {
      ta.selectionStart = ta.selectionEnd = s + 2;
    } else {
      ta.selectionStart = s;
      ta.selectionEnd = s + replacement.length;
    }
    ta.dispatchEvent(new Event("input"));
  }
});

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

  let html = `
    <div style="display:flex;flex-direction:column;gap:.6rem;margin-bottom:1.25rem">
      <button class="btn-target-type" id="btn-add-custom-target">
        <span class="btn-target-label">+ Blank Target</span>
        <span class="btn-target-desc">Type everything from scratch each session</span>
      </button>
      <button class="btn-target-type" id="btn-add-structured-target">
        <span class="btn-target-label">+ Individual Template Target</span>
        <span class="btn-target-desc">Activities will be the same every session, just fill in remarks</span>
      </button>
    </div>`;

  if (state.templates.length > 0) {
    html += `<div class="admin-section-title">Or add from a Standard Template</div>
    <div class="admin-list" id="template-picker-list">`;
    const sortedTmpls = [...state.templates].sort((a, b) => a.name.localeCompare(b.name));
    sortedTmpls.forEach(tmpl => {
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
      templateId: null, isStructured: false
    };
    student.targets.push(t);
    const si = state.students.findIndex(s => s.id === student.id);
    if (si >= 0) state.students[si] = student;
    await saveStudent(student);
    state.selectedTargetName = t.name;
    populateTargetDropdown(student.targets);
    renderTargetContent();
  });

  $("btn-add-structured-target").addEventListener("click", async () => {
    $("manage-modal").classList.add("hidden");
    const name = prompt("Target name:");
    if (!name?.trim()) return;
    const t = {
      id: cfgId("t"), name: name.trim(),
      maxPoints: 3, hasComment: false, fullName: "",
      order: student.targets.length,
      predefinedActivities: [], notes: [],
      templateId: null, isStructured: true
    };
    student.targets.push(t);
    const si = state.students.findIndex(s => s.id === student.id);
    if (si >= 0) state.students[si] = student;
    await saveStudent(student);
    state.selectedTargetName = t.name;
    populateTargetDropdown(student.targets);
    renderTargetContent();
    openManageModal(student, t);
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

// ── Remark preset management content ─────────────────────────

function renderRemarkPresetManageContent(preset) {
  $("manage-modal-title").textContent = preset.name || "New Preset";
  const opts = preset.options || [];

  let html = `
    <div class="admin-section">
      <label class="admin-label">Preset Name</label>
      <input class="admin-input" id="mn-preset-name" value="${escHtml(preset.name || "")}"
        placeholder="e.g. Progress Level" />
    </div>
    <div class="admin-section-title">Options</div>
    <div class="admin-list" id="mn-preset-options">`;

  opts.forEach((opt, idx) => {
    html += `<div class="admin-list-item" data-idx="${idx}">
      <input class="admin-input" id="mn-preset-opt-${idx}" value="${escHtml(opt)}"
        placeholder="Option text" style="flex:1" />
      <button class="btn-adm-del mn-del-preset-opt" data-idx="${idx}">🗑</button>
    </div>`;
  });

  html += `</div>
    <div style="margin-top:.5rem">
      <button class="btn-admin-add" id="btn-mn-add-preset-opt" style="width:100%">+ Add Option</button>
    </div>
    <div style="margin-top:2rem;padding-bottom:1.5rem">
      <button class="btn-primary-sm" id="btn-mn-done-preset"
        style="width:100%;padding:.75rem;margin-bottom:.75rem">Done</button>
      <button class="btn-adm-danger" id="btn-mn-del-preset">Delete This Preset</button>
    </div>`;

  $("manage-modal-body").innerHTML = html;

  const savePreset = async () => {
    const i = state.remarkPresets.findIndex(p => p.id === preset.id);
    if (i >= 0) state.remarkPresets[i] = preset;
    await saveRemarkPreset(preset);
  };

  $("mn-preset-name").addEventListener("blur", async () => {
    const v = $("mn-preset-name").value.trim();
    if (!v || v === preset.name) return;
    preset.name = v;
    $("manage-modal-title").textContent = v;
    await savePreset();
  });
  $("mn-preset-name").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); $("mn-preset-name").blur(); }
  });

  $("manage-modal-body").querySelectorAll(".mn-del-preset-opt").forEach(btn => {
    btn.addEventListener("click", async () => {
      preset.options.splice(Number(btn.dataset.idx), 1);
      await savePreset();
      renderRemarkPresetManageContent(preset);
    });
  });

  $("btn-mn-add-preset-opt").addEventListener("click", async () => {
    (preset.options = preset.options || []).push("New Option");
    await savePreset();
    renderRemarkPresetManageContent(preset);
  });

  opts.forEach((opt, idx) => {
    const input = $(`mn-preset-opt-${idx}`);
    if (!input) return;
    input.addEventListener("blur", async () => {
      const v = input.value.trim();
      if (!v || v === preset.options[idx]) return;
      preset.options[idx] = v;
      await savePreset();
    });
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    });
  });

  $("btn-mn-done-preset").addEventListener("click", closeManageModal);

  $("btn-mn-del-preset").addEventListener("click", async () => {
    if (!confirm(`Delete "${preset.name}"?`)) return;
    state.remarkPresets = state.remarkPresets.filter(p => p.id !== preset.id);
    await deleteRemarkPreset(preset.id);
    closeManageModal();
  });
}

// ── Student management content ────────────────────────────────

function renderStudentManageContent(student) {
  $("manage-modal-title").textContent = student.name;
  const isAssessment = student.type === "assessment";
  const sorted = [...student.targets].sort((a, b) => a.name.localeCompare(b.name));

  const targetsHtml = sorted.length > 0
    ? `<div class="roster-list" style="margin-bottom:.5rem">` +
        sorted.map(t => `
          <div class="roster-item">
            <span class="roster-item-name">${escHtml(t.name)}</span>
            <button class="btn-del-target" data-target-id="${escHtml(t.id)}"
              style="font-size:.8rem;padding:.2rem .55rem;border-radius:6px;
                     border:1.5px solid var(--danger);color:var(--danger);
                     background:none;cursor:pointer;flex-shrink:0">
              Delete
            </button>
          </div>`).join("") +
      `</div>`
    : `<p style="color:var(--text-muted);font-size:.88rem;margin:.25rem 0 .75rem">No targets yet.</p>`;

  const html = `
    <div class="admin-section">
      <label class="admin-label">Student Name</label>
      <div style="display:flex;gap:.5rem;align-items:center">
        <input class="admin-input" id="mn-s-name" value="${escHtml(student.name)}" style="flex:1" />
        <button class="btn-primary-sm" id="btn-mn-rename">Save</button>
      </div>
    </div>
    <div class="admin-section">
      <label class="admin-label">Targets</label>
      ${targetsHtml}
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

  $("manage-modal-body").querySelectorAll(".btn-del-target").forEach(btn => {
    btn.addEventListener("click", async () => {
      const target = student.targets.find(t => t.id === btn.dataset.targetId);
      if (!target) return;
      if (!confirm(`Delete target "${target.name}"? All session data for this target will also be permanently deleted.`)) return;
      student.targets = student.targets.filter(t => t.id !== target.id);
      student.targets.forEach((t, i) => t.order = i);
      const si = state.students.findIndex(s => s.id === student.id);
      if (si >= 0) state.students[si] = student;
      await saveStudent(student);
      await deleteTargetDataFromSessions(student.id, target.name);
      renderStudentManageContent(student);
    });
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
  let dragEl      = null;
  let placeholder = null;
  let offsetY     = 0;
  let lastY       = 0;
  let scrollRaf   = null;

  // The scrollable container is the manage modal body
  const scrollEl = listEl.closest('.manage-modal-body') || listEl.parentElement;
  const ZONE  = 80;  // px from edge to start auto-scrolling
  const SPEED = 12;  // max px per frame

  function autoScroll() {
    if (!dragEl || !scrollEl) { scrollRaf = null; return; }
    const { top, bottom } = scrollEl.getBoundingClientRect();
    if (lastY < top + ZONE) {
      scrollEl.scrollTop -= Math.ceil(SPEED * (1 - (lastY - top) / ZONE));
    } else if (lastY > bottom - ZONE) {
      scrollEl.scrollTop += Math.ceil(SPEED * (1 - (bottom - lastY) / ZONE));
    }
    scrollRaf = requestAnimationFrame(autoScroll);
  }

  listEl.addEventListener('pointerdown', e => {
    if (!e.target.closest('.drag-handle')) return;
    const item = e.target.closest('.admin-list-item');
    if (!item) return;
    e.preventDefault();

    const rect = item.getBoundingClientRect();
    offsetY = e.clientY - rect.top;
    lastY   = e.clientY;

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
    scrollRaf = requestAnimationFrame(autoScroll);
  });

  listEl.addEventListener('pointermove', e => {
    if (!dragEl) return;
    lastY = e.clientY;
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
    if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = null; }
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

function autoResizeTextarea(el) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

function renderNoteText(text) {
  return escHtml(text || "").replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
}

function renderTargetManageContent(student, target) {
  $("manage-modal-title").textContent = target.name;
  target.predefinedActivities = normalizeActivitiesFormat(target.predefinedActivities || []);

  // Migrate legacy notes array into the unified predefinedActivities list
  if (target.notes?.length > 0) {
    for (const n of target.notes) {
      target.predefinedActivities.push({ id: n.id || cfgId("n"), isNote: true, text: n.text || "", order: target.predefinedActivities.length });
    }
    target.notes = [];
  }

  const acts = target.predefinedActivities;

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

    <div class="admin-section-title">Activities & Notes</div>
    <div class="admin-list" id="mn-act-list">`;

  acts.forEach((a, idx) => {
    if (a.isHeading) {
      html += `<div class="admin-list-item mn-heading-item" data-idx="${idx}">
        <span class="drag-handle">⠿</span>
        <textarea class="admin-input mn-heading-input" id="mn-act-name-${idx}" data-idx="${idx}"
          rows="1" placeholder="Section heading name (Enter = new line · Ctrl+Enter = save)" style="flex:1">${escHtml(a.name || "")}</textarea>
        <button class="btn-adm-del mn-del-act" data-idx="${idx}">🗑</button>
      </div>`;
    } else if (a.isNote) {
      html += `<div class="admin-list-item admin-note-item" data-idx="${idx}">
        <span class="drag-handle">⠿</span>
        <textarea class="admin-input" id="mn-act-name-${idx}" data-idx="${idx}"
          rows="1" placeholder="Type note… (Enter = new line · Ctrl+Enter = save)" style="flex:1">${escHtml(a.text || "")}</textarea>
        <button class="btn-adm-del mn-del-act" data-idx="${idx}">🗑</button>
      </div>`;
    } else {
      const isStarter = !!a.sentenceStarter;
      const remarkTypeSelect = `<select class="act-preset-select mn-act-preset" data-idx="${idx}">
          <option value="">Free text</option>
          <option value="__starter__"${isStarter ? " selected" : ""}>Sentence starter</option>
          ${state.remarkPresets.length > 0 ? `<option disabled>─ Fixed options ─</option>` : ""}
          ${state.remarkPresets.map(p =>
            `<option value="${escHtml(p.id)}"${a.remarkPresetId === p.id ? " selected" : ""}>${escHtml(p.name)}</option>`
          ).join("")}
        </select>
        <input class="admin-input mn-act-starter-text" data-idx="${idx}"
          placeholder="Starter phrase…"
          value="${escHtml(a.sentenceStarter || "")}"
          style="${isStarter ? "" : "display:none"}">`;
      html += `<div class="admin-list-item" data-idx="${idx}">
        <span class="drag-handle">⠿</span>
        <div style="flex:1;display:flex;flex-direction:column;gap:.3rem">
          <textarea class="admin-input" id="mn-act-name-${idx}" data-idx="${idx}"
            rows="1" placeholder="Activity name (Enter = new line · Ctrl+Enter = save)">${escHtml(a.name || "")}</textarea>
          ${remarkTypeSelect}
        </div>
        <button class="btn-adm-del mn-del-act" data-idx="${idx}">🗑</button>
      </div>`;
    }
  });

  html += `</div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.25rem">
      <button class="btn-admin-add" id="btn-mn-add-act" style="flex:1">+ Add Activity</button>
      <button class="btn-admin-add" id="btn-mn-add-heading" style="flex:1">+ Add Section Heading</button>
      <button class="btn-admin-add" id="btn-mn-add-note" style="flex:1">+ Add Note</button>
    </div>
    <div style="margin-top:2rem;padding-bottom:1.5rem">
      <button class="btn-primary-sm" id="btn-mn-done-target"
        style="width:100%;padding:.75rem;margin-bottom:.75rem">Done</button>
      <button class="btn-adm-danger" id="btn-mn-del-target">Delete This Target</button>
    </div>`;

  $("manage-modal-body").innerHTML = html;
  $("manage-modal-body").querySelectorAll(".admin-list-item textarea").forEach(autoResizeTextarea);

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
    if (state.selectedTargetName === target.name) state.selectedTargetName = v;
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
      if (a.isNote) {
        if (input.value === (a.text || "")) return;
        a.text = input.value;
      } else {
        const v = input.value.trim();
        if (!v || v === a.name) return;
        a.name = v;
      }
      await saveTarget();
      flashSaved(input);
    });
    input?.addEventListener("input", () => autoResizeTextarea(input));
  });

  $("manage-modal-body").querySelectorAll(".mn-del-act").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.idx);
      const item = acts[idx];
      const label = item?.isHeading ? "section heading" : item?.isNote ? "reference note" : "activity";
      if (!confirm(`Delete this ${label}?`)) return;
      acts.splice(idx, 1);
      acts.forEach((a, i) => a.order = i);
      target.predefinedActivities = acts;
      await saveTarget();
      const sp = $("manage-modal-body")?.scrollTop ?? 0;
      renderTargetManageContent(student, target);
      requestAnimationFrame(() => { const b = $("manage-modal-body"); if (b) b.scrollTop = sp; });
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

  $("btn-mn-add-note").addEventListener("click", async () => {
    acts.push({ id: cfgId("n"), isNote: true, text: "", order: acts.length });
    target.predefinedActivities = acts;
    await saveTarget();
    renderTargetManageContent(student, target);
  });

  $("manage-modal-body").querySelectorAll(".mn-act-preset").forEach(sel => {
    sel.addEventListener("change", async () => {
      const idx = Number(sel.dataset.idx);
      const starterInput = $("manage-modal-body").querySelector(`.mn-act-starter-text[data-idx="${idx}"]`);
      if (sel.value === "__starter__") {
        acts[idx].remarkPresetId = null;
        starterInput.style.display = "";
        starterInput.focus();
      } else {
        acts[idx].remarkPresetId = sel.value || null;
        acts[idx].sentenceStarter = null;
        starterInput.style.display = "none";
        target.predefinedActivities = acts;
        await saveTarget();
      }
    });
  });

  $("manage-modal-body").querySelectorAll(".mn-act-starter-text").forEach(input => {
    input.addEventListener("blur", async () => {
      const idx = Number(input.dataset.idx);
      const v = input.value.trim();
      acts[idx].sentenceStarter = v || null;
      if (!v) {
        const sel = $("manage-modal-body").querySelector(`.mn-act-preset[data-idx="${idx}"]`);
        if (sel) sel.value = "";
        input.style.display = "none";
      }
      target.predefinedActivities = acts;
      await saveTarget();
    });
  });

  $("btn-mn-done-target").addEventListener("click", closeManageModal);

  $("btn-mn-del-target").addEventListener("click", async () => {
    if (!confirm(`Delete target "${target.name}"? All session data for this target will also be permanently deleted.`)) return;
    student.targets = student.targets.filter(t => t.id !== target.id);
    student.targets.forEach((t, i) => t.order = i);
    await saveStudent(student);
    await deleteTargetDataFromSessions(student.id, target.name);
    const si = state.students.findIndex(s => s.id === student.id);
    if (si >= 0) state.students[si] = student;
    if (state.selectedTargetName === target.name) {
      state.selectedTargetName = student.targets[0]?.name || null;
    }
    closeManageModal();
  });
}

// ── Template management content ───────────────────────────────

function renderTemplateManageContent(template) {
  $("manage-modal-title").textContent = template.name;
  template.predefinedActivities = normalizeActivitiesFormat(template.predefinedActivities || []);

  // Migrate legacy notes array into the unified predefinedActivities list
  if (template.notes?.length > 0) {
    for (const n of template.notes) {
      template.predefinedActivities.push({ id: n.id || cfgId("n"), isNote: true, text: n.text || "", order: template.predefinedActivities.length });
    }
    template.notes = [];
  }

  const acts = template.predefinedActivities;

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

    <div class="admin-section-title">Activities & Notes</div>
    <div class="admin-list" id="mn-act-list">`;

  acts.forEach((a, idx) => {
    if (a.isHeading) {
      html += `<div class="admin-list-item mn-heading-item" data-idx="${idx}">
        <span class="drag-handle">⠿</span>
        <textarea class="admin-input mn-heading-input" id="mn-act-name-${idx}" data-idx="${idx}"
          rows="1" placeholder="Section heading name (Enter = new line · Ctrl+Enter = save)" style="flex:1">${escHtml(a.name || "")}</textarea>
        <button class="btn-adm-del mn-del-act" data-idx="${idx}">🗑</button>
      </div>`;
    } else if (a.isNote) {
      html += `<div class="admin-list-item admin-note-item" data-idx="${idx}">
        <span class="drag-handle">⠿</span>
        <textarea class="admin-input" id="mn-act-name-${idx}" data-idx="${idx}"
          rows="1" placeholder="Type note… (Enter = new line · Ctrl+Enter = save)" style="flex:1">${escHtml(a.text || "")}</textarea>
        <button class="btn-adm-del mn-del-act" data-idx="${idx}">🗑</button>
      </div>`;
    } else {
      const isStarter = !!a.sentenceStarter;
      const remarkTypeSelect = `<select class="act-preset-select mn-act-preset" data-idx="${idx}">
          <option value="">Free text</option>
          <option value="__starter__"${isStarter ? " selected" : ""}>Sentence starter</option>
          ${state.remarkPresets.length > 0 ? `<option disabled>─ Fixed options ─</option>` : ""}
          ${state.remarkPresets.map(p =>
            `<option value="${escHtml(p.id)}"${a.remarkPresetId === p.id ? " selected" : ""}>${escHtml(p.name)}</option>`
          ).join("")}
        </select>
        <input class="admin-input mn-act-starter-text" data-idx="${idx}"
          placeholder="Starter phrase…"
          value="${escHtml(a.sentenceStarter || "")}"
          style="${isStarter ? "" : "display:none"}">`;
      html += `<div class="admin-list-item" data-idx="${idx}">
        <span class="drag-handle">⠿</span>
        <div style="flex:1;display:flex;flex-direction:column;gap:.3rem">
          <textarea class="admin-input" id="mn-act-name-${idx}" data-idx="${idx}"
            rows="1" placeholder="Activity name (Enter = new line · Ctrl+Enter = save)">${escHtml(a.name || "")}</textarea>
          ${remarkTypeSelect}
        </div>
        <button class="btn-adm-del mn-del-act" data-idx="${idx}">🗑</button>
      </div>`;
    }
  });

  html += `</div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.25rem">
      <button class="btn-admin-add" id="btn-mn-add-act" style="flex:1">+ Add Activity</button>
      <button class="btn-admin-add" id="btn-mn-add-heading" style="flex:1">+ Add Section Heading</button>
      <button class="btn-admin-add" id="btn-mn-add-note" style="flex:1">+ Add Note</button>
    </div>
    <div style="margin-top:2rem;padding-bottom:1.5rem">
      <button class="btn-adm-danger" id="btn-mn-del-template">Delete Template</button>
    </div>`;

  $("manage-modal-body").innerHTML = html;
  $("manage-modal-body").querySelectorAll(".admin-list-item textarea").forEach(autoResizeTextarea);

  const saveTemplateFn = async () => {
    const idx = state.templates.findIndex(t => t.id === template.id);
    if (idx >= 0) state.templates[idx] = template;
    await saveTemplate(template);
    await syncTemplateToStudents(template);
    showAutosaved();
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
      if (a.isNote) {
        if (input.value === (a.text || "")) return;
        a.text = input.value;
      } else {
        const v = input.value.trim();
        if (!v || v === a.name) return;
        a.name = v;
      }
      await saveTemplateFn();
      flashSaved(input);
    });
    input?.addEventListener("input", () => autoResizeTextarea(input));
  });

  $("manage-modal-body").querySelectorAll(".mn-del-act").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.idx);
      const item = acts[idx];
      const label = item?.isHeading ? "section heading" : item?.isNote ? "reference note" : "activity";
      if (!confirm(`Delete this ${label}?`)) return;
      acts.splice(idx, 1);
      acts.forEach((a, i) => a.order = i);
      template.predefinedActivities = acts;
      await saveTemplateFn();
      const sp = $("manage-modal-body")?.scrollTop ?? 0;
      renderTemplateManageContent(template);
      requestAnimationFrame(() => { const b = $("manage-modal-body"); if (b) b.scrollTop = sp; });
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

  $("btn-mn-add-note").addEventListener("click", async () => {
    acts.push({ id: cfgId("n"), isNote: true, text: "", order: acts.length });
    template.predefinedActivities = acts;
    await saveTemplateFn();
    renderTemplateManageContent(template);
  });

  $("manage-modal-body").querySelectorAll(".mn-act-preset").forEach(sel => {
    sel.addEventListener("change", async () => {
      const idx = Number(sel.dataset.idx);
      const starterInput = $("manage-modal-body").querySelector(`.mn-act-starter-text[data-idx="${idx}"]`);
      if (sel.value === "__starter__") {
        acts[idx].remarkPresetId = null;
        starterInput.style.display = "";
        starterInput.focus();
      } else {
        acts[idx].remarkPresetId = sel.value || null;
        acts[idx].sentenceStarter = null;
        starterInput.style.display = "none";
        template.predefinedActivities = acts;
        await saveTemplateFn();
      }
    });
  });

  $("manage-modal-body").querySelectorAll(".mn-act-starter-text").forEach(input => {
    input.addEventListener("blur", async () => {
      const idx = Number(input.dataset.idx);
      const v = input.value.trim();
      acts[idx].sentenceStarter = v || null;
      if (!v) {
        const sel = $("manage-modal-body").querySelector(`.mn-act-preset[data-idx="${idx}"]`);
        if (sel) sel.value = "";
        input.style.display = "none";
      }
      template.predefinedActivities = acts;
      await saveTemplateFn();
    });
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
      target.name                 = template.name;
      target.predefinedActivities = JSON.parse(JSON.stringify(template.predefinedActivities || []));
      target.notes                = JSON.parse(JSON.stringify(template.notes || []));
      target.maxPoints            = template.maxPoints || 3;
      changed = true;
    }
    if (changed) toSave.push(student);
  }
  for (const student of toSave) await saveStudent(student);
}

// ─── AUTOSAVED INDICATOR (template modal header) ─────────────

function showAutosaved() {
  const el = $("manage-autosave-indicator");
  if (!el) return;
  el.textContent = "Autosaved";
  el.classList.add("visible");
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.remove("visible"), 2000);
}

// ─── SAVED FLASH ─────────────────────────────────────────────

function flashSaved() {}

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
