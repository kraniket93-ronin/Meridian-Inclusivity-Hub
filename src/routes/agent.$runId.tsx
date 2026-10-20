import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { useAgentRun, useAgentService, type AgentStep } from "@/domain/agent.hooks";
import { useCurrentActor } from "@/domain/store";
import { EmptyState, ErrorState, PageHeader, Panel, StatusBadge, fmtDate } from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/agent/$runId")({
  head: ({ params }) => ({
    meta: [
      { title: `Agent run ${params.runId} · Meridian` },
      { name: "description", content: "Every step the agent took, in order, with its guard verdicts." },
      { property: "og:title", content: `Agent run ${params.runId} · Meridian` },
      { property: "og:description", content: "Agent run log and the drafts it produced." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: AgentRunErrorPage,
  component: AgentRunDetail,
});

/** Route-level boundary: a failure shows the run id and a way back, never a blank page. */
function AgentRunErrorPage() {
  const { runId } = Route.useParams();
  return (
    <>
      <PageHeader title="This run could not be displayed" description={`Run ID: ${runId}`} />
      <Link to="/agent" className="text-primary underline">
        Back to agent runs
      </Link>
    </>
  );
}

const PHASE_LABELS: Record<string, string> = {
  plan: "Plan",
  test: "Test",
  diagnose: "Diagnose",
  remediate: "Remediate",
  guard: "Guard",
  write: "Write",
};

const phaseClass: Record<string, string> = {
  plan: "bg-secondary text-secondary-foreground",
  test: "bg-accent text-accent-foreground",
  diagnose: "bg-secondary text-secondary-foreground",
  remediate: "bg-accent text-accent-foreground",
  guard: "bg-sev-moderate-bg text-sev-moderate",
  write: "bg-success-bg text-success",
};

function StepRow({ step }: { step: AgentStep }) {
  const payload = { input: step.input, output: step.output };
  const hasPayload = step.input != null || step.output != null;
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start gap-2">
        <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">{step.seq}</span>
        <span
          className={`inline-flex shrink-0 rounded border px-2 py-0.5 text-xs font-semibold ${phaseClass[step.phase] ?? "bg-muted"}`}
        >
          {PHASE_LABELS[step.phase] ?? step.phase}
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium">{step.summary}</p>
          <p className="text-xs text-muted-foreground">
            {step.actor}
            {step.tool ? ` · ${step.tool}` : ""} · {step.durationMs} ms
          </p>
          {step.message && <p className="mt-1 break-words text-xs text-muted-foreground">{step.message}</p>}
          {hasPayload && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-primary">Input and output</summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded border bg-muted p-2 text-xs">
                {JSON.stringify(payload, null, 1)}
              </pre>
            </details>
          )}
        </div>
        <StatusBadge status={step.verdict} />
      </div>
    </li>
  );
}

function AgentRunDetail() {
  const { runId } = Route.useParams();
  const query = useAgentRun(runId);
  const actor = useCurrentActor();
  const service = useAgentService();
  const [busy, setBusy] = useState<string | null>(null);

  if (query.isLoading) return <p role="status">Loading run {runId}…</p>;
  if (query.error) {
    return (
      <>
        <PageHeader title="This run could not be displayed" description={`Run ID: ${runId}`} />
        <ErrorState
          title="Could not read the run"
          message={query.error instanceof Error ? query.error.message : "Unknown error"}
        />
      </>
    );
  }

  const run = query.data?.run ?? null;
  const steps = query.data?.steps ?? [];
  const drafts = query.data?.drafts ?? [];
  if (!run) {
    return (
      <>
        <PageHeader title="This run could not be displayed" description={`Run ID: ${runId}`} />
        <Link to="/agent" className="text-primary underline">
          Back to agent runs
        </Link>
      </>
    );
  }

  const rejected =
    (run.summary && typeof run.summary === "object" && !Array.isArray(run.summary)
      ? ((run.summary as Record<string, unknown>)["rejected"] as { title: string; reasons: string[] }[])
      : []) ?? [];

  const canAct = actor.role !== "viewer";

  async function act(kind: "promote" | "jira" | "retest", findingId: string) {
    setBusy(`${kind}:${findingId}`);
    try {
      if (kind === "promote") {
        await service.promote(findingId, runId);
        toast.success("Promoted to the review queue");
      } else if (kind === "jira") {
        const result = await service.raiseJira(findingId, runId);
        toast.success(
          result.simulated ? `${result.jiraKey} created (simulated — no Jira credentials)` : `${result.jiraKey} created in Jira`,
        );
      } else {
        await service.requestRetest(findingId, runId);
        toast.success("Re-test requested");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  const stats: [string, string][] = [
    ["Steps", `${run.stepsUsed} of ${run.stepCap}`],
    ["Tool calls", String(run.toolCalls)],
    ["Drafts written", String(run.findingsDrafted)],
    ["Escalated", String(run.escalations)],
    ["Guard rejections", String(run.guardRejections)],
  ];

  return (
    <article className="min-w-0 space-y-5 break-words">
      <Link to="/agent" className="text-sm text-primary hover:underline">
        ← Agent runs
      </Link>
      <PageHeader
        title={`Agent run ${run.id}`}
        description="Every step in order: what it planned, what it called, what the guard said, and what it wrote."
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <StatusBadge status={run.status} />
        <span className="text-muted-foreground">
          {run.task.replaceAll("_", " ")} · requested by {run.requestedBy}
        </span>
        {run.scanId && (
          <Link to="/scans/$scanId" params={{ scanId: run.scanId }} className="text-primary underline">
            {run.scanId}
          </Link>
        )}
      </div>
      {run.haltReason && (
        <p className="rounded border border-sev-moderate/30 bg-sev-moderate-bg p-3 text-sm text-sev-moderate">
          Halted: {run.haltReason}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-lg border bg-card p-4 shadow-card">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <Panel title="Run context">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-semibold">Provider and model</dt>
            <dd>
              {run.provider} · {run.model}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Prompt version</dt>
            <dd>{run.promptVersion}</dd>
          </div>
          <div>
            <dt className="font-semibold">Started</dt>
            <dd>{fmtDate(run.startedAt)}</dd>
          </div>
          <div>
            <dt className="font-semibold">Finished</dt>
            <dd>{fmtDate(run.finishedAt ?? undefined)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-muted-foreground">
          The agent may read journeys, accessibility trees, rule results, recorded traces, aggregate signals and
          verified policy chunks. It may write only a draft finding, a Jira ticket for an approved finding, and a
          re-test request. It never changes a status, approves a waiver or closes a finding.
        </p>
      </Panel>

      <Panel title={`Drafts for review (${drafts.length})`}>
        {drafts.length === 0 ? (
          <EmptyState title="No drafts from this run" />
        ) : (
          <ul className="divide-y">
            {drafts.map((d) => (
              <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link
                    to="/findings/$findingId"
                    params={{ findingId: d.id }}
                    className="font-medium text-primary hover:underline"
                  >
                    {d.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {d.findingType.replaceAll("_", " ")} · {d.severity} · {d.gateRecommendation.replaceAll("_", " ")} ·
                    to {d.escalateTo}
                  </p>
                  {d.jiraKey && (
                    <p className="mt-1 text-xs">
                      Ticket <span className="font-mono">{d.jiraKey}</span>
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={d.status} />
                  {canAct && d.status === "agent_draft" && (
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void act("promote", d.id)}
                      className="h-auto min-h-9 whitespace-normal"
                    >
                      {busy === `promote:${d.id}` ? "Promoting…" : "Promote to review"}
                    </Button>
                  )}
                  {canAct && d.status !== "agent_draft" && !d.jiraKey && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => void act("jira", d.id)}
                      className="h-auto min-h-9 whitespace-normal"
                    >
                      {busy === `jira:${d.id}` ? "Creating…" : "Raise Jira ticket"}
                    </Button>
                  )}
                  {canAct && d.status === "remediation_in_progress" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => void act("retest", d.id)}
                      className="h-auto min-h-9 whitespace-normal"
                    >
                      {busy === `retest:${d.id}` ? "Requesting…" : "Request re-test"}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          A draft is not a finding. It enters the review queue only when a person promotes it, and a ticket can be
          raised only after that.
        </p>
      </Panel>

      {rejected.length > 0 && (
        <Panel title={`Refused by the guard (${rejected.length})`}>
          <ul className="divide-y text-sm">
            {rejected.map((r, i) => (
              <li key={`${r.title}-${i}`} className="py-2">
                <p className="font-medium">{r.title}</p>
                <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                  {r.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={`Run log (${steps.length} steps)`}>
        {steps.length === 0 ? (
          <EmptyState title="No steps recorded" />
        ) : (
          <ul className="divide-y">
            {steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </ul>
        )}
      </Panel>
    </article>
  );
}
