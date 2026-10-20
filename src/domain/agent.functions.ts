// Server functions for the agent: start a run, read the run log, and the three human
// actions that follow one (promote a draft, raise a Jira ticket, ask for a re-test).
//
// The agent itself never promotes, approves or verifies. Those calls are here because a
// person made them in the UI, and each one is checked against the same role rules.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { DataResult } from "./data.functions";
import { DEFAULT_RUN_OPTIONS, runBuildScan, type StepRecord } from "./agent/harness";
import { callTool } from "./agent/tools";

const ActorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  role: z.enum(["admin", "reviewer", "engineer", "viewer"]),
});

const StartRunSchema = z.object({
  journey: z.enum(["onboarding", "dispute_filing"]),
  platform: z.enum(["android", "ios", "web"]),
  buildId: z.string().trim().min(1).max(12).default("v3"),
  maxScreens: z.number().int().min(1).max(12).default(6),
  actor: ActorSchema,
});

const FindingActionSchema = z.object({
  findingId: z.string().trim().min(3).max(80),
  actor: ActorSchema,
});

/** What crosses the server-function boundary has to be plain JSON. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface AgentDraftSummary {
  id: string;
  title: string;
  status: string;
  severity: string;
  findingType: string;
  gateRecommendation: string;
  escalateTo: string;
  jiraKey: string | null;
  jiraUrl: string | null;
}

export interface AgentRunSummary {
  id: string;
  task: string;
  status: string;
  scanId: string | null;
  requestedBy: string;
  provider: string;
  model: string;
  promptVersion: string;
  stepsUsed: number;
  stepCap: number;
  toolCalls: number;
  findingsDrafted: number;
  escalations: number;
  guardRejections: number;
  haltReason: string | null;
  startedAt: string;
  finishedAt: string | null;
  summary: Json | null;
}

export interface AgentStep {
  id: string;
  seq: number;
  phase: string;
  actor: string;
  tool: string | null;
  summary: string;
  input: Json;
  output: Json;
  verdict: string;
  message: string | null;
  durationMs: number;
  createdAt: string;
}

async function loadDb() {
  const mod = await import("@/integrations/supabase/mae-app.server");
  if (!mod.appDbIsConfigured()) throw new mod.SupabaseNotConfiguredError();
  return mod.getAppDb();
}

function unwrap<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new Error(`${res.error.code ?? ""} ${res.error.message}`.trim());
  return (res.data ?? []) as T;
}

function fail(err: unknown): { ok: false; error: DataResult<never> extends never ? never : any; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    err instanceof Error && err.name === "SupabaseNotConfiguredError"
      ? "not_configured"
      : /does not exist|PGRST205|schema cache|42P01/i.test(message)
        ? "schema_missing"
        : "upstream_error";
  if (code === "upstream_error") console.error("[agent]", message);
  return { ok: false, error: code as any, message };
}

const rid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const toRun = (r: any): AgentRunSummary => ({
  id: String(r.id),
  task: String(r.task),
  status: String(r.status),
  scanId: r.scan_id ? String(r.scan_id) : null,
  requestedBy: String(r.requested_by),
  provider: String(r.provider),
  model: String(r.model),
  promptVersion: String(r.prompt_version),
  stepsUsed: Number(r.steps_used ?? 0),
  stepCap: Number(r.step_cap ?? 0),
  toolCalls: Number(r.tool_calls ?? 0),
  findingsDrafted: Number(r.findings_drafted ?? 0),
  escalations: Number(r.escalations ?? 0),
  guardRejections: Number(r.guard_rejections ?? 0),
  haltReason: r.halt_reason ? String(r.halt_reason) : null,
  startedAt: String(r.started_at),
  finishedAt: r.finished_at ? String(r.finished_at) : null,
  summary: (r.summary as Json) ?? null,
});

const toStep = (r: any): AgentStep => ({
  id: String(r.id),
  seq: Number(r.seq),
  phase: String(r.phase),
  actor: String(r.actor),
  tool: r.tool ? String(r.tool) : null,
  summary: String(r.summary),
  input: (r.input as Json) ?? null,
  output: (r.output as Json) ?? null,
  verdict: String(r.verdict),
  message: r.message ? String(r.message) : null,
  durationMs: Number(r.duration_ms ?? 0),
  createdAt: String(r.created_at),
});

/* ------------------------------------------------------------------ start a run */

export const startAgentRun = createServerFn({ method: "POST" })
  .validator((input: unknown) => StartRunSchema.parse(input))
  .handler(async ({ data }): Promise<DataResult<{ runId: string; scanId: string; status: string }>> => {
    const { journey, platform, buildId, maxScreens, actor } = data;
    try {
      if (!["admin", "engineer", "reviewer"].includes(actor.role)) {
        return { ok: false, error: "forbidden", message: "Your role does not allow starting an agent run" };
      }
      const db = await loadDb();
      const runId = rid("run");
      const scanId = rid("scn-agt");

      const project = unwrap<any[]>(await db.from("app_projects").select("id").limit(1))[0];
      if (!project) return { ok: false, error: "invalid", message: "No project to scan" };

      unwrap(
        await db
          .from("app_scans")
          .insert({
            id: scanId,
            project_id: project.id,
            target_url: `${buildId} staging build`,
            scope: `${journey} · ${platform} · agent run`,
            engines: [
              "rule engine (WCAG 2.1 A/AA, 17 checks)",
              "screen-reader journey simulation (recorded trace)",
              "signal mapping (aggregate tickets and sessions)",
            ],
            status: "running",
            created_by: `MAE agent (requested by ${actor.name})`,
          })
          .select("id"),
      );
      unwrap(
        await db
          .from("app_scan_jobs")
          .insert({ id: `job-${scanId}`, scan_id: scanId, status: "running", attempts: 1, progress: 10 })
          .select("id"),
      );
      unwrap(
        await db
          .from("app_agent_runs")
          .insert({
            id: runId,
            task: "build_scan",
            status: "running",
            scan_id: scanId,
            requested_by: actor.name,
            step_cap: DEFAULT_RUN_OPTIONS.stepCap,
          })
          .select("id"),
      );

      // Steps are written as they happen, so a run that halts still has its log.
      const buffer: StepRecord[] = [];
      const outcome = await runBuildScan(
        runId,
        scanId,
        { ...DEFAULT_RUN_OPTIONS, journey, platform, buildId, maxScreens, requestedBy: actor.name },
        {
          async recordStep(step) {
            buffer.push(step);
            if (buffer.length >= 10) await flush();
          },
        },
      );
      await flush();

      async function flush() {
        if (!buffer.length) return;
        const rows = buffer.splice(0, buffer.length).map((s) => ({
          id: `${runId}-s${s.seq}`,
          run_id: runId,
          seq: s.seq,
          phase: s.phase,
          actor: s.actor,
          tool: s.tool,
          summary: s.summary.slice(0, 400),
          input: s.input ?? null,
          output: s.output ?? null,
          verdict: s.verdict,
          message: s.message?.slice(0, 1000) ?? null,
          duration_ms: s.durationMs,
        }));
        unwrap(await db.from("app_agent_steps").insert(rows).select("id"));
      }

      unwrap(
        await db
          .from("app_agent_runs")
          .update({
            status: outcome.status,
            steps_used: outcome.counters.steps,
            tool_calls: outcome.counters.toolCalls,
            findings_drafted: outcome.counters.drafted,
            escalations: outcome.counters.escalations,
            guard_rejections: outcome.counters.rejections,
            halt_reason: outcome.haltReason,
            summary: { drafts: outcome.drafts, rejected: outcome.rejected },
            finished_at: new Date().toISOString(),
          })
          .eq("id", runId)
          .select("id"),
      );
      unwrap(
        await db
          .from("app_scan_jobs")
          .update({
            status: outcome.status === "succeeded" ? "succeeded" : "failed",
            progress: 100,
            updated_at: new Date().toISOString(),
          })
          .eq("scan_id", scanId)
          .select("id"),
      );
      unwrap(
        await db
          .from("app_scans")
          .update({
            status: outcome.status === "succeeded" ? "completed" : "failed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", scanId)
          .select("id"),
      );
      unwrap(
        await db
          .from("app_audit_events")
          .insert({
            id: rid("aud"),
            actor: "mae-agent",
            action: `agent.run ${outcome.status} (${outcome.counters.drafted} drafts, ${outcome.counters.rejections} guard rejections, requested by ${actor.name})`,
            entity: "agent_run",
            entity_id: runId,
          })
          .select("id"),
      );

      return { ok: true, data: { runId, scanId, status: outcome.status } };
    } catch (err) {
      return fail(err) as DataResult<never>;
    }
  });

/* ------------------------------------------------------------------ reads */

export const fetchAgentRuns = createServerFn({ method: "GET" }).handler(
  async (): Promise<DataResult<AgentRunSummary[]>> => {
    try {
      const db = await loadDb();
      const rows = unwrap<any[]>(
        await db.from("app_agent_runs").select("*").order("started_at", { ascending: false }).limit(25),
      );
      return { ok: true, data: rows.map(toRun) };
    } catch (err) {
      return fail(err) as DataResult<never>;
    }
  },
);

export const fetchAgentRun = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ runId: z.string().trim().min(3).max(60) }).parse(input))
  .handler(
    async ({
      data,
    }): Promise<DataResult<{ run: AgentRunSummary | null; steps: AgentStep[]; drafts: AgentDraftSummary[] }>> => {
      try {
        const db = await loadDb();
        const [runs, steps, drafts] = await Promise.all([
          db.from("app_agent_runs").select("*").eq("id", data.runId).limit(1).then(unwrap<any[]>),
          db.from("app_agent_steps").select("*").eq("run_id", data.runId).order("seq").then(unwrap<any[]>),
          db.from("app_findings").select("*").eq("agent_run_id", data.runId).then(unwrap<any[]>),
        ]);
        return {
          ok: true,
          data: {
            run: runs[0] ? toRun(runs[0]) : null,
            steps: steps.map(toStep),
            drafts: drafts.map((d) => ({
              id: String(d.id),
              title: String(d.title),
              status: String(d.status),
              severity: String(d.severity),
              findingType: String(d.finding_type),
              gateRecommendation: String(d.gate_recommendation),
              escalateTo: String(d.escalate_to),
              jiraKey: d.jira_key ? String(d.jira_key) : null,
              jiraUrl: d.jira_url ? String(d.jira_url) : null,
            })),
          },
        };
      } catch (err) {
        return fail(err) as DataResult<never>;
      }
    },
  );

/* ------------------------------------------------------------------ human actions */

export const promoteDraft = createServerFn({ method: "POST" })
  .validator((input: unknown) => FindingActionSchema.parse(input))
  .handler(async ({ data }): Promise<DataResult<{ status: string }>> => {
    try {
      if (!["admin", "reviewer"].includes(data.actor.role)) {
        return { ok: false, error: "forbidden", message: "Only a reviewer or admin promotes a draft" };
      }
      const db = await loadDb();
      const rows = unwrap<any[]>(
        await db.from("app_findings").select("id, status").eq("id", data.findingId).limit(1),
      );
      if (!rows[0]) return { ok: false, error: "invalid", message: "Finding not found" };
      if (rows[0].status !== "agent_draft") {
        return { ok: false, error: "invalid", message: "Only an agent draft can be promoted" };
      }
      unwrap(await db.from("app_findings").update({ status: "open" }).eq("id", data.findingId).select("id"));
      unwrap(
        await db
          .from("app_audit_events")
          .insert({
            id: rid("aud"),
            actor: data.actor.name,
            action: "finding.promoted_from_agent_draft",
            entity: "finding",
            entity_id: data.findingId,
          })
          .select("id"),
      );
      return { ok: true, data: { status: "open" } };
    } catch (err) {
      return fail(err) as DataResult<never>;
    }
  });

export const raiseJiraTicket = createServerFn({ method: "POST" })
  .validator((input: unknown) => FindingActionSchema.parse(input))
  .handler(
    async ({ data }): Promise<DataResult<{ jiraKey: string; jiraUrl: string; simulated: boolean }>> => {
      try {
        if (data.actor.role === "viewer") {
          return { ok: false, error: "forbidden", message: "Your role does not allow raising tickets" };
        }
        const result = await callTool("create_jira_ticket", { findingId: data.findingId }, "harness");
        if (!result.ok) return { ok: false, error: "invalid", message: result.error ?? "Jira call failed" };
        const out = result.output as { jiraKey: string; jiraUrl: string; simulated: boolean };
        const db = await loadDb();
        unwrap(
          await db
            .from("app_audit_events")
            .insert({
              id: rid("aud"),
              actor: data.actor.name,
              action: `jira.ticket_created ${out.jiraKey}${out.simulated ? " (simulated — no Jira credentials configured)" : ""}`,
              entity: "finding",
              entity_id: data.findingId,
            })
            .select("id"),
        );
        return { ok: true, data: out };
      } catch (err) {
        return fail(err) as DataResult<never>;
      }
    },
  );

export const requestRetest = createServerFn({ method: "POST" })
  .validator((input: unknown) => FindingActionSchema.parse(input))
  .handler(async ({ data }): Promise<DataResult<{ status: string }>> => {
    try {
      if (data.actor.role === "viewer") {
        return { ok: false, error: "forbidden", message: "Your role does not allow requesting a re-test" };
      }
      const result = await callTool("request_retest", { findingId: data.findingId }, "harness");
      if (!result.ok) return { ok: false, error: "invalid", message: result.error ?? "Re-test request failed" };
      const db = await loadDb();
      unwrap(
        await db
          .from("app_audit_events")
          .insert({
            id: rid("aud"),
            actor: data.actor.name,
            action: "finding.retest_requested",
            entity: "finding",
            entity_id: data.findingId,
          })
          .select("id"),
      );
      return { ok: true, data: { status: "ready_for_verification" } };
    } catch (err) {
      return fail(err) as DataResult<never>;
    }
  });
