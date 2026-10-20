// Output guards. Every finding the agent produces passes through here before it reaches
// the database, and these are pure functions so they can be tested without a model or a
// network. A guard failure is never "retry until it passes": it rejects or escalates.
import { z } from "zod";

import type { PolicyChunk } from "./tools";

/** WCAG 2.1 Level A and AA — the gate baseline. Nothing outside it may be called a failure. */
export const BASELINE_CRITERIA = [
  "1.1.1", "1.3.1", "1.4.3", "1.4.4", "2.2.1", "2.4.3", "2.4.7",
  "3.1.1", "3.1.2", "3.3.1", "3.3.3", "4.1.2", "4.1.3",
] as const;

/** New in WCAG 2.2: reportable, never gating, and never labelled an AA baseline failure. */
export const SUPPLEMENTAL_CRITERIA = ["2.5.8", "3.3.7", "3.3.8"] as const;

/** Level AAA: best practice, not conformance. */
export const AAA_CRITERIA = ["2.5.5", "3.1.5"] as const;

export const FindingDraftSchema = z
  .object({
    title: z.string().trim().min(8).max(160),
    finding_type: z.enum([
      "wcag_failure",
      "accessibility_usability_issue",
      "cognitive_load_issue",
      "language_inclusion_issue",
      "banking_policy_violation",
      "needs_expert_review",
    ]),
    journey: z.enum(["onboarding", "dispute_filing"]),
    step_no: z.number().int().min(1).max(20),
    step_name: z.string().trim().min(2).max(120),
    platform: z.enum(["android", "ios", "web"]),
    wcag_criteria: z.array(z.string().regex(/^\d\.\d\.\d+$/)).nullable(),
    wcag_version: z.string().max(60).nullable(),
    conformance_level: z.enum(["A", "AA", "AAA", "A/AA"]).nullable(),
    baseline_status: z.enum([
      "in_baseline_2.1_AA",
      "supplemental_2.2",
      "aaa_best_practice",
      "outside_AA_baseline",
      "outside_wcag",
    ]),
    severity: z.enum(["critical", "high", "medium", "low"]),
    confidence: z.enum(["high", "medium", "low"]),
    abstention_reason: z.string().max(400).nullable(),
    evidence: z.string().trim().min(10).max(2000),
    affected_user_need: z.string().trim().min(5).max(200),
    user_impact: z.enum(["task_blocked", "task_slowed"]),
    affected_groups: z.array(z.string().max(60)).min(1),
    recommended_fix: z.string().trim().min(10).max(2000),
    fix_rationale: z.string().max(2000),
    verification_steps: z.string().trim().min(10).max(1000),
    gate_recommendation: z.enum([
      "advisory",
      "hold_for_expert_review",
      "escalate_to_compliance",
      "recommend_block_pending_human",
    ]),
    requires_human_review: z.boolean(),
    escalate_to: z.enum(["Owning squad", "Accessibility specialist", "Compliance"]),
    priority_score: z.number().min(0).max(100),
    priority_band: z.enum(["P1", "P2", "P3"]),
  })
  // The model may not set a status, an id, a reviewer or a Jira key. Anything it adds
  // beyond the contract is a reason to reject, not to sanitise quietly.
  .strict();

export type FindingDraft = z.infer<typeof FindingDraftSchema>;

export type GuardVerdict = "ok" | "rejected" | "escalated";
export interface GuardResult {
  verdict: GuardVerdict;
  reasons: string[];
  /** Chunks that may be cited as support, after the unapproved ones are dropped. */
  citableSources: string[];
  contextSources: string[];
}

const PII_PATTERNS: [string, RegExp][] = [
  ["mobile number", /\b[6-9]\d{9}\b/],
  ["Aadhaar-like number", /\b\d{4}\s?\d{4}\s?\d{4}\b/],
  ["PAN", /\b[A-Z]{5}\d{4}[A-Z]\b/],
  ["email address", /\b[\w.+-]+@(?!example\.invalid)[\w-]+\.[a-z]{2,}\b/i],
  ["card number", /\b(?:\d[ -]?){13,19}\b/],
];

const UNSAFE_PATTERNS: [string, RegExp][] = [
  ["recommends weakening authentication", /\b(remove|disable|skip|drop|bypass|turn off)\b[^.]{0,40}\b(factor|otp|mpin|2fa|two[- ]factor|authentication|liveness|kyc)\b/i],
  ["claims compliance certification", /\b(is|are|now)\s+(fully\s+)?(wcag|rpwd|rbi|dpdp)[^.]{0,20}\bcompliant\b|\bcertif(y|ies|ied)\b[^.]{0,30}\bcompliance\b/i],
  ["closes the loop itself", /\b(marked|mark)\s+(as\s+)?(resolved|verified|closed)\b|\bno further review (is )?(needed|required)\b/i],
  ["approves regulated wording", /\b(approved|approve)\b[^.]{0,30}\b(translation|regulated wording|consent text)\b/i],
];

const freeText = (draft: FindingDraft): string =>
  [
    draft.title,
    draft.evidence,
    draft.recommended_fix,
    draft.fix_rationale,
    draft.verification_steps,
    draft.affected_user_need,
    draft.abstention_reason ?? "",
  ].join("\n");

/**
 * Runs every output rule. `chunks` are the policy chunks the agent was given for this
 * finding; support may rest only on the approved ones.
 */
export function guardFinding(draft: FindingDraft, chunks: PolicyChunk[]): GuardResult {
  const reasons: string[] = [];
  let escalate = false;

  const citable = chunks.filter((c) => c.citable).map((c) => c.id);
  const context = chunks.filter((c) => !c.citable).map((c) => c.id);

  // 1. WCAG discipline.
  if (draft.finding_type === "wcag_failure") {
    if (!draft.wcag_criteria?.length || !draft.wcag_version || !draft.conformance_level) {
      reasons.push("A WCAG failure must name its criteria, version and level.");
    }
    for (const c of draft.wcag_criteria ?? []) {
      const inBaseline = (BASELINE_CRITERIA as readonly string[]).includes(c);
      const supplemental = (SUPPLEMENTAL_CRITERIA as readonly string[]).includes(c);
      const aaa = (AAA_CRITERIA as readonly string[]).includes(c);
      if (!inBaseline && !supplemental && !aaa) {
        reasons.push(`WCAG ${c} is not on the allow-list for this product.`);
      }
      if (aaa && draft.baseline_status === "in_baseline_2.1_AA") {
        reasons.push(`WCAG ${c} is Level AAA and cannot be an AA baseline failure.`);
      }
      if (supplemental && draft.baseline_status === "in_baseline_2.1_AA") {
        reasons.push(`WCAG ${c} is new in 2.2 and must be reported as supplemental, not as a 2.1 AA failure.`);
      }
    }
  } else if (draft.wcag_criteria?.length && draft.baseline_status === "in_baseline_2.1_AA" && draft.finding_type !== "needs_expert_review") {
    reasons.push("Only a wcag_failure may claim the 2.1 AA baseline.");
  }

  // 2. Grounding. A conformance or policy claim needs at least one approved source.
  if ((draft.finding_type === "wcag_failure" || draft.finding_type === "banking_policy_violation") && !citable.length) {
    reasons.push("No verified policy source supports this claim; unapproved chunks are context only.");
  }

  // 3. Honest uncertainty.
  if (draft.confidence === "low" && !draft.abstention_reason?.trim()) {
    reasons.push("Low confidence requires an abstention reason.");
  }

  // 4. Who decides.
  const mustEscalate = ["needs_expert_review", "banking_policy_violation", "language_inclusion_issue"];
  if (mustEscalate.includes(draft.finding_type) && !draft.requires_human_review) {
    reasons.push(`${draft.finding_type} always requires human review.`);
  }
  if (draft.gate_recommendation === "recommend_block_pending_human" && !draft.requires_human_review) {
    reasons.push("A block recommendation requires human review.");
  }
  if (draft.finding_type === "banking_policy_violation" && draft.escalate_to !== "Compliance") {
    reasons.push("A candidate policy breach goes to Compliance, nobody else.");
  }
  if (mustEscalate.includes(draft.finding_type)) escalate = true;

  // 5. Privacy.
  const text = freeText(draft);
  for (const [label, pattern] of PII_PATTERNS) {
    if (pattern.test(text)) reasons.push(`Output contains what looks like a ${label}.`);
  }

  // 6. The things the agent may never say.
  for (const [label, pattern] of UNSAFE_PATTERNS) {
    if (pattern.test(text)) reasons.push(`Unsafe output: ${label}.`);
  }

  if (reasons.length) return { verdict: "rejected", reasons, citableSources: citable, contextSources: context };
  return {
    verdict: escalate ? "escalated" : "ok",
    reasons: escalate ? [`Routed to ${draft.escalate_to} before any squad sees it.`] : [],
    citableSources: citable,
    contextSources: context,
  };
}

/** Parses an untrusted model payload, then guards it. Parse failures are rejections. */
export function validateAndGuard(
  payload: unknown,
  chunks: PolicyChunk[],
): { draft: FindingDraft | null; result: GuardResult } {
  const parsed = FindingDraftSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      draft: null,
      result: {
        verdict: "rejected",
        reasons: parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".") || "payload"}: ${i.message}`),
        citableSources: [],
        contextSources: [],
      },
    };
  }
  return { draft: parsed.data, result: guardFinding(parsed.data, chunks) };
}
