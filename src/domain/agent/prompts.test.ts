import { describe, expect, it } from "vitest";

import {
  CONSTITUTION,
  diagnoseUserPrompt,
  diagnoserSystemPrompt,
  remediateUserPrompt,
  remediatorSystemPrompt,
  selectFewShot,
  type FewShotExample,
} from "./prompts";
import type { RuleResult } from "./rules";
import type { PolicyChunk, SignalSummary } from "./tools";

const example = (id: string, splitGroup: string): FewShotExample => ({
  findingId: id,
  splitGroup,
  findingType: "wcag_failure",
  title: "Controls have no accessible name",
  evidence: "Two buttons expose an empty name.",
  affectedUserNeed: "Know what a control does before activating it",
  recommendedFix: "Give every control an accessible name.",
  fixRationale: "SC 4.1.2 requires a programmatically determinable name.",
  verificationSteps: "Walk the screen with TalkBack; every control announces a name.",
  abstentionReason: null,
  confidence: "high",
  gate: "advisory",
});

const rule: RuleResult = {
  ruleId: "tap-target",
  title: "Touch target too small (38 dp)",
  findingType: "accessibility_usability_issue",
  criteria: null,
  wcagVersion: null,
  conformanceLevel: null,
  baselineStatus: "outside_AA_baseline",
  severity: "medium",
  confidence: "high",
  abstentionReason: null,
  evidence: "Tappable controls measure 38 dp.",
  citationKeys: ["topic:tap_target"],
  affectedUserNeed: "Tap controls accurately with limited dexterity or vision",
  affectedGroups: ["Seniors (60+)"],
  userImpact: "task_slowed",
};

const chunks: PolicyChunk[] = [
  {
    id: "P026",
    title: "WCAG 2.5.8 Target Size (Minimum)",
    text: "24 by 24 CSS pixels.",
    verificationStatus: "verified_primary",
    approvedForAnswers: true,
    lastVerified: "2026-10-19",
    citable: true,
  },
  {
    id: "P027",
    title: "Android touch target guidance",
    text: "48 dp.",
    verificationStatus: "secondary_only",
    approvedForAnswers: false,
    lastVerified: null,
    citable: false,
  },
];

describe("few-shot selection", () => {
  it("keeps train rows and drops dev and test", () => {
    const picked = selectFewShot(
      [example("FND-1", "test"), example("FND-2", "train"), example("FND-3", "dev"), example("FND-4", "train")],
      5,
    );
    expect(picked.map((e) => e.findingId)).toEqual(["FND-2", "FND-4"]);
  });

  it("is deterministic and respects the limit", () => {
    const rows = [example("FND-9", "train"), example("FND-2", "train"), example("FND-5", "train")];
    expect(selectFewShot(rows, 2).map((e) => e.findingId)).toEqual(["FND-2", "FND-5"]);
    expect(selectFewShot(rows, 2)).toEqual(selectFewShot(rows, 2));
  });

  it("returns nothing when no train row is offered", () => {
    expect(selectFewShot([example("FND-1", "test")], 3)).toEqual([]);
  });
});

describe("diagnoser prompt", () => {
  const system = diagnoserSystemPrompt(selectFewShot([example("FND-2", "train")], 3));

  it("states every rule the output guard enforces", () => {
    // Each phrase pairs with a rule in guards.ts. If the guard gains a rule, the prompt
    // must gain the matching sentence, or the model is being judged on an unstated rule.
    const required = [
      "weakening an authentication factor",
      "cannot certify anything",
      "approve a waiver",
      "no names, phone numbers",
      "Aadhaar",
      "Re-decide a deterministic rule result",
      "not marked citable",
    ];
    for (const phrase of required) {
      expect(system, `missing from the prompt: ${phrase}`).toContain(phrase);
      expect(CONSTITUTION, `missing from the constitution: ${phrase}`).toContain(phrase);
    }
  });

  it("carries the taxonomy the UI uses", () => {
    expect(system).toContain("Usability issue (not a WCAG failure)");
    expect(system).toContain("WCAG 2.2 supplemental (reported, not gating)");
    expect(system).toContain("Recommend block (a human decides)");
  });

  it("names the split its examples came from", () => {
    expect(system).toContain("train split");
    expect(system).toContain("FND-2");
  });

  it("tells the model the rule result is authoritative", () => {
    expect(system).toMatch(/Carry them through unchanged/);
    expect(system).toMatch(/never by relabelling/);
  });
});

describe("diagnose user prompt", () => {
  const signals: SignalSummary = {
    journey: "onboarding",
    stepNo: 7,
    tickets: 93,
    accessibilityRelated: 93,
    unableUnassisted: 20,
    seniorShare: 45.2,
    topBarriers: [{ barrier: "otp_boxes_focus_jump", count: 44 }],
    sessions: 6000,
    abandonedAtStep: 113,
    screenReaderAbandonRate: 37.9,
    otherAbandonRate: 15,
    suppressed: false,
  };

  const prompt = diagnoseUserPrompt({
    rule,
    screenId: "ONB-07-IOS-v3",
    journey: "onboarding",
    stepNo: 7,
    stepName: "e-KYC OTP",
    platform: "ios",
    signals,
    trace: { traceId: "TRC-003", stuckStepNo: 7, reasonCode: "otp_boxes_focus_jump", assistiveTech: "TalkBack" },
    chunks,
  });

  it("marks which sources may be cited", () => {
    expect(prompt).toContain("P026 [CITABLE]");
    expect(prompt).toContain("P027 [NOT CITABLE — context only]");
  });

  it("passes the rule classification as authoritative", () => {
    expect(prompt).toContain("Rule result (authoritative, do not relabel)");
    expect(prompt).toContain("finding_type: accessibility_usability_issue");
  });

  it("includes the trace and the aggregate signals", () => {
    expect(prompt).toContain("TRC-003");
    expect(prompt).toContain("20 say the customer could not finish unassisted");
  });

  it("withholds signals below the minimum group size", () => {
    const quiet = diagnoseUserPrompt({
      rule,
      screenId: "ONB-07-IOS-v3",
      journey: "onboarding",
      stepNo: 7,
      stepName: "e-KYC OTP",
      platform: "ios",
      signals: { ...signals, suppressed: true },
      trace: null,
      chunks,
    });
    expect(quiet).toContain("below the minimum group size");
    expect(quiet).not.toContain("45.2");
  });
});

describe("remediator prompt", () => {
  it("refuses to draft regulated wording and to touch security controls", () => {
    const system = remediatorSystemPrompt([]);
    expect(system).toMatch(/not to draft the text\s+yourself|not to draft the text yourself/);
    expect(system).toMatch(/Security must assess/);
    expect(system).toMatch(/Never propose removing the control/);
  });

  it("gives the model the rule-backed fix to improve on, not to contradict", () => {
    const prompt = remediateUserPrompt({
      rule,
      screenId: "ONB-07-IOS-v3",
      stepName: "e-KYC OTP",
      platform: "ios",
      fallback: {
        recommendedFix: "Raise the tappable area to at least 48 dp.",
        rationale: "Platform guidance, not an AA criterion.",
        verificationSteps: "Measure target bounds.",
      },
    });
    expect(prompt).toContain("Do not contradict it");
    expect(prompt).toContain("Raise the tappable area to at least 48 dp.");
  });
});
