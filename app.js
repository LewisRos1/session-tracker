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
  updateRemarkNote,
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
  loadGroups,
  saveGroup,
  deleteGroup,
  getOrCreateGroupSessionForDate,
  getRecentGroupSessions,
  deleteGroupTargetDataFromSessions,
  addGroupRemark,
  setTrials,
  sanitizeKey,
  getTodayString,
  getOrCreateSessionForDate,
  deleteSession,
  updateSessionDate,
  deleteTargetDataFromSessions
} from "./firebase-service.js";
import { exportStudentData, exportAllStudents } from "./export.js";

// ── SW update detection — must run at parse time, before DOMContentLoaded,
//   so the listener is in place before the new SW can fire controllerchange.
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // Only reload for updates, not for the very first SW install.
    if (hadController) window.location.reload();
  });
}

const APP_VERSION = "266";

// ─── STATE ───────────────────────────────────────────────────
const state = {
  authenticated:      false,
  students:           [],
  templates:          [],
  remarkPresets:      [],
  searchExisting:     "",
  searchAssessment:   "",
  searchTemplate:     "",
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
  viewPickerTargetName: null,
  // Group sessions
  groups:                  [],
  searchGroup:             "",
  currentGroup:            null,
  groupSessionId:          null,
  groupSessionData:        null,
  groupAttendees:          [],
  fbGroupUnsubscribe:      null,
  groupRenderPending:      false,
  selectedGroupTargetName: null,
};

const $ = id => document.getElementById(id);

// ─── BOTTOM-SHEET TEXT EDITOR ────────────────────────────────
let _sheetOriginEl = null;

// ─── GROUP TARGET EDIT OVERRIDE ──────────────────────────────
// When editing a target belonging to a group, this is set so that
// renderTargetManageContent saves to the group instead of the student.
let _groupForTargetEdit = null;
// Tracks a newly-created group ID so it can be auto-deleted if closed with no students.
let _newGroupId = null;

function openTextEditorSheet(originEl) {
  _sheetOriginEl = originEl;
  $("text-editor-content").innerHTML = originEl.innerHTML;
  $("text-editor-sheet").classList.remove("hidden");
  requestAnimationFrame(() => $("text-editor-content").focus());
}

function commitTextEditorSheet() {
  if (!_sheetOriginEl) return;
  _sheetOriginEl.innerHTML = $("text-editor-content").innerHTML;
  _sheetOriginEl.dispatchEvent(new Event("blur"));
  _sheetOriginEl = null;
}

function closeTextEditorSheet() {
  $("text-editor-sheet").classList.add("hidden");
  _sheetOriginEl = null;
  // Process any render that was deferred while the sheet was open
  if (state.renderPending) { state.renderPending = false; renderTargetContent(); }
  if (state.viewRenderPending) { state.viewRenderPending = false; renderSessionView(); }
}

// ─── INIT ────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  // Register SW immediately — don't wait for Firebase so updates are never blocked.
  registerServiceWorker();

  // On iOS, relatedTarget is always null and pointerdown may not fire for <select>.
  // Use both pointerdown and touchstart (touchstart fires reliably before focusout on iOS).
  ["pointerdown", "touchstart"].forEach(evtName => {
    $("target-select").addEventListener(evtName, () => {
      state._targetSelDown = true;
      clearTimeout(state._targetSelTimer);
      state._targetSelTimer = setTimeout(() => { state._targetSelDown = false; }, 800);
    }, { passive: true });
  });

  document.addEventListener("focusout", (e) => {
    if (e.relatedTarget === $("target-select") || state._targetSelDown) return;
    // Don't trigger re-renders while the bottom-sheet editor is open
    if (!$("text-editor-sheet").classList.contains("hidden")) return;
    // Defer one tick so activeElement updates before we check
    setTimeout(() => {
      if (document.activeElement === $("target-select")) return;
      if (state.renderPending) {
        state.renderPending = false;
        renderTargetContent();
      }
      if (state.viewRenderPending) {
        state.viewRenderPending = false;
        renderSessionView();
      }
    }, 0);
  });

  // Ctrl+B / Cmd+B: visual bold in contenteditable remark fields
  document.addEventListener("keydown", e => {
    if (!(e.key === "b" && (e.ctrlKey || e.metaKey))) return;
    const el = document.activeElement;
    if (!el) return;
    if (el.isContentEditable) {
      e.preventDefault();
      document.execCommand("bold");
      return;
    }
  });

  $("text-editor-done").addEventListener("click", () => {
    commitTextEditorSheet();
    closeTextEditorSheet();
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

  // Load groups
  try {
    state.groups = await loadGroups();
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
  state.searchExport = ""; state.searchGroup = "";
  [$("search-existing"), $("search-assessment"), $("search-template"), $("search-export"), $("search-group")]
    .forEach(el => { if (el) el.value = ""; });
  renderExistingStudentButtons();
  renderGroupButtons();
  renderAssessmentStudentButtons();
  renderTemplateButtons();
  renderExportButtons();
}

// ── Add student / template from home screen ───────────────────

$("btn-add-existing-student").addEventListener("click", () => addNewStudent("existing"));
$("btn-add-assessment-student").addEventListener("click", () => addNewStudent("assessment"));
$("btn-add-template").addEventListener("click", addNewTemplate);
$("btn-add-group").addEventListener("click", addNewGroup);
$("search-existing").addEventListener("input", e => {
  state.searchExisting = e.target.value;
  renderExistingStudentButtons();
});
$("search-group").addEventListener("input", e => {
  state.searchGroup = e.target.value;
  renderGroupButtons();
});
$("search-assessment").addEventListener("input", e => {
  state.searchAssessment = e.target.value;
  renderAssessmentStudentButtons();
});
$("search-template").addEventListener("input", e => {
  state.searchTemplate = e.target.value;
  renderTemplateButtons();
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

async function addNewGroup() {
  const g = { id: cfgId("g"), name: "", order: state.groups.length, students: [], targets: [] };
  state.groups.push(g);
  await saveGroup(g);
  renderGroupButtons();
  _newGroupId = g.id;
  openGroupManageModal(g);
}

function groupAutoName(students) {
  return (students || []).join(" & ");
}
// Returns true if the group's name still matches the auto-generated pattern
// (meaning it's safe to update it automatically when students change).
function groupNameIsAuto(group) {
  const s = group.students || [];
  return !group.name || group.name === groupAutoName(s);
}

function renderGroupButtons() {
  const container = $("group-buttons");
  if (!container) return;
  const q = state.searchGroup.toLowerCase();
  const filtered = state.groups
    .filter(g => !q || g.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (filtered.length === 0) {
    container.innerHTML = `<div class="roster-list"><p class="empty-hint">${q ? "No matches." : "No groups yet."}</p></div>`;
    return;
  }
  container.innerHTML = `<div class="roster-list">` +
    filtered.map(g => `<button class="roster-item" data-id="${g.id}"><span class="roster-item-name">${escHtml(g.name)}</span></button>`).join("") +
    `</div>`;
  container.querySelectorAll(".roster-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const group = state.groups.find(g => g.id === btn.dataset.id);
      if (group) showGroupChoice(group);
    });
  });
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

  container.innerHTML =
    `<button class="export-btn export-btn-all" id="btn-export-all">Export All (ZIP)</button>` +
    filtered.map(s => `<button class="export-btn" data-id="${s.id}">Export ${escHtml(s.name)}</button>`).join("");

  $("btn-export-all").addEventListener("click", async () => {
    const btn = $("btn-export-all");
    btn.disabled = true;
    btn.textContent = "Generating…";
    try {
      await exportAllStudents(state.students);
    } catch (err) {
      alert("Export failed: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Export All (ZIP)";
    }
  });

  container.querySelectorAll(".export-btn[data-id]").forEach(btn => {
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

  const sorted  = [...monthSessions].sort((a, b) => a.date.localeCompare(b.date));
  const display = [...sorted].reverse();
  for (const s of display) {
    const num      = sorted.findIndex(x => x.id === s.id) + 1;
    const isToday  = s.date === today;
    html += `<div class="session-list-item${isToday ? " session-list-today" : ""}" data-session-id="${s.id}">
      <div class="session-list-meta">
        <div class="session-list-label"><strong>Session ${num}</strong>: ${formatDate(s.date)}</div>
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

// ─── GO TO ANOTHER SESSION ───────────────────────────────────
// Opens session-picker starting at the current session's month.
async function showGoToAnotherSession(student) {
  $("session-picker-title").textContent = student.name;
  $("session-picker-list").innerHTML = `<div class="session-picker-loading">Loading sessions…</div>`;
  $("session-picker-modal").classList.remove("hidden");

  let sessions = [];
  try { sessions = await getRecentSessionsForStudent(student.id); } catch (_) {}

  const currentTargetNames = new Set((student.targets || []).map(t => t.name));
  const hasUsefulData = s => {
    const remarks = Object.values(s.remarks || {});
    if (!remarks.length) return false;
    return remarks.some(r => {
      const act = (s.activities || {})[r.activityId];
      return act && currentTargetNames.has(act.targetName);
    });
  };
  // Don't auto-delete the session currently being viewed
  const empties = sessions.filter(s => s.id !== state.viewSessionId && !hasUsefulData(s));
  empties.forEach(s => deleteSession(s.id).catch(() => {}));
  sessions = sessions.filter(s => !empties.some(e => e.id === s.id));

  const today = getTodayString();
  const byMonth = new Map();
  for (const s of sessions) {
    if (!byMonth.has(s.month)) byMonth.set(s.month, []);
    byMonth.get(s.month).push(s);
  }

  if (byMonth.size === 0) {
    $("session-picker-list").innerHTML = `<div class="session-picker-loading">No sessions found.</div>`;
    return;
  }

  // Start on the current session's month; fall back to month grid
  const currentMonth = state.viewSessionData?.month;
  if (currentMonth && byMonth.has(currentMonth)) {
    renderGoToSessionsForMonth(student, currentMonth, byMonth.get(currentMonth), byMonth, today);
  } else {
    renderGoToMonthGrid(student, byMonth, today);
  }
}

function renderGoToMonthGrid(student, byMonth, today) {
  $("session-picker-title").textContent = student.name;
  let html = `<div class="month-grid">`;
  for (const month of byMonth.keys()) {
    const [name, year] = month.split(" ");
    html += `<button class="month-grid-btn" data-month="${escHtml(month)}">
      <span class="mgb-month">${escHtml(name.slice(0, 3))}</span>
      <span class="mgb-year">${escHtml(year)}</span>
    </button>`;
  }
  html += `</div>`;
  $("session-picker-list").innerHTML = html;
  $("session-picker-list").querySelectorAll(".month-grid-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const month = btn.dataset.month;
      renderGoToSessionsForMonth(student, month, byMonth.get(month), byMonth, today);
    });
  });
}

function renderGoToSessionsForMonth(student, month, monthSessions, byMonth, today) {
  $("session-picker-title").textContent = month;
  const sorted  = [...monthSessions].sort((a, b) => a.date.localeCompare(b.date));
  const display = [...sorted].reverse();
  let html = `<button class="btn-picker-back">← Back</button>`;
  for (const s of display) {
    const num       = sorted.findIndex(x => x.id === s.id) + 1;
    const isCurrent = s.id === state.viewSessionId;
    const isToday   = s.date === today;
    let cls = "session-list-item";
    if (isCurrent) cls += " session-list-current";
    if (isToday)   cls += " session-list-today";
    html += `<div class="${cls}" data-session-id="${s.id}">
      <div class="session-list-meta">
        <div class="session-list-label"><strong>Session ${num}</strong>: ${formatDate(s.date)}${isCurrent ? " (current)" : ""}</div>
      </div>
    </div>`;
  }
  const list = $("session-picker-list");
  list.innerHTML = html;
  list.querySelector(".btn-picker-back").addEventListener("click", () => {
    renderGoToMonthGrid(student, byMonth, today);
  });
  list.querySelectorAll(".session-list-item").forEach(item => {
    item.addEventListener("click", () => {
      const sid = item.dataset.sessionId;
      closeSessionPicker();
      if (sid !== state.viewSessionId) openSessionView(student, sid);
    });
  });
}

// ─── CUSTOM DATE PICKER ───────────────────────────────────────
async function showEditDatePicker() {
  const student     = state.viewStudent;
  const currentDate = state.viewSessionData.date;

  $("session-picker-title").textContent = "Edit Date";
  $("session-picker-list").innerHTML = `<div class="session-picker-loading">Loading…</div>`;
  $("session-picker-modal").classList.remove("hidden");

  let sessions = [];
  try { sessions = await getRecentSessionsForStudent(student.id); } catch (_) {}
  // Dates already occupied by another session
  const takenDates = new Set(
    sessions.filter(s => s.id !== state.viewSessionId).map(s => s.date)
  );
  renderDatePickerCalendar(currentDate, takenDates, getTodayString(), currentDate);
}

function renderDatePickerCalendar(displayDate, takenDates, today, currentDate) {
  const [y, m] = displayDate.split("-").map(Number);
  const monthLabel = new Date(y, m - 1, 1)
    .toLocaleString("default", { month: "long", year: "numeric" });
  const [ty, tm] = today.split("-").map(Number);
  const canNext = y < ty || (y === ty && m < tm);

  const pad = n => String(n).padStart(2, "0");
  const prevM = m === 1  ? `${y - 1}-12-01` : `${y}-${pad(m - 1)}-01`;
  const nextM = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;

  const firstDow  = new Date(y, m - 1, 1).getDay();
  const daysInMon = new Date(y, m, 0).getDate();

  let html = `<div class="date-picker-wrap">
    <p class="date-picker-subtitle">Select a new date</p>
    <div class="date-picker-row">
      <div class="date-picker-cal">
        <div class="date-picker-nav">
          <button class="btn-date-prev">‹</button>
          <span class="date-picker-month-label">${escHtml(monthLabel)}</span>
          <button class="btn-date-next"${canNext ? "" : " disabled"}>›</button>
        </div>
        <div class="date-picker-day-headers">
          <span>Su</span><span>Mo</span><span>Tu</span><span>We</span>
          <span>Th</span><span>Fr</span><span>Sa</span>
        </div>
        <div class="date-picker-grid">`;

  // Always render 42 cells (6 rows) so height never changes between months
  for (let cell = 0; cell < 42; cell++) {
    const d = cell - firstDow + 1;
    if (d < 1 || d > daysInMon) { html += `<span></span>`; continue; }
    const ds     = `${y}-${pad(m)}-${pad(d)}`;
    const isCur  = ds === currentDate;
    const isFut  = ds > today;
    const isTaken = takenDates.has(ds);
    const dis    = isFut || isTaken;
    let cls = "date-picker-day";
    if (isCur)   cls += " date-picker-day-current";
    if (isFut)   cls += " date-picker-day-future";
    if (isTaken) cls += " date-picker-day-taken";
    const dotCls = (isTaken || isCur) ? "date-taken-dot" : "day-dot-spacer";
    html += `<button class="${cls}" data-date="${ds}"${dis ? " disabled" : ""}><span class="day-num">${d}</span><span class="${dotCls}"></span></button>`;
  }
  html += `</div><!-- grid -->
      </div><!-- cal -->
      <div class="date-picker-aside">
        <span class="date-taken-dot"></span> Session exists on this day
      </div>
    </div><!-- row -->
  </div><!-- wrap -->`;

  $("session-picker-title").textContent = "Edit Date";
  $("session-picker-list").innerHTML = html;

  $("session-picker-list").querySelector(".btn-date-prev").addEventListener("click", () => {
    renderDatePickerCalendar(prevM, takenDates, today, currentDate);
  });
  if (canNext) {
    $("session-picker-list").querySelector(".btn-date-next").addEventListener("click", () => {
      renderDatePickerCalendar(nextM, takenDates, today, currentDate);
    });
  }
  $("session-picker-list").querySelectorAll(".date-picker-day:not([disabled])").forEach(btn => {
    btn.addEventListener("click", async () => {
      const newDate = btn.dataset.date;
      closeSessionPicker();
      if (newDate === currentDate) return;
      try {
        await updateSessionDate(state.viewSessionId, newDate, state.viewStudent.id);
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

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
  $("target-select").innerHTML  = `<option value="">— loading —</option>`;
  $("btn-manage-targets")?.classList.add("hidden");
  $("target-type-chip")?.classList.add("hidden");

  if (state.fbUnsubscribe) { state.fbUnsubscribe(); state.fbUnsubscribe = null; }

  try {
    const sessionId = existingSessionId
      ? existingSessionId
      : await getOrCreateSessionForDate(student.id, dateStr || getTodayString(), student.targets);
    state.currentSessionId = sessionId;

    state.fbUnsubscribe = listenToSession(sessionId, async data => {
      const firstLoad = state.sessionData === null;
      state.sessionData = data;
      if (firstLoad) {
        const eff = getEffectiveTargets();
        state.selectedTargetName = eff[0]?.name || null;
        populateTargetDropdown(eff);
        // Auto-create mastery remarks if previous session had values.
        // If any are created the Firestore write triggers another snapshot
        // which will render — so we return early here to avoid a stale render.
        const filled = await autoFillMasteryRemarks(student, sessionId);
        if (filled > 0) return;
      }
      // Keep score modal trial badges in sync with Firestore
      if (state.scorePicker?.open && state.scorePicker?.remId) {
        renderScoreModalTrials(state.scorePicker.remId);
      }
      const active = document.activeElement;
      const busy   = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT");
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
  commitTextEditorSheet();
  $("text-editor-sheet").classList.add("hidden");
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
    // Clean up empty remarks/activities across all targets (fire-and-forget)
    const allTargetNames = new Set(Object.values(data.activities || {}).map(a => a.targetName));
    allTargetNames.forEach(name => cleanupEmptyEntries(sessionId, data, name).catch(() => {}));

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
    const prevTarget = state.selectedTargetName;
    state.selectedTargetName = sel.value;
    state.pendingNewActivity = null;
    state.pendingNewRemark   = null;
    // Clean up empty entries from the previous target (fire-and-forget)
    if (prevTarget && prevTarget !== sel.value) {
      cleanupEmptyEntries(state.currentSessionId, state.sessionData, prevTarget).catch(() => {});
    }
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

  $("target-type-chip")?.classList.add("hidden");

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
      if (pa.text) html += `<div class="activity-note-heading">${noteToHtml(pa.text)}</div>`;
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
        html += renderRemarkFields(rem, target, getActivityInlineOptions(pa), pa.sentenceStarter || null, pa.optionsMulti || false, pa.isMastery || false);
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

  html += `<button class="btn-add-activity" data-target="${escHtml(target.name)}">+ Add Activity (This activity only appears in this session)</button>`;

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

  html += `<button class="btn-add-activity" data-target="${escHtml(target.name)}">+ Add Activity (This activity only appears in this session)</button>`;

  return html;
}

// Returns the inline options string for an activity (new inlineOptions field,
// falling back to old remarkPresetId preset for backward compat).
function getActivityInlineOptions(a) {
  if (a.inlineOptions) return a.inlineOptions;
  if (a.remarkPresetId) {
    const preset = state.remarkPresets.find(p => p.id === a.remarkPresetId);
    if (preset?.options?.length) return preset.options.join("/");
  }
  return null;
}

function parseOpts(str) {
  return (str || "").split("/").map(s => s.trim()).filter(Boolean);
}

// Converts stored remark text (plain or legacy **bold**) to HTML for contenteditable display
function remarkToHtml(text) {
  if (!text) return "";
  return text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

// ─── REMARK FIELDS ───────────────────────────────────────────

function renderRemarkFields(rem, target, inlineOptions = null, sentenceStarter = null, multiSelect = false, isMastery = false) {
  const opts = parseOpts(inlineOptions);

  const trials = rem.trials || [];
  const badgesHtml = trials.map((score, idx) =>
    `<span class="trial-badge">${score}<button class="btn-trial-delete"
      data-rem-id="${rem.id}" data-idx="${idx}">×</button></span>`
  ).join("");

  if (isMastery) {
    const cur = rem.text || "";
    return `
    <div class="entry-divider"></div>
    <div class="entry-field">
      <span class="field-label">Remark</span>
      <div class="mastery-remark-wrap">
        <div class="remark-mastery-opts" data-rem-id="${rem.id}">
          ${["In Progress", "Mastered", "Maintain"].map(v =>
            `<button class="btn-mastery${cur === v ? " active" : ""}" data-rem-id="${rem.id}" data-val="${v}">${v}</button>`
          ).join("")}
        </div>
        <div class="mastery-note-row">
          <button class="btn-sketch" data-rem-id="${rem.id}" aria-label="Open sketch board">✏</button>
          <div class="field-input mastery-note-input" contenteditable="true"
            data-rem-id="${rem.id}" data-placeholder="Notes…">${rem.masteryNote || ""}</div>
        </div>
      </div>
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

  function makeOptPills(remId, remText) {
    if (opts.length === 0) return null;
    if (multiSelect) {
      const sel = (remText || "").split(", ").map(s => s.trim()).filter(Boolean);
      return `<div class="remark-preset-opts remark-preset-opts-multi">${opts.map(opt =>
        `<button class="btn-remark-opt${sel.includes(opt) ? " active" : ""}"
          data-rem-id="${remId}" data-opt="${escHtml(opt)}">${escHtml(opt)}</button>`
      ).join("")}</div>`;
    }
    return `<div class="remark-preset-opts">${opts.map(opt =>
      `<button class="btn-remark-opt${remText === opt ? " active" : ""}"
        data-rem-id="${remId}" data-opt="${escHtml(opt)}">${escHtml(opt)}</button>`
    ).join("")}</div>`;
  }

  const optBtns = makeOptPills(rem.id, rem.text)
    || `<div class="field-input remark-text-input" contenteditable="true"
        data-rem-id="${rem.id}">${remarkToHtml(rem.text)}</div>`;

  // Sketch board button only shown when there's a free-text input (no preset opt pills)
  const sketchBtn = opts.length === 0
    ? `<button class="btn-sketch" data-rem-id="${rem.id}" aria-label="Open sketch board">✏</button>`
    : "";

  let remarkContent;
  if (sentenceStarter) {
    remarkContent = `<div class="remark-starter-wrap">
      <span class="remark-starter-prefix">${escHtml(sentenceStarter)}</span>
      ${makeOptPills(rem.id, rem.text)
        || `<div class="field-input remark-text-input" contenteditable="true"
            data-rem-id="${rem.id}">${remarkToHtml(rem.text)}</div>`
      }
    </div>`;
  } else {
    remarkContent = optBtns;
  }

  return `
    <div class="entry-divider"></div>
    <div class="entry-field">
      <span class="field-label">Remark</span>
      ${sketchBtn}
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
      <button class="btn-sketch btn-sketch-pending" aria-label="Open sketch board">✏</button>
      <div id="new-remark-textarea" class="field-input" contenteditable="true"
        data-placeholder="Type remark…"></div>
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

  // ── Remark text: blur auto-saves (contenteditable, stores HTML) ──
  c.querySelectorAll(".remark-text-input").forEach(ta => {
    let orig = ta.innerHTML;
    ta.addEventListener("blur", async () => {
      const newText = ta.innerHTML;
      if (newText !== orig) {
        orig = newText;
        flashSaved(ta);
        await updateRemarkText(state.currentSessionId, ta.dataset.remId, newText);
      }
    });
  });

  // ── Mastery note text (contenteditable below buttons) ────
  c.querySelectorAll(".mastery-note-input").forEach(div => {
    let orig = div.innerHTML;
    div.addEventListener("blur", async () => {
      const newNote = div.innerHTML;
      if (newNote === orig) return;
      orig = newNote;
      await updateRemarkNote(state.currentSessionId, div.dataset.remId, newNote);
    });
  });

  // ── Mastery level buttons ─────────────────────────────────
  c.querySelectorAll(".btn-mastery").forEach(btn => {
    btn.addEventListener("click", async () => {
      const container  = btn.closest(".remark-mastery-opts");
      const currentVal = container?.querySelector(".btn-mastery.active")?.dataset.val || "";
      const isActive   = btn.classList.contains("active");
      const newVal     = isActive ? "" : btn.dataset.val;
      if (currentVal === newVal) return;
      const fromLabel = currentVal || "none";
      const toLabel   = newVal     || "none";
      if (!confirm(`Change mastery level from "${fromLabel}" to "${toLabel}"?`)) return;
      container?.querySelectorAll(".btn-mastery").forEach(b => b.classList.remove("active"));
      if (!isActive) btn.classList.add("active");
      await updateRemarkText(state.currentSessionId, btn.dataset.remId, newVal);
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
      let initialText = "";
      if (paName) {
        const pa = target.predefinedActivities?.find(a => a.name === paName);
        if (pa?.isMastery) {
          initialText = await getLastMasteryValue(state.currentStudent, target.name, paName, state.currentSessionId);
        }
      }
      await addRemark(state.currentSessionId, actId, initialText);
    });
  });

  // ── Remark option buttons (single-select) ─────────────────
  c.querySelectorAll(".remark-preset-opts:not(.remark-preset-opts-multi) .btn-remark-opt").forEach(btn => {
    btn.addEventListener("click", async () => {
      const isActive = btn.classList.contains("active");
      btn.closest(".remark-preset-opts")?.querySelectorAll(".btn-remark-opt").forEach(b => b.classList.remove("active"));
      const newText = isActive ? "" : btn.dataset.opt;
      if (!isActive) btn.classList.add("active");
      await updateRemarkText(state.currentSessionId, btn.dataset.remId, newText);
    });
  });

  // ── Remark option buttons (multi-select) ──────────────────
  c.querySelectorAll(".remark-preset-opts-multi .btn-remark-opt").forEach(btn => {
    btn.addEventListener("click", async () => {
      btn.classList.toggle("active");
      const container = btn.closest(".remark-preset-opts-multi");
      const selected = [...container.querySelectorAll(".btn-remark-opt.active")].map(b => b.dataset.opt);
      await updateRemarkText(state.currentSessionId, btn.dataset.remId, selected.join(", "));
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

  // ── Sketch board buttons (session screen) ─────────────────
  c.querySelectorAll(".btn-sketch[data-rem-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.remId;
      const field = c.querySelector(`.remark-text-input[data-rem-id="${id}"]`)
                 || c.querySelector(`.mastery-note-input[data-rem-id="${id}"]`);
      if (field) openTextEditorSheet(field);
    });
  });
  c.querySelector(".btn-sketch-pending")?.addEventListener("click", () => {
    const field = $("new-remark-textarea");
    if (field) openTextEditorSheet(field);
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

  const text    = ta.innerHTML;
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

const MASTERY_VALUES = new Set(["In Progress", "Mastered", "Maintain"]);

async function getLastMasteryValue(student, targetName, activityName, currentSessionId) {
  try {
    const sessions = await getRecentSessionsForStudent(student.id, 10);
    for (const sess of sessions) {
      if (sess.id === currentSessionId) continue;
      const actEntry = Object.entries(sess.activities || {})
        .find(([, a]) => a.targetName === targetName && a.activityName === activityName);
      if (!actEntry) continue;
      const [actId] = actEntry;
      const rem = Object.values(sess.remarks || {}).find(r => r.activityId === actId);
      if (rem?.text && MASTERY_VALUES.has(rem.text)) return rem.text;
      break; // found the session but value was empty — stop looking
    }
  } catch (_) {}
  return "";
}

// Auto-create mastery remarks on session open if previous session had a value.
// Returns number of remarks created (so the caller can skip rendering if > 0).
async function autoFillMasteryRemarks(student, sessionId) {
  const data = state.sessionData;
  let count = 0;
  for (const target of (student.targets || [])) {
    for (const pa of (target.predefinedActivities || [])) {
      if (!pa.isMastery) continue;

      // Find existing activity entry in current session
      const existingAct = Object.entries(data.activities || {})
        .find(([, a]) => a.targetName === target.name && a.activityName === pa.name);
      let actId = existingAct?.[0] || null;

      // If activity exists and already has a remark, nothing to do
      if (actId) {
        const hasRemark = Object.values(data.remarks || {}).some(r => r.activityId === actId);
        if (hasRemark) continue;
      }

      // Get last chosen mastery value from previous sessions
      const lastVal = await getLastMasteryValue(student, target.name, pa.name, sessionId);
      if (!lastVal) continue; // no previous value — leave collapsed

      // Create activity if it doesn't exist yet
      if (!actId) {
        actId = await addActivity(sessionId, target.name, pa.name, pa.order ?? 0, true);
      }
      await addRemark(sessionId, actId, lastVal);
      count++;
    }
  }
  return count;
}

// Deletes remarks that have no text, no mastery note, and no valid trials for
// the given target, then removes any activity that is left with no remarks.
async function cleanupEmptyEntries(sessionId, data, targetName) {
  if (!sessionId || !data) return;
  const acts = Object.entries(data.activities || {})
    .filter(([, a]) => a.targetName === targetName);
  for (const [actId] of acts) {
    const rems = Object.entries(data.remarks || {}).filter(([, r]) => r.activityId === actId);
    const stripEmpty = s => (s || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/ /g, " ").trim();
    const emptyIds = rems
      .filter(([, r]) => {
        const hasText   = stripEmpty(r.text).length > 0;
        const hasNote   = stripEmpty(r.masteryNote).length > 0;
        const hasTrials = (r.trials || []).some(t => t !== -1);
        return !hasText && !hasNote && !hasTrials;
      })
      .map(([id]) => id);
    if (!emptyIds.length) continue;
    if (emptyIds.length === rems.length) {
      await deleteActivity(sessionId, actId, emptyIds); // removes activity + all its empty remarks
    } else {
      for (const remId of emptyIds) await deleteRemark(sessionId, remId);
    }
  }
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

function _activeSessionData() {
  return state.scorePicker?.isGroup ? state.groupSessionData : state.sessionData;
}
function _activeSessionId() {
  return state.scorePicker?.isGroup ? state.groupSessionId : state.currentSessionId;
}

function renderScoreModalTrials(remId) {
  const el = $("score-modal-trials");
  if (!el) return;
  const allTrials = _activeSessionData()?.remarks?.[remId]?.trials || [];
  const visible = allTrials.map((t, i) => ({ t, i })).filter(({ t }) => t !== -1);
  if (!visible.length) { el.innerHTML = ""; return; }

  el.innerHTML =
    `<span class="score-modal-trials-label">Added:</span>` +
    visible.map(({ t, i }) =>
      `<span class="score-modal-trial-badge">
        ${t}<button class="score-trial-del" data-idx="${i}" aria-label="Remove">×</button>
      </span>`
    ).join("");

  el.querySelectorAll(".score-trial-del").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.stopPropagation();
      const idx = Number(btn.dataset.idx);
      btn.closest(".score-modal-trial-badge").remove(); // optimistic
      const rem = _activeSessionData()?.remarks?.[remId];
      if (rem) await deleteTrial(_activeSessionId(), remId, idx, rem.trials || []);
    });
  });
}

function openScorePicker(remId, target) {
  const maxPoints = (typeof target === "object" ? target?.maxPoints : target) || 3;
  const isGroup   = !!state.scorePicker?.isGroup;
  state.scorePicker = { open: true, remId, isGroup };
  const labels = CONFIG.SCORE_LABELS[maxPoints] || CONFIG.SCORE_LABELS[3];

  renderScoreModalTrials(remId);

  $("score-buttons").innerHTML = Object.entries(labels).map(([score, label]) =>
    `<button class="score-btn" data-score="${score}">
      <span class="score-num">${score}</span>
      <span class="score-label">${escHtml(label)}</span>
    </button>`
  ).join("");

  $("score-buttons").querySelectorAll(".score-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const rem = _activeSessionData()?.remarks?.[remId];
      if (!rem) return;
      const score = Number(btn.dataset.score);
      await addTrial(_activeSessionId(), remId, score, rem.trials || []);
      // Firestore snapshot will call renderScoreModalTrials to update badges
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
  const currentTargets = state.viewStudent?.targets || [];
  if (!state.viewSessionData) return currentTargets;
  // Always use the current target list: new targets appear in old sessions,
  // deleted targets disappear from all sessions (data removed by deleteTargetDataFromSessions).
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
  commitTextEditorSheet();
  $("text-editor-sheet").classList.add("hidden");
  $("btn-delete-session")?.classList.add("hidden");
  $("btn-goto-session")?.classList.add("hidden");
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
    + ` <button class="btn-edit-session-date">Edit Date</button>`;

  const delBtn = $("btn-delete-session");
  if (delBtn) delBtn.classList.remove("hidden");

  $("view-session-meta").querySelector(".btn-edit-session-date").addEventListener("click", () => {
    showEditDatePicker();
  });

  const gotoBtn = $("btn-goto-session");
  if (gotoBtn) {
    gotoBtn.classList.remove("hidden");
    gotoBtn.onclick = () => showGoToAnotherSession(state.viewStudent);
  }

  // Wire delete button (static element in header — re-attach each time)
  const _delBtn = $("btn-delete-session");
  if (_delBtn) {
    const newDelBtn = _delBtn.cloneNode(true); // remove old listeners
    newDelBtn.classList.remove("hidden");
    _delBtn.replaceWith(newDelBtn);
    newDelBtn.addEventListener("click", async () => {
      const typed = prompt(`Delete Session ${data.sessionNumber} of ${data.month.split(" ")[0]} (${formatDate(data.date)})?\n\nThis cannot be undone. Type DELETE to confirm:`);
      if (typed !== "DELETE") return;
      const sid = state.viewSessionId;
      leaveSessionView();
      await deleteSession(sid).catch(() => {});
    });
  }

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
        rows += `<tr class="view-note-row"><td colspan="6">${noteToHtml(pa.text)}</td></tr>`;
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
  const inlineOptions   = paEntry ? getActivityInlineOptions(paEntry) : null;
  const sentenceStarter = paEntry?.sentenceStarter || null;
  const multiSelect     = paEntry?.optionsMulti || false;
  const isMastery       = paEntry?.isMastery || false;

  if (remarks.length === 0) {
    // For free-text remark types (no preset opts, not mastery), show a clickable empty input
    const opts = parseOpts(inlineOptions);
    const showEmpty = opts.length === 0 && !isMastery;
    const emptyCell = showEmpty
      ? `<div class="view-remark-edit view-remark-empty" contenteditable="true"
           data-act-id="${escHtml(actId || "")}"
           data-act-name="${escHtml(actName)}"
           data-target="${escHtml(target.name)}"
           data-is-predefined="${isPredefined}"
           data-placeholder="Click to add remark…"></div>`
      : "";
    return `<tr>
      <td class="vcol-no">${no}</td>
      <td class="vcol-act">${actCell}</td>
      <td class="vcol-rem">${emptyCell}</td>
      <td class="vcol-trials"></td>
      <td class="vcol-total"></td>
      <td class="vcol-score"></td>
    </tr>`;
  }
  return remarks.map((rem, ri) => viewRemarkRow(
    ri === 0 ? no : null,
    ri === 0 ? actCell : null,
    rem, target, inlineOptions, sentenceStarter, multiSelect, isMastery
  )).join("");
}

function viewRemarkRow(no, actName, rem, target, inlineOptions = null, sentenceStarter = null, multiSelect = false, isMastery = false) {
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

  const opts = parseOpts(inlineOptions);

  function makeViewOpts(remId, remText) {
    if (opts.length === 0) return null;
    if (multiSelect) {
      const sel = (remText || "").split(", ").map(s => s.trim()).filter(Boolean);
      return `<div class="view-remark-multi-opts">${opts.map(opt =>
        `<button class="view-remark-multi-btn${sel.includes(opt) ? " active" : ""}"
          data-rem-id="${escHtml(remId)}" data-opt="${escHtml(opt)}">${escHtml(opt)}</button>`
      ).join("")}</div>`;
    }
    return `<select class="view-remark-preset-select" data-rem-id="${escHtml(remId)}">
        <option value="">— select —</option>
        ${opts.map(opt =>
          `<option value="${escHtml(opt)}"${remText === opt ? " selected" : ""}>${escHtml(opt)}</option>`
        ).join("")}
       </select>`;
  }

  const optSelect = isMastery
    ? `<div class="mastery-remark-wrap">
        <div class="remark-mastery-opts view-mastery-opts" data-rem-id="${rem.id}">
          ${["In Progress", "Mastered", "Maintain"].map(v =>
            `<button class="btn-mastery${rem.text === v ? " active" : ""}" data-rem-id="${escHtml(rem.id)}" data-val="${v}">${v}</button>`
          ).join("")}
        </div>
        <div class="mastery-note-row">
          <button class="btn-sketch" data-rem-id="${escHtml(rem.id)}" aria-label="Open sketch board">✏</button>
          <div class="view-mastery-note" contenteditable="true"
            data-rem-id="${escHtml(rem.id)}" data-placeholder="Notes…">${rem.masteryNote || ""}</div>
        </div>
      </div>`
    : (makeViewOpts(rem.id, rem.text)
        || `<div style="display:flex;align-items:flex-start;gap:.3rem">
              <button class="btn-sketch" data-rem-id="${escHtml(rem.id)}" aria-label="Open sketch board">✏</button>
              <div class="view-remark-edit" contenteditable="true" data-rem-id="${escHtml(rem.id)}">${remarkToHtml(rem.text)}</div>
            </div>`);

  let remarkCell;
  if (sentenceStarter) {
    remarkCell = `<div class="view-starter-wrap">
      <span class="view-starter-prefix">${escHtml(sentenceStarter)}</span>
      ${makeViewOpts(rem.id, rem.text)
        || `<input type="text" class="view-starter-input" data-rem-id="${escHtml(rem.id)}"
            value="${escHtml(rem.text || "")}">`
      }
    </div>`;
  } else {
    remarkCell = optSelect;
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

  // ── Sketch board buttons (view screen) ────────────────────
  body.querySelectorAll(".btn-sketch[data-rem-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.remId;
      const field = body.querySelector(`.view-remark-edit[data-rem-id="${id}"]`)
                 || body.querySelector(`.view-mastery-note[data-rem-id="${id}"]`);
      if (field) openTextEditorSheet(field);
    });
  });

  body.querySelectorAll(".view-remark-edit:not(.view-remark-empty)").forEach(ta => {
    let orig = ta.innerHTML;
    ta.addEventListener("blur", async () => {
      const newText = ta.innerHTML;
      if (newText === orig) return;
      orig = newText;
      await updateRemarkText(state.viewSessionId, ta.dataset.remId, newText);
    });
  });

  // Empty remark cells — create activity + remark on first input
  body.querySelectorAll(".view-remark-empty").forEach(div => {
    div.addEventListener("blur", async () => {
      const strip = s => (s || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/ /g, " ").trim();
      const text = div.innerHTML;
      if (!strip(text)) return;
      let actId = div.dataset.actId;
      if (!actId) {
        actId = await addActivity(
          state.viewSessionId, div.dataset.target,
          div.dataset.actName, Date.now(),
          div.dataset.isPredefined === "true"
        );
      }
      const remId = await addRemark(state.viewSessionId, actId, "");
      await updateRemarkText(state.viewSessionId, remId, text);
    });
  });

  body.querySelectorAll(".view-mastery-note").forEach(div => {
    let orig = div.innerHTML;
    div.addEventListener("blur", async () => {
      const newNote = div.innerHTML;
      if (newNote === orig) return;
      orig = newNote;
      await updateRemarkNote(state.viewSessionId, div.dataset.remId, newNote);
    });
  });

  body.querySelectorAll(".view-mastery-opts .btn-mastery").forEach(btn => {
    btn.addEventListener("click", async () => {
      const container  = btn.closest(".remark-mastery-opts");
      const currentVal = container?.querySelector(".btn-mastery.active")?.dataset.val || "";
      const isActive   = btn.classList.contains("active");
      const newVal     = isActive ? "" : btn.dataset.val;
      if (currentVal === newVal) return;
      if (!confirm(`Change mastery level from "${currentVal || "none"}" to "${newVal || "none"}"?`)) return;
      container?.querySelectorAll(".btn-mastery").forEach(b => b.classList.remove("active"));
      if (!isActive) btn.classList.add("active");
      await updateRemarkText(state.viewSessionId, btn.dataset.remId, newVal);
    });
  });

  body.querySelectorAll(".view-remark-preset-select").forEach(sel => {
    sel.addEventListener("change", async () => {
      if (!sel.value) return;
      await updateRemarkText(state.viewSessionId, sel.dataset.remId, sel.value);
    });
  });

  body.querySelectorAll(".view-remark-multi-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      btn.classList.toggle("active");
      const container = btn.closest(".view-remark-multi-opts");
      const selected = [...container.querySelectorAll(".view-remark-multi-btn.active")].map(b => b.dataset.opt);
      await updateRemarkText(state.viewSessionId, btn.dataset.remId, selected.join(", "));
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

// ── Group Add Target picker ───────────────────────────────────

function showGroupAddTargetPicker(group) {
  $("manage-modal-title").textContent = "Add Target";
  $("manage-modal").classList.remove("hidden");

  const hasDup       = group.targets.length > 0;
  const otherGroups  = state.groups.filter(g => g.id !== group.id && g.targets?.length > 0);
  const hasOther     = otherGroups.length > 0;
  const hasTemplates = state.templates.length > 0;

  $("manage-modal-body").innerHTML = `
    <div style="display:flex;flex-direction:column;gap:.6rem">
      <button class="btn-target-type" id="btn-gadd-create">
        <span class="btn-target-label">Create Target</span>
        <span class="btn-target-desc">Activities will be the same every session, just fill in remarks</span>
      </button>
      ${hasDup ? `<button class="btn-target-type" id="btn-gadd-dup-current">
        <span class="btn-target-label">Duplicate Target from Current Group</span>
        <span class="btn-target-desc">Duplicate an existing target from this group</span>
      </button>` : ""}
      ${hasOther ? `<button class="btn-target-type" id="btn-gadd-dup-other">
        <span class="btn-target-label">Duplicate Target from Another Group</span>
        <span class="btn-target-desc">Duplicate a target from a different group</span>
      </button>` : ""}
      ${hasTemplates ? `<button class="btn-target-type" id="btn-gadd-dup-tmpl">
        <span class="btn-target-label">Duplicate from Template</span>
        <span class="btn-target-desc">Duplicate a template as an individual target</span>
      </button>` : ""}
    </div>`;
  $("manage-modal-body").scrollTop = 0;

  $("btn-gadd-create").addEventListener("click", async () => {
    $("manage-modal").classList.add("hidden");
    const name = prompt("Target name:");
    if (!name?.trim()) return;
    const t = { id: cfgId("gt"), name: name.trim(), maxPoints: 3, hasComment: false, fullName: "",
      order: group.targets.length, predefinedActivities: [], notes: [], isStructured: true };
    group.targets.push(t);
    const gi = state.groups.findIndex(g => g.id === group.id);
    if (gi >= 0) state.groups[gi] = group;
    await saveGroup(group);
    state.selectedGroupTargetName = t.name;
    populateGroupTargetDropdown(group.targets);
    renderGroupTargetContent();
    openGroupManageModal(group, t);
  });

  $("btn-gadd-dup-current")?.addEventListener("click", () => showGroupDupFromCurrent(group));
  $("btn-gadd-dup-other")?.addEventListener("click", () => showGroupDupFromOther(group, otherGroups));
  $("btn-gadd-dup-tmpl")?.addEventListener("click", () => showGroupDupFromTemplate(group));
}

function showGroupDupFromCurrent(group) {
  const sorted = [...group.targets].sort((a, b) => a.name.localeCompare(b.name));
  $("manage-modal-body").innerHTML = `
    <div class="admin-section-title" style="margin-bottom:.5rem">Choose a target to duplicate</div>
    <div class="admin-list">
      ${sorted.map(t => `
        <label class="admin-list-item" style="cursor:pointer;gap:.75rem">
          <input type="radio" name="gdup-target" class="gdup-target-radio" data-target-id="${escHtml(t.id)}"
            style="width:18px;height:18px;flex-shrink:0;cursor:pointer" />
          <span class="admin-item-name">${escHtml(t.name)}</span>
        </label>`).join("")}
    </div>
    <button class="btn-primary-sm" id="btn-gdup-confirm" style="width:100%;margin-top:.75rem;padding:.75rem">Duplicate Selected</button>
    <button class="btn-adm-secondary" id="btn-gdup-back" style="width:100%;margin-top:.5rem;padding:.65rem">← Back</button>`;

  $("btn-gdup-back").addEventListener("click", () => showGroupAddTargetPicker(group));
  $("btn-gdup-confirm").addEventListener("click", async () => {
    const radio = $("manage-modal-body").querySelector(".gdup-target-radio:checked");
    if (!radio) { alert("Select a target to duplicate."); return; }
    const source = group.targets.find(t => t.id === radio.dataset.targetId);
    if (!source) return;
    $("manage-modal").classList.add("hidden");
    const name = prompt("Name for the duplicate:", source.name + " (duplicate)");
    if (!name?.trim()) { $("manage-modal").classList.remove("hidden"); showGroupAddTargetPicker(group); return; }
    const copy = JSON.parse(JSON.stringify(source));
    copy.id = cfgId("gt"); copy.name = name.trim(); copy.order = group.targets.length;
    group.targets.push(copy);
    const gi = state.groups.findIndex(g => g.id === group.id);
    if (gi >= 0) state.groups[gi] = group;
    await saveGroup(group);
    state.selectedGroupTargetName = copy.name;
    populateGroupTargetDropdown(group.targets);
    renderGroupTargetContent();
    openGroupManageModal(group, copy);
  });
}

function showGroupDupFromOther(group, otherGroups) {
  $("manage-modal-body").innerHTML = `
    <div class="admin-section-title" style="margin-bottom:.5rem">Choose a group</div>
    <div class="admin-list">
      ${otherGroups.sort((a, b) => a.name.localeCompare(b.name)).map(g => `
        <label class="admin-list-item" style="cursor:pointer;gap:.75rem">
          <input type="radio" name="gother-group" class="gother-group-radio" data-group-id="${escHtml(g.id)}"
            style="width:18px;height:18px;flex-shrink:0;cursor:pointer" />
          <span class="admin-item-name">${escHtml(g.name)}</span>
        </label>`).join("")}
    </div>
    <button class="btn-primary-sm" id="btn-gother-next" style="width:100%;margin-top:.75rem;padding:.75rem">Next →</button>
    <button class="btn-adm-secondary" id="btn-gdup-back" style="width:100%;margin-top:.5rem;padding:.65rem">← Back</button>`;

  $("btn-gdup-back").addEventListener("click", () => showGroupAddTargetPicker(group));
  $("btn-gother-next").addEventListener("click", () => {
    const radio = $("manage-modal-body").querySelector(".gother-group-radio:checked");
    if (!radio) { alert("Select a group."); return; }
    const src = otherGroups.find(g => g.id === radio.dataset.groupId);
    if (!src) return;
    showGroupDupFromOtherPickTarget(group, src);
  });
}

function showGroupDupFromOtherPickTarget(group, sourceGroup) {
  const sorted = [...(sourceGroup.targets || [])].sort((a, b) => a.name.localeCompare(b.name));
  if (!sorted.length) { alert(`${sourceGroup.name} has no targets.`); showGroupAddTargetPicker(group); return; }
  $("manage-modal-body").innerHTML = `
    <div class="admin-section-title" style="margin-bottom:.5rem">Choose a target from ${escHtml(sourceGroup.name)}</div>
    <div class="admin-list">
      ${sorted.map(t => `
        <label class="admin-list-item" style="cursor:pointer;gap:.75rem">
          <input type="radio" name="gother-target" class="gother-target-radio" data-target-id="${escHtml(t.id)}"
            style="width:18px;height:18px;flex-shrink:0;cursor:pointer" />
          <span class="admin-item-name">${escHtml(t.name)}</span>
        </label>`).join("")}
    </div>
    <button class="btn-primary-sm" id="btn-gother-dup" style="width:100%;margin-top:.75rem;padding:.75rem">Duplicate Selected</button>
    <button class="btn-adm-secondary" id="btn-gdup-back" style="width:100%;margin-top:.5rem;padding:.65rem">← Back</button>`;

  $("btn-gdup-back").addEventListener("click", () => showGroupDupFromOther(group, state.groups.filter(g => g.id !== group.id && g.targets?.length > 0)));
  $("btn-gother-dup").addEventListener("click", async () => {
    const radio = $("manage-modal-body").querySelector(".gother-target-radio:checked");
    if (!radio) { alert("Select a target."); return; }
    const source = sorted.find(t => t.id === radio.dataset.targetId);
    if (!source) return;
    $("manage-modal").classList.add("hidden");
    const name = prompt("Name for the duplicate:", source.name + " (duplicate)");
    if (!name?.trim()) { $("manage-modal").classList.remove("hidden"); showGroupAddTargetPicker(group); return; }
    const copy = JSON.parse(JSON.stringify(source));
    copy.id = cfgId("gt"); copy.name = name.trim(); copy.order = group.targets.length; copy.isStructured = true;
    group.targets.push(copy);
    const gi = state.groups.findIndex(g => g.id === group.id);
    if (gi >= 0) state.groups[gi] = group;
    await saveGroup(group);
    state.selectedGroupTargetName = copy.name;
    populateGroupTargetDropdown(group.targets);
    renderGroupTargetContent();
    openGroupManageModal(group, copy);
  });
}

function showGroupDupFromTemplate(group) {
  const sortedTmpls = [...state.templates].sort((a, b) => a.name.localeCompare(b.name));
  $("manage-modal-body").innerHTML = `
    <div class="admin-section-title" style="margin-bottom:.5rem">Choose templates to duplicate</div>
    <div class="admin-list">
      ${sortedTmpls.map(t => `
        <label class="admin-list-item" style="cursor:pointer;gap:.75rem">
          <input type="checkbox" class="gtmpl-cb" data-tmpl-id="${escHtml(t.id)}"
            style="width:20px;height:20px;flex-shrink:0;cursor:pointer" />
          <span class="admin-item-name">${escHtml(t.name)}</span>
        </label>`).join("")}
    </div>
    <button class="btn-primary-sm" id="btn-gtmpl-dup" style="width:100%;margin-top:.75rem;padding:.75rem">Duplicate Selected</button>
    <button class="btn-adm-secondary" id="btn-gdup-back" style="width:100%;margin-top:.5rem;padding:.65rem">← Back</button>`;

  $("btn-gdup-back").addEventListener("click", () => showGroupAddTargetPicker(group));
  $("btn-gtmpl-dup").addEventListener("click", async () => {
    const checked = [...$("manage-modal-body").querySelectorAll(".gtmpl-cb:checked")];
    if (!checked.length) { alert("Select at least one template."); return; }
    $("manage-modal").classList.add("hidden");
    let lastAdded = null;
    for (const cb of checked) {
      const tmpl = state.templates.find(t => t.id === cb.dataset.tmplId);
      if (!tmpl) continue;
      const copy = {
        id: cfgId("gt"), name: tmpl.name, maxPoints: tmpl.maxPoints || 3,
        hasComment: false, fullName: "", order: group.targets.length,
        predefinedActivities: JSON.parse(JSON.stringify(tmpl.predefinedActivities || [])),
        notes: JSON.parse(JSON.stringify(tmpl.notes || [])), isStructured: true
      };
      group.targets.push(copy); lastAdded = copy;
    }
    const gi = state.groups.findIndex(g => g.id === group.id);
    if (gi >= 0) state.groups[gi] = group;
    await saveGroup(group);
    if (lastAdded) state.selectedGroupTargetName = lastAdded.name;
    populateGroupTargetDropdown(group.targets);
    renderGroupTargetContent();
    if (lastAdded && checked.length === 1) openGroupManageModal(group, lastAdded);
  });
}

function closeManageModal() {
  $("manage-modal").classList.add("hidden");
  _groupForTargetEdit = null;
  // If a brand-new group was being created but has no students, remove it
  if (_newGroupId) {
    const g = state.groups.find(x => x.id === _newGroupId);
    if (g && (!g.students || g.students.length === 0)) {
      const gi = state.groups.findIndex(x => x.id === _newGroupId);
      if (gi >= 0) state.groups.splice(gi, 1);
      deleteGroup(_newGroupId).catch(() => {});
      renderGroupButtons();
    }
    _newGroupId = null;
  }
  // Refresh session dropdown / content if a session is active
  if (state.currentStudent) {
    populateTargetDropdown(state.currentStudent.targets);
    if (state.currentSessionId) renderTargetContent();
  }
  // Refresh group session dropdown if a group session is active
  if (state.currentGroup) {
    populateGroupTargetDropdown(state.currentGroup.targets);
    if (state.groupSessionId) renderGroupTargetContent();
  }
  // Always refresh all home screen sections
  renderExistingStudentButtons();
  renderAssessmentStudentButtons();
  renderTemplateButtons();
  renderExportButtons();
  renderGroupButtons();
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

  const hasDuplicatable  = student.targets.length > 0;
  const otherStudents    = state.students.filter(s => s.id !== student.id);
  const hasOtherStudents = otherStudents.length > 0;
  const hasTemplates     = state.templates.length > 0;

  const html = `
    <div style="display:flex;flex-direction:column;gap:.6rem">
      <button class="btn-target-type" id="btn-add-structured-target">
        <span class="btn-target-label">Create Target</span>
        <span class="btn-target-desc">Activities will be the same every session, just fill in remarks</span>
      </button>
      ${hasDuplicatable ? `<button class="btn-target-type" id="btn-duplicate-target">
        <span class="btn-target-label">Duplicate Target from Current Student</span>
        <span class="btn-target-desc">Duplicate an existing target from this student</span>
      </button>` : ""}
      ${hasOtherStudents ? `<button class="btn-target-type" id="btn-duplicate-from-other">
        <span class="btn-target-label">Duplicate Target from Another Student</span>
        <span class="btn-target-desc">Duplicate a target from a different student</span>
      </button>` : ""}
      ${hasTemplates ? `<button class="btn-target-type" id="btn-duplicate-from-template">
        <span class="btn-target-label">Duplicate from Template</span>
        <span class="btn-target-desc">Duplicate a template as an individual target</span>
      </button>` : ""}
    </div>`;

  const modalBody = $("manage-modal-body");
  modalBody.innerHTML = html;
  modalBody.scrollTop = 0;

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

  $("btn-duplicate-target")?.addEventListener("click", () => {
    showDupFromCurrentStudent(student);
  });

  $("btn-duplicate-from-other")?.addEventListener("click", () => {
    showDupFromOtherStudent_pickStudent(student, otherStudents);
  });

  $("btn-duplicate-from-template")?.addEventListener("click", () => {
    showDupFromTemplate(student);
  });
}

function showDupFromCurrentStudent(student) {
  const sorted = [...student.targets].sort((a, b) => a.name.localeCompare(b.name));
  $("manage-modal-body").innerHTML = `
    <div class="admin-section-title" style="margin-bottom:.5rem">Choose a target to duplicate</div>
    <div class="admin-list">
      ${sorted.map(t => `
        <label class="admin-list-item" style="cursor:pointer;gap:.75rem">
          <input type="radio" name="dup-target" class="dup-target-radio" data-target-id="${escHtml(t.id)}"
            style="width:18px;height:18px;flex-shrink:0;cursor:pointer" />
          <span class="admin-item-name">${escHtml(t.name)}</span>
        </label>`).join("")}
    </div>
    <button class="btn-primary-sm" id="btn-confirm-duplicate"
      style="width:100%;margin-top:.75rem;padding:.75rem">Duplicate Selected</button>
    <button class="btn-adm-secondary" id="btn-dup-back"
      style="width:100%;margin-top:.5rem;padding:.65rem">← Back</button>`;

  $("btn-dup-back").addEventListener("click", () => showAddTargetPicker(student));

  $("btn-confirm-duplicate").addEventListener("click", async () => {
    const radio = $("manage-modal-body").querySelector(".dup-target-radio:checked");
    if (!radio) { alert("Select a target to duplicate."); return; }
    const source = student.targets.find(t => t.id === radio.dataset.targetId);
    if (!source) return;
    $("manage-modal").classList.add("hidden");
    const name = prompt("Name for the duplicate:", source.name + " (duplicate)");
    if (!name?.trim()) { $("manage-modal").classList.remove("hidden"); showAddTargetPicker(student); return; }
    const copy = JSON.parse(JSON.stringify(source));
    copy.id    = cfgId("t");
    copy.name  = name.trim();
    copy.order = student.targets.length;
    copy.templateId = null;
    student.targets.push(copy);
    const si = state.students.findIndex(s => s.id === student.id);
    if (si >= 0) state.students[si] = student;
    await saveStudent(student);
    state.selectedTargetName = copy.name;
    populateTargetDropdown(student.targets);
    renderTargetContent();
    openManageModal(student, copy);
  });
}

function showDupFromOtherStudent_pickStudent(student, otherStudents) {
  const existing   = otherStudents.filter(s => s.type !== "assessment").sort((a, b) => a.name.localeCompare(b.name));
  const assessment = otherStudents.filter(s => s.type === "assessment").sort((a, b) => a.name.localeCompare(b.name));

  function buildList(list) {
    if (list.length === 0) return `<div style="color:var(--text-muted);font-size:.85rem;padding:.25rem .5rem">None</div>`;
    return list.map(s => `
      <label class="admin-list-item" style="cursor:pointer;gap:.75rem">
        <input type="radio" name="other-student" class="other-student-radio" data-student-id="${escHtml(s.id)}"
          style="width:18px;height:18px;flex-shrink:0;cursor:pointer" />
        <span class="admin-item-name">${escHtml(s.name)}</span>
      </label>`).join("");
  }

  function render(filter) {
    const q = filter.toLowerCase();
    const filteredExisting   = existing.filter(s => s.name.toLowerCase().includes(q));
    const filteredAssessment = assessment.filter(s => s.name.toLowerCase().includes(q));
    $("dup-student-list").innerHTML = `
      <div class="admin-section-title" style="margin:.5rem 0 .25rem">Existing Students</div>
      <div class="admin-list" style="margin-bottom:1rem">${buildList(filteredExisting)}</div>
      <div class="admin-section-title" style="margin:.5rem 0 .25rem">Assessment Students</div>
      <div class="admin-list">${buildList(filteredAssessment)}</div>`;
  }

  $("manage-modal-body").innerHTML = `
    <div class="admin-section-title" style="margin-bottom:.5rem">Search Student</div>
    <input type="search" id="dup-student-search" class="admin-input"
      placeholder="Search students…" autocomplete="off"
      style="width:100%;margin-bottom:.5rem" />
    <div id="dup-student-list"></div>
    <button class="btn-primary-sm" id="btn-pick-other-student"
      style="width:100%;margin-top:.75rem;padding:.75rem">Next →</button>
    <button class="btn-adm-secondary" id="btn-dup-back"
      style="width:100%;margin-top:.5rem;padding:.65rem">← Back</button>`;

  render("");
  $("dup-student-search").addEventListener("input", e => render(e.target.value));
  $("btn-dup-back").addEventListener("click", () => showAddTargetPicker(student));

  $("btn-pick-other-student").addEventListener("click", () => {
    const radio = $("manage-modal-body").querySelector(".other-student-radio:checked");
    if (!radio) { alert("Select a student."); return; }
    const source = otherStudents.find(s => s.id === radio.dataset.studentId);
    if (!source) return;
    showDupFromOtherStudent_pickTarget(student, source);
  });
}

function showDupFromOtherStudent_pickTarget(student, sourceStudent) {
  const sorted = [...sourceStudent.targets].sort((a, b) => a.name.localeCompare(b.name));
  if (sorted.length === 0) {
    alert(`${sourceStudent.name} has no targets to duplicate.`);
    showAddTargetPicker(student);
    return;
  }
  $("manage-modal-body").innerHTML = `
    <div class="admin-section-title" style="margin-bottom:.5rem">Choose a target from ${escHtml(sourceStudent.name)}</div>
    <div class="admin-list">
      ${sorted.map(t => `
        <label class="admin-list-item" style="cursor:pointer;gap:.75rem">
          <input type="radio" name="other-target" class="other-target-radio" data-target-id="${escHtml(t.id)}"
            style="width:18px;height:18px;flex-shrink:0;cursor:pointer" />
          <span class="admin-item-name">${escHtml(t.name)}</span>
        </label>`).join("")}
    </div>
    <button class="btn-primary-sm" id="btn-confirm-other-dup"
      style="width:100%;margin-top:.75rem;padding:.75rem">Duplicate Selected</button>
    <button class="btn-adm-secondary" id="btn-dup-back"
      style="width:100%;margin-top:.5rem;padding:.65rem">← Back</button>`;

  $("btn-dup-back").addEventListener("click", () => {
    showDupFromOtherStudent_pickStudent(student, state.students.filter(s => s.id !== student.id));
  });

  $("btn-confirm-other-dup").addEventListener("click", async () => {
    const radio = $("manage-modal-body").querySelector(".other-target-radio:checked");
    if (!radio) { alert("Select a target to duplicate."); return; }
    const source = sourceStudent.targets.find(t => t.id === radio.dataset.targetId);
    if (!source) return;
    $("manage-modal").classList.add("hidden");
    const name = prompt("Name for the duplicate:", source.name + " (duplicate)");
    if (!name?.trim()) { $("manage-modal").classList.remove("hidden"); showAddTargetPicker(student); return; }
    const copy = JSON.parse(JSON.stringify(source));
    copy.id         = cfgId("t");
    copy.name       = name.trim();
    copy.order      = student.targets.length;
    copy.templateId = null;
    copy.isStructured = true;
    student.targets.push(copy);
    const si = state.students.findIndex(s => s.id === student.id);
    if (si >= 0) state.students[si] = student;
    await saveStudent(student);
    state.selectedTargetName = copy.name;
    populateTargetDropdown(student.targets);
    renderTargetContent();
    openManageModal(student, copy);
  });
}

function showDupFromTemplate(student) {
  const sortedTmpls = [...state.templates].sort((a, b) => a.name.localeCompare(b.name));
  $("manage-modal-body").innerHTML = `
    <div class="admin-section-title" style="margin-bottom:.5rem">Choose templates to duplicate</div>
    <div class="admin-list">
      ${sortedTmpls.map(t => `
        <label class="admin-list-item" style="cursor:pointer;gap:.75rem">
          <input type="checkbox" class="tmpl-source-cb" data-tmpl-id="${escHtml(t.id)}"
            style="width:20px;height:20px;flex-shrink:0;cursor:pointer" />
          <span class="admin-item-name">${escHtml(t.name)}</span>
        </label>`).join("")}
    </div>
    <button class="btn-primary-sm" id="btn-confirm-tmpl-dup"
      style="width:100%;margin-top:.75rem;padding:.75rem">Duplicate Selected</button>
    <button class="btn-adm-secondary" id="btn-dup-back"
      style="width:100%;margin-top:.5rem;padding:.65rem">← Back</button>`;

  $("btn-dup-back").addEventListener("click", () => showAddTargetPicker(student));

  $("btn-confirm-tmpl-dup").addEventListener("click", async () => {
    const checked = [...$("manage-modal-body").querySelectorAll(".tmpl-source-cb:checked")];
    if (checked.length === 0) { alert("Select at least one template to duplicate."); return; }

    $("manage-modal").classList.add("hidden");
    let lastAdded = null;
    for (const cb of checked) {
      const tmpl = state.templates.find(t => t.id === cb.dataset.tmplId);
      if (!tmpl) continue;
      const copy = {
        id: cfgId("t"), name: tmpl.name,
        maxPoints: tmpl.maxPoints || 3,
        hasComment: false, fullName: "",
        order: student.targets.length,
        predefinedActivities: JSON.parse(JSON.stringify(tmpl.predefinedActivities || [])),
        notes: JSON.parse(JSON.stringify(tmpl.notes || [])),
        templateId: null, isStructured: true
      };
      student.targets.push(copy);
      lastAdded = copy;
    }
    const si = state.students.findIndex(s => s.id === student.id);
    if (si >= 0) state.students[si] = student;
    await saveStudent(student);
    if (lastAdded) state.selectedTargetName = lastAdded.name;
    populateTargetDropdown(student.targets);
    renderTargetContent();
    if (lastAdded && checked.length === 1) openManageModal(student, lastAdded);
  });
}

// ── Remark preset management content ─────────────────────────

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

// Converts stored note text to safe display HTML.
// Accepts both legacy **bold** markdown and new HTML from contenteditable.
function noteToHtml(text) {
  if (!text) return "";
  if (/<[a-z]/i.test(text)) return text;            // already HTML — use directly
  return escHtml(text).replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
}

// Convert stored note text (possibly HTML) to plain text for textarea editing
function stripNoteHtml(text) {
  if (!text) return "";
  if (!/<[a-z]/i.test(text)) {
    return text.replace(/\*\*([\s\S]+?)\*\*/g, "$1");
  }
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n").replace(/<div>/gi, "")
    .replace(/<\/p>/gi, "\n").replace(/<p>/gi, "")
    .replace(/<\/?(strong|b|u|em|i)[^>]*>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
          rows="1" placeholder="Note"
          style="flex:1;overflow-y:hidden;resize:none">${escHtml(stripNoteHtml(a.text || ""))}</textarea>
        <button class="btn-adm-del mn-del-act" data-idx="${idx}">🗑</button>
      </div>`;
    } else {
      const type = a.isMastery ? "mastery" : (a.sentenceStarter && a.inlineOptions && a.optionsMulti) ? "starter_fixed_multi" : (a.sentenceStarter && a.inlineOptions) ? "starter_fixed" : a.sentenceStarter ? "starter" : (a.inlineOptions && a.optionsMulti) ? "fixed_multi" : (a.inlineOptions || a.remarkPresetId) ? "fixed" : "";
      const remarkTypeSelect = `<select class="act-preset-select mn-act-preset" data-idx="${idx}">
          <option value="">Free text</option>
          <option value="fixed"${type === "fixed" ? " selected" : ""}>Select one</option>
          <option value="fixed_multi"${type === "fixed_multi" ? " selected" : ""}>Tick boxes</option>
          <option value="starter"${type === "starter" ? " selected" : ""}>Sentence Starter + Free Text</option>
          <option value="starter_fixed"${type === "starter_fixed" ? " selected" : ""}>Sentence Starter + Select one</option>
          <option value="starter_fixed_multi"${type === "starter_fixed_multi" ? " selected" : ""}>Sentence Starter + Tick boxes</option>
          <option value="mastery"${type === "mastery" ? " selected" : ""}>Mastery Level + Free Text</option>
        </select>
        <input class="admin-input mn-act-starter-text" data-idx="${idx}"
          placeholder="Starter phrase…"
          value="${escHtml(a.sentenceStarter || "")}"
          style="${type === "starter" || type === "starter_fixed" || type === "starter_fixed_multi" ? "" : "display:none"}">
        <input class="admin-input mn-act-inline-opts" data-idx="${idx}"
          placeholder="Options separated by /  e.g. Low/Medium/High"
          value="${escHtml(a.inlineOptions || (a.remarkPresetId ? (state.remarkPresets.find(p=>p.id===a.remarkPresetId)?.options||[]).join("/") : ""))}"
          style="${type === "fixed" || type === "fixed_multi" || type === "starter_fixed" || type === "starter_fixed_multi" ? "" : "display:none"}">`;
      html += `<div class="admin-list-item" data-idx="${idx}">
        <span class="drag-handle">⠿</span>
        <div style="flex:1;display:flex;flex-direction:column;gap:.3rem">
          <textarea class="admin-input" id="mn-act-name-${idx}" data-idx="${idx}"
            rows="1" placeholder="Activity name (Enter = new line · Ctrl+Enter = save)">${escHtml(a.name || "")}</textarea>
          <div style="display:flex;align-items:center;gap:.5rem">
            <span style="font-size:.75rem;color:#6b7280;white-space:nowrap;font-weight:600">Remark Type:</span>
            ${remarkTypeSelect}
          </div>
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
    if (_groupForTargetEdit) {
      const gi = state.groups.findIndex(g => g.id === _groupForTargetEdit.id);
      if (gi >= 0) state.groups[gi] = _groupForTargetEdit;
      await saveGroup(_groupForTargetEdit);
    } else {
      const si = state.students.findIndex(s => s.id === student.id);
      if (si >= 0) state.students[si] = student;
      await saveStudent(student);
    }
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
    if (a.isNote && input) {
      const resize = () => { input.style.height = "auto"; input.style.height = input.scrollHeight + "px"; };
      resize();
      let noteTimer;
      input.addEventListener("input", () => {
        resize();
        a.text = input.value;           // keep in-memory state in sync immediately
        clearTimeout(noteTimer);
        noteTimer = setTimeout(async () => { await saveTarget(); }, 800);
      });
    }
    input?.addEventListener("blur", async () => {
      if (a.isNote) {
        const v = input.value;
        if (v === (a.text || "")) return;
        a.text = v;
      } else {
        const v = input.value.trim();
        if (!v || v === a.name) return;
        a.name = v;
      }
      await saveTarget();
      flashSaved(input);
    });
    if (!a.isNote) input?.addEventListener("input", () => autoResizeTextarea(input));
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
      const body = $("manage-modal-body");
      const starterInput = body.querySelector(`.mn-act-starter-text[data-idx="${idx}"]`);
      const optsInput    = body.querySelector(`.mn-act-inline-opts[data-idx="${idx}"]`);
      const type = sel.value;
      acts[idx].sentenceStarter = null;
      acts[idx].remarkPresetId  = null;
      acts[idx].inlineOptions   = null;
      acts[idx].optionsMulti    = (type === "fixed_multi" || type === "starter_fixed_multi");
      acts[idx].isMastery       = (type === "mastery");
      starterInput.style.display = (type === "starter" || type === "starter_fixed" || type === "starter_fixed_multi") ? "" : "none";
      optsInput.style.display    = (type === "fixed" || type === "fixed_multi" || type === "starter_fixed" || type === "starter_fixed_multi") ? "" : "none";
      if (type === "starter" || type === "starter_fixed" || type === "starter_fixed_multi") { starterInput.focus(); }
      else if (type === "fixed" || type === "fixed_multi") { optsInput.focus(); }
      else { target.predefinedActivities = acts; await saveTarget(); }
    });
  });

  $("manage-modal-body").querySelectorAll(".mn-act-starter-text").forEach(input => {
    input.addEventListener("blur", async () => {
      const idx = Number(input.dataset.idx);
      acts[idx].sentenceStarter = input.value.trim() || null;
      target.predefinedActivities = acts;
      await saveTarget();
    });
  });

  $("manage-modal-body").querySelectorAll(".mn-act-inline-opts").forEach(input => {
    input.addEventListener("blur", async () => {
      const idx = Number(input.dataset.idx);
      acts[idx].inlineOptions  = input.value.trim() || null;
      acts[idx].remarkPresetId = null;
      target.predefinedActivities = acts;
      await saveTarget();
    });
  });

  $("btn-mn-done-target").addEventListener("click", closeManageModal);

  $("btn-mn-del-target").addEventListener("click", async () => {
    const typed1 = prompt(`This will permanently delete "${target.name}" and ALL its session data across every date.\n\nType DELETE to confirm:`);
    if (typed1 !== "DELETE") return;
    const typed2 = prompt(`Are you absolutely sure? This cannot be undone.\n\nType DELETE again to permanently delete "${target.name}":`);
    if (typed2 !== "DELETE") return;
    student.targets = student.targets.filter(t => t.id !== target.id);
    student.targets.forEach((t, i) => t.order = i);
    if (_groupForTargetEdit) {
      await saveGroup(_groupForTargetEdit);
      await deleteGroupTargetDataFromSessions(_groupForTargetEdit.id, target.name);
    } else {
      await saveStudent(student);
      await deleteTargetDataFromSessions(student.id, target.name);
    }
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
          rows="1" placeholder="Note"
          style="flex:1;overflow-y:hidden;resize:none">${escHtml(stripNoteHtml(a.text || ""))}</textarea>
        <button class="btn-adm-del mn-del-act" data-idx="${idx}">🗑</button>
      </div>`;
    } else {
      const type = a.isMastery ? "mastery" : (a.sentenceStarter && a.inlineOptions && a.optionsMulti) ? "starter_fixed_multi" : (a.sentenceStarter && a.inlineOptions) ? "starter_fixed" : a.sentenceStarter ? "starter" : (a.inlineOptions && a.optionsMulti) ? "fixed_multi" : (a.inlineOptions || a.remarkPresetId) ? "fixed" : "";
      const remarkTypeSelect = `<select class="act-preset-select mn-act-preset" data-idx="${idx}">
          <option value="">Free text</option>
          <option value="fixed"${type === "fixed" ? " selected" : ""}>Select one</option>
          <option value="fixed_multi"${type === "fixed_multi" ? " selected" : ""}>Tick boxes</option>
          <option value="starter"${type === "starter" ? " selected" : ""}>Sentence Starter + Free Text</option>
          <option value="starter_fixed"${type === "starter_fixed" ? " selected" : ""}>Sentence Starter + Select one</option>
          <option value="starter_fixed_multi"${type === "starter_fixed_multi" ? " selected" : ""}>Sentence Starter + Tick boxes</option>
          <option value="mastery"${type === "mastery" ? " selected" : ""}>Mastery Level + Free Text</option>
        </select>
        <input class="admin-input mn-act-starter-text" data-idx="${idx}"
          placeholder="Starter phrase…"
          value="${escHtml(a.sentenceStarter || "")}"
          style="${type === "starter" || type === "starter_fixed" || type === "starter_fixed_multi" ? "" : "display:none"}">
        <input class="admin-input mn-act-inline-opts" data-idx="${idx}"
          placeholder="Options separated by /  e.g. Low/Medium/High"
          value="${escHtml(a.inlineOptions || (a.remarkPresetId ? (state.remarkPresets.find(p=>p.id===a.remarkPresetId)?.options||[]).join("/") : ""))}"
          style="${type === "fixed" || type === "fixed_multi" || type === "starter_fixed" || type === "starter_fixed_multi" ? "" : "display:none"}">`;
      html += `<div class="admin-list-item" data-idx="${idx}">
        <span class="drag-handle">⠿</span>
        <div style="flex:1;display:flex;flex-direction:column;gap:.3rem">
          <textarea class="admin-input" id="mn-act-name-${idx}" data-idx="${idx}"
            rows="1" placeholder="Activity name (Enter = new line · Ctrl+Enter = save)">${escHtml(a.name || "")}</textarea>
          <div style="display:flex;align-items:center;gap:.5rem">
            <span style="font-size:.75rem;color:#6b7280;white-space:nowrap;font-weight:600">Remark Type:</span>
            ${remarkTypeSelect}
          </div>
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
      <button class="btn-primary-sm" id="btn-mn-done-template"
        style="width:100%;padding:.75rem;margin-bottom:.75rem">Done</button>
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
    if (a.isNote && input) {
      const resize = () => { input.style.height = "auto"; input.style.height = input.scrollHeight + "px"; };
      resize();
      let noteTimer;
      input.addEventListener("input", () => {
        resize();
        a.text = input.value;           // keep in-memory state in sync immediately
        clearTimeout(noteTimer);
        noteTimer = setTimeout(async () => { await saveTemplateFn(); }, 800);
      });
    }
    input?.addEventListener("blur", async () => {
      if (a.isNote) {
        const v = input.value;
        if (v === (a.text || "")) return;
        a.text = v;
      } else {
        const v = input.value.trim();
        if (!v || v === a.name) return;
        a.name = v;
      }
      await saveTemplateFn();
      flashSaved(input);
    });
    if (!a.isNote) input?.addEventListener("input", () => autoResizeTextarea(input));
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
      const body = $("manage-modal-body");
      const starterInput = body.querySelector(`.mn-act-starter-text[data-idx="${idx}"]`);
      const optsInput    = body.querySelector(`.mn-act-inline-opts[data-idx="${idx}"]`);
      const type = sel.value;
      acts[idx].sentenceStarter = null;
      acts[idx].remarkPresetId  = null;
      acts[idx].inlineOptions   = null;
      acts[idx].optionsMulti    = (type === "fixed_multi" || type === "starter_fixed_multi");
      acts[idx].isMastery       = (type === "mastery");
      starterInput.style.display = (type === "starter" || type === "starter_fixed" || type === "starter_fixed_multi") ? "" : "none";
      optsInput.style.display    = (type === "fixed" || type === "fixed_multi" || type === "starter_fixed" || type === "starter_fixed_multi") ? "" : "none";
      if (type === "starter" || type === "starter_fixed" || type === "starter_fixed_multi") { starterInput.focus(); }
      else if (type === "fixed" || type === "fixed_multi") { optsInput.focus(); }
      else { template.predefinedActivities = acts; await saveTemplateFn(); }
    });
  });

  $("manage-modal-body").querySelectorAll(".mn-act-starter-text").forEach(input => {
    input.addEventListener("blur", async () => {
      const idx = Number(input.dataset.idx);
      acts[idx].sentenceStarter = input.value.trim() || null;
      template.predefinedActivities = acts;
      await saveTemplateFn();
    });
  });

  $("manage-modal-body").querySelectorAll(".mn-act-inline-opts").forEach(input => {
    input.addEventListener("blur", async () => {
      const idx = Number(input.dataset.idx);
      acts[idx].inlineOptions  = input.value.trim() || null;
      acts[idx].remarkPresetId = null;
      template.predefinedActivities = acts;
      await saveTemplateFn();
    });
  });

  $("btn-mn-done-template").addEventListener("click", closeManageModal);

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

// ============================================================
// GROUP SESSIONS
// ============================================================

// ── Choice modal ─────────────────────────────────────────────
function showGroupChoice(group) {
  $("session-picker-title").textContent = group.name;
  $("session-picker-list").innerHTML = `
    <div class="choice-list">
      <button class="choice-btn choice-today">
        <span class="choice-icon">▶</span>
        <div class="choice-text"><div class="choice-label">Start Session</div></div>
      </button>
      <button class="choice-btn choice-other">
        <span class="choice-icon">🗂</span>
        <div class="choice-text"><div class="choice-label">View/Edit Past Sessions</div></div>
      </button>
      <button class="choice-btn choice-manage">
        <span class="choice-icon">✏</span>
        <div class="choice-text"><div class="choice-label">Manage Group</div></div>
      </button>
    </div>`;
  $("session-picker-modal").classList.remove("hidden");

  const today = getTodayString();
  $("session-picker-list").querySelector(".choice-today").addEventListener("click", () => {
    const yesterday = (() => {
      const d = new Date(today + "T00:00:00"); d.setDate(d.getDate() - 1);
      const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    })();
    const fmtShort = d => {
      const [, m, day] = d.split("-");
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return `${+day} ${months[+m - 1]}`;
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
        showGroupAttendancePicker(group, btn.dataset.date);
      });
    });
    $("session-picker-list").querySelector(".btn-date-other").addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "date"; input.max = today;
      input.style.cssText = "position:fixed;opacity:0;top:0;left:0;width:1px;height:1px;";
      document.body.appendChild(input);
      const cleanup = () => { if (document.body.contains(input)) document.body.removeChild(input); };
      input.addEventListener("change", () => {
        const d = input.value; cleanup();
        if (!d) return;
        closeSessionPicker();
        showGroupAttendancePicker(group, d);
      });
      input.addEventListener("blur", () => setTimeout(cleanup, 500));
      try { input.showPicker(); } catch (_) { input.click(); }
    });
  });
  $("session-picker-list").querySelector(".choice-other").addEventListener("click", () => {
    closeSessionPicker();
    showGroupSessionPicker(group);
  });
  $("session-picker-list").querySelector(".choice-manage").addEventListener("click", () => {
    closeSessionPicker();
    openGroupManageModal(group);
  });
}

// ── Attendance picker ────────────────────────────────────────
function showGroupAttendancePicker(group, dateStr) {
  if (!group.students?.length) {
    alert("No students in this group. Add students first under Manage Group.");
    return;
  }
  $("session-picker-title").textContent = "Attendance List";
  const checkboxHtml = group.students.map((s, i) =>
    `<label class="attendance-row">
       <input type="checkbox" class="attendance-chk" data-idx="${i}" checked />
       <span>${escHtml(s)}</span>
     </label>`
  ).join("");
  $("session-picker-list").innerHTML = `
    <div class="attendance-sheet">
      <p class="attendance-date">${formatDate(dateStr)}</p>
      <div class="attendance-list">${checkboxHtml}</div>
      <button class="btn-primary attendance-start-btn">Start Session →</button>
    </div>`;
  $("session-picker-modal").classList.remove("hidden");

  $("session-picker-list").querySelector(".attendance-start-btn").addEventListener("click", () => {
    const attendees = [...$("session-picker-list").querySelectorAll(".attendance-chk:checked")]
      .map(chk => group.students[Number(chk.dataset.idx)]);
    if (!attendees.length) { alert("Select at least one student."); return; }
    closeSessionPicker();
    openGroupSession(group, dateStr, attendees);
  });
}

// ── Open group session ───────────────────────────────────────
async function openGroupSession(group, dateStr, attendees) {
  if (state.fbGroupUnsubscribe) { state.fbGroupUnsubscribe(); state.fbGroupUnsubscribe = null; }
  state.currentGroup            = group;
  state.groupAttendees          = attendees;
  state.groupSessionId          = null;
  state.groupSessionData        = null;
  state.selectedGroupTargetName = null;
  state.groupRenderPending      = false;

  showScreen("screen-group-session");
  $("group-session-name").textContent = group.name;
  $("group-target-content").innerHTML = `<div class="loading">Loading…</div>`;

  try {
    const sid = await getOrCreateGroupSessionForDate(group.id, dateStr, group.targets, attendees);
    state.groupSessionId = sid;
    let firstLoad = true;
    state.fbGroupUnsubscribe = listenToSession(sid, async data => {
      state.groupSessionData = data;
      renderGroupSessionHeader(data);
      if (firstLoad) {
        firstLoad = false;
        state.selectedGroupTargetName = state.selectedGroupTargetName || group.targets.sort((a,b)=>a.name.localeCompare(b.name))[0]?.name || null;
        populateGroupTargetDropdown(group.targets);
        if (state.selectedGroupTargetName) {
          const filled = await autoFillGroupSession(group, sid, data, state.selectedGroupTargetName, attendees);
          if (filled > 0) return;
        }
      }
      if (state.scorePicker?.open && state.scorePicker?.isGroup) renderScoreModalTrials(state.scorePicker.remId);
      if (state.groupRenderPending && document.activeElement?.isContentEditable) {
        state.groupRenderPending = true;
        return;
      }
      state.groupRenderPending = false;
      renderGroupTargetContent();
    });
  } catch (err) {
    alert("Error opening session: " + err.message);
    showHome();
  }
}

function renderGroupSessionHeader(data) {
  if (!data) return;
  $("group-session-meta").textContent =
    `Session ${data.sessionNumber} of ${(data.month || "").split(" ")[0]} · ${formatDate(data.date)}`;
}

function populateGroupTargetDropdown(targets) {
  const sel = $("group-target-select");
  if (!sel) return;
  const sorted = [...targets].sort((a, b) => a.name.localeCompare(b.name));
  const placeholder = sorted.length === 0
    ? `<option value="" disabled selected>— no targets yet —</option>` : "";
  sel.innerHTML = placeholder +
    sorted.map(t =>
      `<option value="${escHtml(t.name)}"${t.name === state.selectedGroupTargetName ? " selected" : ""}>${escHtml(t.name)}</option>`
    ).join("") +
    `<option value="__add_target__">+ Add Target…</option>`;

  const manageBtn = $("btn-group-manage-targets");
  if (manageBtn) manageBtn.classList.toggle("hidden", !state.selectedGroupTargetName);

  // Wire change handler — same pattern as individual session's populateTargetDropdown
  sel.onchange = async () => {
    if (sel.value === "__add_target__") {
      sel.value = state.selectedGroupTargetName || "";
      const group = state.currentGroup;
      if (group) showGroupAddTargetPicker(group);
      return;
    }
    const prevTarget = state.selectedGroupTargetName;
    state.selectedGroupTargetName = sel.value || null;
    if (prevTarget && prevTarget !== sel.value) {
      // cleanup empty entries for prev target (fire-and-forget)
    }
    if (!state.selectedGroupTargetName) { renderGroupTargetContent(); return; }
    const data = state.groupSessionData;
    if (data) {
      const filled = await autoFillGroupSession(
        state.currentGroup, state.groupSessionId, data,
        state.selectedGroupTargetName, state.groupAttendees
      );
      if (filled > 0) return;
    }
    renderGroupTargetContent();
  };
}

// ── Auto-fill activity + remark stubs for predefined activities ──
async function autoFillGroupSession(group, sessionId, data, targetName, attendees) {
  const target = group.targets.find(t => t.name === targetName);
  if (!target) return 0;
  let created = 0;
  const predefined = (target.predefinedActivities || []).filter(pa => !pa.isHeading && !pa.isNote);
  for (const pa of predefined) {
    let actId = Object.entries(data.activities || {})
      .find(([, a]) => a.targetName === targetName && a.activityName === pa.name)?.[0];
    if (!actId) {
      actId = await addActivity(sessionId, targetName, pa.name, Date.now(), true);
      created++;
    }
    for (const studentName of attendees) {
      const hasRemark = Object.values(data.remarks || {})
        .some(r => r.activityId === actId && r.studentName === studentName);
      if (!hasRemark) {
        await addGroupRemark(sessionId, actId, studentName);
        created++;
      }
    }
  }
  return created;
}

function leaveGroupSession() {
  commitTextEditorSheet();
  $("text-editor-sheet").classList.add("hidden");
  if (state.fbGroupUnsubscribe) { state.fbGroupUnsubscribe(); state.fbGroupUnsubscribe = null; }
  const sessionId = state.groupSessionId;
  const data      = state.groupSessionData;
  state.currentGroup            = null;
  state.groupSessionId          = null;
  state.groupSessionData        = null;
  state.groupAttendees          = [];
  state.groupRenderPending      = false;
  state.selectedGroupTargetName = null;

  if (sessionId && data) {
    // Delete if no useful data
    const hasData = Object.values(data.remarks || {}).some(r => {
      const strip = s => (s || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
      return strip(r.text).length > 0 || (r.trials || []).some(t => t !== -1);
    });
    if (!hasData) deleteSession(sessionId).catch(() => {});
  }
  showHome();
}

$("btn-group-back").addEventListener("click", leaveGroupSession);

// ── Render group target content ──────────────────────────────
function renderGroupTargetContent() {
  const content = $("group-target-content");
  if (!content) return;
  const group   = state.currentGroup;
  const data    = state.groupSessionData;
  const target  = group?.targets.find(t => t.name === state.selectedGroupTargetName);
  if (!target || !data) {
    content.innerHTML = `<p class="empty-hint" style="padding:2rem;text-align:center">No targets added yet. Use the dropdown above to add one.</p>`;
    updateGroupAvgChips(null, null);
    return;
  }

  const attendees = state.groupAttendees;
  const predefined = (target.predefinedActivities || []).filter(pa => !pa.isHeading && !pa.isNote);

  // Build activity list: predefined first, then manually added
  const activityCards = [];
  for (const pa of predefined) {
    const actId = Object.entries(data.activities || {})
      .find(([, a]) => a.targetName === target.name && a.activityName === pa.name)?.[0] || null;
    activityCards.push(renderGroupActivityCard(pa.name, actId, target, data, attendees));
  }
  // Manually added (non-predefined) activities
  Object.entries(data.activities || {})
    .filter(([, a]) => a.targetName === target.name && !a.isPredefined)
    .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0))
    .forEach(([actId, act]) => {
      activityCards.push(renderGroupActivityCard(act.activityName, actId, target, data, attendees));
    });

  if (activityCards.length === 0) {
    content.innerHTML = `<p class="empty-hint" style="padding:1.5rem">No activities yet. Add them under Edit Target.</p>`;
  } else {
    content.innerHTML = activityCards.join("");
  }

  updateGroupAvgChips(target, data);
  attachGroupTargetListeners(target);
}

function renderGroupActivityCard(actName, actId, target, data, attendees) {
  let rows = "";
  for (const studentName of attendees) {
    const rems = actId
      ? Object.entries(data.remarks || {}).filter(([, r]) => r.activityId === actId && r.studentName === studentName)
      : [];
    if (rems.length > 0) {
      for (const [remId, rem] of rems) {
        rows += renderGroupStudentRow(studentName, remId, rem, target);
      }
    } else {
      rows += renderGroupStudentPendingRow(studentName, actId, actName, target);
    }
  }
  return `<div class="group-activity-card" data-act-name="${escHtml(actName)}" data-act-id="${escHtml(actId || "")}">
    <div class="group-activity-header">${escHtml(actName)}</div>
    <div class="group-student-rows">${rows}</div>
  </div>`;
}

function renderGroupStudentRow(studentName, remId, rem, target) {
  const trials  = rem.trials || [];
  const maxPts  = target.maxPoints || 3;
  const valid   = trials.filter(t => t !== -1);
  const score   = valid.length > 0
    ? Math.round(valid.reduce((a, b) => a + b, 0) / (valid.length * maxPts) * 100) + "%" : "";
  const badges  = trials.map((t, i) =>
    `<span class="trial-badge">${t === -1 ? "—" : t}<button class="btn-trial-delete btn-group-trial-del" data-rem-id="${remId}" data-idx="${i}">×</button></span>`
  ).join("");
  return `<div class="group-student-row" data-rem-id="${remId}" data-student="${escHtml(studentName)}">
    <span class="group-student-label">${escHtml(studentName)}</span>
    <div class="group-remark-area">
      <button class="btn-sketch btn-group-sketch" data-rem-id="${remId}" aria-label="Sketch board">✏</button>
      <div class="field-input group-remark-input" contenteditable="true"
        data-rem-id="${remId}" data-placeholder="Remark…">${remarkToHtml(rem.text)}</div>
    </div>
    <div class="group-trial-area">
      <div class="trials-badges">${badges}</div>
      <button class="btn-add-trial btn-primary-sm btn-group-add-trial"
        data-rem-id="${remId}" data-target="${escHtml(target.name)}">+ Trial</button>
    </div>
    <span class="group-student-score">${score}</span>
  </div>`;
}

function renderGroupStudentPendingRow(studentName, actId, actName, target) {
  return `<div class="group-student-row group-student-pending"
    data-student="${escHtml(studentName)}"
    data-act-id="${escHtml(actId || "")}"
    data-act-name="${escHtml(actName)}"
    data-target="${escHtml(target.name)}">
    <span class="group-student-label">${escHtml(studentName)}</span>
    <div class="group-remark-area">
      <button class="btn-sketch btn-group-sketch-pending"
        data-student="${escHtml(studentName)}"
        data-act-id="${escHtml(actId || "")}"
        data-act-name="${escHtml(actName)}"
        data-target="${escHtml(target.name)}"
        aria-label="Sketch board">✏</button>
      <div class="field-input group-remark-input group-pending-remark"
        contenteditable="true"
        data-student="${escHtml(studentName)}"
        data-act-id="${escHtml(actId || "")}"
        data-act-name="${escHtml(actName)}"
        data-target="${escHtml(target.name)}"
        data-placeholder="Remark…"></div>
    </div>
    <div class="group-trial-area">
      <button class="btn-primary-sm btn-group-add-trial-pending"
        data-student="${escHtml(studentName)}"
        data-act-id="${escHtml(actId || "")}"
        data-act-name="${escHtml(actName)}"
        data-target="${escHtml(target.name)}">+ Trial</button>
    </div>
    <span class="group-student-score"></span>
  </div>`;
}

function updateGroupAvgChips(target, data) {
  const container = $("group-avg-chips");
  if (!container) return;
  const attendees = state.groupAttendees || [];
  if (!target || !data || !attendees.length) {
    container.innerHTML = attendees.map(name =>
      `<div class="days-average-chip">
        <span class="days-average-label">${escHtml(name)}'s Avg</span>
        <span class="days-average-value">—</span>
      </div>`
    ).join("");
    return;
  }
  const maxPts = target.maxPoints || 3;
  container.innerHTML = attendees.map(name => {
    const actIds = Object.entries(data.activities || {})
      .filter(([, a]) => a.targetName === target.name).map(([id]) => id);
    const valid = Object.values(data.remarks || {})
      .filter(r => actIds.includes(r.activityId) && r.studentName === name)
      .flatMap(r => (r.trials || []).filter(t => t !== -1));
    const avg = valid.length
      ? Math.round(valid.reduce((a, b) => a + b, 0) / (valid.length * maxPts) * 100) + "%"
      : "—";
    return `<div class="days-average-chip">
      <span class="days-average-label">${escHtml(name)}'s Avg</span>
      <span class="days-average-value">${avg}</span>
    </div>`;
  }).join("");
}

// ── Attach event listeners to the rendered group target content ──
function attachGroupTargetListeners(target) {
  const c = $("group-target-content");
  if (!c) return;

  // Target selector change
  const sel = $("group-target-select");
  // "Edit Target" button — re-wire each time (onchange handler is in populateGroupTargetDropdown)
  const manageBtn = $("btn-group-manage-targets");
  if (manageBtn) {
    manageBtn.onclick = () => {
      const tgt = state.currentGroup?.targets.find(t => t.name === state.selectedGroupTargetName);
      if (tgt) openGroupManageModal(state.currentGroup, tgt);
    };
  }

  // Remark blur-save (live rows)
  c.querySelectorAll(".group-remark-input:not(.group-pending-remark)").forEach(div => {
    let orig = div.innerHTML;
    div.addEventListener("blur", async () => {
      const newText = div.innerHTML;
      if (newText === orig) return;
      orig = newText;
      await updateRemarkText(state.groupSessionId, div.dataset.remId, newText);
    });
  });

  // Pending remark blur-save: create record when text is entered
  c.querySelectorAll(".group-pending-remark").forEach(div => {
    div.addEventListener("blur", async () => {
      const text = div.innerHTML;
      const strip = s => (s || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
      if (!strip(text)) return;
      const { actId, remId } = await ensureGroupActivityAndRemark(div);
      if (remId) await updateRemarkText(state.groupSessionId, remId, text);
    });
  });

  // Sketch board: live rows
  c.querySelectorAll(".btn-group-sketch").forEach(btn => {
    btn.addEventListener("click", () => {
      const field = c.querySelector(`.group-remark-input[data-rem-id="${btn.dataset.remId}"]`);
      if (field) openTextEditorSheet(field);
    });
  });

  // Sketch board: pending rows
  c.querySelectorAll(".btn-group-sketch-pending").forEach(btn => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".group-student-pending");
      if (!row) return;
      const pendingInput = row.querySelector(".group-pending-remark");
      if (pendingInput) openTextEditorSheet(pendingInput);
    });
  });

  // + Trial: live rows
  c.querySelectorAll(".btn-group-add-trial").forEach(btn => {
    btn.addEventListener("click", () => {
      const remId = btn.dataset.remId;
      state.scorePicker = { open: true, remId, isGroup: true };
      openScorePicker(remId, target);
    });
  });

  // + Trial: pending rows
  c.querySelectorAll(".btn-group-add-trial-pending").forEach(btn => {
    btn.addEventListener("click", async () => {
      const { remId } = await ensureGroupActivityAndRemark(btn);
      if (!remId) return;
      state.scorePicker = { open: true, remId, isGroup: true };
      openScorePicker(remId, target);
    });
  });

  // Delete trial badges
  c.querySelectorAll(".btn-group-trial-del").forEach(btn => {
    btn.addEventListener("click", async () => {
      const remId = btn.dataset.remId;
      const rem   = state.groupSessionData?.remarks?.[remId];
      if (!rem) return;
      const updated = (rem.trials || []).filter((_, i) => i !== Number(btn.dataset.idx));
      await setTrials(state.groupSessionId, remId, updated);
    });
  });
}

// Helper: ensure activity + remark exist in Firestore for a pending row element
async function ensureGroupActivityAndRemark(el) {
  const studentName = el.dataset.student;
  const actName     = el.dataset.actName;
  const targetName  = el.dataset.target;
  const data        = state.groupSessionData;

  let actId = el.dataset.actId || Object.entries(data.activities || {})
    .find(([, a]) => a.targetName === targetName && a.activityName === actName)?.[0] || null;
  if (!actId) {
    actId = await addActivity(state.groupSessionId, targetName, actName, Date.now(), true);
  }
  // Check again in case snapshot already has the remark
  const existing = Object.entries(data.remarks || {})
    .find(([, r]) => r.activityId === actId && r.studentName === studentName);
  if (existing) return { actId, remId: existing[0] };
  const remId = await addGroupRemark(state.groupSessionId, actId, studentName);
  return { actId, remId };
}

// ── Group session history ────────────────────────────────────
async function showGroupSessionPicker(group) {
  $("session-picker-title").textContent = group.name;
  $("session-picker-list").innerHTML = `<div class="session-picker-loading">Loading sessions…</div>`;
  $("session-picker-modal").classList.remove("hidden");

  let sessions = [];
  try { sessions = await getRecentGroupSessions(group.id); } catch (_) {}

  const byMonth = new Map();
  for (const s of sessions) {
    if (!byMonth.has(s.month)) byMonth.set(s.month, []);
    byMonth.get(s.month).push(s);
  }
  if (byMonth.size === 0) {
    $("session-picker-list").innerHTML = `<div class="session-picker-loading">No sessions found.</div>`;
    return;
  }
  renderGroupMonthGrid(group, byMonth);
}

function renderGroupMonthGrid(group, byMonth) {
  $("session-picker-title").textContent = group.name;
  let html = `<div class="month-grid">`;
  for (const month of byMonth.keys()) {
    const [name, year] = month.split(" ");
    html += `<button class="month-grid-btn" data-month="${escHtml(month)}">
      <span class="mgb-month">${escHtml(name.slice(0,3))}</span>
      <span class="mgb-year">${escHtml(year)}</span>
    </button>`;
  }
  html += `</div>`;
  $("session-picker-list").innerHTML = html;
  $("session-picker-list").querySelectorAll(".month-grid-btn").forEach(btn => {
    btn.addEventListener("click", () =>
      renderGroupSessionsForMonth(group, btn.dataset.month, byMonth.get(btn.dataset.month), byMonth)
    );
  });
}

function renderGroupSessionsForMonth(group, month, monthSessions, byMonth) {
  $("session-picker-title").textContent = month;
  const sorted  = [...monthSessions].sort((a, b) => a.date.localeCompare(b.date));
  const display = [...sorted].reverse();
  const today   = getTodayString();
  let html = `<button class="btn-picker-back">← Back</button>`;
  for (const s of display) {
    const num       = sorted.findIndex(x => x.id === s.id) + 1;
    const isToday   = s.date === today;
    const attendees = (s.attendees || []).join(", ");
    html += `<div class="session-list-item${isToday ? " session-list-today" : ""}" data-session-id="${s.id}">
      <div class="session-list-meta">
        <div class="session-list-label"><strong>Session ${num}</strong>: ${formatDate(s.date)}</div>
        ${attendees ? `<div class="session-list-date">${escHtml(attendees)}</div>` : ""}
      </div>
    </div>`;
  }
  $("session-picker-list").innerHTML = html;
  $("session-picker-list").querySelector(".btn-picker-back").addEventListener("click", () =>
    renderGroupMonthGrid(group, byMonth)
  );
  $("session-picker-list").querySelectorAll(".session-list-item").forEach(item => {
    item.addEventListener("click", () => {
      closeSessionPicker();
      // Reopen the group session for the chosen date
      const s = monthSessions.find(x => x.id === item.dataset.sessionId);
      if (s) openGroupSession(group, s.date, s.attendees || group.students);
    });
  });
}

// ── Group manage modal ───────────────────────────────────────
function openGroupManageModal(group, target = null) {
  $("manage-modal").classList.remove("hidden");
  if (target) {
    _groupForTargetEdit = group;
    renderTargetManageContent(group, target);
  } else {
    _groupForTargetEdit = null;
    renderGroupManageContent(group);
  }
}

function renderGroupManageContent(group) {
  $("manage-modal-title").textContent = group.name || "New Group";

  // 3 fixed student rows — always show exactly 3
  const studentRowsHtml = [0, 1, 2].map(i => `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.45rem">
      <span style="min-width:5.5rem;font-size:.85rem;font-weight:600;color:var(--text-muted)">Student ${i + 1}</span>
      <input class="admin-input mn-g-student-field" data-idx="${i}"
        value="${escHtml(group.students?.[i] || "")}"
        placeholder="Enter name…" style="flex:1" />
    </div>`).join("");

  $("manage-modal-body").innerHTML = `
    <div class="admin-section">
      <label class="admin-label">Group Name</label>
      <div class="admin-input" id="mn-g-name"
        style="min-height:2.8rem;display:flex;align-items:center;white-space:normal;
               color:${group.name ? "var(--text)" : "var(--text-muted)"};
               font-style:${group.name ? "normal" : "italic"};cursor:default;line-height:1.4">
        ${group.name
          ? escHtml(group.name)
          : "The group name is automatically set based on the student names entered below. Just fill in the students and this field will be filled automatically."}
      </div>
    </div>
    <div class="admin-section">
      <label class="admin-label">Students</label>
      ${studentRowsHtml}
    </div>
    <div style="margin-top:1.5rem;padding-bottom:.5rem;display:flex;flex-direction:column;gap:.6rem">
      <button class="btn-primary-sm" id="btn-mn-g-done"
        style="width:100%;padding:.75rem;font-size:1rem">Done</button>
      <button class="btn-adm-danger" id="btn-mn-del-group">Delete Group</button>
    </div>`;

  // Save student fields on blur — reads all 3 inputs, filters empty, updates group
  const saveStudents = async () => {
    const wasAuto = groupNameIsAuto(group);
    group.students = [...$("manage-modal-body").querySelectorAll(".mn-g-student-field")]
      .map(f => f.value.trim()).filter(Boolean);
    if (wasAuto) group.name = groupAutoName(group.students);
    if (group.students.length > 0) _newGroupId = null; // group is no longer empty
    const nameEl = $("mn-g-name");
    if (nameEl) {
      nameEl.textContent = group.name || "The group name is automatically set based on the student names entered below. Just fill in the students and this field will be filled automatically.";
      nameEl.style.color = group.name ? "var(--text)" : "var(--text-muted)";
      nameEl.style.fontStyle = group.name ? "normal" : "italic";
    }
    $("manage-modal-title").textContent = group.name || "New Group";
    const gi = state.groups.findIndex(g => g.id === group.id);
    if (gi >= 0) state.groups[gi] = group;
    await saveGroup(group);
    renderGroupButtons();
  };
  $("manage-modal-body").querySelectorAll(".mn-g-student-field").forEach(input => {
    input.addEventListener("blur", saveStudents);
    input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
  });

  // Done
  $("btn-mn-g-done").addEventListener("click", closeManageModal);

  // Delete group
  $("btn-mn-del-group").addEventListener("click", async () => {
    const typed = prompt(`Type DELETE to permanently delete the group "${group.name}":`);
    if (typed !== "DELETE") return;
    const gi = state.groups.findIndex(g => g.id === group.id);
    if (gi >= 0) state.groups.splice(gi, 1);
    await deleteGroup(group.id);
    closeManageModal();
  });
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
