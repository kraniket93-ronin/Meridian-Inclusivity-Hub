import { describe, expect, it } from "vitest";

import { runRules, type ScreenRecord } from "./rules";
import { guardFinding, type FindingDraft } from "./guards";
import type { PolicyChunk } from "./tools";

const screen = (overrides: Partial<ScreenRecord>): ScreenRecord => ({
  screen_id: "ONB-03-AND-v3",
  journey: "onboarding",
  step_no: "3",
  step_name: "OTP entry",
  step_type: "auth",
  platform: "android",
  build_id: "v3",
  a11y_tree_json: "[]",
  lang_attr_set: "Y",
  min_contrast_ratio: "7.0",
  font_scaling_supported: "Y",
  focus_indicator_visible: "Y",
  ...overrides,
});

const ruleIds = (s: ScreenRecord) => runRules(s).map((r) => r.ruleId);

describe("rule engine", () => {
  it("treats an empty attribute as not recorded, not as zero", () => {
    // Regression: Number("") is 0, which had the timeout rule firing on every screen
    // that has no OTP at all, reporting "expires after 0 seconds".
    expect(ruleIds(screen({ otp_timeout_sec: "", otp_timeout_extendable: "" }))).not.toContain("timeout");
    expect(ruleIds(screen({ min_tap_target_dp: "" }))).not.toContain("tap-target");
    expect(ruleIds(screen({ min_contrast_ratio: "" }))).not.toContain("contrast-fail");
  });

  it("reports a short, non-extendable code timeout", () => {
    const hit = runRules(screen({ otp_timeout_sec: "30.0", otp_timeout_extendable: "N" })).find(
      (r) => r.ruleId === "timeout",
    );
    expect(hit?.findingType).toBe("wcag_failure");
    expect(hit?.criteria).toEqual(["2.2.1"]);
    expect(hit?.evidence).toMatch(/security exception/i);
  });

  it("names every interactive control with no accessible name", () => {
    const tree = JSON.stringify([
      { id: "n1", role: "button", name: "", interactive: "Y" },
      { id: "n2", role: "button", name: "Continue", interactive: "Y" },
      { id: "n3", role: "text", name: "", interactive: "N" },
    ]);
    const hit = runRules(screen({ a11y_tree_json: tree })).find((r) => r.ruleId === "name-missing");
    expect(hit?.nodeIds).toEqual(["n1"]);
    expect(hit?.criteria).toEqual(["4.1.2"]);
    expect(hit?.severity).toBe("critical"); // auth step
  });

  it("keeps a small tap target out of the WCAG baseline", () => {
    const hit = runRules(screen({ min_tap_target_dp: "38" })).find((r) => r.ruleId === "tap-target");
    expect(hit?.findingType).toBe("accessibility_usability_issue");
    expect(hit?.criteria).toBeNull();
    expect(hit?.callout).toMatch(/2\.5\.8/);
  });

  it("abstains on contrast between 3:1 and 4.5:1", () => {
    const hit = runRules(screen({ min_contrast_ratio: "3.4" })).find(
      (r) => r.ruleId === "contrast-indeterminate",
    );
    expect(hit?.findingType).toBe("needs_expert_review");
    expect(hit?.confidence).toBe("low");
    expect(hit?.abstentionReason).toMatch(/text size is not recorded/i);
  });

  it("flags blink-only liveness as a candidate policy breach, never a conclusion", () => {
    const hit = runRules(screen({ liveness_methods: '["blink"]' })).find(
      (r) => r.ruleId === "liveness-blink-only",
    );
    expect(hit?.findingType).toBe("banking_policy_violation");
    expect(hit?.abstentionReason).toMatch(/reserved for Compliance/i);
    expect(runRules(screen({ liveness_methods: '["passive", "audio_prompt"]' })).map((r) => r.ruleId)).not.toContain(
      "liveness-blink-only",
    );
  });

  it("reports a missing regulated language as outside WCAG", () => {
    const hit = runRules(
      screen({
        regulated_content: "Y",
        languages_required: '["en", "hi", "ta"]',
        languages_available: '["en"]',
      }),
    ).find((r) => r.ruleId === "language-coverage");
    expect(hit?.findingType).toBe("language_inclusion_issue");
    expect(hit?.baselineStatus).toBe("outside_wcag");
  });
});

/* ------------------------------------------------------------------ guards */

const verified: PolicyChunk[] = [
  {
    id: "P031",
    title: "WCAG 4.1.2 Name, Role, Value",
    text: "…",
    verificationStatus: "verified_primary_partial",
    approvedForAnswers: true,
    lastVerified: "2026-10-19",
    citable: true,
  },
];
const unverifiedOnly: PolicyChunk[] = [
  {
    id: "P027",
    title: "Android touch target guidance",
    text: "…",
    verificationStatus: "secondary_only",
    approvedForAnswers: false,
    lastVerified: null,
    citable: false,
  },
];

const draft = (overrides: Partial<FindingDraft> = {}): FindingDraft => ({
  title: "Controls have no accessible name",
  finding_type: "wcag_failure",
  journey: "onboarding",
  step_no: 3,
  step_name: "OTP entry",
  platform: "android",
  wcag_criteria: ["4.1.2"],
  wcag_version: "WCAG 2.0, in 2.1 baseline",
  conformance_level: "A",
  baseline_status: "in_baseline_2.1_AA",
  severity: "critical",
  confidence: "high",
  abstention_reason: null,
  evidence: "Interactive nodes with an empty name: n1 (button).",
  affected_user_need: "Know what a control does before activating it",
  user_impact: "task_blocked",
  affected_groups: ["Screen-reader users"],
  recommended_fix: "Give every interactive control an accessible name.",
  fix_rationale: "SC 4.1.2 requires a programmatically determinable name.",
  verification_steps: "Walk the screen with TalkBack: every control announces a name.",
  gate_recommendation: "advisory",
  requires_human_review: true,
  escalate_to: "Owning squad",
  priority_score: 70,
  priority_band: "P2",
  ...overrides,
});

describe("output guards", () => {
  it("passes a well-formed, well-grounded finding", () => {
    expect(guardFinding(draft(), verified).verdict).toBe("ok");
  });

  it("refuses a conformance claim with no verified source", () => {
    const result = guardFinding(draft(), unverifiedOnly);
    expect(result.verdict).toBe("rejected");
    expect(result.reasons.join(" ")).toMatch(/no verified policy source/i);
  });

  it("refuses a WCAG 2.2 criterion dressed up as a 2.1 AA failure", () => {
    const result = guardFinding(draft({ wcag_criteria: ["3.3.8"] }), verified);
    expect(result.reasons.join(" ")).toMatch(/new in 2\.2/i);
  });

  it("refuses output that would weaken authentication", () => {
    const result = guardFinding(
      draft({ recommended_fix: "Remove the second factor for returning devices." }),
      verified,
    );
    expect(result.verdict).toBe("rejected");
    expect(result.reasons.join(" ")).toMatch(/weakening authentication/i);
  });

  it("refuses output that closes the loop itself or certifies compliance", () => {
    expect(
      guardFinding(draft({ verification_steps: "No further review is needed." }), verified).verdict,
    ).toBe("rejected");
    expect(
      guardFinding(draft({ fix_rationale: "The app is now WCAG compliant." }), verified).verdict,
    ).toBe("rejected");
  });

  it("refuses output carrying personal data", () => {
    const result = guardFinding(draft({ evidence: "Reported by 9876543210 on the OTP screen." }), verified);
    expect(result.verdict).toBe("rejected");
    expect(result.reasons.join(" ")).toMatch(/mobile number/i);
  });

  it("escalates policy and language findings instead of passing them through", () => {
    const result = guardFinding(
      draft({
        finding_type: "banking_policy_violation",
        wcag_criteria: null,
        wcag_version: null,
        conformance_level: null,
        baseline_status: "outside_wcag",
        escalate_to: "Compliance",
        gate_recommendation: "escalate_to_compliance",
        abstention_reason: "Legal or regulatory conclusion reserved for Compliance.",
        confidence: "medium",
      }),
      verified,
    );
    expect(result.verdict).toBe("escalated");
  });

  it("requires an abstention reason when confidence is low", () => {
    const result = guardFinding(draft({ confidence: "low", abstention_reason: null }), verified);
    expect(result.reasons.join(" ")).toMatch(/abstention reason/i);
  });
});
