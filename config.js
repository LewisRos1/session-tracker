// ============================================================
// CONFIG.JS — Edit students, targets, and activities here.
// ============================================================

export const CONFIG = {

  PIN: "T7M2KP",

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
        {
          name: "Behaviours",
          maxPoints: 3,
          predefinedActivities: [
            { name: "Antecedent" },
            { name: "Behaviour" },
            { name: "Consequences" }
          ]
        },
        {
          name: "Practical Life",
          maxPoints: 3,
          predefinedActivities: [
            {
              name: "Eating Etiquette",
              note: [
                "Eat the food from the plate nicely",
                "Eat small spoonful one at a time",
                "Eat quietly",
                "Choose from three category of drinks: high, moderate, low calorie drinks"
              ]
            },
            {
              name: "Personal Hygiene",
              note: [
                "Shower",
                "Brush teeth",
                "Wash face",
                "Change clothes",
                "Use bathrobe",
                "Shower and change clothes after outing"
              ]
            },
            {
              name: "Packing for school",
              note: [
                "Check and sort stationery to take to school"
              ]
            },
            {
              name: "Social Skill in daily life",
              note: [
                "Use the social circle social story: Home, school and outdoor"
              ]
            },
            { name: "Social skills: Voice volume" },
            { name: "Practice an exercise routine" },
            { name: "Self-regulation by resting" },
            { name: "Grooming checklist after arrival at school" },
            { name: "Managing behaviours when class noise is loud" }
          ]
        },
        {
          name: "Grooming",
          maxPoints: 3,
          predefinedActivities: [
            { name: "Grooming" }
          ]
        },
        {
          name: "Community Trip",
          maxPoints: 3,
          predefinedActivities: [
            { name: "Community Trip" }
          ]
        },
        {
          name: "Self Management",
          maxPoints: 3,
          predefinedActivities: [
            {
              name: "Self Management",
              predefinedRemarks: [
                "Day Checklist",
                "Night Checklist",
                "Neat Hair",
                "Reward checklist",
                "Stationery checklist",
                "Voice volume",
                "On Task checklist",
                "Next Reward checklist"
              ]
            }
          ]
        },
        {
          name: "Social Skills",
          maxPoints: 3,
          predefinedActivities: [
            {
              name: "Listening responding to instructions respectfully",
              note: [
                "Leven do not show behaviours of aggression to show avoidance"
              ]
            },
            { name: "Social Circle" },
            { name: "Listening responding - SSJ" },
            { name: "Two way communication" },
            { name: "Social Detective" }
          ]
        },
        {
          name: "Flexible",
          maxPoints: 3,
          predefinedActivities: [
            { name: "Flexible Activity" }
          ]
        },
        {
          name: "Learning",
          maxPoints: 3,
          predefinedActivities: [
            { name: "Inference" },
            { name: "Read with Punctuation" },
            { name: "Oral Language" },
            { name: "Silent Reading - Point and read silently" }
          ]
        }
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
            { name: "Closeness",               group: "Demonstrate the following emotions" },
            { name: "Pleasure and Excitement", group: "Demonstrate the following emotions" },
            { name: "Assertive curiosity",     group: "Demonstrate the following emotions" },
            { name: "Protest or Anger",        group: "Demonstrate the following emotions" },
            { name: "Fear",                    group: "Demonstrate the following emotions" }
          ],
          hasComment: true
        },
        { name: "Play",        maxPoints: 3 },
        { name: "Behaviours",  maxPoints: 3 }
      ]
    }
  ]
};
