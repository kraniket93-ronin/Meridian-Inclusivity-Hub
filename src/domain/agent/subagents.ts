// The four sub-agents from the architecture: Planner, Tester, Diagnoser, Remediator.
//
// Each one is a narrow worker with its own inputs, its own tools and its own output
// contract. They are deterministic today: the Planner and Tester need no model at all,
// and the Diagnoser and Remediator run through the same adapter interface a hosted model
// will use, so swapping Claude in means changing the adapter, not the orchestrator.
import type { FindingDraft } from "./guards";
import type { RuleResult } from "./rules";
import type { SignalSummary } from "./tools";

export type SubAgentName = "planner" | "tester" | "diagnoser" | "remediator";

/* ------------------------------------------------------------------ planner */

export interface TestPlan {
  journey: "onboarding" | "dispute_filing";
  platform: "android" | "ios" | "web";
  buildId: string;
  screens: { screenId: string; stepNo: number; stepName: string; regulated: boolean }[];
  personas: string[];
  rationale: string;
}

export interface PlannerInput {
  journey: TestPlan["journey"];
  platform: TestPlan["platform"];
  buildId: string;
  steps: { screenId: string; stepNo: number; stepName: string; stepType: string; regulated: boolean }[];
  maxScreens: number;
}

/**
 * Picks what to test. Regulated and authentication steps first, because that is where the
 * case's evidence says customers are blocked — then the rest in journey order.
 */
export function planTests(input: PlannerInput): TestPlan {
  const priority = (s: PlannerInput["steps"][number]) =>
    (s.regulated ? 0 : 1) + (s.stepType === "auth" ? 0 : 1);
  const ordered = [...input.steps].sort((a, b) => priority(a) - priority(b) || a.stepNo - b.stepNo);
  const screens = ordered.slice(0, input.maxScreens).map(({ screenId, stepNo, stepName, regulated }) => ({
    screenId,
    stepNo,
    stepName,
    regulated,
  }));
  const regulatedCount = screens.filter((s) => s.regulated).length;
  return {
    journey: input.journey,
    platform: input.platform,
    buildId: input.buildId,
    screens,
    personas: ["screen_reader", "senior", "low_literacy"],
    rationale: `Selected ${screens.length} of ${input.steps.length} steps: regulated and authentication steps first (${regulatedCount} regulated), then journey order.`,
  };
}

/* ------------------------------------------------------------------ diagnoser */

export interface DiagnoseInput {
  rule: RuleResult;
  screenId: string;
  journey: TestPlan["journey"];
  stepNo: number;
  stepName: string;
  platform: TestPlan["platform"];
  signals: SignalSummary | null;
  trace: {
    traceId: string;
    stuckStepNo: number | null;
    reasonCode: string;
    persona: string;
    assistiveTech: string;
  } | null;
  fix: Remediation;
}

/** Proposed weights (P044). Uncalibrated — the components stay visible for audit. */
const SEVERITY_WEIGHT = { critical: 40, high: 28, medium: 16, low: 8 } as const;
const IMPACT_WEIGHT = { task_blocked: 20, task_slowed: 10 } as const;

export function priorityScore(input: DiagnoseInput): { score: number; band: "P1" | "P2" | "P3" } {
  const regulatory =
    input.rule.findingType === "banking_policy_violation" || input.rule.findingType === "language_inclusion_issue"
      ? 20
      : 0;
  const journeyCriticality = input.journey === "onboarding" ? 12 : 8;
  const signalBoost = input.signals
    ? Math.min(
        12,
        Math.round(
          (input.signals.unableUnassisted / Math.max(1, input.signals.tickets)) * 10 +
            (input.signals.abandonedAtStep ?? 0) / 50,
        ),
      )
    : 0;
  const traceBoost = input.trace && input.trace.stuckStepNo === input.stepNo ? 8 : 0;
  const raw =
    SEVERITY_WEIGHT[input.rule.severity] +
    IMPACT_WEIGHT[input.rule.userImpact] +
    regulatory +
    journeyCriticality +
    signalBoost +
    traceBoost;
  const score = Math.round(Math.min(100, raw) * 10) / 10;
  return { score, band: score >= 80 ? "P1" : score >= 45 ? "P2" : "P3" };
}

function gateFor(rule: RuleResult): FindingDraft["gate_recommendation"] {
  if (rule.findingType === "banking_policy_violation" || rule.findingType === "language_inclusion_issue") {
    return "escalate_to_compliance";
  }
  if (rule.findingType === "needs_expert_review") return "hold_for_expert_review";
  if (rule.findingType === "wcag_failure" && rule.severity === "critical" && rule.baselineStatus === "in_baseline_2.1_AA") {
    return "recommend_block_pending_human";
  }
  return "advisory";
}

function escalateTo(rule: RuleResult): FindingDraft["escalate_to"] {
  if (rule.findingType === "banking_policy_violation" || rule.findingType === "language_inclusion_issue") {
    return "Compliance";
  }
  if (rule.findingType === "needs_expert_review" || rule.confidence === "low") return "Accessibility specialist";
  if (rule.severity === "critical") return "Accessibility specialist";
  return "Owning squad";
}

/**
 * Turns one rule result, its customer signals and the simulation trace into a finding
 * that answers "what is wrong, who is hurt, what standard (if any), how sure are we".
 * The rule's classification is carried through untouched — the diagnoser may add context
 * but never re-decides whether something is a WCAG failure.
 */
export function diagnose(input: DiagnoseInput): FindingDraft {
  const { rule, fix } = input;
  const { score, band } = priorityScore(input);
  const evidence = [
    rule.evidence,
    rule.nodeIds?.length ? `Nodes: ${rule.nodeIds.join(", ")}.` : "",
    input.trace && input.trace.stuckStepNo === input.stepNo
      ? `Simulation ${input.trace.traceId}: a ${input.trace.assistiveTech} persona was stuck at step ${input.stepNo} (reason: ${input.trace.reasonCode}).`
      : "",
    input.signals && !input.signals.suppressed && input.signals.unableUnassisted > 0
      ? `Customer signal: ${input.signals.unableUnassisted} of ${input.signals.tickets} tickets mapped to this step say the customer could not finish unassisted.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    title: rule.title,
    finding_type: rule.findingType,
    journey: input.journey,
    step_no: input.stepNo,
    step_name: input.stepName,
    platform: input.platform,
    wcag_criteria: rule.criteria,
    wcag_version: rule.wcagVersion,
    conformance_level: rule.conformanceLevel,
    baseline_status: rule.baselineStatus,
    severity: rule.severity,
    confidence: rule.confidence,
    abstention_reason: rule.abstentionReason,
    evidence,
    affected_user_need: rule.affectedUserNeed,
    user_impact: rule.userImpact,
    affected_groups: rule.affectedGroups,
    recommended_fix: fix.recommendedFix,
    fix_rationale: fix.rationale,
    verification_steps: fix.verificationSteps,
    gate_recommendation: gateFor(rule),
    requires_human_review:
      rule.findingType !== "wcag_failure" ||
      rule.confidence !== "high" ||
      gateFor(rule) === "recommend_block_pending_human",
    escalate_to: escalateTo(rule),
    priority_score: score,
    priority_band: band,
  };
}

/* ------------------------------------------------------------------ remediator */

export interface Remediation {
  recommendedFix: string;
  rationale: string;
  verificationSteps: string;
}

/**
 * Fix suggestions per rule. Deliberately conservative where the agent is not allowed to
 * act: the language and liveness entries route to people instead of drafting regulated
 * wording, and nothing here ever proposes removing a security control.
 */
const REMEDIATIONS: Record<string, Remediation> = {
  "name-missing": {
    recommendedFix:
      'Give every interactive control an accessible name that says what it does, for example aria-label="Continue to PAN entry" or a visible label bound with for/id.',
    rationale: "SC 4.1.2 requires a programmatically determinable name; a visual icon alone does not provide one.",
    verificationSteps:
      "Walk the screen with TalkBack and VoiceOver: every control announces a name that distinguishes it from its neighbours.",
  },
  "focus-order": {
    recommendedFix:
      "Make the DOM or view order match the reading order, and remove positive tabindex values that jump the sequence.",
    rationale: "SC 2.4.3 requires a focus order that preserves meaning and operability.",
    verificationSteps: "Tab from the first control to the last: focus follows the visual order with no jumps.",
  },
  "otp-focus-jump": {
    recommendedFix:
      'Use one labelled OTP input, or a group named "OTP, 6 digits" with "Digit n of 6" names; keep focus in place after each keystroke and support paste and auto-fill.',
    rationale:
      "A stable, named OTP control lets assistive-technology users enter a code without losing their position (SC 1.3.1, 2.4.3, 4.1.2).",
    verificationSteps:
      "Enter the OTP with TalkBack and VoiceOver. Focus stays in place, group and digit names are announced, paste and auto-fill work.",
  },
  "lang-attr": {
    recommendedFix: "Set the page or view language attribute to the language actually rendered.",
    rationale: "SC 3.1.1 requires the default human language to be programmatically determinable.",
    verificationSteps: "Inspect the rendered language attribute and confirm the screen reader switches voice.",
  },
  "contrast-indeterminate": {
    recommendedFix:
      "Record the text size and weight for the measured node, then re-evaluate against SC 1.4.3 (4.5:1, or 3:1 for large text).",
    rationale:
      "Between 3:1 and 4.5:1 the outcome depends on text size, which is not captured; asserting a failure would be guessing.",
    verificationSteps: "Measure contrast with the text size and weight recorded, and attach both to the finding.",
  },
  "contrast-fail": {
    recommendedFix: "Darken the foreground or lighten the background to at least 4.5:1 for body text.",
    rationale: "SC 1.4.3 sets 4.5:1 for normal text; the measured ratio is below the large-text threshold too.",
    verificationSteps: "Re-measure contrast on the shipped build and confirm 4.5:1 or better.",
  },
  "resize-text": {
    recommendedFix: "Support the platform font-scale setting up to 200% without clipping or loss of function.",
    rationale: "SC 1.4.4 requires text to resize without assistive technology and without losing content.",
    verificationSteps: "Set the device font scale to its maximum and confirm no text is clipped and all actions work.",
  },
  "focus-visible": {
    recommendedFix: "Restore a visible focus indicator with sufficient contrast against both backgrounds.",
    rationale: "SC 2.4.7 requires a visible keyboard focus indicator.",
    verificationSteps: "Tab through the screen and confirm the focused control is visibly distinct in both themes.",
  },
  "status-message": {
    recommendedFix:
      "Expose results and errors as status messages (a live region), or move focus to the message when it appears.",
    rationale: "SC 4.1.3 requires status changes to be available to assistive technology without a focus change.",
    verificationSteps:
      "Trigger the success and error states with a screen reader: the message is announced without moving focus manually.",
  },
  "error-suggestion": {
    recommendedFix:
      "State the problem and the correction in plain words, naming the field and showing the expected format.",
    rationale: "SC 3.3.1 requires the error to be identified; 3.3.3 requires a suggestion when one is known.",
    verificationSteps:
      "Trigger each error: the message names the field, states the problem and suggests a correction.",
  },
  timeout: {
    recommendedFix:
      "Let the customer extend or restart the code within the session, and announce the remaining time. Any change to the expiry window needs Security's assessment first.",
    rationale:
      "SC 2.2.1 requires the time limit to be adjustable unless an exception applies; the security exception must be assessed, not assumed.",
    verificationSteps: "Confirm an extension is offered before expiry and that the screen reader announces it.",
  },
  "tap-target": {
    recommendedFix: "Raise the tappable area to at least 48 dp with spacing, keeping the visual size if needed.",
    rationale:
      "This is platform guidance, not a WCAG 2.1 AA criterion: 2.5.5 is AAA and 2.2's 2.5.8 asks for only 24 px.",
    verificationSteps: "Measure target bounds on the shipped build; confirm 48 dp or more, or document the spacing.",
  },
  "language-coverage": {
    recommendedFix:
      "Hand this to the localisation workstream for reviewed Hindi and Tamil versions. The agent does not draft or ship regulated wording; a native speaker and Compliance approve before release.",
    rationale:
      "No WCAG criterion requires translation. The obligation comes from banking regulation, which Compliance interprets.",
    verificationSteps:
      "Compliance confirms the language obligation and an approved translation renders on the screen.",
  },
  "liveness-blink-only": {
    recommendedFix:
      "Add an accessible liveness alternative — audio-guided, passive, or assisted verification — and tell customers how to request it. Route the case to Compliance before release.",
    rationale:
      "The RBI text is verified; whether this amounts to a breach is a legal judgement reserved for Compliance.",
    verificationSteps:
      "Compliance reviews against the RBI KYC Directions, and the alternative is tested with affected users.",
  },
  "reading-level": {
    recommendedFix:
      "Draft a plain-language version at about grade 6–8 with short sentences and a glossary, and send it to Compliance with the original wording alongside.",
    rationale: "Reading level is an AAA best practice (SC 3.1.5), not an AA failure, but the barrier is real.",
    verificationSteps:
      "A content designer reviews the rewrite and Compliance confirms the legal meaning is unchanged.",
  },
  "redundant-entry": {
    recommendedFix:
      "Carry forward information already given in the journey, unless re-entry is essential or required for security.",
    rationale: "SC 3.3.7 is new in WCAG 2.2, so this is reported as supplemental and does not gate the release.",
    verificationSteps: "Complete the journey once and confirm no field asks again for data already provided.",
  },
  "auth-load": {
    recommendedFix:
      "Reduce memory load within the existing factors: allow paste and auto-fill, keep the code visible, and show progress. Do not remove a factor — any change to authentication goes to Security.",
    rationale:
      "W3C does not treat multi-factor login as a 3.3.8 failure, so this is cognitive load rather than a conformance failure.",
    verificationSteps: "Walk the full chain with a senior persona and confirm each step can be completed from one screen.",
  },
  "cognitive-test": {
    recommendedFix: "Record the puzzle type, then have a specialist judge whether an exception applies.",
    rationale: "Object-recognition puzzles are exempt at AA, and the type is not captured, so the evidence cannot decide.",
    verificationSteps: "Capture the puzzle type and alternatives, then re-evaluate against SC 3.3.8.",
  },
};

const FALLBACK: Remediation = {
  recommendedFix: "Hold for a specialist: no suggested fix is available for this rule.",
  rationale: "The agent proposes a fix only where it has a rule-backed one.",
  verificationSteps: "A specialist defines the test and the pass condition.",
};

export function remediate(ruleId: string): Remediation {
  return REMEDIATIONS[ruleId] ?? FALLBACK;
}

export const REMEDIATION_COVERAGE = Object.keys(REMEDIATIONS).length;
