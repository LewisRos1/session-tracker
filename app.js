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

  // pendingNewRemark: { pendingKey, actId, paName, paOrder } | null
  //   pendingKey = paName for FEDC, actId for regular
  //   actId      = Firebase actId (may be null for FEDC with no record yet)
  pendingNewRemark:   null,
  pendingNewActivity: null,   // { targetName } | null
  editingRemark:      null    // { remId } | null
};

const $ = id => document.getElementById(id);

// ─── INIT ────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Deferred render when any text input loses focus
  document.addEventListener("focusout", () => {
    if (state.renderPending) {
      state.renderPending = false;
      renderTargetContent();
    }
  });

  if (sessionStorage.getItem("auth") === "1") {
    state.authenticated = true;
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

// ─── SESSION PICKER ──────────────────────────────────────────

async function showSessionPicker(student) {
  $("session-picker-title").textContent = student.name;
  $("session-picker-list").innerHTML =
    `<div class="session-picker-loading">Loading sessions…</div>`;
  $("session-picker-modal").classList.remove("hidden");

  let sessions = [];
  try {
    sessions = await getRecentSessionsForStudent(student.id);
  } catch (_) {}

  const today      = getTodayString();
  const todaySess  = sessions.find(s => s.date === today);
  const pastSess   = sessions.filter(s => s.date !== today); // already newest-first

  let html = "";

  // Today row
  if (todaySess) {
    const badge      = todaySess.finished ? "Finished" : "In progress";
    const badgeClass = todaySess.finished ? "badge-finished" : "badge-inprogress";
    html += `<div class="session-list-item session-list-today"
      data-session-id="${todaySess.id}">
      <div class="session-list-meta">
        <div class="session-list-label">
          Session ${todaySess.sessionNumber} of ${todaySess.month.split(" ")[0]}
        </div>
        <div class="session-list-date">Today · ${formatDate(today)}</div>
      </div>
      <span class="session-list-badge ${badgeClass}">${badge}</span>
    </div>`;
  } else {
    html += `<div class="session-list-item session-list-today"
      data-new-session="true">
      <div class="session-list-meta">
        <div class="session-list-label">Start Today's Session</div>
        <div class="session-list-date">${formatDate(today)}</div>
      </div>
      <span class="session-list-badge badge-new">New</span>
    </div>`;
  }

  // Past sessions
  for (const s of pastSess) {
    const badge      = s.finished ? "Finished" : "Unfinished";
    const badgeClass = s.finished ? "badge-finished" : "badge-inprogress";
    html += `<div class="session-list-item"
      data-session-id="${s.id}">
      <div class="session-list-meta">
        <div class="session-list-label">
          Session ${s.sessionNumber} of ${s.month.split(" ")[0]}
        </div>
        <div class="session-list-date">${formatDate(s.date)}</div>
      </div>
      <span class="session-list-badge ${badgeClass}">${badge}</span>
    </div>`;
  }

  $("session-picker-list").innerHTML = html;

  $("session-picker-list").querySelectorAll(".session-list-item").forEach(item => {
    item.addEventListener("click", () => {
      closeSessionPicker();
      if (item.dataset.newSession) {
        openSession(student, null);       // create today's session
      } else {
        openSession(student, item.dataset.sessionId); // open existing
      }
    });
  });
}

function closeSessionPicker() {
  $("session-picker-modal").classList.add("hidden");
}

$("session-picker-close").addEventListener("click",    closeSessionPicker);
$("session-picker-backdrop").addEventListener("click", closeSessionPicker);

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
// SESSION SCREEN — OPEN / NAVIGATION
// ============================================================

// existingSessionId: pass a Firestore doc ID to open a past session,
// or null to create/open today's session.
async function openSession(student, existingSessionId = null) {
  state.currentStudent     = student;
  state.selectedTargetName = student.targets[0]?.name || null;
  state.sessionData        = null;
  state.pendingNewActivity = null;
  state.pendingNewRemark   = null;
  state.editingRemark      = null;
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
  state.editingRemark      = null;
  state.renderPending      = false;
  showHome();
}

// ─── SESSION HEADER ──────────────────────────────────────────

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

// ─── TARGET DROPDOWN ─────────────────────────────────────────
// Called once per openSession; uses onchange to avoid listener accumulation.
function populateTargetDropdown(targets) {
  const sel = $("target-select");
  sel.innerHTML = targets.map(t =>
    `<option value="${escHtml(t.name)}">${escHtml(t.name)}</option>`
  ).join("");
  sel.value = state.selectedTargetName || targets[0]?.name || "";

  // Replace (not add) listener
  sel.onchange = () => {
    state.selectedTargetName = sel.value;
    state.pendingNewActivity = null;
    state.pendingNewRemark   = null;
    state.editingRemark      = null;
    renderTargetContent();
  };
}

// ─── BACK & FINISH BUTTONS (attached once on module load) ────
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

    // pendingKey for FEDC = predefined activity name
    const pendingKey  = pa.name;
    const actData     = findActivityByName(target.name, pa.name);
    const actId       = actData ? actData.id : null;
    const isPending   = state.pendingNewRemark?.pendingKey === pendingKey;

    html += `<div class="activity-block fedc-activity">
      <div class="activity-name-row">
        <span class="activity-name">${escHtml(pa.name)}</span>
      </div>
      ${renderRemarksList(actId, pendingKey, target)}
      ${!isPending ? `<button class="btn-add-remark"
        data-pending-key="${escHtml(pendingKey)}"
        data-act-id="${actId || ""}"
        data-pa-name="${escHtml(pa.name)}"
        data-pa-order="${idx}"
        data-target="${escHtml(target.name)}">+ Add Remark</button>` : ""}
    </div>`;
  });

  // FEDC free-text Comment field
  if (target.hasComment) {
    const commentKey  = sanitizeKey(target.name);
    const commentText = (state.sessionData.fedcComments || {})[commentKey] || "";
    html += `<div class="fedc-comment-block">
      <label class="fedc-comment-label">Comment (no scoring)</label>
      <textarea class="fedc-comment-input"
        data-target="${escHtml(target.name)}"
        placeholder="Free-text comment…">${escHtml(commentText)}</textarea>
    </div>`;
  }

  return html;
}

// ─── REGULAR TARGET ──────────────────────────────────────────

function renderRegularTarget(target) {
  const activities = getActivitiesForTarget(target.name);
  let html = "";

  if (state.pendingNewActivity?.targetName === target.name) {
    html += `<div class="add-activity-row">
      <input id="new-activity-input" class="new-activity-input"
        type="text" placeholder="Activity name…" maxlength="200" />
      <button class="btn-confirm-activity" id="btn-confirm-activity">Add</button>
      <button class="btn-cancel-plain" id="btn-cancel-new-activity">Cancel</button>
    </div>`;
  } else {
    html += `<button class="btn-add-activity" data-target="${escHtml(target.name)}">
      + Add Activity</button>`;
  }

  for (const act of activities) {
    const pendingKey = act.id;   // pendingKey for regular = actId
    const isPending  = state.pendingNewRemark?.pendingKey === pendingKey;

    html += `<div class="activity-block" data-act-id="${act.id}">
      <div class="activity-name-row">
        <span class="activity-name">${escHtml(act.activityName)}</span>
        <div class="activity-actions">
          <button class="btn-icon btn-delete-activity"
            data-act-id="${act.id}" title="Delete activity">🗑</button>
        </div>
      </div>
      ${renderRemarksList(act.id, pendingKey, target)}
      ${!isPending ? `<button class="btn-add-remark"
        data-pending-key="${escHtml(pendingKey)}"
        data-act-id="${act.id}"
        data-target="${escHtml(target.name)}">+ Add Remark</button>` : ""}
    </div>`;
  }

  return html;
}

// ─── REMARKS LIST ────────────────────────────────────────────

// actId    = Firebase actId (null if FEDC activity not yet in Firebase)
// pendingKey = key to match pending remark input (paName for FEDC, actId for regular)
function renderRemarksList(actId, pendingKey, target) {
  const remarks = actId ? getRemarksForActivity(actId) : [];

  let html = `<div class="remarks-list">`;
  for (const rem of remarks) {
    html += renderRemarkItem(rem, actId, target);
  }
  html += renderPendingInput(pendingKey, actId, target);
  html += `</div>`;
  return html;
}

function renderPendingInput(pendingKey, actId, target) {
  if (state.pendingNewRemark?.pendingKey !== pendingKey) return "";
  const p = state.pendingNewRemark;
  return `<div class="pending-remark-row">
    <textarea id="new-remark-textarea" class="remark-textarea"
      placeholder="Type remark…" rows="2"></textarea>
    <div class="pending-remark-actions">
      <button class="btn-save-remark btn-primary-sm"
        data-act-id="${actId || ""}"
        data-pa-name="${escHtml(p.paName || "")}"
        data-pa-order="${p.paOrder ?? ""}"
        data-target="${escHtml(target.name)}">Save</button>
      <button class="btn-cancel-plain btn-cancel-remark">Cancel</button>
    </div>
  </div>`;
}

function renderRemarkItem(rem, actId, target) {
  const isEditing = state.editingRemark?.remId === rem.id;
  const trials    = rem.trials || [];

  const textHtml = isEditing
    ? `<textarea class="remark-textarea remark-edit-textarea"
        data-rem-id="${rem.id}" rows="2">${escHtml(rem.text || "")}</textarea>
       <div class="pending-remark-actions">
         <button class="btn-save-edit btn-primary-sm" data-rem-id="${rem.id}">Save</button>
         <button class="btn-cancel-plain btn-cancel-edit" data-rem-id="${rem.id}">Cancel</button>
       </div>`
    : `<span class="remark-text">${escHtml(rem.text || "(empty)")}</span>
       <button class="btn-icon btn-edit-remark" data-rem-id="${rem.id}" title="Edit">✏</button>
       <button class="btn-icon btn-delete-remark" data-rem-id="${rem.id}" title="Delete">🗑</button>`;

  const trialsHtml = trials.map((score, idx) =>
    `<span class="trial-badge">${score}<button class="btn-trial-delete"
      data-rem-id="${rem.id}" data-idx="${idx}" title="Remove">×</button></span>`
  ).join("");

  return `<div class="remark-item" data-rem-id="${rem.id}">
    <div class="remark-text-row">${textHtml}</div>
    <div class="trials-row">
      <div class="trials-chips">${trialsHtml}</div>
      <button class="btn-add-trial btn-primary-sm"
        data-rem-id="${rem.id}"
        data-target="${escHtml(target.name)}">+ Trial</button>
    </div>
  </div>`;
}

// ─── ATTACH LISTENERS AFTER RENDER ───────────────────────────

function attachTargetListeners(target) {
  const c = $("target-content");

  // ── Add Activity (regular targets) ───────────────────────
  c.querySelector(".btn-add-activity")?.addEventListener("click", () => {
    state.pendingNewActivity = { targetName: target.name };
    state.pendingNewRemark   = null;
    renderTargetContent();
    setTimeout(() => $("new-activity-input")?.focus(), 50);
  });
  $("btn-confirm-activity")?.addEventListener("click", () => confirmNewActivity(target));
  $("new-activity-input")?.addEventListener("keydown", e => {
    if (e.key === "Enter")  confirmNewActivity(target);
    if (e.key === "Escape") cancelPendingActivity();
  });
  $("btn-cancel-new-activity")?.addEventListener("click", cancelPendingActivity);

  // ── Delete Activity ───────────────────────────────────────
  c.querySelectorAll(".btn-delete-activity").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this activity and all its remarks?")) return;
      const remIds = getRemarksForActivity(btn.dataset.actId).map(r => r.id);
      await deleteActivity(state.currentSessionId, btn.dataset.actId, remIds);
    });
  });

  // ── Add Remark ────────────────────────────────────────────
  c.querySelectorAll(".btn-add-remark").forEach(btn => {
    btn.addEventListener("click", () => {
      state.pendingNewRemark = {
        pendingKey: btn.dataset.pendingKey,
        actId:      btn.dataset.actId || null,
        paName:     btn.dataset.paName || null,
        paOrder:    btn.dataset.paOrder !== undefined ? Number(btn.dataset.paOrder) : null
      };
      state.pendingNewActivity = null;
      renderTargetContent();
      setTimeout(() => $("new-remark-textarea")?.focus(), 50);
    });
  });

  // ── Save New Remark ───────────────────────────────────────
  c.querySelectorAll(".btn-save-remark").forEach(btn => {
    btn.addEventListener("click", () => saveNewRemark(btn, target));
  });

  // ── Cancel New Remark ─────────────────────────────────────
  c.querySelectorAll(".btn-cancel-remark").forEach(btn => {
    btn.addEventListener("click", () => {
      state.pendingNewRemark = null;
      renderTargetContent();
    });
  });

  // ── Edit Remark ───────────────────────────────────────────
  c.querySelectorAll(".btn-edit-remark").forEach(btn => {
    btn.addEventListener("click", () => {
      state.editingRemark    = { remId: btn.dataset.remId };
      state.pendingNewRemark = null;
      renderTargetContent();
      setTimeout(() => {
        const ta = c.querySelector(`.remark-edit-textarea[data-rem-id="${btn.dataset.remId}"]`);
        if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
      }, 50);
    });
  });

  // ── Save Edited Remark ────────────────────────────────────
  c.querySelectorAll(".btn-save-edit").forEach(btn => {
    btn.addEventListener("click", async () => {
      const remId = btn.dataset.remId;
      const ta    = c.querySelector(`.remark-edit-textarea[data-rem-id="${remId}"]`);
      if (!ta) return;
      await updateRemarkText(state.currentSessionId, remId, ta.value.trim());
      state.editingRemark = null;
    });
  });

  // ── Cancel Edit ───────────────────────────────────────────
  c.querySelectorAll(".btn-cancel-edit").forEach(btn => {
    btn.addEventListener("click", () => {
      state.editingRemark = null;
      renderTargetContent();
    });
  });

  // ── Delete Remark ─────────────────────────────────────────
  c.querySelectorAll(".btn-delete-remark").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this remark and its trials?")) return;
      await deleteRemark(state.currentSessionId, btn.dataset.remId);
    });
  });

  // ── Add Trial ─────────────────────────────────────────────
  c.querySelectorAll(".btn-add-trial").forEach(btn => {
    btn.addEventListener("click", () => {
      const tgt = state.currentStudent.targets.find(t => t.name === btn.dataset.target);
      openScorePicker(btn.dataset.remId, tgt?.maxPoints || 3);
    });
  });

  // ── Delete Trial ──────────────────────────────────────────
  c.querySelectorAll(".btn-trial-delete").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.stopPropagation();
      const rem = state.sessionData?.remarks?.[btn.dataset.remId];
      if (!rem) return;
      await deleteTrial(state.currentSessionId, btn.dataset.remId,
        Number(btn.dataset.idx), rem.trials || []);
    });
  });

  // ── FEDC Comment (debounced auto-save) ────────────────────
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
  const text = ta.value.trim();
  if (!text) { ta.focus(); return; }

  const paName  = btn.dataset.paName  || null;
  const paOrder = btn.dataset.paOrder !== undefined ? Number(btn.dataset.paOrder) : null;
  let   actId   = btn.dataset.actId   || null;

  // For FEDC: ensure the activity record exists in Firebase before adding remark
  if (paName) {
    actId = await ensureFedcActivity(target.name, paName, paOrder ?? 0);
  }

  if (!actId) return;
  state.pendingNewRemark = null;
  await addRemark(state.currentSessionId, actId, text);
}

// Guarantee a Firebase activity record exists for a predefined FEDC activity.
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
      const score = Number(btn.dataset.score);
      const rem   = state.sessionData?.remarks?.[remId];
      if (!rem) return;
      closeScorePicker();
      await addTrial(state.currentSessionId, remId, score, rem.trials || []);
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
