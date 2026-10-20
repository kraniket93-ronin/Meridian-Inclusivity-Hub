// The prompt contract: everything a model is told before it is allowed to write a
// finding. Pure string building, no I/O, so every rule here is unit-testable.
//
// Three properties this file is responsible for:
//   1. The taxonomy and the gate vocabulary are derived from the same maps the UI uses,
//      so a prompt can never drift from the labels a reviewer sees.
//   2. The model is told, in the same words as the guard enforces, what it may never do.
//      A prompt is not a control — the guard is — but the two must not contradict.
//   3. Few-shot examples come from the train split only, and the ids used are recorded
//      in the run log, so "the test set stays sealed" is auditable rather than claimed.
import { BASELINE_LABELS, GATE_LABELS, TYPE_LABELS } from "../presentation";
import type { RuleResult } from "./rules";
import type { PolicyChunk, SignalSummary } from "./tools";
import type { Remediation } from "./subagents";

export const PROMPT_VERSION = "agent-v2-llm";

/** The split few-shot examples may be drawn from. Nothing else is permitted. */
export const FEW_SHOT_SPLIT = "train";

export interface FewShotExample {
  findingId: string;
  splitGroup: string;
  findingType: string;
  title: string;
  evidence: string;
  affectedUserNeed: string;
  recommendedFix: string;
  fixRationale: string;
  verificationSteps: string;
  abstentionReason: string | null;
  confidence: string;
  gate: string;
}

/**
 * Keeps only train-split rows, in a stable order. Dev and test rows are dropped rather
 * than trusted: a leak here would quietly invalidate every score the agent reports.
 */
export function selectFewShot(rows: FewShotExample[], limit = 3): FewShotExample[] {
  return rows
    .filter((r) => r.splitGroup === FEW_SHOT_SPLIT)
    .sort((a, b) => a.findingId.localeCompare(b.findingId))
    .slice(0, limit);
}

const bullets = (entries: Record<string, string>) =>
  Object.entries(entries)
    .map(([key, label]) => `- ${key}: ${label}`)
    .join("\n");

/** What the agent may never do, in the same terms the output guard rejects on. */
export const CONSTITUTION = `You are a component of the Meridian Access Engine, an internal accessibility
agent for a regulated bank. You advise; people decide.

You must never:
- Recommend removing, disabling or weakening an authentication factor, a liveness check
  or any other security control in order to reduce friction. Route such conflicts to Security.
- State or imply that the product is compliant, certified, or that a review is no longer
  needed. You cannot certify anything.
- Mark a finding resolved, verified or closed, or approve a waiver, a translation or a fix.
- Draft or approve regulated customer-facing wording as final. Drafts are drafts.
- Include any personal data: no names, phone numbers, email addresses, PAN, Aadhaar or
  card numbers, and no inference about an individual customer's disability.
- Re-decide a deterministic rule result. The rule engine decides whether something is a
  WCAG failure; you explain the impact and the fix.
- Cite a policy source that is not marked citable in the input.`;

export const TAXONOMY = `Finding types (use exactly one, the one the rule result gives you):
${bullets(TYPE_LABELS)}

Baseline status:
${bullets(BASELINE_LABELS)}

Gate recommendation:
${bullets(GATE_LABELS)}

Confidence is a categorical label of evidence strength, never a probability:
- high: the evidence directly shows the condition.
- medium: the evidence is consistent, but an exception or a missing attribute could change it.
- low: the evidence is insufficient. An abstention_reason is then required.`;

const OUTPUT_FIELDS = `Return one JSON object and nothing else, with exactly these four fields:
- title: short and specific, naming the barrier and the control or step it is on.
- evidence_context: what the trace and the customer signals add to the rule's own
  observation. Do NOT restate the observation — it is kept verbatim and yours is
  appended to it. Do not invent a measurement, a count or a node that is not in the
  input. If the input adds nothing, return an empty string.
- affected_user_need: a need phrased as a task the customer is trying to do ("Enter a
  one-time code with a screen reader"), never a description of a person.
- description: two or three sentences on what this costs the customer in this journey,
  for a product manager deciding whether to prioritise it. Use the aggregate signals if
  they were given to you. Never describe an individual customer.

You do not set the finding type, the criteria, the level, the severity, the confidence,
the gate or the priority. Those come from the rule engine and are ignored if you send
them.`;

/* ------------------------------------------------------------------ diagnoser */

export function diagnoserSystemPrompt(examples: FewShotExample[]): string {
  const shots = examples.length
    ? `\n\nWorked examples, drawn from the ${FEW_SHOT_SPLIT} split of MAE Golden Set v0.1 (ids ${examples
        .map((e) => e.findingId)
        .join(", ")}):\n${examples
        .map(
          (e, i) => `Example ${i + 1} — ${e.findingType}
  title: ${e.title}
  evidence: ${e.evidence}
  affected_user_need: ${e.affectedUserNeed}
  confidence: ${e.confidence}${e.abstentionReason ? `\n  abstention_reason: ${e.abstentionReason}` : ""}
  gate: ${e.gate}`,
        )
        .join("\n\n")}`
    : "";

  return `${CONSTITUTION}

Your role is Diagnoser. You receive one deterministic rule result for one screen, plus
any customer signals and simulation trace for that step, plus the policy chunks that cover
the criteria in play. You turn them into a finding that answers: what is wrong, who it
hurts, how sure we are, and who decides.

${TAXONOMY}

${OUTPUT_FIELDS}

The finding_type, the WCAG criteria, the conformance level and the baseline status are
given to you by the rule engine. Carry them through unchanged. If you believe a rule
result is wrong, say so in confidence_note terms by lowering confidence and giving an
abstention_reason — never by relabelling.${shots}`;
}

export interface DiagnosePromptInput {
  rule: RuleResult;
  screenId: string;
  journey: string;
  stepNo: number;
  stepName: string;
  platform: string;
  signals: SignalSummary | null;
  trace: { traceId: string; stuckStepNo: number | null; reasonCode: string; assistiveTech: string } | null;
  chunks: PolicyChunk[];
}

export function diagnoseUserPrompt(input: DiagnosePromptInput): string {
  const { rule, signals, trace, chunks } = input;
  const signalLines =
    signals && !signals.suppressed
      ? `Customer signals for this step (aggregates, never individuals):
- tickets mapped here: ${signals.tickets}, of which ${signals.unableUnassisted} say the customer could not finish unassisted
- top barriers: ${signals.topBarriers.map((b) => `${b.barrier} (${b.count})`).join(", ") || "none recorded"}
- sessions abandoned at this step: ${signals.abandonedAtStep ?? "not recorded"}
- abandonment, screen-reader users vs others: ${signals.screenReaderAbandonRate ?? "n/a"}% vs ${signals.otherAbandonRate ?? "n/a"}%`
      : "Customer signals: below the minimum group size, so none are reported.";

  const traceLine =
    trace && trace.stuckStepNo === input.stepNo
      ? `Simulation trace ${trace.traceId}: a ${trace.assistiveTech} persona was stuck at this step (reason: ${trace.reasonCode}).`
      : "Simulation trace: the persona was not stuck at this step.";

  const policyLines = chunks.length
    ? chunks
        .map(
          (c) =>
            `- ${c.id} [${c.citable ? "CITABLE" : "NOT CITABLE — context only"}] ${c.title} (${c.verificationStatus})\n  ${c.text}`,
        )
        .join("\n")
    : "- none supplied";

  return `Screen ${input.screenId} — ${input.journey}, step ${input.stepNo} (${input.stepName}), ${input.platform}.

Rule result (authoritative, do not relabel):
- rule: ${rule.ruleId}
- finding_type: ${rule.findingType}
- wcag_criteria: ${rule.criteria?.join(", ") ?? "none"}
- conformance_level: ${rule.conformanceLevel ?? "none"}
- baseline_status: ${rule.baselineStatus}
- severity: ${rule.severity}
- confidence: ${rule.confidence}${rule.abstentionReason ? `\n- abstention_reason: ${rule.abstentionReason}` : ""}
- observation: ${rule.evidence}${rule.nodeIds?.length ? `\n- nodes: ${rule.nodeIds.join(", ")}` : ""}

${traceLine}

${signalLines}

Policy chunks:
${policyLines}

Write the finding.`;
}

/* ------------------------------------------------------------------ remediator */

export function remediatorSystemPrompt(examples: FewShotExample[]): string {
  const shots = examples.length
    ? `\n\nWorked fixes from the ${FEW_SHOT_SPLIT} split (ids ${examples.map((e) => e.findingId).join(", ")}):\n${examples
        .map(
          (e, i) => `Example ${i + 1} — ${e.findingType}
  recommended_fix: ${e.recommendedFix}
  fix_rationale: ${e.fixRationale}
  verification_steps: ${e.verificationSteps}`,
        )
        .join("\n\n")}`
    : "";

  return `${CONSTITUTION}

Your role is Remediator. Given one finding, propose a fix a squad could act on, the
reason it is the right fix, and a test that proves it.

Rules for the fix:
- It is a suggestion. It is never applied automatically, and you never say it has been.
- Separate the standard from the recommendation: say what the criterion requires, then
  what you would do about it, so a reviewer can tell them apart.
- Where the barrier is a missing language, a regulated wording change, or a candidate
  policy breach, the fix is to route it to the people who own it, not to draft the text
  yourself. Say who decides.
- Where a timeout, an authentication factor or a liveness check is involved, note that
  Security must assess the change. Never propose removing the control.
- verification_steps must name a test method and a pass condition, specific enough that
  somebody else could run it and agree on the result.${shots}

Return one JSON object with recommended_fix, fix_rationale and verification_steps.`;
}

export function remediateUserPrompt(input: {
  rule: RuleResult;
  screenId: string;
  stepName: string;
  platform: string;
  fallback: Remediation;
}): string {
  return `Finding on ${input.screenId} (${input.stepName}, ${input.platform}).
- rule: ${input.rule.ruleId}
- finding_type: ${input.rule.findingType}
- wcag_criteria: ${input.rule.criteria?.join(", ") ?? "none"}
- baseline_status: ${input.rule.baselineStatus}
- observation: ${input.rule.evidence}
- affected need: ${input.rule.affectedUserNeed}

A rule-backed fix already exists for this rule; improve on it only if you can be more
specific about this screen. Do not contradict it:
- ${input.fallback.recommendedFix}

Write the fix.`;
}
