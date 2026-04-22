// ============================================================
// FIREBASE-SERVICE.JS
// All Firestore read/write operations live here.
// Fill in the FIREBASE_CONFIG placeholders below after
// creating your Firebase project at console.firebase.google.com
// ============================================================

import { initializeApp }    from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
  onSnapshot,
  deleteField,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// ─── FIREBASE CONFIGURATION ────────────────────────────────
// Replace every "YOUR_..." placeholder with your project's values.
// Find these in: Firebase Console → Project Settings → Your apps → SDK setup
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAPcXOMAN-alX8y_PgCX5m-09iJwRgzzE0",
  authDomain:        "session-tracker-b663a.firebaseapp.com",
  projectId:         "session-tracker-b663a",
  storageBucket:     "session-tracker-b663a.firebasestorage.app",
  messagingSenderId: "1011584567383",
  appId:             "1:1011584567383:web:3eff4340c16260de977b12"
};
// ────────────────────────────────────────────────────────────

const app = initializeApp(FIREBASE_CONFIG);

// Enable offline persistence (IndexedDB cache)
const db = initializeFirestore(app, {
  localCache: persistentLocalCache()
});

// ─── ID GENERATOR ───────────────────────────────────────────
// Produces short alphanumeric IDs safe for Firestore field paths.
export function generateId(prefix = "id") {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─── DATE / MONTH HELPERS ────────────────────────────────────
export function getTodayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getMonthString(dateStr) {
  const [y, m] = dateStr.split("-");
  const months = ["January","February","March","April","May","June",
                  "July","August","September","October","November","December"];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
}

// Sanitise a string for use as a Firestore map key (no dots or special chars).
export function sanitizeKey(name) {
  return name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
}

// ─── SESSION MANAGEMENT ──────────────────────────────────────

/**
 * Returns the session document ID for today for this student.
 * Creates one if it does not exist yet, with correct session number.
 */
export async function getOrCreateTodaySession(studentId) {
  const today = getTodayString();
  const month = getMonthString(today);

  // Look for an existing session today
  const existingSnap = await getDocs(
    query(collection(db, "sessions"),
      where("studentId", "==", studentId),
      where("date", "==", today))
  );
  if (!existingSnap.empty) {
    return existingSnap.docs[0].id;
  }

  // Count distinct days already recorded this month → session number
  const monthSnap = await getDocs(
    query(collection(db, "sessions"),
      where("studentId", "==", studentId),
      where("month", "==", month))
  );
  const existingDates = new Set(monthSnap.docs.map(d => d.data().date));
  existingDates.add(today);
  const sessionNumber = [...existingDates].sort().indexOf(today) + 1;

  const ref = await addDoc(collection(db, "sessions"), {
    studentId,
    date: today,
    month,
    sessionNumber,
    finished: false,
    activities: {},
    remarks: {},
    fedcComments: {},
    createdAt: serverTimestamp()
  });
  return ref.id;
}

/**
 * Real-time listener for a session document.
 * Returns unsubscribe function.
 */
export function listenToSession(sessionId, callback) {
  return onSnapshot(doc(db, "sessions", sessionId), snap => {
    if (snap.exists()) callback(snap.data());
  });
}

/** Mark session as finished. */
export async function finishSession(sessionId) {
  await updateDoc(doc(db, "sessions", sessionId), { finished: true });
}

// ─── ACTIVITY OPERATIONS ─────────────────────────────────────

export async function addActivity(sessionId, targetName, activityName, order, isPredefined = false) {
  const actId = generateId("a");
  await updateDoc(doc(db, "sessions", sessionId), {
    [`activities.${actId}`]: { targetName, activityName, order, isPredefined }
  });
  return actId;
}

export async function deleteActivity(sessionId, actId, remarkIds) {
  const updates = { [`activities.${actId}`]: deleteField() };
  for (const remId of remarkIds) {
    updates[`remarks.${remId}`] = deleteField();
  }
  await updateDoc(doc(db, "sessions", sessionId), updates);
}

// ─── REMARK OPERATIONS ───────────────────────────────────────

export async function addRemark(sessionId, actId, text) {
  const remId = generateId("r");
  await updateDoc(doc(db, "sessions", sessionId), {
    [`remarks.${remId}`]: { activityId: actId, text, trials: [], order: Date.now() }
  });
  return remId;
}

export async function updateRemarkText(sessionId, remId, text) {
  await updateDoc(doc(db, "sessions", sessionId), {
    [`remarks.${remId}.text`]: text
  });
}

export async function updateActivityName(sessionId, actId, name) {
  await updateDoc(doc(db, "sessions", sessionId), {
    [`activities.${actId}.activityName`]: name
  });
}

export async function deleteRemark(sessionId, remId) {
  await updateDoc(doc(db, "sessions", sessionId), {
    [`remarks.${remId}`]: deleteField()
  });
}

// ─── TRIAL OPERATIONS ────────────────────────────────────────

export async function addTrial(sessionId, remId, score, currentTrials) {
  await updateDoc(doc(db, "sessions", sessionId), {
    [`remarks.${remId}.trials`]: [...currentTrials, score]
  });
}

export async function deleteTrial(sessionId, remId, trialIndex, currentTrials) {
  const updated = currentTrials.filter((_, i) => i !== trialIndex);
  await updateDoc(doc(db, "sessions", sessionId), {
    [`remarks.${remId}.trials`]: updated
  });
}

// ─── FEDC COMMENT ────────────────────────────────────────────

export async function updateFedcComment(sessionId, targetName, text) {
  const key = sanitizeKey(targetName);
  await updateDoc(doc(db, "sessions", sessionId), {
    [`fedcComments.${key}`]: text
  });
}

// ─── EXPORT DATA ─────────────────────────────────────────────

/** Fetch recent sessions for a student, newest-first (for session picker). */
export async function getRecentSessionsForStudent(studentId, maxCount = 60) {
  const snap = await getDocs(
    query(collection(db, "sessions"),
      where("studentId", "==", studentId),
      orderBy("date", "desc"),
      firestoreLimit(maxCount))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Fetch all sessions for a student, sorted oldest-first. */
export async function getAllSessionsForStudent(studentId) {
  const snap = await getDocs(
    query(collection(db, "sessions"),
      where("studentId", "==", studentId),
      orderBy("date", "asc"))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Fetch today's unfinished session IDs, keyed by studentId. */
export async function getTodayUnfinishedStudentIds() {
  const today = getTodayString();
  const snap = await getDocs(
    query(collection(db, "sessions"),
      where("date", "==", today),
      where("finished", "==", false))
  );
  return new Set(snap.docs.map(d => d.data().studentId));
}
