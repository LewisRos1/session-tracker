// ============================================================
// CONFIG.JS — Edit students, targets, and activities here.
// No code changes needed for adding/removing targets or
// predefined activities — everything reads from this file.
// ============================================================

export const CONFIG = {

  PIN: "T7M2KP",

  // Score labels indexed by maxPoints value
  SCORE_LABELS: {
    3: {
      0: "Refuse to Engage",
      1: "Fully Prompt",
      2: "Partial Prompt",
      3: "Independent"
    },
    4: {
      0: "Refuse to Respond / Call Out",
      1: "Partial Prompted (Choice given)",
      2: "Prompted Response (Beyond 5s)",
      3: "Delayed Response (5s)",
      4: "Attempt Independently"
    }
  },

  // ─── STUDENTS ───────────────────────────────────────────
  // Each target:
  //   name        {string}  displayed name
  //   maxPoints   {3|4}     determines score labels
  //   fullName    {string?} subtitle shown for FEDC targets
  //   predefinedActivities {Array?}  makes this a FEDC-style target
  //     Each predefined activity: { name, group? }
  //     group = optional section heading shown above that activity
  //   hasComment  {bool?}   adds a free-text Comment field (no scoring)
  // ────────────────────────────────────────────────────────

  STUDENTS: [
    {
      id: "liam",
      name: "Liam",
      targets: [
        { name: "Ex. Function",            maxPoints: 3 },
        { name: "SEL and Comm",            maxPoints: 3 },
        { name: "Self R. and Engagement",  maxPoints: 3 },
        { name: "Learning",                maxPoints: 3 },
        { name: "Behaviours",              maxPoints: 3 }
      ]
    },

    {
      id: "leven",
      name: "Leven",
      targets: [
        { name: "Behaviours",       maxPoints: 3 },
        { name: "Practical Life",   maxPoints: 3 },
        { name: "Grooming",         maxPoints: 3 },
        { name: "Community Trip",   maxPoints: 3 },
        { name: "Self Management",  maxPoints: 3 },
        { name: "Social Skills",    maxPoints: 3 },
        { name: "Flexible",         maxPoints: 3 },
        { name: "Learning",         maxPoints: 3 }
      ]
    },

    {
      id: "zhangqipei",
      name: "Zhang QiPei",
      targets: [
        {
          name: "FEDC 1",
          maxPoints: 3,
          fullName: "Stage 1 — Shared Attention & Regulation",
          predefinedActivities: [
            { name: "Shows interest in different sensations for 3+secs" },
            { name: "Remains calm and focused for 2+mins with your help" },
            { name: "Recovers from distress within 20mins" },
            { name: "Shows interest in you (Not only inanimate object)" }
          ],
          hasComment: true
        },
        {
          name: "FEDC 2",
          maxPoints: 3,
          fullName: "Stage 2 — Engagement & Relating",
          predefinedActivities: [
            { name: "Responds to your overtures" },
            { name: "Responds to your overtures with obvious pleasure" },
            { name: "Responds to your overtures with curiosity and assertive interest" },
            { name: "Anticipates an object that was shown then removed" },
            { name: "Become displeased when you are unresponsive during play" },
            { name: "Protest and grows angry when frustrated" },
            { name: "Recover from distress within 15mins with your help" }
          ],
          hasComment: true
        },
        {
          name: "FEDC 3",
          maxPoints: 3,
          fullName: "Stage 3 — Purposeful Communication",
          predefinedActivities: [
            { name: "Respond to your gestures with intentional gestures" },
            { name: "Initiates interaction with you" },
            { name: "Closeness",            group: "Demonstrate the following emotions" },
            { name: "Pleasure and Excitement", group: "Demonstrate the following emotions" },
            { name: "Assertive curiosity",  group: "Demonstrate the following emotions" },
            { name: "Protest or Anger",     group: "Demonstrate the following emotions" },
            { name: "Fear",                 group: "Demonstrate the following emotions" }
          ],
          hasComment: true
        },
        { name: "Play",        maxPoints: 3 },
        { name: "Behaviours",  maxPoints: 3 }
      ]
    }
  ]
};
