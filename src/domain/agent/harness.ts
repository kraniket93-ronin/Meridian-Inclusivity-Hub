// The orchestrator. A fixed plan per task type, hard caps, a tool allowlist per
// sub-agent, and one row in the run log for every step — so any run can be replayed and
// audited after the fact.
//
// The agent writes drafts and requests. It never changes a release, approves anything, or
// closes a finding.
import { validateAndGuard, guardFinding, type FindingDraft, type GuardResult } from "./guards";
import type { RuleResult } from "./rules";
import { diagnose, planTests, remediate, type TestPlan } from "./subagents";
import { callTool, type PolicyChunk, type SignalSummary, type ToolName } from "./tools";
import { diagnosisDescription, mergeDiagnosis, mergeRemediation, type AgentModel } from "./model";
import type { FewShotExample } from "./prompts";

export interface RunOptions {
  journey: "onboarding" | "dispute_filing";
  platform: "android" | "ios" | "web";
  buildId: string;
  requestedBy: string;
  maxScreens: number;
  stepCap: number;
  /** Wall-clock budget. A run that exceeds it halts and says so. */
  timeBudgetMs: number;
  /** Writes the narrative. Falls back to rule-backed text whenever it cannot. */
  model: AgentModel;
}

// Sized so a six-screen journey finishes inside the caps; the caps still bind, and a run
// that hits one halts and says which.
export const DEFAULT_RUN_OPTIONS: Omit<RunOptions, "journey" | "platform" | "requestedBy" | "model"> = {
  buildId: "v3",
  maxScreens: 6,
  stepCap: 140,
  timeBudgetMs: 120_000,
};

export interface StepRecord {
  seq: number;
  phase: "plan" | "test" | "diagnose" | "remediate" | "guard" | "write";
  actor: string;
  tool: ToolName | null;
  summary: string;
  input: unknown;
  output: unknown;
  verdict: "ok" | "rejected" | "escalated" | "skipped" | "error";
  message: string | null;
  durationMs: number;
}

export interface RunOutcome {
  status: "succeeded" | "failed" | "halted";
  haltReason: string | null;
  steps: StepRecord[];
  drafts: { findingId: string; title: string; verdict: GuardResult["verdict"] }[];
  rejected: { title: string; reasons: string[] }[];
  counters: {
    steps: number;
    toolCalls: number;
    drafted: number;
    escalations: number;
    rejections: number;
    modelCalls: number;
    modelFallbacks: number;
  };
  plan: TestPlan | null;
}

/** A payload the guard must refuse. Run on every scan, so the safety layer is proven live. */
const CANARY: Record<string, unknown> = {
  title: "Remove the second authentication factor to reduce OTP friction",
  finding_type: "wcag_failure",
  journey: "onboarding",
  step_no: 3,
  step_name: "OTP entry",
  platform: "android",
  wcag_criteria: ["3.3.8"],
  wcag_version: "WCAG 2.2",
  conformance_level: "AA",
  baseline_status: "in_baseline_2.1_AA",
  severity: "critical",
  confidence: "low",
  abstention_reason: null,
  evidence: "Customers complain about the OTP step; contact 9876543210 for the full list.",
  affected_user_need: "Sign in quickly",
  user_impact: "task_blocked",
  affected_groups: ["Seniors (60+)"],
  recommended_fix: "Disable the second factor for returning devices and mark the finding resolved.",
  fix_rationale: "The app is now WCAG compliant.",
  verification_steps: "No further review is needed.",
  gate_recommendation: "recommend_block_pending_human",
  requires_human_review: false,
  escalate_to: "Owning squad",
  priority_score: 99,
  priority_band: "P1",
};

export interface Harness {
  /** Persists one step. The caller decides how (database in the app, memory in tests). */
  recordStep(step: StepRecord): Promise<void>;
}

/**
 * The build-scan plan: steps → rule checks → simulation → signals → findings → guards →
 * drafts. Each phase is capped, and nothing proceeds on a failed guard.
 */
/**
 * Runs `fn` over the items with at most `limit` in flight. Concurrency here is a
 * trade, not a win: more at once is faster until the provider's per-minute limit
 * turns the extra calls into 429s and the run falls back to rule-backed text.
 */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function runBuildScan(
  runId: string,
  scanId: string,
  options: RunOptions,
  harness: Harness,
): Promise<RunOutcome> {
  const started = Date.now();
  const steps: StepRecord[] = [];
  const drafts: RunOutcome["drafts"] = [];
  const rejected: RunOutcome["rejected"] = [];
  let seq = 0;
  let toolCalls = 0;
  let escalations = 0;
  let modelCalls = 0;
  let modelFallbacks = 0;
  let fewShot: FewShotExample[] = [];
  let halted: string | null = null;

  const log = async (step: Omit<StepRecord, "seq">): Promise<StepRecord> => {
    const record = { ...step, seq: ++seq };
    steps.push(record);
    await harness.recordStep(record);
    return record;
  };

  const budgetLeft = () => options.timeBudgetMs - (Date.now() - started);
  const capHit = () => seq >= options.stepCap || budgetLeft() <= 0;

  const call = async (
    tool: ToolName,
    input: unknown,
    caller: Parameters<typeof callTool>[2],
    phase: StepRecord["phase"],
    summary: string,
  ) => {
    const result = await callTool(tool, input, caller);
    toolCalls += 1;
    await log({
      phase,
      actor: caller,
      tool,
      summary,
      input,
      output: result.ok ? result.output : null,
      verdict: result.ok ? "ok" : "error",
      message: result.error ?? null,
      durationMs: result.durationMs,
    });
    return result;
  };

  try {
    // 1. Plan.
    const stepsResult = await call(
      "get_journey_steps",
      { journey: options.journey, platform: options.platform, buildId: options.buildId },
      "planner",
      "plan",
      `Read the ${options.journey} steps on ${options.platform} ${options.buildId}`,
    );
    if (!stepsResult.ok) throw new Error(stepsResult.error ?? "Could not read the journey");
    const journeySteps = (stepsResult.output as { steps: TestPlan["screens"] & { stepType: string }[] }).steps ?? [];
    const plan = planTests({
      journey: options.journey,
      platform: options.platform,
      buildId: options.buildId,
      steps: journeySteps as never,
      maxScreens: options.maxScreens,
    });
    await log({
      phase: "plan",
      actor: "planner",
      tool: null,
      summary: `Planned ${plan.screens.length} screens and ${plan.personas.length} personas`,
      input: { maxScreens: options.maxScreens },
      output: plan,
      verdict: "ok",
      message: plan.rationale,
      durationMs: 0,
    });

    // 2. Prove the guard is live before anything is written.
    const canaryStart = Date.now();
    const canary = validateAndGuard(CANARY, []);
    await log({
      phase: "guard",
      actor: "guard",
      tool: null,
      summary: "Canary: a deliberately unsafe draft is refused",
      input: { title: CANARY["title"] },
      output: canary.result,
      verdict: canary.result.verdict === "rejected" ? "ok" : "error",
      message:
        canary.result.verdict === "rejected"
          ? `Refused for ${canary.result.reasons.length} reasons, including: ${canary.result.reasons[0]}`
          : "GUARD FAILURE: the canary was accepted. Run halted.",
      durationMs: Date.now() - canaryStart,
    });
    if (canary.result.verdict !== "rejected") {
      return finish("halted", "Guard canary was not refused; the safety layer is not working.");
    }

    // 3. Few-shot examples, train split only. The ids are logged, so a reader can check
    //    afterwards that no dev or test row ever reached a prompt.
    const examples = await call(
      "get_training_examples",
      { limit: 3 },
      "diagnoser",
      "plan",
      "Load worked examples from the train split",
    );
    if (examples.ok) {
      const payload = examples.output as { examples?: FewShotExample[]; ids?: string[] };
      fewShot = payload.examples ?? [];
    }

    // 4. Walk the journey once as a screen-reader persona.
    const traceResult = await call(
      "simulate_screen_reader",
      { journey: options.journey, platform: options.platform, buildId: options.buildId },
      "tester",
      "test",
      "Walk the journey as a screen-reader persona",
    );
    const traceOut = traceResult.ok ? (traceResult.output as Record<string, unknown>) : null;
    const trace =
      traceOut && traceOut["found"]
        ? {
            traceId: String(traceOut["traceId"]),
            stuckStepNo: traceOut["stuckStepNo"] == null ? null : Number(traceOut["stuckStepNo"]),
            reasonCode: String(traceOut["reasonCode"] ?? ""),
            persona: String(traceOut["persona"] ?? ""),
            assistiveTech: String(traceOut["assistiveTech"] ?? ""),
          }
        : null;

    // 4. Test each planned screen, then diagnose what the rules found.
    const signalCache = new Map<number, SignalSummary | null>();

    for (const screen of plan.screens) {
      if (capHit()) {
        halted = seq >= options.stepCap ? "Step cap reached" : "Time budget reached";
        break;
      }

      const checks = await call(
        "run_rule_checks",
        { screenId: screen.screenId },
        "tester",
        "test",
        `Rule checks on ${screen.screenId}`,
      );
      if (!checks.ok) continue;
      const results = ((checks.output as { results?: RuleResult[] }).results ?? []) as RuleResult[];
      if (!results.length) continue;

      if (!signalCache.has(screen.stepNo)) {
        const signals = await call(
          "query_signals",
          { journey: options.journey, stepNo: screen.stepNo },
          "tester",
          "test",
          `Customer signals for step ${screen.stepNo}`,
        );
        signalCache.set(screen.stepNo, signals.ok ? (signals.output as SignalSummary) : null);
      }

      // Every rule on this screen is prepared at once. The model calls dominate the
      // wall clock, and a serverless function has a limit to stay inside; the results
      // are then logged in rule order, so the run log still reads top to bottom.
      // One rule at a time, its two model calls together: two requests in flight is
      // what a free-tier key tolerates without returning 429.
      const prepared = await mapWithConcurrency(results, 1, async (rule) => {
          const policy = await callTool("search_policy", { keys: rule.citationKeys }, "diagnoser");
          toolCalls += 1;
          const chunks = policy.ok ? ((policy.output as { chunks: PolicyChunk[] }).chunks ?? []) : [];
          const ruleFix = remediate(rule.ruleId);
          const [remediation, diagnosis] = await Promise.all([
            options.model.remediate(
              {
                rule,
                screenId: screen.screenId,
                stepName: screen.stepName,
                platform: options.platform,
                fallback: ruleFix,
              },
              fewShot,
            ),
            options.model.diagnose(
              {
                rule,
                screenId: screen.screenId,
                journey: options.journey,
                stepNo: screen.stepNo,
                stepName: screen.stepName,
                platform: options.platform,
                signals: signalCache.get(screen.stepNo) ?? null,
                trace,
                chunks,
              },
              fewShot,
            ),
          ]);
          return { rule, chunks, policy, ruleFix, remediation, diagnosis };
      });

      for (const { rule, chunks, policy, ruleFix, remediation, diagnosis } of prepared) {
        if (capHit()) {
          halted = seq >= options.stepCap ? "Step cap reached" : "Time budget reached";
          break;
        }

        await log({
          phase: "diagnose",
          actor: "diagnoser",
          tool: "search_policy",
          summary: `Policy sources for ${rule.citationKeys.join(", ")}`,
          input: { keys: rule.citationKeys },
          output: policy.ok ? policy.output : null,
          verdict: policy.ok ? "ok" : "error",
          message: policy.error ?? null,
          durationMs: policy.durationMs,
        });

        modelCalls += remediation.meta.provider === "deterministic" ? 0 : 1;
        if (remediation.meta.fellBackBecause) modelFallbacks += 1;
        const fix = remediation.output ? mergeRemediation(ruleFix, remediation.output) : ruleFix;
        await log({
          phase: "remediate",
          actor: "remediator",
          tool: null,
          summary: `Fix drafted for ${rule.ruleId}`,
          input: { ruleId: rule.ruleId, provider: remediation.meta.provider, model: remediation.meta.model },
          output: { ...fix, meta: remediation.meta },
          verdict: remediation.meta.fellBackBecause ? "skipped" : "ok",
          message: remediation.meta.fellBackBecause
            ? `Rule-backed fix used: ${remediation.meta.fellBackBecause}`
            : "Model-written, suggested only — never auto-applied.",
          durationMs: remediation.meta.latencyMs,
        });

        const baseDraft: FindingDraft = diagnose({
          rule,
          screenId: screen.screenId,
          journey: options.journey,
          stepNo: screen.stepNo,
          stepName: screen.stepName,
          platform: options.platform,
          signals: signalCache.get(screen.stepNo) ?? null,
          trace,
          fix,
        });

        // Diagnoser: the model wrote the narrative. mergeDiagnosis carries every
        // classification field through untouched, whatever the model returned.
        modelCalls += diagnosis.meta.provider === "deterministic" ? 0 : 1;
        if (diagnosis.meta.fellBackBecause) modelFallbacks += 1;
        const draft: FindingDraft = diagnosis.output
          ? mergeDiagnosis(baseDraft, diagnosis.output, rule)
          : baseDraft;
        const description = diagnosis.output ? diagnosisDescription(diagnosis.output) : null;
        await log({
          phase: "diagnose",
          actor: "diagnoser",
          tool: null,
          summary: `Finding written for ${rule.ruleId}`,
          input: { provider: diagnosis.meta.provider, model: diagnosis.meta.model, promptVersion: diagnosis.meta.promptVersion },
          output: { title: draft.title, description, meta: diagnosis.meta },
          verdict: diagnosis.meta.fellBackBecause ? "skipped" : "ok",
          message: diagnosis.meta.fellBackBecause
            ? `Rule-backed text used: ${diagnosis.meta.fellBackBecause}`
            : "Classification carried from the rule engine; the model wrote the narrative only.",
          durationMs: diagnosis.meta.latencyMs,
        });

        const guardStart = Date.now();
        const verdict = guardFinding(draft, chunks);
        await log({
          phase: "guard",
          actor: "guard",
          tool: null,
          summary: `Guard: ${draft.title}`,
          input: { findingType: draft.finding_type, criteria: draft.wcag_criteria },
          output: verdict,
          verdict: verdict.verdict === "rejected" ? "rejected" : verdict.verdict === "escalated" ? "escalated" : "ok",
          message: verdict.reasons.join(" ") || null,
          durationMs: Date.now() - guardStart,
        });

        if (verdict.verdict === "rejected") {
          rejected.push({ title: draft.title, reasons: verdict.reasons });
          continue;
        }
        if (verdict.verdict === "escalated") escalations += 1;

        const written = await call(
          "draft_finding",
          {
            runId,
            scanId,
            screenId: screen.screenId,
            payload: {
              ...draft,
              description,
              golden_set_id: `${rule.ruleId}@${screen.screenId}`,
              rule_id: rule.ruleId,
              wcag: (draft.wcag_criteria ?? []).join(", "),
              node_ids: rule.nodeIds ?? null,
              simulation_trace:
                trace && trace.stuckStepNo === screen.stepNo
                  ? `Simulation ${trace.traceId}: ${trace.assistiveTech} persona stuck at step ${screen.stepNo} (${trace.reasonCode}).`
                  : null,
              callout: rule.callout ?? null,
              extra_note: rule.extraNote ?? null,
              selector: screen.screenId,
              page_url: `${options.buildId} staging build`,
            },
          },
          "harness",
          "write",
          `Draft written for ${screen.screenId}`,
        );
        if (written.ok) {
          const out = written.output as { findingId: string };
          drafts.push({ findingId: out.findingId, title: draft.title, verdict: verdict.verdict });
        }
      }
      if (halted) break;
    }

    return finish(halted ? "halted" : "succeeded", halted);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log({
      phase: "write",
      actor: "harness",
      tool: null,
      summary: "Run failed",
      input: null,
      output: null,
      verdict: "error",
      message,
      durationMs: 0,
    });
    return finish("failed", message);
  }

  function finish(status: RunOutcome["status"], haltReason: string | null): RunOutcome {
    return {
      status,
      haltReason,
      steps,
      drafts,
      rejected,
      counters: {
        steps: seq,
        toolCalls,
        drafted: drafts.length,
        escalations,
        rejections: rejected.length,
        modelCalls,
        modelFallbacks,
      },
      plan: null,
    };
  }
}
