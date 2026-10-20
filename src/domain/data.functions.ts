// Server functions: every read and write goes to Postgres (Supabase). The secret key
// is loaded inside the handlers, so it never reaches the browser bundle.
//
// Prototype boundary, stated plainly: the signed-in demo identity is sent from the
// client and checked here against the same role rules the UI shows. Replace it with
// Supabase Auth + a user_roles table before this is anything but a demo.
//
// PostgREST hands back untyped JSON rows; `any` is confined to the moment a row is read
// and is narrowed immediately by the mappers, which are the only typed boundary.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { DbState, Finding, Role } from "./types";
import {
  canAct,
  canMarkVerified,
  nextStatus,
  pickDeterministic,
  validateRejection,
  type FindingAction,
} from "./workflow";
import { REJECT_REASONS } from "./workflow";
import {
  findingInsert,
  toAuditEvent,
  toEvidence,
  toFinding,
  toModelRun,
  toPolicySource,
  toProject,
  toRecommendation,
  toReviewTask,
  toScan,
  toScanJob,
  toVerificationRun,
} from "./mappers";

/* ------------------------------------------------------------------ contracts */

export type DataError =
  "not_configured" | "schema_missing" | "upstream_error" | "forbidden" | "invalid";
export type DataResult<T> =
  { ok: true; data: T } | { ok: false; error: DataError; message: string };

const ActorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  role: z.enum(["admin", "reviewer", "engineer", "viewer"]),
});
export type ActorInput = z.infer<typeof ActorSchema>;

const TransitionSchema = z.object({
  findingId: z.string().trim().min(1).max(80),
  action: z.enum([
    "request_review",
    "approve",
    "reject",
    "start_remediation",
    "mark_ready",
    "send_compliance",
  ]),
  note: z.string().trim().max(2000).optional(),
  reason: z.enum(REJECT_REASONS).optional(),
  actor: ActorSchema,
});

const VerificationSchema = z.object({
  findingId: z.string().trim().min(1).max(80),
  method: z.enum(["manual", "automated_rescan", "assistive_tech"]),
  result: z.enum(["pass", "fail"]),
  notes: z.string().trim().min(5, "Describe how it was checked").max(2000),
  actor: ActorSchema,
});

const CreateScanInputSchema = z.object({
  projectId: z.string().trim().min(1).max(80),
  targetUrl: z.string().trim().min(3, "Enter the staging build target").max(200),
  actor: ActorSchema,
});

const RunScanSchema = z.object({ scanId: z.string().trim().min(1).max(80), actor: ActorSchema });

const SaveRecommendationSchema = z.object({
  findingId: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(10).max(300),
  proposedFix: z.string().trim().min(1).max(4000),
  rationale: z.string().trim().min(10).max(1500),
  confidence: z.number().min(0).max(1),
  policyRefs: z.array(z.string().max(16)).min(1),
  run: z.object({
    provider: z.string().max(60),
    model: z.string().max(60),
    latencyMs: z.number().int().min(0),
    promptVersion: z.string().max(40),
  }),
  actor: ActorSchema,
});

const FailedRunSchema = z.object({
  findingId: z.string().trim().min(1).max(80),
  run: z.object({
    provider: z.string().max(60),
    model: z.string().max(60),
    latencyMs: z.number().int().min(0),
    promptVersion: z.string().max(40),
  }),
});

/* ------------------------------------------------------------------ helpers */

type Db = Awaited<ReturnType<typeof loadDb>>;

async function loadDb() {
  const mod = await import("@/integrations/supabase/mae-app.server");
  if (!mod.appDbIsConfigured()) throw new mod.SupabaseNotConfiguredError();
  return mod.getAppDb();
}

function classify(err: unknown): { error: DataError; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof Error && err.name === "SupabaseNotConfiguredError") {
    return { error: "not_configured", message };
  }
  if (/does not exist|PGRST205|schema cache|42P01/i.test(message)) {
    return { error: "schema_missing", message };
  }
  return { error: "upstream_error", message };
}

function fail(err: unknown): { ok: false; error: DataError; message: string } {
  const c = classify(err);
  if (c.error === "upstream_error") console.error("[data]", c.message);
  return { ok: false, ...c };
}

/** Throws on a PostgREST error so one catch can classify every failure. */
function unwrap<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new Error(`${res.error.code ?? ""} ${res.error.message}`.trim());
  return (res.data ?? []) as T;
}

const nowIso = () => new Date().toISOString();
const rid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function writeAudit(
  db: Db,
  entry: { actor: string; action: string; entity: string; entityId: string },
) {
  unwrap(
    await db
      .from("app_audit_events")
      .insert({
        id: rid("aud"),
        ...{
          actor: entry.actor,
          action: entry.action,
          entity: entry.entity,
          entity_id: entry.entityId,
        },
      })
      .select("id"),
  );
}

function requireRole(actor: ActorInput, action: FindingAction) {
  if (!canAct(actor.role as Role, action)) {
    const e = new Error("Your role does not allow this action");
    e.name = "ForbiddenError";
    throw e;
  }
}

async function readState(db: Db): Promise<DbState> {
  const [
    projects,
    scans,
    scanJobs,
    findings,
    findingSources,
    policySources,
    evidence,
    recommendations,
    modelRuns,
    reviewTasks,
    verificationRuns,
    auditEvents,
  ] = await Promise.all([
    db
      .from("app_projects")
      .select("*")
      .order("name")
      .then(unwrap<any[]>),
    db
      .from("app_scans")
      .select("*")
      .order("created_at", { ascending: false })
      .then(unwrap<any[]>),
    db
      .from("app_scan_jobs")
      .select("*")
      .order("updated_at", { ascending: false })
      .then(unwrap<any[]>),
    db
      .from("app_findings")
      .select("*")
      .order("priority_score", { ascending: false })
      .then(unwrap<any[]>),
    db
      .from("app_finding_policy_sources")
      .select("*")
      .order("position")
      .then(unwrap<any[]>),
    db
      .from("app_policy_sources")
      .select("*")
      .order("id")
      .then(unwrap<any[]>),
    db
      .from("app_evidence")
      .select("*")
      .then(unwrap<any[]>),
    db
      .from("app_recommendations")
      .select("*")
      .order("created_at", { ascending: false })
      .then(unwrap<any[]>),
    db
      .from("app_model_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .then(unwrap<any[]>),
    db
      .from("app_review_tasks")
      .select("*")
      .order("created_at", { ascending: false })
      .then(unwrap<any[]>),
    db
      .from("app_verification_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .then(unwrap<any[]>),
    db
      .from("app_audit_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200)
      .then(unwrap<any[]>),
  ]);

  const sourceById = new Map(policySources.map((r) => [String(r.id), toPolicySource(r)]));
  const citations = new Map<string, ReturnType<typeof toPolicySource>[]>();
  for (const row of findingSources) {
    const source = sourceById.get(String(row.policy_source_id));
    if (!source) continue;
    const list = citations.get(String(row.finding_id)) ?? [];
    list.push(source);
    citations.set(String(row.finding_id), list);
  }

  return {
    projects: projects.map(toProject),
    scans: scans.map(toScan),
    scanJobs: scanJobs.map(toScanJob),
    findings: findings.map((r) => toFinding(r, citations.get(String(r.id)) ?? [])),
    evidence: evidence.map(toEvidence),
    recommendations: recommendations.map(toRecommendation),
    reviewTasks: reviewTasks.map(toReviewTask),
    verificationRuns: verificationRuns.map(toVerificationRun),
    policySources: [...sourceById.values()],
    modelRuns: modelRuns.map(toModelRun),
    auditEvents: auditEvents.map(toAuditEvent),
  };
}

/* ------------------------------------------------------------------ reads */

export const fetchAppState = createServerFn({ method: "GET" }).handler(
  async (): Promise<DataResult<DbState>> => {
    try {
      return { ok: true, data: await readState(await loadDb()) };
    } catch (err) {
      return fail(err);
    }
  },
);

/* ------------------------------------------------------------------ writes */

export const transitionFinding = createServerFn({ method: "POST" })
  .validator((input: unknown) => TransitionSchema.parse(input))
  .handler(async ({ data }): Promise<DataResult<{ status: string }>> => {
    const { findingId, action, note, reason, actor } = data;
    try {
      requireRole(actor, action);
      if (action === "reject") validateRejection(reason, note);
      const db = await loadDb();
      const rows = unwrap<any[]>(
        await db.from("app_findings").select("*").eq("id", findingId).limit(1),
      );
      const current = rows[0];
      if (!current) return { ok: false, error: "invalid", message: "Finding not found" };

      const status = nextStatus(current.status, action);
      unwrap(await db.from("app_findings").update({ status }).eq("id", findingId).select("id"));

      if (action === "request_review") {
        unwrap(
          await db
            .from("app_review_tasks")
            .insert({ id: rid("rvw"), finding_id: findingId, status: "pending" })
            .select("id"),
        );
      }
      if (action === "approve" || action === "reject") {
        const decision = action === "approve" ? "approved" : "rejected";
        const pending = unwrap<any[]>(
          await db
            .from("app_review_tasks")
            .select("id")
            .eq("finding_id", findingId)
            .eq("status", "pending"),
        );
        const decisionNote = [reason, note].filter(Boolean).join(": ") || null;
        if (pending.length) {
          unwrap(
            await db
              .from("app_review_tasks")
              .update({
                status: decision,
                reviewer: actor.name,
                decision_note: decisionNote,
                decided_at: nowIso(),
              })
              .in(
                "id",
                pending.map((p) => p.id),
              )
              .select("id"),
          );
        } else {
          unwrap(
            await db
              .from("app_review_tasks")
              .insert({
                id: rid("rvw"),
                finding_id: findingId,
                status: decision,
                reviewer: actor.name,
                decision_note: decisionNote,
                decided_at: nowIso(),
              })
              .select("id"),
          );
        }
      }

      await writeAudit(db, {
        actor: actor.name,
        action: `finding.${action}${reason ? `:${reason}` : ""}${note ? ` — ${note}` : ""}`.slice(
          0,
          400,
        ),
        entity: "finding",
        entityId: findingId,
      });
      return { ok: true, data: { status } };
    } catch (err) {
      if (
        err instanceof Error &&
        (err.name === "ForbiddenError" || /does not allow/.test(err.message))
      ) {
        return { ok: false, error: "forbidden", message: err.message };
      }
      if (err instanceof Error && /^Cannot |rejection reason|other reason/.test(err.message)) {
        return { ok: false, error: "invalid", message: err.message };
      }
      return fail(err);
    }
  });

export const recordVerification = createServerFn({ method: "POST" })
  .validator((input: unknown) => VerificationSchema.parse(input))
  .handler(async ({ data }): Promise<DataResult<{ status: string }>> => {
    const { findingId, method, result, notes, actor } = data;
    try {
      requireRole(actor, "verify_pass");
      const db = await loadDb();
      const rows = unwrap<any[]>(
        await db.from("app_findings").select("*").eq("id", findingId).limit(1),
      );
      const current = rows[0];
      if (!current) return { ok: false, error: "invalid", message: "Finding not found" };

      const finding = { status: current.status } as Finding;
      if (result === "pass") {
        const check = canMarkVerified(finding, { result, verifiedBy: actor.name });
        if (!check.ok)
          return { ok: false, error: "invalid", message: check.reason ?? "Cannot verify" };
      } else if (current.status !== "ready_for_verification") {
        return { ok: false, error: "invalid", message: "Finding is not ready for verification" };
      }

      // The run is written first: the database trigger requires a passing human run
      // to exist before a finding may move to 'verified'.
      unwrap(
        await db
          .from("app_verification_runs")
          .insert({
            id: rid("ver"),
            finding_id: findingId,
            method,
            result,
            verified_by: actor.name,
            notes,
          })
          .select("id"),
      );
      const status = nextStatus(current.status, result === "pass" ? "verify_pass" : "verify_fail");
      unwrap(await db.from("app_findings").update({ status }).eq("id", findingId).select("id"));
      await writeAudit(db, {
        actor: actor.name,
        action: `verification.${result === "pass" ? "passed" : "failed"} (${method})`,
        entity: "finding",
        entityId: findingId,
      });
      return { ok: true, data: { status } };
    } catch (err) {
      if (err instanceof Error && err.name === "ForbiddenError") {
        return { ok: false, error: "forbidden", message: err.message };
      }
      return fail(err);
    }
  });

export const createScan = createServerFn({ method: "POST" })
  .validator((input: unknown) => CreateScanInputSchema.parse(input))
  .handler(async ({ data }): Promise<DataResult<{ scanId: string }>> => {
    const { projectId, targetUrl, actor } = data;
    try {
      if (!["admin", "engineer", "reviewer"].includes(actor.role)) {
        return {
          ok: false,
          error: "forbidden",
          message: "Your role does not allow starting a scan",
        };
      }
      const db = await loadDb();
      const scanId = rid("scn");
      const template = unwrap<any[]>(
        await db.from("app_scans").select("scope, engines").order("created_at").limit(1),
      )[0];
      unwrap(
        await db
          .from("app_scans")
          .insert({
            id: scanId,
            project_id: projectId,
            target_url: targetUrl,
            scope: template?.scope ?? "Onboarding + Dispute filing, all three platforms",
            engines: template?.engines ?? [
              "rule engine (WCAG 2.1 A/AA)",
              "screen-reader journey simulation (mock)",
              "signal mapping (mock)",
            ],
            status: "queued",
            created_by: actor.name,
          })
          .select("id"),
      );
      unwrap(
        await db
          .from("app_scan_jobs")
          .insert({
            id: `job-${scanId}`,
            scan_id: scanId,
            status: "queued",
            attempts: 0,
            progress: 0,
          })
          .select("id"),
      );
      await writeAudit(db, {
        actor: actor.name,
        action: "scan.created",
        entity: "scan",
        entityId: scanId,
      });
      return { ok: true, data: { scanId } };
    } catch (err) {
      return fail(err);
    }
  });

/**
 * The scan worker. Claims the queued job, re-runs the deterministic rule set against
 * the seeded golden-set findings for this build, writes the findings it produced and
 * completes the job. Nothing here is a live scanner: the engines are simulated and
 * every finding it writes is a synthetic MAE Golden Set v0.1 record.
 */
export const runScan = createServerFn({ method: "POST" })
  .validator((input: unknown) => RunScanSchema.parse(input))
  .handler(async ({ data }): Promise<DataResult<{ findings: number }>> => {
    const { scanId, actor } = data;
    try {
      const db = await loadDb();
      const scan = unwrap<any[]>(
        await db.from("app_scans").select("*").eq("id", scanId).limit(1),
      )[0];
      if (!scan) return { ok: false, error: "invalid", message: "Scan not found" };
      if (scan.status === "completed") return { ok: true, data: { findings: 0 } };

      unwrap(
        await db
          .from("app_scan_jobs")
          .update({ status: "running", attempts: 1, progress: 45, updated_at: nowIso() })
          .eq("scan_id", scanId)
          .select("id"),
      );
      unwrap(
        await db.from("app_scans").update({ status: "running" }).eq("id", scanId).select("id"),
      );

      // Rule templates are the seeded scenario's findings — the golden set is the yardstick.
      const seedScan = unwrap<any[]>(
        await db.from("app_scans").select("id").order("created_at").limit(1),
      )[0];
      const templates = unwrap<any[]>(
        await db
          .from("app_findings")
          .select("*")
          .eq("scan_id", seedScan?.id ?? "scn-2001"),
      );
      const sourceLinks = unwrap<any[]>(
        await db.from("app_finding_policy_sources").select("*").order("position"),
      );
      const picked = pickDeterministic(scan.target_url as string, templates, 2);

      const inserts = picked.map((t) => {
        const finding = toFinding(t, []);
        const row = findingInsert({ ...finding, id: `${scanId}-${t.id}`, scanId, status: "open" });
        return row;
      });
      if (inserts.length) {
        unwrap(await db.from("app_findings").insert(inserts).select("id"));
        const links = picked.flatMap((t) =>
          sourceLinks
            .filter((l) => String(l.finding_id) === String(t.id))
            .map((l) => ({
              finding_id: `${scanId}-${t.id}`,
              policy_source_id: l.policy_source_id,
              position: l.position,
            })),
        );
        if (links.length)
          unwrap(await db.from("app_finding_policy_sources").insert(links).select("finding_id"));
        const evidence = picked.map((t) => ({
          id: rid("evd"),
          finding_id: `${scanId}-${t.id}`,
          kind: "dom_snippet",
          content: String(t.evidence ?? ""),
        }));
        unwrap(await db.from("app_evidence").insert(evidence).select("id"));
      }

      unwrap(
        await db
          .from("app_scan_jobs")
          .update({ status: "succeeded", progress: 100, updated_at: nowIso() })
          .eq("scan_id", scanId)
          .select("id"),
      );
      unwrap(
        await db
          .from("app_scans")
          .update({ status: "completed", completed_at: nowIso() })
          .eq("id", scanId)
          .select("id"),
      );
      await writeAudit(db, {
        actor: "scan-worker",
        action: `scan.completed (${inserts.length} findings, requested by ${actor.name})`,
        entity: "scan",
        entityId: scanId,
      });
      return { ok: true, data: { findings: inserts.length } };
    } catch (err) {
      try {
        const db = await loadDb();
        await db
          .from("app_scan_jobs")
          .update({ status: "failed", error: String(err).slice(0, 300), updated_at: nowIso() })
          .eq("scan_id", data.scanId);
        await db.from("app_scans").update({ status: "failed" }).eq("id", data.scanId);
      } catch {
        /* the original error is what matters */
      }
      return fail(err);
    }
  });

export const saveRecommendation = createServerFn({ method: "POST" })
  .validator((input: unknown) => SaveRecommendationSchema.parse(input))
  .handler(async ({ data }): Promise<DataResult<{ id: string }>> => {
    try {
      const db = await loadDb();
      const runId = rid("mr");
      unwrap(
        await db
          .from("app_model_runs")
          .insert({
            id: runId,
            finding_id: data.findingId,
            provider: data.run.provider,
            model: data.run.model,
            status: "succeeded",
            latency_ms: data.run.latencyMs,
            prompt_version: data.run.promptVersion,
          })
          .select("id"),
      );
      // One advisory suggestion per finding; a new one replaces the old.
      unwrap(
        await db.from("app_recommendations").delete().eq("finding_id", data.findingId).select("id"),
      );
      const recId = rid("rec");
      unwrap(
        await db
          .from("app_recommendations")
          .insert({
            id: recId,
            finding_id: data.findingId,
            model_run_id: runId,
            summary: data.summary,
            proposed_fix: data.proposedFix,
            rationale: data.rationale,
            confidence: data.confidence,
            policy_refs: data.policyRefs,
          })
          .select("id"),
      );
      await writeAudit(db, {
        actor: "llm-adapter",
        action: `recommendation.generated (${data.run.provider}/${data.run.model})`,
        entity: "finding",
        entityId: data.findingId,
      });
      return { ok: true, data: { id: recId } };
    } catch (err) {
      return fail(err);
    }
  });

export const saveFailedModelRun = createServerFn({ method: "POST" })
  .validator((input: unknown) => FailedRunSchema.parse(input))
  .handler(async ({ data }): Promise<DataResult<{ id: string }>> => {
    try {
      const db = await loadDb();
      const id = rid("mr");
      unwrap(
        await db
          .from("app_model_runs")
          .insert({
            id,
            finding_id: data.findingId,
            provider: data.run.provider,
            model: data.run.model,
            status: "failed_validation",
            latency_ms: data.run.latencyMs,
            prompt_version: data.run.promptVersion,
          })
          .select("id"),
      );
      return { ok: true, data: { id } };
    } catch (err) {
      return fail(err);
    }
  });

export const resetDemoData = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ actor: ActorSchema }).parse(input))
  .handler(async ({ data }): Promise<DataResult<null>> => {
    try {
      if (!["admin", "reviewer", "engineer"].includes(data.actor.role)) {
        return {
          ok: false,
          error: "forbidden",
          message: "Your role does not allow resetting demo data",
        };
      }
      const db = await loadDb();
      unwrap(await db.rpc("app_reset_demo"));
      return { ok: true, data: null };
    } catch (err) {
      return fail(err);
    }
  });
