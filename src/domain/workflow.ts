import type { Finding, FindingStatus, Severity, VerificationRun, Role } from "./types";
import { fixtures } from "./fixtures";

export type FindingAction =
  | "request_review"
  | "approve"
  | "reject"
  | "start_remediation"
  | "mark_ready"
  | "send_compliance"
  | "verify_pass"
  | "verify_fail";

const TRANSITIONS: Record<FindingAction, { from: FindingStatus[]; to: FindingStatus }> = {
  request_review: { from: ["open"], to: "in_review" },
  approve: { from: ["open", "in_review", "held_for_expert_review"], to: "remediation_in_progress" },
  reject: { from: ["open", "in_review", "held_for_expert_review"], to: "rejected" },
  start_remediation: { from: ["in_review"], to: "remediation_in_progress" },
  send_compliance: {
    from: [
      "open",
      "in_review",
      "held_for_expert_review",
      "remediation_in_progress",
      "ready_for_verification",
    ],
    to: "awaiting_compliance",
  },
  mark_ready: { from: ["remediation_in_progress"], to: "ready_for_verification" },
  verify_pass: { from: ["ready_for_verification"], to: "verified" },
  verify_fail: { from: ["ready_for_verification"], to: "remediation_in_progress" },
};

export const AI_ACTORS = ["ai", "llm", "model", "agent", "system"];
export const isAiActor = (actor: string) => AI_ACTORS.includes(actor.trim().toLowerCase());

export function allowedActions(status: FindingStatus): FindingAction[] {
  return (Object.keys(TRANSITIONS) as FindingAction[]).filter((a) =>
    TRANSITIONS[a].from.includes(status),
  );
}

export function canAct(role: Role, action: FindingAction): boolean {
  if (role === "admin") return true;
  if (role === "viewer") return false;
  if (["approve", "reject", "send_compliance", "verify_pass", "verify_fail"].includes(action))
    return role === "reviewer";
  return role === "engineer" || (role === "reviewer" && action === "request_review");
}

export const REJECT_REASONS = [
  "false_positive",
  "exception_applies",
  "duplicate",
  "insufficient_evidence",
  "other",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];
export function validateRejection(reason?: string, note?: string): void {
  if (!REJECT_REASONS.some((r) => r === reason)) throw new Error("Choose a rejection reason.");
  if (reason === "other" && !note?.trim()) throw new Error("Describe the other reason.");
}

export function nextStatus(status: FindingStatus, action: FindingAction): FindingStatus {
  const t = TRANSITIONS[action];
  if (!t.from.includes(status))
    throw new Error(`Cannot ${action.replace("_", " ")} from ${status}`);
  return t.to;
}

/**
 * A finding may become verified ONLY with a passing verification run recorded by a
 * named human. AI recommendations never count as evidence of a fix.
 */
export function canMarkVerified(
  finding: Finding,
  run: Pick<VerificationRun, "result" | "verifiedBy">,
): { ok: boolean; reason?: string } {
  if (finding.status !== "ready_for_verification")
    return { ok: false, reason: "Finding is not ready for verification" };
  if (run.result !== "pass") return { ok: false, reason: "Verification did not pass" };
  if (!run.verifiedBy.trim() || isAiActor(run.verifiedBy))
    return { ok: false, reason: "A human verifier is required" };
  return { ok: true };
}

/* ---------------- Deterministic rule engine (scan worker simulation) ---------------- */

export type RuleTemplate = Finding & { snippet: string };
export const RULES: RuleTemplate[] = fixtures.findings.map((f) => ({ ...f, snippet: f.evidence }));

export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The same seed always picks the same subset, in the items' own order. Used by the
 * scan worker so a given staging build reproduces its findings exactly.
 */
export function pickDeterministic<T>(seed: string, items: T[], min = 2): T[] {
  const h = hashString(seed);
  const picked = items.filter((_, i) => ((h >> (i % 31)) & 1) === 1);
  return picked.length >= min ? picked : items.slice(0, min);
}

/** Same URL always yields the same rule set — at least two rules, in stable order. */
export function deterministicRules(targetUrl: string): RuleTemplate[] {
  return pickDeterministic(targetUrl, RULES, 2);
}

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];
