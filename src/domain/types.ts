export type Severity = "critical" | "high" | "medium" | "low";
export type ScanStatus = "queued" | "running" | "completed" | "failed";
export type JobStatus = "queued" | "claimed" | "running" | "succeeded" | "failed";
export type FindingStatus =
  | "open"
  | "in_review"
  | "awaiting_compliance"
  | "held_for_expert_review"
  | "rejected"
  | "remediation_in_progress"
  | "ready_for_verification"
  | "verified"
  ;
export type ReviewStatus = "pending" | "approved" | "rejected";
export type VerificationMethod = "manual" | "automated_rescan" | "assistive_tech";
export type Role = "admin" | "reviewer" | "engineer" | "viewer";

export interface Project { id: string; name: string; baseUrl: string; owner: string; journeys: { name: string; steps: number }[]; platforms: string[] }
export interface Scan {
  id: string; projectId: string; targetUrl: string; status: ScanStatus;
  createdAt: string; completedAt?: string; createdBy: string; scope: string; engines: string[];
}
export interface ScanJob {
  id: string; scanId: string; status: JobStatus; attempts: number; progress: number;
  updatedAt: string; error?: string;
}
export interface Finding {
  id: string; scanId: string; ruleId: string; wcag: string; title: string;
  severity: Severity; status: FindingStatus; selector: string; pageUrl: string;
  createdAt: string; assignee?: string;
  goldenSetId: string; journey: "onboarding" | "dispute_filing"; stepNo: number; stepName: string;
  platform: "android" | "ios" | "web"; screenId: string; findingType: FindingType;
  wcagCriteria: string[] | null; wcagVersion: string | null; conformanceLevel: "A" | "AA" | "AAA" | "A/AA" | null;
  baselineStatus: BaselineStatus; confidence: "high" | "medium" | "low"; abstentionReason: string | null;
  evidence: string; nodeIds?: string[]; simulationTrace?: string; affectedUserNeed: string;
  userImpact: "task_blocked" | "task_slowed"; affectedGroups: string[];
  recommendedFix: string; fixRationale: string; verificationSteps: string;
  gateRecommendation: GateRecommendation; requiresHumanReview: boolean;
  escalateTo: "Owning squad" | "Accessibility specialist" | "Compliance";
  policySources: PolicySource[]; priorityScore: number; priorityBand: "P1" | "P2" | "P3";
  description?: string; callout?: string; extraNote?: string;
}
export interface Evidence {
  id: string; findingId: string; kind: "dom_snippet" | "contrast_sample" | "screenshot";
  content: string; storagePath?: string;
}
export interface Recommendation {
  id: string; findingId: string; modelRunId: string; summary: string; proposedFix: string;
  rationale: string; confidence: number; policyRefs: string[]; createdAt: string;
}
export interface ReviewTask {
  id: string; findingId: string; status: ReviewStatus; reviewer?: string;
  decisionNote?: string; createdAt: string; decidedAt?: string;
}
export interface VerificationRun {
  id: string; findingId: string; method: VerificationMethod; result: "pass" | "fail";
  verifiedBy: string; notes: string; createdAt: string;
}
export type FindingType = "wcag_failure" | "accessibility_usability_issue" | "cognitive_load_issue" | "language_inclusion_issue" | "banking_policy_violation" | "needs_expert_review";
export type BaselineStatus = "in_baseline_2.1_AA" | "supplemental_2.2" | "aaa_best_practice" | "outside_AA_baseline" | "outside_wcag";
export type GateRecommendation = "advisory" | "hold_for_expert_review" | "escalate_to_compliance" | "recommend_block_pending_human";
export type SourceStatus = "verified" | "partially_verified" | "unverified" | "proposed_internal";
export interface PolicySource { id: string; title: string; status: SourceStatus }
export interface ModelRun {
  id: string; findingId: string; provider: string; model: string;
  status: "succeeded" | "failed_validation" | "failed"; latencyMs: number;
  promptVersion: string; createdAt: string;
}
export interface AuditEvent { id: string; actor: string; action: string; entity: string; entityId: string; createdAt: string }

export interface DbState {
  projects: Project[]; scans: Scan[]; scanJobs: ScanJob[]; findings: Finding[];
  evidence: Evidence[]; recommendations: Recommendation[]; reviewTasks: ReviewTask[];
  verificationRuns: VerificationRun[]; policySources: PolicySource[];
  modelRuns: ModelRun[]; auditEvents: AuditEvent[];
}
