import type { DbState } from "./types";

/** Synthetic, unvalidated MAE demo scenario supplied for this prototype; no external records retrieved. */
export const fixtures: DbState = {
  "projects": [
    {
      "id": "prj-mobile",
      "name": "Meridian Mobile App — MVP journeys",
      "baseUrl": "Release 4.2 staging build",
      "owner": "Meridian mobile squad",
      "journeys": [
        {
          "name": "Onboarding",
          "steps": 12
        },
        {
          "name": "Dispute filing",
          "steps": 9
        }
      ],
      "platforms": [
        "Android",
        "iOS",
        "Web"
      ]
    }
  ],
  "scans": [
    {
      "id": "scn-2001",
      "projectId": "prj-mobile",
      "targetUrl": "Release 4.2 staging build",
      "scope": "Onboarding + Dispute filing, all three platforms",
      "status": "completed",
      "createdAt": "2026-10-19T10:00:00Z",
      "completedAt": "2026-10-19T10:00:00Z",
      "createdBy": "Demo scan worker",
      "engines": [
        "rule engine (WCAG 2.1 A/AA)",
        "screen-reader journey simulation (mock)",
        "signal mapping (mock)"
      ]
    }
  ],
  "scanJobs": [
    {
      "id": "job-2001",
      "scanId": "scn-2001",
      "status": "succeeded",
      "attempts": 1,
      "progress": 100,
      "updatedAt": "2026-10-19T10:00:00Z"
    }
  ],
  "findings": [
    {
      "id": "FND-0048",
      "scanId": "scn-2001",
      "ruleId": "FND-0048",
      "wcag": "1.3.1, 4.1.2, 2.4.3",
      "title": "OTP boxes unlabelled and focus jumps",
      "severity": "critical",
      "status": "in_review",
      "selector": "ONB-03-AND",
      "pageUrl": "Release 4.2 staging build",
      "createdAt": "2026-10-19T10:00:00Z",
      "goldenSetId": "FND-0048 / DEF-0048",
      "journey": "onboarding",
      "stepNo": 3,
      "stepName": "OTP entry",
      "platform": "android",
      "screenId": "ONB-03-AND",
      "findingType": "wcag_failure",
      "wcagCriteria": [
        "1.3.1",
        "4.1.2",
        "2.4.3"
      ],
      "wcagVersion": "WCAG 2.0, in 2.1 baseline",
      "conformanceLevel": "A",
      "baselineStatus": "in_baseline_2.1_AA",
      "confidence": "medium",
      "abstentionReason": null,
      "evidence": "Ungrouped digit boxes; focus returns to box 1 after each digit. Nodes n5–n10. Simulation traces TRC-003 and TRC-140: a TalkBack persona was stuck at step 3 (reason: otp_boxes_focus_jump).",
      "affectedUserNeed": "Enter a one-time code with a screen reader",
      "userImpact": "task_blocked",
      "affectedGroups": [
        "Screen-reader users"
      ],
      "recommendedFix": "Use one labelled OTP input or a group named \"OTP, 6 digits\" with \"Digit n of 6\" names; keep focus in place; support paste and auto-fill.",
      "fixRationale": "A stable, named OTP control allows assistive technology users to enter a code without losing their position.",
      "verificationSteps": "Enter the OTP with TalkBack and VoiceOver. Focus stays in place, group and digit names are announced, paste and auto-fill work.",
      "gateRecommendation": "recommend_block_pending_human",
      "requiresHumanReview": true,
      "escalateTo": "Accessibility specialist",
      "policySources": [
        {
          "id": "P020",
          "title": "WCAG 1.3.1 Info and Relationships (A)",
          "status": "verified"
        },
        {
          "id": "P031",
          "title": "WCAG 4.1.2 Name, Role, Value (A), 4.1.3 Status Messages (AA)",
          "status": "partially_verified"
        },
        {
          "id": "P024",
          "title": "WCAG 2.4.3 Focus Order (A)",
          "status": "verified"
        }
      ],
      "priorityScore": 63.0,
      "priorityBand": "P2",
      "nodeIds": [
        "n5",
        "n6",
        "n7",
        "n8",
        "n9",
        "n10"
      ],
      "simulationTrace": "Simulation traces TRC-003 and TRC-140: a TalkBack persona was stuck at step 3 (reason: otp_boxes_focus_jump)."
    },
    {
      "id": "FND-0020",
      "scanId": "scn-2001",
      "ruleId": "FND-0020",
      "wcag": "outside_wcag",
      "title": "Liveness check relies only on blinking",
      "severity": "critical",
      "status": "awaiting_compliance",
      "selector": "ONB-08-WEB",
      "pageUrl": "Release 4.2 staging build",
      "createdAt": "2026-10-19T10:00:00Z",
      "goldenSetId": "FND-0020 / DEF-0020",
      "journey": "onboarding",
      "stepNo": 8,
      "stepName": "Liveness",
      "platform": "web",
      "screenId": "ONB-08-WEB",
      "findingType": "banking_policy_violation",
      "wcagCriteria": null,
      "wcagVersion": null,
      "conformanceLevel": null,
      "baselineStatus": "outside_wcag",
      "confidence": "medium",
      "abstentionReason": "Legal or regulatory conclusion reserved for Compliance.",
      "evidence": "Liveness offers blink-only verification with no alternative.",
      "affectedUserNeed": "Complete identity verification with a disability",
      "userImpact": "task_blocked",
      "affectedGroups": [
        "Screen-reader users",
        "Low vision"
      ],
      "recommendedFix": "Add accessible alternatives (audio-guided or passive liveness, assisted verification) and tell users how to request them.",
      "fixRationale": "Alternative identity checks reduce exclusion; only Compliance can determine the applicable regulatory obligation.",
      "verificationSteps": "Compliance review against the RBI KYC Directions; test an accessible alternative with affected users.",
      "gateRecommendation": "escalate_to_compliance",
      "requiresHumanReview": true,
      "escalateTo": "Compliance",
      "policySources": [
        {
          "id": "P003",
          "title": "RBI KYC (2nd Amendment) Directions 2025, para 18(b)(i): \"The liveness check shall not result in exclusion of person with special needs.\"",
          "status": "verified"
        },
        {
          "id": "P001",
          "title": "Supreme Court, Pragya Prasun v. Union of India (30 Apr 2025)",
          "status": "partially_verified"
        },
        {
          "id": "P002",
          "title": "Supreme Court directions on liveness and nodal officers",
          "status": "unverified"
        }
      ],
      "priorityScore": 68.7,
      "priorityBand": "P2",
      "description": "The only liveness method is blinking on command, which excludes blind and low-vision users. This may conflict with RBI's 2025 KYC amendment; Compliance decides."
    },
    {
      "id": "FND-0067",
      "scanId": "scn-2001",
      "ruleId": "FND-0067",
      "wcag": "outside_wcag",
      "title": "Regulated declaration available only in English",
      "severity": "critical",
      "status": "awaiting_compliance",
      "selector": "DIS-05-IOS",
      "pageUrl": "Release 4.2 staging build",
      "createdAt": "2026-10-19T10:00:00Z",
      "goldenSetId": "FND-0067 / DEF-0067",
      "journey": "dispute_filing",
      "stepNo": 5,
      "stepName": "Declaration and consent",
      "platform": "ios",
      "screenId": "DIS-05-IOS",
      "findingType": "language_inclusion_issue",
      "wcagCriteria": null,
      "wcagVersion": null,
      "conformanceLevel": null,
      "baselineStatus": "outside_wcag",
      "confidence": "medium",
      "abstentionReason": "Legal or regulatory conclusion reserved for Compliance.",
      "evidence": "Content language detected: en only. Hindi and Tamil are required for regulated flows (proposed rule P047).",
      "affectedUserNeed": "Read regulated content in a preferred language",
      "userImpact": "task_blocked",
      "affectedGroups": [
        "Non-English preference"
      ],
      "recommendedFix": "Provide reviewed Hindi and Tamil versions before release. Translations need native-speaker and Compliance approval.",
      "fixRationale": "Reviewed translations make regulated content understandable; the proposed language rule is not established Meridian policy.",
      "verificationSteps": "Compliance confirms the language obligation; a reviewed translation is present and approved.",
      "gateRecommendation": "escalate_to_compliance",
      "requiresHumanReview": true,
      "escalateTo": "Compliance",
      "policySources": [
        {
          "id": "P013",
          "title": "RBI Key Facts Statement for loans",
          "status": "unverified"
        },
        {
          "id": "P014",
          "title": "DPDP notice-language provision",
          "status": "unverified"
        },
        {
          "id": "P047",
          "title": "Language coverage rule (proposed MAE rule)",
          "status": "proposed_internal"
        }
      ],
      "priorityScore": 89.1,
      "priorityBand": "P1",
      "extraNote": "MAE reports this gap. Closing it is the localisation workstream's job, not the agent's."
    },
    {
      "id": "FND-0099",
      "scanId": "scn-2001",
      "ruleId": "FND-0099",
      "wcag": "3.1.5",
      "title": "Declaration text too complex",
      "severity": "medium",
      "status": "in_review",
      "selector": "DIS-05-IOS",
      "pageUrl": "Release 4.2 staging build",
      "createdAt": "2026-10-19T10:00:00Z",
      "goldenSetId": "FND-0099 / DEF-0099",
      "journey": "dispute_filing",
      "stepNo": 5,
      "stepName": "Declaration and consent",
      "platform": "ios",
      "screenId": "DIS-05-IOS",
      "findingType": "cognitive_load_issue",
      "wcagCriteria": [
        "3.1.5"
      ],
      "wcagVersion": "WCAG 2.0, in 2.1",
      "conformanceLevel": "AAA",
      "baselineStatus": "aaa_best_practice",
      "confidence": "medium",
      "abstentionReason": null,
      "evidence": "Reading grade about 13.4; jargon: \"chargeback\", \"penal charges\".",
      "affectedUserNeed": "Understand financial terms and their consequences",
      "userImpact": "task_slowed",
      "affectedGroups": [
        "Cognitive disabilities",
        "Low digital literacy"
      ],
      "recommendedFix": "Rewrite in plain language at about grade 6–8 with short sentences and a glossary. Regulated wording needs Compliance approval.",
      "fixRationale": "Plain language reduces cognitive effort while preserving the regulated meaning.",
      "verificationSteps": "Plain-language review by a content designer; Compliance confirms no change in legal meaning.",
      "gateRecommendation": "advisory",
      "requiresHumanReview": true,
      "escalateTo": "Compliance",
      "policySources": [
        {
          "id": "P032",
          "title": "WCAG 3.1.5 Reading Level (AAA)",
          "status": "verified"
        },
        {
          "id": "P042",
          "title": "Regulated content rule (proposed MAE rule)",
          "status": "proposed_internal"
        }
      ],
      "priorityScore": 59.5,
      "priorityBand": "P2"
    },
    {
      "id": "FND-0223",
      "scanId": "scn-2001",
      "ruleId": "FND-0223",
      "wcag": "outside_wcag",
      "title": "Touch target too small (38 dp)",
      "severity": "medium",
      "status": "open",
      "selector": "ONB-07-IOS",
      "pageUrl": "Release 4.2 staging build",
      "createdAt": "2026-10-19T10:00:00Z",
      "goldenSetId": "FND-0223 / DEF-0223",
      "journey": "onboarding",
      "stepNo": 7,
      "stepName": "e-KYC OTP",
      "platform": "ios",
      "screenId": "ONB-07-IOS",
      "findingType": "accessibility_usability_issue",
      "wcagCriteria": null,
      "wcagVersion": null,
      "conformanceLevel": null,
      "baselineStatus": "outside_AA_baseline",
      "confidence": "high",
      "abstentionReason": null,
      "evidence": "Tappable controls measure 38 dp.",
      "affectedUserNeed": "Tap controls accurately with limited dexterity or vision",
      "userImpact": "task_slowed",
      "affectedGroups": [
        "Seniors (60+)",
        "Limited dexterity"
      ],
      "recommendedFix": "Increase targets to at least 48 dp and add spacing.",
      "fixRationale": "Larger, spaced targets improve touch accuracy; this is not a WCAG 2.1 AA failure.",
      "verificationSteps": "Measure target bounds; confirm 48 dp or more, or document the spacing.",
      "gateRecommendation": "advisory",
      "requiresHumanReview": true,
      "escalateTo": "Accessibility specialist",
      "policySources": [
        {
          "id": "P026",
          "title": "WCAG 2.5.8 Target Size (Minimum) (AA, WCAG 2.2)",
          "status": "verified"
        },
        {
          "id": "P027",
          "title": "Android touch-target guidance (48 dp)",
          "status": "unverified"
        },
        {
          "id": "P033",
          "title": "WCAG 2.5.5 Target Size (AAA, WCAG 2.1)",
          "status": "verified"
        }
      ],
      "priorityScore": 57.4,
      "priorityBand": "P2",
      "callout": "Not a WCAG 2.1 AA failure. 38 dp passes WCAG 2.2 2.5.8 (24 px) and fails only WCAG 2.1 2.5.5 (AAA, 44 px). Reported against Android's 48 dp guidance."
    },
    {
      "id": "FND-0297",
      "scanId": "scn-2001",
      "ruleId": "FND-0297",
      "wcag": "1.4.3",
      "title": "Text contrast 3.4:1 — needs expert review",
      "severity": "medium",
      "status": "held_for_expert_review",
      "selector": "ONB-01-AND",
      "pageUrl": "Release 4.2 staging build",
      "createdAt": "2026-10-19T10:00:00Z",
      "goldenSetId": "FND-0297 / DEF-0297",
      "journey": "onboarding",
      "stepNo": 1,
      "stepName": "Welcome and language choice",
      "platform": "android",
      "screenId": "ONB-01-AND",
      "findingType": "needs_expert_review",
      "wcagCriteria": [
        "1.4.3"
      ],
      "wcagVersion": "WCAG 2.0, in 2.1 baseline",
      "conformanceLevel": "AA",
      "baselineStatus": "in_baseline_2.1_AA",
      "confidence": "low",
      "abstentionReason": "Contrast is between 3:1 and 4.5:1 and the text size is not recorded. Large text passes 1.4.3 at 3:1.",
      "evidence": "Measured contrast 3.4:1.",
      "affectedUserNeed": "Read text with low vision or in bright light",
      "userImpact": "task_slowed",
      "affectedGroups": [
        "Low vision",
        "Seniors (60+)"
      ],
      "recommendedFix": "Darken text or lighten the background to at least 4.5:1 (3:1 for large text).",
      "fixRationale": "Text size and weight must be established before determining whether 3.4:1 fails the AA criterion.",
      "verificationSteps": "Measure contrast and record text size and weight.",
      "gateRecommendation": "hold_for_expert_review",
      "requiresHumanReview": true,
      "escalateTo": "Accessibility specialist",
      "policySources": [
        {
          "id": "P021",
          "title": "WCAG 1.4.3 Contrast (Minimum) (AA)",
          "status": "verified"
        }
      ],
      "priorityScore": 64.3,
      "priorityBand": "P2"
    },
    {
      "id": "FND-0141",
      "scanId": "scn-2001",
      "ruleId": "FND-0141",
      "wcag": "4.1.3",
      "title": "Status change not announced",
      "severity": "high",
      "status": "remediation_in_progress",
      "selector": "ONB-05-AND",
      "pageUrl": "Release 4.2 staging build",
      "createdAt": "2026-10-19T10:00:00Z",
      "goldenSetId": "FND-0141 / DEF-0141",
      "journey": "onboarding",
      "stepNo": 5,
      "stepName": "PAN entry",
      "platform": "android",
      "screenId": "ONB-05-AND",
      "findingType": "wcag_failure",
      "wcagCriteria": [
        "4.1.3"
      ],
      "wcagVersion": "WCAG 2.1, in 2.1 baseline",
      "conformanceLevel": "AA",
      "baselineStatus": "in_baseline_2.1_AA",
      "confidence": "high",
      "abstentionReason": null,
      "evidence": "The error message appears without a live region.",
      "affectedUserNeed": "Learn the result of an action without sight",
      "userImpact": "task_slowed",
      "affectedGroups": [
        "Screen-reader users"
      ],
      "recommendedFix": "Expose results and errors as status messages, or move focus to them.",
      "fixRationale": "Programmatically exposed status messages let screen-reader users perceive results.",
      "verificationSteps": "Trigger success and error states with a screen reader; the message is announced without moving focus manually.",
      "gateRecommendation": "advisory",
      "requiresHumanReview": true,
      "escalateTo": "Owning squad",
      "policySources": [
        {
          "id": "P031",
          "title": "WCAG 4.1.2 Name, Role, Value (A), 4.1.3 Status Messages (AA)",
          "status": "partially_verified"
        }
      ],
      "priorityScore": 53.0,
      "priorityBand": "P2"
    },
    {
      "id": "FND-0199",
      "scanId": "scn-2001",
      "ruleId": "FND-0199",
      "wcag": "3.3.1, 3.3.3",
      "title": "Error message does not explain the problem",
      "severity": "high",
      "status": "ready_for_verification",
      "selector": "ONB-11-WEB",
      "pageUrl": "Release 4.2 staging build",
      "createdAt": "2026-10-19T10:00:00Z",
      "goldenSetId": "FND-0199 / DEF-0199",
      "journey": "onboarding",
      "stepNo": 11,
      "stepName": "Set MPIN or biometric",
      "platform": "web",
      "screenId": "ONB-11-WEB",
      "findingType": "wcag_failure",
      "wcagCriteria": [
        "3.3.1",
        "3.3.3"
      ],
      "wcagVersion": "WCAG 2.0, in 2.1 baseline",
      "conformanceLevel": "A/AA",
      "baselineStatus": "in_baseline_2.1_AA",
      "confidence": "medium",
      "abstentionReason": null,
      "evidence": "Error text: \"Authentication error 308\".",
      "affectedUserNeed": "Know what went wrong and how to fix it",
      "userImpact": "task_slowed",
      "affectedGroups": [
        "Low digital literacy",
        "Cognitive disabilities"
      ],
      "recommendedFix": "State the problem and the fix in plain words, with an example of the expected format.",
      "fixRationale": "Actionable error messages help users identify and correct the problem.",
      "verificationSteps": "Trigger each error; the message names the field, states the problem and suggests a correction.",
      "gateRecommendation": "advisory",
      "requiresHumanReview": true,
      "escalateTo": "Owning squad",
      "policySources": [
        {
          "id": "P029",
          "title": "WCAG 3.3.1 Error Identification (A), 3.3.3 Error Suggestion (AA)",
          "status": "partially_verified"
        }
      ],
      "priorityScore": 61.7,
      "priorityBand": "P2"
    }
  ],
  "evidence": [
    {
      "id": "evd-FND-0048",
      "findingId": "FND-0048",
      "kind": "dom_snippet",
      "content": "Ungrouped digit boxes; focus returns to box 1 after each digit. Nodes n5–n10. Simulation traces TRC-003 and TRC-140: a TalkBack persona was stuck at step 3 (reason: otp_boxes_focus_jump)."
    },
    {
      "id": "evd-FND-0020",
      "findingId": "FND-0020",
      "kind": "dom_snippet",
      "content": "Liveness offers blink-only verification with no alternative."
    },
    {
      "id": "evd-FND-0067",
      "findingId": "FND-0067",
      "kind": "dom_snippet",
      "content": "Content language detected: en only. Hindi and Tamil are required for regulated flows (proposed rule P047)."
    },
    {
      "id": "evd-FND-0099",
      "findingId": "FND-0099",
      "kind": "dom_snippet",
      "content": "Reading grade about 13.4; jargon: \"chargeback\", \"penal charges\"."
    },
    {
      "id": "evd-FND-0223",
      "findingId": "FND-0223",
      "kind": "dom_snippet",
      "content": "Tappable controls measure 38 dp."
    },
    {
      "id": "evd-FND-0297",
      "findingId": "FND-0297",
      "kind": "dom_snippet",
      "content": "Measured contrast 3.4:1."
    },
    {
      "id": "evd-FND-0141",
      "findingId": "FND-0141",
      "kind": "dom_snippet",
      "content": "The error message appears without a live region."
    },
    {
      "id": "evd-FND-0199",
      "findingId": "FND-0199",
      "kind": "dom_snippet",
      "content": "Error text: \"Authentication error 308\"."
    }
  ],
  "recommendations": [],
  "reviewTasks": [
    {
      "id": "rvw-FND-0048",
      "findingId": "FND-0048",
      "status": "pending",
      "createdAt": "2026-10-19T10:00:00Z"
    },
    {
      "id": "rvw-FND-0099",
      "findingId": "FND-0099",
      "status": "pending",
      "createdAt": "2026-10-19T10:00:00Z"
    },
    {
      "id": "rvw-FND-0297",
      "findingId": "FND-0297",
      "status": "pending",
      "createdAt": "2026-10-19T10:00:00Z"
    }
  ],
  "verificationRuns": [],
  "policySources": [
    {
      "id": "P001",
      "title": "Supreme Court, Pragya Prasun v. Union of India (30 Apr 2025)",
      "status": "partially_verified"
    },
    {
      "id": "P002",
      "title": "Supreme Court directions on liveness and nodal officers",
      "status": "unverified"
    },
    {
      "id": "P003",
      "title": "RBI KYC (2nd Amendment) Directions 2025, para 18(b)(i): \"The liveness check shall not result in exclusion of person with special needs.\"",
      "status": "verified"
    },
    {
      "id": "P013",
      "title": "RBI Key Facts Statement for loans",
      "status": "unverified"
    },
    {
      "id": "P014",
      "title": "DPDP notice-language provision",
      "status": "unverified"
    },
    {
      "id": "P020",
      "title": "WCAG 1.3.1 Info and Relationships (A)",
      "status": "verified"
    },
    {
      "id": "P021",
      "title": "WCAG 1.4.3 Contrast (Minimum) (AA)",
      "status": "verified"
    },
    {
      "id": "P024",
      "title": "WCAG 2.4.3 Focus Order (A)",
      "status": "verified"
    },
    {
      "id": "P026",
      "title": "WCAG 2.5.8 Target Size (Minimum) (AA, WCAG 2.2)",
      "status": "verified"
    },
    {
      "id": "P027",
      "title": "Android touch-target guidance (48 dp)",
      "status": "unverified"
    },
    {
      "id": "P029",
      "title": "WCAG 3.3.1 Error Identification (A), 3.3.3 Error Suggestion (AA)",
      "status": "partially_verified"
    },
    {
      "id": "P031",
      "title": "WCAG 4.1.2 Name, Role, Value (A), 4.1.3 Status Messages (AA)",
      "status": "partially_verified"
    },
    {
      "id": "P032",
      "title": "WCAG 3.1.5 Reading Level (AAA)",
      "status": "verified"
    },
    {
      "id": "P033",
      "title": "WCAG 2.5.5 Target Size (AAA, WCAG 2.1)",
      "status": "verified"
    },
    {
      "id": "P042",
      "title": "Regulated content rule (proposed MAE rule)",
      "status": "proposed_internal"
    },
    {
      "id": "P047",
      "title": "Language coverage rule (proposed MAE rule)",
      "status": "proposed_internal"
    }
  ],
  "modelRuns": [],
  "auditEvents": [
    {
      "id": "aud-FND-0048",
      "actor": "Aniket Kumar (Demo reviewer)",
      "action": "review.in_review",
      "entity": "finding",
      "entityId": "FND-0048",
      "createdAt": "2026-10-19T11:00:00Z"
    },
    {
      "id": "aud-FND-0020",
      "actor": "Madhavi Singh (Demo compliance officer)",
      "action": "review.awaiting_compliance",
      "entity": "finding",
      "entityId": "FND-0020",
      "createdAt": "2026-10-19T11:00:00Z"
    },
    {
      "id": "aud-FND-0067",
      "actor": "Madhavi Singh (Demo compliance officer)",
      "action": "review.awaiting_compliance",
      "entity": "finding",
      "entityId": "FND-0067",
      "createdAt": "2026-10-19T11:00:00Z"
    },
    {
      "id": "aud-FND-0099",
      "actor": "Aniket Kumar (Demo reviewer)",
      "action": "review.in_review",
      "entity": "finding",
      "entityId": "FND-0099",
      "createdAt": "2026-10-19T11:00:00Z"
    },
    {
      "id": "aud-FND-0297",
      "actor": "Aniket Kumar (Demo reviewer)",
      "action": "review.held_for_expert_review",
      "entity": "finding",
      "entityId": "FND-0297",
      "createdAt": "2026-10-19T11:00:00Z"
    },
    {
      "id": "aud-FND-0141",
      "actor": "Aniket Kumar (Demo reviewer)",
      "action": "review.remediation_in_progress",
      "entity": "finding",
      "entityId": "FND-0141",
      "createdAt": "2026-10-19T11:00:00Z"
    },
    {
      "id": "aud-FND-0199",
      "actor": "Aniket Kumar (Demo reviewer)",
      "action": "review.ready_for_verification",
      "entity": "finding",
      "entityId": "FND-0199",
      "createdAt": "2026-10-19T11:00:00Z"
    }
  ]
};
