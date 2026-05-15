// ============================================================
// CONFIG.JS — App-wide constants + initial seed data for Firebase
// Student/target/activity config is stored in Firestore after first run.
// ============================================================

export const CONFIG = {

  PIN:       "T7M2KP",
  ADMIN_PIN: "FT3EJ2",

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

  // ─── Seed data ────────────────────────────────────────────
  // Written to Firebase once on first run (when students collection is empty).
  // After that, all edits happen through the Admin screen.
  INITIAL_STUDENTS: [
    {
      id: "liam", name: "Liam", order: 0,
      targets: [
        { id: "t_l1", name: "Ex. Function",           maxPoints: 3, order: 0, fullName: "", hasComment: false, predefinedActivities: [], notes: [] },
        { id: "t_l2", name: "SEL and Comm",            maxPoints: 3, order: 1, fullName: "", hasComment: false, predefinedActivities: [], notes: [] },
        { id: "t_l3", name: "Self R. and Engagement",  maxPoints: 3, order: 2, fullName: "", hasComment: false, predefinedActivities: [], notes: [] },
        { id: "t_l4", name: "Learning",                maxPoints: 3, order: 3, fullName: "", hasComment: false, predefinedActivities: [], notes: [] },
        { id: "t_l5", name: "Behaviours",              maxPoints: 3, order: 4, fullName: "", hasComment: false, predefinedActivities: [], notes: [] }
      ]
    },

    {
      id: "leven", name: "Leven", order: 1,
      targets: [
        {
          id: "t_lv1", name: "Behaviours", maxPoints: 3, order: 0, fullName: "", hasComment: false,
          predefinedActivities: [
            { id: "a_lv1_1", name: "Antecedent",   group: "", order: 0 },
            { id: "a_lv1_2", name: "Behaviour",    group: "", order: 1 },
            { id: "a_lv1_3", name: "Consequences", group: "", order: 2 }
          ],
          notes: []
        },
        {
          id: "t_lv2", name: "Practical Life", maxPoints: 3, order: 1, fullName: "", hasComment: false,
          predefinedActivities: [
            { id: "a_lv2_1",  name: "Eat the food from the plate nicely",                                  group: "Eating Etiquette",       order: 0  },
            { id: "a_lv2_2",  name: "Eat small spoonful one at a time",                                    group: "Eating Etiquette",       order: 1  },
            { id: "a_lv2_3",  name: "Eat quietly",                                                         group: "Eating Etiquette",       order: 2  },
            { id: "a_lv2_4",  name: "Choose from three category of drinks: high, moderate, low calorie",   group: "Eating Etiquette",       order: 3  },
            { id: "a_lv2_5",  name: "Shower",                                                              group: "Personal Hygiene",       order: 4  },
            { id: "a_lv2_6",  name: "Brush teeth",                                                         group: "Personal Hygiene",       order: 5  },
            { id: "a_lv2_7",  name: "Wash face",                                                           group: "Personal Hygiene",       order: 6  },
            { id: "a_lv2_8",  name: "Change clothes",                                                      group: "Personal Hygiene",       order: 7  },
            { id: "a_lv2_9",  name: "Use bathrobe",                                                        group: "Personal Hygiene",       order: 8  },
            { id: "a_lv2_10", name: "Shower and change clothes after outing",                              group: "Personal Hygiene",       order: 9  },
            { id: "a_lv2_11", name: "Check and sort stationery to take to school",                         group: "Packing for school",     order: 10 },
            { id: "a_lv2_12", name: "Use the social circle social story: Home, school and outdoor",        group: "Social Skill in daily life", order: 11 },
            { id: "a_lv2_13", name: "Social skills: Voice volume",                                         group: "",                       order: 12 },
            { id: "a_lv2_14", name: "Practice an exercise routine",                                        group: "",                       order: 13 },
            { id: "a_lv2_15", name: "Self-regulation by resting",                                          group: "",                       order: 14 },
            { id: "a_lv2_16", name: "Grooming checklist after arrival at school",                          group: "",                       order: 15 },
            { id: "a_lv2_17", name: "Managing behaviours when class noise is loud",                        group: "",                       order: 16 }
          ],
          notes: []
        },
        {
          id: "t_lv3", name: "Grooming", maxPoints: 3, order: 2, fullName: "", hasComment: false,
          predefinedActivities: [{ id: "a_lv3_1", name: "Grooming", group: "", order: 0 }],
          notes: []
        },
        {
          id: "t_lv4", name: "Community Trip", maxPoints: 3, order: 3, fullName: "", hasComment: false,
          predefinedActivities: [{ id: "a_lv4_1", name: "Community Trip", group: "", order: 0 }],
          notes: []
        },
        {
          id: "t_lv5", name: "Self Management", maxPoints: 3, order: 4, fullName: "", hasComment: false,
          predefinedActivities: [
            {
              id: "a_lv5_1", name: "Self Management", group: "", order: 0,
              predefinedRemarks: ["Day Checklist","Night Checklist","Neat Hair","Reward checklist","Stationery checklist","Voice volume","On Task checklist","Next Reward checklist"]
            }
          ],
          notes: []
        },
        {
          id: "t_lv6", name: "Social Skills", maxPoints: 3, order: 5, fullName: "", hasComment: false,
          predefinedActivities: [
            { id: "a_lv6_1", name: "Leven do not show behaviours of aggression to show avoidance", group: "Listening responding to instructions respectfully", order: 0 },
            { id: "a_lv6_2", name: "Social Circle",              group: "", order: 1 },
            { id: "a_lv6_3", name: "Listening responding - SSJ", group: "", order: 2 },
            { id: "a_lv6_4", name: "Two way communication",      group: "", order: 3 },
            { id: "a_lv6_5", name: "Social Detective",           group: "", order: 4 }
          ],
          notes: []
        },
        {
          id: "t_lv7", name: "Flexible", maxPoints: 3, order: 6, fullName: "", hasComment: false,
          predefinedActivities: [{ id: "a_lv7_1", name: "Flexible Activity", group: "", order: 0 }],
          notes: []
        },
        {
          id: "t_lv8", name: "Learning", maxPoints: 3, order: 7, fullName: "", hasComment: false,
          predefinedActivities: [
            { id: "a_lv8_1", name: "Inference",                            group: "", order: 0 },
            { id: "a_lv8_2", name: "Read with Punctuation",                group: "", order: 1 },
            { id: "a_lv8_3", name: "Oral Language",                        group: "", order: 2 },
            { id: "a_lv8_4", name: "Silent Reading - Point and read silently", group: "", order: 3 }
          ],
          notes: []
        }
      ]
    },

    {
      id: "zhangqipei", name: "Zhang QiPei", order: 2,
      targets: [
        {
          id: "t_zqp1", name: "FEDC 1", maxPoints: 3, order: 0,
          fullName: "Stage 1 — Shared Attention & Regulation", hasComment: true,
          predefinedActivities: [
            { id: "a_z1_1", name: "Shows interest in different sensations for 3+secs",    group: "", order: 0 },
            { id: "a_z1_2", name: "Remains calm and focused for 2+mins with your help",   group: "", order: 1 },
            { id: "a_z1_3", name: "Recovers from distress within 20mins",                 group: "", order: 2 },
            { id: "a_z1_4", name: "Shows interest in you (Not only inanimate object)",    group: "", order: 3 }
          ],
          notes: []
        },
        {
          id: "t_zqp2", name: "FEDC 2", maxPoints: 3, order: 1,
          fullName: "Stage 2 — Engagement & Relating", hasComment: true,
          predefinedActivities: [
            { id: "a_z2_1", name: "Responds to your overtures",                                         group: "", order: 0 },
            { id: "a_z2_2", name: "Responds to your overtures with obvious pleasure",                   group: "", order: 1 },
            { id: "a_z2_3", name: "Responds to your overtures with curiosity and assertive interest",   group: "", order: 2 },
            { id: "a_z2_4", name: "Anticipates an object that was shown then removed",                  group: "", order: 3 },
            { id: "a_z2_5", name: "Become displeased when you are unresponsive during play",            group: "", order: 4 },
            { id: "a_z2_6", name: "Protest and grows angry when frustrated",                            group: "", order: 5 },
            { id: "a_z2_7", name: "Recover from distress within 15mins with your help",                group: "", order: 6 }
          ],
          notes: []
        },
        {
          id: "t_zqp3", name: "FEDC 3", maxPoints: 3, order: 2,
          fullName: "Stage 3 — Purposeful Communication", hasComment: true,
          predefinedActivities: [
            { id: "a_z3_1", name: "Respond to your gestures with intentional gestures", group: "", order: 0 },
            { id: "a_z3_2", name: "Initiates interaction with you",                     group: "", order: 1 },
            { id: "a_z3_3", name: "Closeness",            group: "Demonstrate the following emotions", order: 2 },
            { id: "a_z3_4", name: "Pleasure and Excitement", group: "Demonstrate the following emotions", order: 3 },
            { id: "a_z3_5", name: "Assertive curiosity",  group: "Demonstrate the following emotions", order: 4 },
            { id: "a_z3_6", name: "Protest or Anger",     group: "Demonstrate the following emotions", order: 5 },
            { id: "a_z3_7", name: "Fear",                 group: "Demonstrate the following emotions", order: 6 }
          ],
          notes: []
        },
        { id: "t_zqp4", name: "Play",       maxPoints: 3, order: 3, fullName: "", hasComment: false, predefinedActivities: [], notes: [] },
        { id: "t_zqp5", name: "Behaviours", maxPoints: 3, order: 4, fullName: "", hasComment: false, predefinedActivities: [], notes: [] }
      ]
    }
  ]
};
