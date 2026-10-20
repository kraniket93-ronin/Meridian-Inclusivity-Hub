// Row ↔ domain mapping for the public.app_* tables. Pure functions, no I/O, so they
// can be unit-tested and reused by any adapter.
import type {
  AuditEvent,
  DbState,
  Evidence,
  Finding,
  ModelRun,
  PolicySource,
  Project,
  Recommendation,
  ReviewTask,
  Scan,
  ScanJob,
  VerificationRun,
} from "./types";

// Rows arrive as untyped JSON from PostgREST; the mappers are the only place that
// touches raw column names, and each one narrows the row into a domain object.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = any;

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const optArr = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.length ? v.map(String) : undefined;
const opt = (v: unknown): string | undefined => (typeof v === "string" && v.length ? v : undefined);

export function toProject(r: Row): Project {
  return {
    id: str(r.id),
    name: str(r.name),
    baseUrl: str(r.base_url),
    owner: str(r.owner),
    journeys: Array.isArray(r.journeys) ? r.journeys : [],
    platforms: arr(r.platforms),
  };
}

export function toScan(r: Row): Scan {
  return {
    id: str(r.id),
    projectId: str(r.project_id),
    targetUrl: str(r.target_url),
    scope: str(r.scope),
    status: r.status,
    engines: arr(r.engines),
    createdAt: str(r.created_at),
    createdBy: str(r.created_by),
    ...(r.completed_at ? { completedAt: str(r.completed_at) } : {}),
  };
}

export function toScanJob(r: Row): ScanJob {
  return {
    id: str(r.id),
    scanId: str(r.scan_id),
    status: r.status,
    attempts: Number(r.attempts ?? 0),
    progress: Number(r.progress ?? 0),
    updatedAt: str(r.updated_at),
    ...(r.error ? { error: str(r.error) } : {}),
  };
}

export function toPolicySource(r: Row): PolicySource {
  return { id: str(r.id), title: str(r.title), status: r.status };
}

/** `sources` comes from the ordered join table; the finding keeps its citation order. */
export function toFinding(r: Row, sources: PolicySource[]): Finding {
  return {
    id: str(r.id),
    scanId: str(r.scan_id),
    goldenSetId: str(r.golden_set_id),
    ruleId: str(r.rule_id),
    title: str(r.title),
    severity: r.severity,
    status: r.status,
    journey: r.journey,
    stepNo: Number(r.step_no ?? 0),
    stepName: str(r.step_name),
    platform: r.platform,
    screenId: str(r.screen_id),
    findingType: r.finding_type,
    wcag: str(r.wcag),
    wcagCriteria:
      Array.isArray(r.wcag_criteria) && r.wcag_criteria.length ? r.wcag_criteria.map(String) : null,
    wcagVersion: r.wcag_version ?? null,
    conformanceLevel: r.conformance_level ?? null,
    baselineStatus: r.baseline_status,
    confidence: r.confidence,
    abstentionReason: r.abstention_reason ?? null,
    evidence: str(r.evidence),
    affectedUserNeed: str(r.affected_user_need),
    userImpact: r.user_impact,
    affectedGroups: arr(r.affected_groups),
    recommendedFix: str(r.recommended_fix),
    fixRationale: str(r.fix_rationale),
    verificationSteps: str(r.verification_steps),
    gateRecommendation: r.gate_recommendation,
    requiresHumanReview: Boolean(r.requires_human_review),
    escalateTo: r.escalate_to,
    policySources: sources,
    priorityScore: Number(r.priority_score ?? 0),
    priorityBand: r.priority_band,
    selector: str(r.selector),
    pageUrl: str(r.page_url),
    createdAt: str(r.created_at),
    ...(optArr(r.node_ids) ? { nodeIds: optArr(r.node_ids)! } : {}),
    ...(opt(r.simulation_trace) ? { simulationTrace: opt(r.simulation_trace)! } : {}),
    ...(opt(r.assignee) ? { assignee: opt(r.assignee)! } : {}),
    ...(opt(r.description) ? { description: opt(r.description)! } : {}),
    ...(opt(r.callout) ? { callout: opt(r.callout)! } : {}),
    ...(opt(r.extra_note) ? { extraNote: opt(r.extra_note)! } : {}),
  };
}

export function toEvidence(r: Row): Evidence {
  return { id: str(r.id), findingId: str(r.finding_id), kind: r.kind, content: str(r.content) };
}

export function toRecommendation(r: Row): Recommendation {
  return {
    id: str(r.id),
    findingId: str(r.finding_id),
    modelRunId: str(r.model_run_id),
    summary: str(r.summary),
    proposedFix: str(r.proposed_fix),
    rationale: str(r.rationale),
    confidence: Number(r.confidence ?? 0),
    policyRefs: arr(r.policy_refs),
    createdAt: str(r.created_at),
  };
}

export function toModelRun(r: Row): ModelRun {
  return {
    id: str(r.id),
    findingId: str(r.finding_id),
    provider: str(r.provider),
    model: str(r.model),
    status: r.status,
    latencyMs: Number(r.latency_ms ?? 0),
    promptVersion: str(r.prompt_version),
    createdAt: str(r.created_at),
  };
}

export function toReviewTask(r: Row): ReviewTask {
  return {
    id: str(r.id),
    findingId: str(r.finding_id),
    status: r.status,
    createdAt: str(r.created_at),
    ...(opt(r.reviewer) ? { reviewer: opt(r.reviewer)! } : {}),
    ...(opt(r.decision_note) ? { decisionNote: opt(r.decision_note)! } : {}),
    ...(opt(r.decided_at) ? { decidedAt: opt(r.decided_at)! } : {}),
  };
}

export function toVerificationRun(r: Row): VerificationRun {
  return {
    id: str(r.id),
    findingId: str(r.finding_id),
    method: r.method,
    result: r.result,
    verifiedBy: str(r.verified_by),
    notes: str(r.notes),
    createdAt: str(r.created_at),
  };
}

export function toAuditEvent(r: Row): AuditEvent {
  return {
    id: str(r.id),
    actor: str(r.actor),
    action: str(r.action),
    entity: str(r.entity),
    entityId: str(r.entity_id),
    createdAt: str(r.created_at),
  };
}

/** Domain → row, for the finding columns a new scan writes. */
export function findingInsert(f: Finding): Row {
  return {
    id: f.id,
    scan_id: f.scanId,
    golden_set_id: f.goldenSetId,
    rule_id: f.ruleId,
    title: f.title,
    description: f.description ?? null,
    callout: f.callout ?? null,
    extra_note: f.extraNote ?? null,
    journey: f.journey,
    step_no: f.stepNo,
    step_name: f.stepName,
    platform: f.platform,
    screen_id: f.screenId,
    finding_type: f.findingType,
    wcag: f.wcag,
    wcag_criteria: f.wcagCriteria,
    wcag_version: f.wcagVersion,
    conformance_level: f.conformanceLevel,
    baseline_status: f.baselineStatus,
    severity: f.severity,
    confidence: f.confidence,
    abstention_reason: f.abstentionReason,
    evidence: f.evidence,
    node_ids: f.nodeIds ?? null,
    simulation_trace: f.simulationTrace ?? null,
    affected_user_need: f.affectedUserNeed,
    user_impact: f.userImpact,
    affected_groups: f.affectedGroups,
    recommended_fix: f.recommendedFix,
    fix_rationale: f.fixRationale,
    verification_steps: f.verificationSteps,
    gate_recommendation: f.gateRecommendation,
    requires_human_review: f.requiresHumanReview,
    escalate_to: f.escalateTo,
    priority_score: f.priorityScore,
    priority_band: f.priorityBand,
    status: f.status,
    assignee: f.assignee ?? null,
    selector: f.selector,
    page_url: f.pageUrl,
  };
}

export const emptyState = (): DbState => ({
  projects: [],
  scans: [],
  scanJobs: [],
  findings: [],
  evidence: [],
  recommendations: [],
  reviewTasks: [],
  verificationRuns: [],
  policySources: [],
  modelRuns: [],
  auditEvents: [],
});
