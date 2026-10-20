import type {
  Finding,
  FindingType,
  BaselineStatus,
  GateRecommendation,
  Severity,
  SourceStatus,
} from "./types";

export const DEMO_NOTE =
  "Demo findings are synthetic records from MAE Golden Set v0.1. They are not human-validated.";
export const TYPE_LABELS: Record<FindingType, string> = {
  wcag_failure: "WCAG failure",
  accessibility_usability_issue: "Usability issue (not a WCAG failure)",
  cognitive_load_issue: "Cognitive load issue",
  language_inclusion_issue: "Language inclusion issue",
  banking_policy_violation: "Policy risk (Compliance decides)",
  needs_expert_review: "Needs expert review",
};
export const BASELINE_LABELS: Record<BaselineStatus, string> = {
  "in_baseline_2.1_AA": "In WCAG 2.1 AA baseline",
  "supplemental_2.2": "WCAG 2.2 supplemental (reported, not gating)",
  aaa_best_practice: "AAA best practice",
  outside_AA_baseline: "Outside the AA baseline",
  outside_wcag: "Outside WCAG",
};
export const GATE_LABELS: Record<GateRecommendation, string> = {
  advisory: "Advisory",
  hold_for_expert_review: "Hold for expert review",
  escalate_to_compliance: "Escalate to Compliance before release",
  recommend_block_pending_human: "Recommend block (a human decides)",
};
export const SOURCE_LABELS: Record<SourceStatus, string> = {
  verified: "Verified source",
  partially_verified: "Partly verified",
  unverified: "Unverified — not citable",
  proposed_internal: "Proposed rule, not Meridian policy",
};
export const SEVERITY_DEFINITIONS: Record<Severity, string> = {
  critical: "The user cannot complete a core task.",
  high: "Completes only with major difficulty, errors or outside help.",
  medium: "Slowed or confused but can complete.",
  low: "Minor or cosmetic.",
};
export const JOURNEY_LABELS = { onboarding: "Onboarding", dispute_filing: "Dispute filing" };
export const PLATFORM_LABELS = { android: "Android", ios: "iOS", web: "Web" };
export const locationLabel = (f: Finding) =>
  `${JOURNEY_LABELS[f.journey]} · Step ${f.stepNo} · ${f.stepName} · ${PLATFORM_LABELS[f.platform]}`;
export function wcagVerdict(f: Finding): string {
  if (f.findingType === "needs_expert_review") return "Not determined — needs expert review.";
  if (f.findingType === "wcag_failure")
    return `Yes — fails WCAG ${f.wcagCriteria?.join(", ")} (Level ${f.conformanceLevel}, ${f.baselineStatus === "in_baseline_2.1_AA" ? "in the 2.1 AA baseline" : BASELINE_LABELS[f.baselineStatus]}).`;
  if (f.findingType === "banking_policy_violation") return "No — policy risk. Compliance decides.";
  if (f.findingType === "accessibility_usability_issue")
    return "No — usability issue outside the AA baseline.";
  if (f.findingType === "cognitive_load_issue")
    return "No — cognitive load issue; WCAG 3.1.5 is an AAA best practice, not an AA baseline failure.";
  return "No — language inclusion issue outside WCAG. Compliance decides.";
}
