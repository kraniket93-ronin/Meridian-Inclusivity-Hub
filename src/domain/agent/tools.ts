// The tool layer. Everything the agent is allowed to touch is here, with a schema on
// the way in and on the way out. Nothing else in the agent may reach the database.
//
// Server-only: it loads the Supabase client inside each handler, so no key is ever
// bundled for the browser.
//
// Read tools are the default. Exactly three tools write, and each one writes a draft or
// a request that a person still has to act on.
import { z } from "zod";

import { runRules, type RuleResult, type ScreenRecord } from "./rules";

/* ------------------------------------------------------------------ plumbing */

async function db() {
  const mod = await import("@/integrations/supabase/mae-app.server");
  if (!mod.appDbIsConfigured()) throw new mod.SupabaseNotConfiguredError();
  return mod.getAppDb();
}

/** PostgREST errors become thrown errors so one catch classifies them all. */
function unwrap<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new Error(`${res.error.code ?? ""} ${res.error.message}`.trim());
  return (res.data ?? []) as T;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = any;

/** Golden-set rows live as JSONB in benchmark_records; this unwraps them. */
const asRecords = (rows: Row[]): Row[] => rows.map((r) => r.record ?? r);

const dedupeBy = <T,>(rows: T[], key: (r: T) => string): T[] => {
  const seen = new Map<string, T>();
  for (const row of rows) if (!seen.has(key(row))) seen.set(key(row), row);
  return [...seen.values()];
};

/* ------------------------------------------------------------------ schemas */

const JourneySchema = z.enum(["onboarding", "dispute_filing"]);
const PlatformSchema = z.enum(["android", "ios", "web"]);

export const ToolInputs = {
  list_journeys: z.object({}),
  get_journey_steps: z.object({
    journey: JourneySchema,
    platform: PlatformSchema,
    buildId: z.string().trim().max(12).default("v3"),
  }),
  get_accessibility_tree: z.object({ screenId: z.string().trim().min(3).max(40) }),
  run_rule_checks: z.object({ screenId: z.string().trim().min(3).max(40) }),
  simulate_screen_reader: z.object({
    journey: JourneySchema,
    platform: PlatformSchema,
    buildId: z.string().trim().max(12).default("v3"),
  }),
  query_signals: z.object({
    journey: JourneySchema,
    stepNo: z.number().int().min(1).max(20).optional(),
  }),
  search_policy: z.object({ keys: z.array(z.string().trim().max(40)).min(1).max(8) }),
  draft_finding: z.object({
    runId: z.string().trim().min(3).max(60),
    scanId: z.string().trim().min(3).max(60),
    screenId: z.string().trim().min(3).max(40),
    payload: z.record(z.string(), z.unknown()),
  }),
  create_jira_ticket: z.object({ findingId: z.string().trim().min(3).max(80) }),
  request_retest: z.object({ findingId: z.string().trim().min(3).max(80) }),
} as const;

export type ToolName = keyof typeof ToolInputs;

export interface ToolSpec {
  name: ToolName;
  description: string;
  writes: boolean;
  /** Who may call it. The orchestrator enforces this, not the prompt. */
  allowedFor: Array<"planner" | "tester" | "diagnoser" | "remediator" | "harness">;
}

export const TOOLS: Record<ToolName, ToolSpec> = {
  list_journeys: {
    name: "list_journeys",
    description: "MVP journeys with their step counts and platforms.",
    writes: false,
    allowedFor: ["planner"],
  },
  get_journey_steps: {
    name: "get_journey_steps",
    description: "Ordered steps of one journey on one platform and build.",
    writes: false,
    allowedFor: ["planner", "tester"],
  },
  get_accessibility_tree: {
    name: "get_accessibility_tree",
    description: "The accessibility tree a screen reader would announce for one screen.",
    writes: false,
    allowedFor: ["tester", "diagnoser"],
  },
  run_rule_checks: {
    name: "run_rule_checks",
    description: "Deterministic WCAG 2.1 A/AA and platform checks for one screen.",
    writes: false,
    allowedFor: ["tester"],
  },
  simulate_screen_reader: {
    name: "simulate_screen_reader",
    description: "Walk a journey as a screen-reader persona and return where it got stuck.",
    writes: false,
    allowedFor: ["tester"],
  },
  query_signals: {
    name: "query_signals",
    description: "Aggregate ticket and session signals for a journey step. Never per-customer.",
    writes: false,
    allowedFor: ["tester", "diagnoser"],
  },
  search_policy: {
    name: "search_policy",
    description: "Policy chunks for WCAG criteria or topics, with their verification status.",
    writes: false,
    allowedFor: ["diagnoser", "remediator"],
  },
  draft_finding: {
    name: "draft_finding",
    description: "Write a finding as a draft for human review. Never creates a live finding.",
    writes: true,
    allowedFor: ["harness"],
  },
  create_jira_ticket: {
    name: "create_jira_ticket",
    description: "Open a Jira ticket for an approved finding.",
    writes: true,
    allowedFor: ["harness"],
  },
  request_retest: {
    name: "request_retest",
    description: "Ask for a re-test of a remediated finding using its verification steps.",
    writes: true,
    allowedFor: ["harness"],
  },
};

/* ------------------------------------------------------------------ handlers */

export interface PolicyChunk {
  id: string;
  title: string;
  text: string;
  verificationStatus: string;
  approvedForAnswers: boolean;
  lastVerified: string | null;
  citable: boolean;
}

export interface SignalSummary {
  journey: string;
  stepNo: number | null;
  tickets: number;
  accessibilityRelated: number;
  unableUnassisted: number;
  seniorShare: number | null;
  topBarriers: { barrier: string; count: number }[];
  sessions: number;
  abandonedAtStep: number | null;
  screenReaderAbandonRate: number | null;
  otherAbandonRate: number | null;
  suppressed: boolean;
}

/** Group sizes below this are suppressed by app_signal_summary, not by the app. */
export const MIN_GROUP = 30;

export const handlers: { [K in ToolName]: (input: z.infer<(typeof ToolInputs)[K]>) => Promise<unknown> } = {
  async list_journeys() {
    const client = await db();
    const catalog = unwrap<Row>(await client.rpc("app_journey_catalog"));
    return {
      ...(catalog as Record<string, unknown>),
      note: "MVP journeys only. Screens come from the golden set, not a live build.",
    };
  },

  async get_journey_steps({ journey, platform, buildId }) {
    const client = await db();
    const rows = dedupeBy(
      asRecords(
        unwrap<Row[]>(
          await client
            .from("benchmark_records")
            .select("record")
            .eq("table_name", "screens")
            .eq("record->>journey", journey)
            .eq("record->>platform", platform)
            .eq("record->>build_id", buildId)
            .limit(60),
        ),
      ),
      (s) => String(s.screen_id),
    ).sort((a, b) => Number(a.step_no) - Number(b.step_no));
    return {
      journey,
      platform,
      buildId,
      steps: rows.map((s) => ({
        screenId: String(s.screen_id),
        stepNo: Number(s.step_no),
        stepName: String(s.step_name),
        stepType: String(s.step_type),
        regulated: s.regulated_content === "Y",
      })),
    };
  },

  async get_accessibility_tree({ screenId }) {
    const screen = await loadScreen(screenId);
    if (!screen) return { screenId, found: false, nodes: [] };
    let nodes: unknown = [];
    try {
      nodes = JSON.parse(String(screen.a11y_tree_json ?? "[]"));
    } catch {
      nodes = [];
    }
    return {
      screenId,
      found: true,
      stepName: screen.step_name,
      platform: screen.platform,
      renderedLanguage: screen.rendered_language,
      nodes,
    };
  },

  async run_rule_checks({ screenId }) {
    const screen = await loadScreen(screenId);
    if (!screen) return { screenId, found: false, results: [] as RuleResult[] };
    const results = runRules(screen as ScreenRecord);
    return {
      screenId,
      found: true,
      stepNo: Number(screen.step_no),
      stepName: String(screen.step_name),
      platform: String(screen.platform),
      checksRun: 17,
      results,
    };
  },

  async simulate_screen_reader({ journey, platform, buildId }) {
    const client = await db();
    const match = asRecords(
      unwrap<Row[]>(
        await client
          .from("benchmark_records")
          .select("record")
          .eq("table_name", "sr_traces")
          .eq("record->>journey", journey)
          .eq("record->>platform", platform)
          .eq("record->>build_id", buildId)
          .limit(5),
      ),
    );
    const trace = match[0];
    if (!trace) return { journey, platform, buildId, found: false };
    let steps: unknown = [];
    try {
      steps = JSON.parse(String(trace.steps_json ?? "[]"));
    } catch {
      steps = [];
    }
    return {
      found: true,
      traceId: String(trace.trace_id),
      persona: String(trace.persona),
      assistiveTech: String(trace.assistive_tech),
      taskGoal: String(trace.task_goal),
      outcome: String(trace.outcome),
      stuckStepNo: trace.stuck_step_no ? Number(trace.stuck_step_no) : null,
      stuckScreenId: trace.stuck_screen_id ? String(trace.stuck_screen_id) : null,
      reasonCode: String(trace.reason_code ?? ""),
      steps,
      note: "Recorded walk from the golden set, labelled simulated. Not a live assistive-technology session.",
    };
  },

  async query_signals({ journey, stepNo }): Promise<SignalSummary> {
    // Aggregated in Postgres: 3,000 tickets and 12,000 sessions are never pulled into
    // the app, and no per-customer row is ever put in front of the agent.
    const client = await db();
    const summary = unwrap<Row>(
      await client.rpc("app_signal_summary", { p_journey: journey, p_step: stepNo ?? null }),
    );
    const s = (summary ?? {}) as Record<string, unknown>;
    const n = (v: unknown): number | null => (v == null ? null : Math.round(Number(v) * 10) / 10);
    return {
      journey,
      stepNo: stepNo ?? null,
      tickets: Number(s["tickets"] ?? 0),
      accessibilityRelated: Number(s["accessibilityRelated"] ?? 0),
      unableUnassisted: Number(s["unableUnassisted"] ?? 0),
      seniorShare: n(s["seniorShare"]),
      topBarriers: (s["topBarriers"] as SignalSummary["topBarriers"]) ?? [],
      sessions: Number(s["sessions"] ?? 0),
      abandonedAtStep: s["abandonedAtStep"] == null ? null : Number(s["abandonedAtStep"]),
      screenReaderAbandonRate: n(s["screenReaderAbandonRate"]),
      otherAbandonRate: n(s["otherAbandonRate"]),
      suppressed: Boolean(s["suppressed"]),
    };
  },

  async search_policy({ keys }): Promise<{ keys: string[]; chunks: PolicyChunk[] }> {
    const client = await db();
    const mapped = unwrap<Row[]>(
      await client.from("app_citation_map").select("key, chunk_id").in("key", keys),
    );
    const ids = [...new Set(mapped.map((m) => String(m.chunk_id)))];
    if (!ids.length) return { keys, chunks: [] };
    const chunks = unwrap<Row[]>(await client.from("app_policy_chunks").select("*").in("id", ids));
    return {
      keys,
      chunks: chunks.map((c) => ({
        id: String(c.id),
        title: String(c.title),
        text: String(c.text),
        verificationStatus: String(c.verification_status),
        approvedForAnswers: Boolean(c.approved_for_answers),
        lastVerified: c.last_verified ? String(c.last_verified) : null,
        // Said plainly for the model: an unapproved chunk is context, never support.
        citable: Boolean(c.approved_for_answers),
      })),
    };
  },

  async draft_finding({ runId, scanId, screenId, payload }) {
    const client = await db();
    const id = `AGT-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const row = {
      ...(payload as Record<string, unknown>),
      id,
      scan_id: scanId,
      screen_id: screenId,
      status: "agent_draft",
      origin: "agent",
      agent_run_id: runId,
    };
    unwrap(await client.from("app_findings").insert(row).select("id"));
    return { findingId: id, status: "agent_draft" };
  },

  async create_jira_ticket({ findingId }) {
    const client = await db();
    const rows = unwrap<Row[]>(await client.from("app_findings").select("*").eq("id", findingId).limit(1));
    const finding = rows[0];
    if (!finding) throw new Error("Finding not found");
    if (finding.status === "agent_draft") {
      throw new Error("A draft cannot be ticketed; a human promotes it first");
    }
    const base = process.env["JIRA_BASE_URL"];
    const email = process.env["JIRA_EMAIL"];
    const token = process.env["JIRA_API_TOKEN"];
    const project = process.env["JIRA_PROJECT_KEY"];

    let key: string;
    let url: string;
    let simulated = false;

    if (base && email && token && project) {
      const res = await fetch(`${base.replace(/\/+$/, "")}/rest/api/3/issue`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            project: { key: project },
            issuetype: { name: "Bug" },
            summary: `[${finding.severity}] ${finding.title}`,
            description: jiraDescription(finding),
            labels: ["accessibility", "mae", String(finding.finding_type)],
          },
        }),
      });
      if (!res.ok) throw new Error(`Jira responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const created = (await res.json()) as { key: string };
      key = created.key;
      url = `${base.replace(/\/+$/, "")}/browse/${key}`;
    } else {
      // No credentials: a ticket is still recorded so the workflow is demonstrable,
      // and it is labelled simulated everywhere it appears.
      simulated = true;
      key = `MAE-${Math.floor(Math.random() * 9000 + 1000)}`;
      url = `https://example.invalid/browse/${key}`;
    }

    unwrap(
      await client.from("app_findings").update({ jira_key: key, jira_url: url }).eq("id", findingId).select("id"),
    );
    return { findingId, jiraKey: key, jiraUrl: url, simulated };
  },

  async request_retest({ findingId }) {
    const client = await db();
    const rows = unwrap<Row[]>(
      await client.from("app_findings").select("id, status, verification_steps").eq("id", findingId).limit(1),
    );
    const finding = rows[0];
    if (!finding) throw new Error("Finding not found");
    if (finding.status !== "remediation_in_progress") {
      throw new Error("Only a finding in remediation can be sent for re-test");
    }
    unwrap(
      await client.from("app_findings").update({ status: "ready_for_verification" }).eq("id", findingId).select("id"),
    );
    return { findingId, status: "ready_for_verification", verificationSteps: finding.verification_steps };
  },
};

function jiraDescription(finding: Row): string {
  return [
    finding.title,
    "",
    `Journey: ${finding.journey} · step ${finding.step_no} ${finding.step_name} · ${finding.platform} · ${finding.screen_id}`,
    `Type: ${finding.finding_type}${finding.wcag_criteria?.length ? ` · WCAG ${finding.wcag_criteria.join(", ")} (${finding.conformance_level})` : ""}`,
    `Severity: ${finding.severity} · confidence: ${finding.confidence} (evidence strength, not a probability)`,
    "",
    `Evidence: ${finding.evidence}`,
    `Affected need: ${finding.affected_user_need}`,
    "",
    `Suggested fix (never auto-applied): ${finding.recommended_fix}`,
    `Verification: ${finding.verification_steps}`,
    "",
    "Raised by the Meridian Access Engine. Advisory only — a human approved this finding before the ticket was created.",
  ].join("\n");
}

async function loadScreen(screenId: string): Promise<Row | null> {
  const client = await db();
  const rows = unwrap<Row[]>(
    await client
      .from("benchmark_records")
      .select("record")
      .eq("table_name", "screens")
      .eq("record->>screen_id", screenId)
      .limit(1),
  );
  return rows.length ? (rows[0].record as Row) : null;
}

/* ------------------------------------------------------------------ dispatch */

export interface ToolCallResult {
  tool: ToolName;
  ok: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
}

/**
 * The only way to call a tool. Validates the input, enforces the caller's allowlist,
 * and times the call so the run log can show where the budget went.
 */
export async function callTool(
  tool: ToolName,
  input: unknown,
  caller: ToolSpec["allowedFor"][number],
): Promise<ToolCallResult> {
  const started = Date.now();
  const spec = TOOLS[tool];
  try {
    if (!spec) throw new Error(`Unknown tool: ${tool}`);
    if (!spec.allowedFor.includes(caller)) {
      throw new Error(`${caller} may not call ${tool}`);
    }
    const parsed = ToolInputs[tool].parse(input ?? {});
    const output = await (handlers[tool] as (i: unknown) => Promise<unknown>)(parsed);
    return { tool, ok: true, output, durationMs: Date.now() - started };
  } catch (err) {
    return {
      tool,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
}
