import { describe, expect, it } from "vitest";

import {
  DiagnoseOutput,
  RemediateOutput,
  deterministicAgentModel,
  diagnosisDescription,
  mergeDiagnosis,
  mergeRemediation,
} from "./model";
import type { FindingDraft } from "./guards";
import type { RuleResult } from "./rules";

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

const baseDraft: FindingDraft = {
  title: rule.title,
  finding_type: "accessibility_usability_issue",
  journey: "onboarding",
  step_no: 7,
  step_name: "e-KYC OTP",
  platform: "ios",
  wcag_criteria: null,
  wcag_version: null,
  conformance_level: null,
  baseline_status: "outside_AA_baseline",
  severity: "medium",
  confidence: "high",
  abstention_reason: null,
  evidence: rule.evidence,
  affected_user_need: rule.affectedUserNeed,
  user_impact: "task_slowed",
  affected_groups: ["Seniors (60+)"],
  recommended_fix: "Raise the tappable area to at least 48 dp.",
  fix_rationale: "Platform guidance, not an AA criterion.",
  verification_steps: "Measure target bounds.",
  gate_recommendation: "advisory",
  requires_human_review: true,
  escalate_to: "Accessibility specialist",
  priority_score: 57.4,
  priority_band: "P2",
};

const modelOutput: DiagnoseOutput = {
  title: "Small targets on the e-KYC OTP step slow seniors down",
  evidence_context: "Sessions show 113 abandonments at this step.",
  affected_user_need: "Tap the verification controls without mis-hitting them",
  description: "Seniors retry this step more than any other in onboarding.",
};

describe("the model may write prose, never the classification", () => {
  it("carries every gating field through untouched", () => {
    const merged = mergeDiagnosis(baseDraft, modelOutput, rule);
    const gating = [
      "finding_type",
      "wcag_criteria",
      "wcag_version",
      "conformance_level",
      "baseline_status",
      "severity",
      "confidence",
      "abstention_reason",
      "gate_recommendation",
      "requires_human_review",
      "escalate_to",
      "priority_score",
      "priority_band",
      "user_impact",
      "affected_groups",
      "journey",
      "step_no",
      "platform",
    ] as const;
    for (const field of gating) {
      expect(merged[field], `the model must not change ${field}`).toEqual(baseDraft[field]);
    }
  });

  it("keeps the rule's own observation verbatim and appends the model's context", () => {
    const merged = mergeDiagnosis(baseDraft, modelOutput, rule);
    expect(merged.evidence.startsWith(rule.evidence)).toBe(true);
    expect(merged.evidence).toContain("113 abandonments");
  });

  it("falls back to the rule evidence when the model adds nothing", () => {
    const merged = mergeDiagnosis(baseDraft, { ...modelOutput, evidence_context: "   " }, rule);
    expect(merged.evidence).toBe(baseDraft.evidence);
  });

  it("takes the title and the user need from the model", () => {
    const merged = mergeDiagnosis(baseDraft, modelOutput, rule);
    expect(merged.title).toBe(modelOutput.title);
    expect(merged.affected_user_need).toBe(modelOutput.affected_user_need);
  });
});

describe("model output validation", () => {
  it("rejects a model that tries to set the classification", () => {
    const smuggled = { ...modelOutput, finding_type: "wcag_failure", severity: "critical" };
    const parsed = DiagnoseOutput.safeParse(smuggled);
    expect(parsed.success).toBe(false);
  });

  it("rejects a missing or empty field rather than drafting half a finding", () => {
    expect(DiagnoseOutput.safeParse({ ...modelOutput, description: "" }).success).toBe(false);
    expect(DiagnoseOutput.safeParse({ title: modelOutput.title }).success).toBe(false);
  });

  it("accepts a well-formed response", () => {
    expect(DiagnoseOutput.safeParse(modelOutput).success).toBe(true);
    expect(
      RemediateOutput.safeParse({
        recommended_fix: "Raise the target to 48 dp with 8 dp spacing.",
        fix_rationale: "Android guidance; not a WCAG 2.1 AA criterion.",
        verification_steps: "Measure the bounds on the shipped build; confirm 48 dp or more.",
      }).success,
    ).toBe(true);
  });
});

describe("remediation merge", () => {
  it("replaces the rule-backed fix only when the model produced one", () => {
    const merged = mergeRemediation(
      { recommendedFix: "a", rationale: "b", verificationSteps: "c" },
      {
        recommended_fix: "Raise the target to 48 dp with 8 dp spacing.",
        fix_rationale: "Android guidance; not a WCAG 2.1 AA criterion.",
        verification_steps: "Measure the bounds on the shipped build.",
      },
    );
    expect(merged.recommendedFix).toContain("48 dp");
    expect(merged.verificationSteps).toContain("Measure");
  });
});

describe("no model configured", () => {
  it("returns no output and says why, so the run continues on rule-backed text", async () => {
    const result = await deterministicAgentModel.diagnose({} as never, []);
    expect(result.output).toBeNull();
    expect(result.meta.fellBackBecause).toBe("no model configured");
    expect(result.meta.provider).toBe("deterministic");
  });
});

describe("description", () => {
  it("is trimmed model narrative", () => {
    expect(diagnosisDescription({ ...modelOutput, description: "  text  " })).toBe("text");
  });
});
