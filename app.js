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
  sanitizeKey,
  getTodayString
} from "./firebase-service.js";
import { exportStudentData } from "./export.js";

// ─── STATE ───────────────────────────────────────────────────
const state = {
  authenticated:      false,
  currentStudent:     null,
  currentSessionId:   null,
  sessionData:        null,
  selectedTargetName: null,
  fbUnsubscribe:      null,
  renderPending:      false,
  scorePicker:        { open: false, remId: null },
  pendingNewRemark:   null,   // { pendingKey, actId, paName, paOrder } | null
  pendingNewActivity: null    // { targetName } | null
};

const $ = id => document.getElementById(id);

// ─── INIT ────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("focusout", () => {
    if (state.renderPending) {
      state.renderPending = false;
      renderTargetContent();
    }
  });

  if (sessionStorage.getItem("auth") === "1") {
    showHome();
  } else {
    initPin();
  }

  registerServiceWorker();
});

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
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

function renderStudentButtons(unfinishedIds) {
  const container = $("student-buttons");
  container.innerHTML = CONFIG.STUDENTS.map(s => `
    <button class="student-btn" data-id="${s.id}">
      <span class="student-btn-name">${escHtml(s.name)}</span>
      ${unfinishedIds.has(s.id)
        ? `<span class="session-indicator" title="Unfinished session today"></span>`
        : ""}
    </button>
  `).join("");
  container.querySelectorAll(".student-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const student = CONFIG.STUDENTS.find(s => s.id === btn.dataset.id);
      if (student) showSessionPicker(student);
    });
  });
}

function renderExportButtons() {
  const container = $("export-buttons");
  container.innerHTML = CONFIG.STUDENTS.map(s => `
    <button class="export-btn" data-id="${s.id}">Export ${escHtml(s.name)}</button>
  `).join("");
  container.querySelectorAll(".export-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Generating…";
      try {
        await exportStudentData(btn.dataset.id);
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

async function showSessionPicker(student) {
  $("session-picker-title").textContent = student.name;
  $("session-picker-list").innerHTML =
    `<div class="session-picker-loading">Loading sessions…</div>`;
  $("session-picker-modal").classList.remove("hidden");

  let sessions = [];
  try { sessions = await getRecentSessionsForStudent(student.id); } catch (_) {}

  const today     = getTodayString();
  const todaySess = sessions.find(s => s.date === today);
  const pastSess  = sessions.filter(s => s.date !== today);

  let html = "";

  if (todaySess) {
    const badge      = todaySess.finished ? "Finished" : "In progress";
    const badgeClass = todaySess.finished ? "badge-finished" : "badge-inprogress";
    html += `<div class="session-list-item session-list-today" data-session-id="${todaySess.id}">
      <div class="session-list-meta">
        <div class="session-list-label">Session ${todaySess.sessionNumber} of ${todaySess.month.split(" ")[0]}</div>
        <div class="session-list-date">Today · ${formatDate(today)}</div>
      </div>
      <span class="session-list-badge ${badgeClass}">${badge}</span>
    </div>`;
  } else {
    html += `<div class="session-list-item session-list-today" data-new-session="true">
      <div class="session-list-meta">
        <div class="session-list-label">Start Today's Session</div>
        <div class="session-list-date">${formatDate(today)}</div>
      </div>
      <span class="session-list-badge badge-new">New</span>
    </div>`;
  }

  for (const s of pastSess) {
    const badge      = s.finished ? "Finished" : "Unfinished";
    const badgeClass = s.finished ? "badge-finished" : "badge-inprogress";
    html += `<div class="session-list-item" data-session-id="${s.id}">
      <div class="session-list-meta">
        <div class="session-list-label">Session ${s.sessionNumber} of ${s.month.split(" ")[0]}</div>
        <div class="session-list-date">${formatDate(s.date)}</div>
      </div>
      <span class="session-list-badge ${badgeClass}">${badge}</span>
    </div>`;
  }

  $("session-picker-list").innerHTML = html;
  $("session-picker-list").querySelectorAll(".session-list-item").forEach(item => {
    item.addEventListener("click", () => {
      closeSessionPicker();
      item.dataset.newSession
        ? openSession(student, null)
        : openSession(student, item.dataset.sessionId);
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
  $("session-date").textContent = "";
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
  $("session-meta").textContent = `Session ${d.sessionNumber} of ${d.month.split(" ")[0]}`;
  $("session-date").textContent = formatDate(d.date);
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
  container.innerHTML = target.predefinedActivities
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

    html += `</div>`;
  });

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
  const trialsHtml = trials.map((score, idx) =>
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
      <div class="trials-content">
        ${trialsHtml}
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
  if (!text) { ta.focus(); return; }

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
