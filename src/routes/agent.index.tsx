import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { useAgentRuns, useAgentService } from "@/domain/agent.hooks";
import { useCurrentActor } from "@/domain/store";
import { EmptyState, ErrorState, PageHeader, Panel, StatusBadge, fmtDate } from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/agent/")({
  head: () => ({
    meta: [
      { title: "Agent runs · Meridian" },
      {
        name: "description",
        content: "Start an agent run over an MVP journey and read every step it took.",
      },
      { property: "og:title", content: "Agent runs · Meridian" },
      { property: "og:description", content: "Plan, test, diagnose, guard, draft — with a full run log." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AgentRuns,
});

const JOURNEYS = [
  { value: "onboarding", label: "Onboarding (12 steps)" },
  { value: "dispute_filing", label: "Dispute filing (9 steps)" },
] as const;
const PLATFORMS = [
  { value: "android", label: "Android" },
  { value: "ios", label: "iOS" },
  { value: "web", label: "Web" },
] as const;
const BUILDS = ["v3", "v2", "v1"] as const;

function AgentRuns() {
  const actor = useCurrentActor();
  const service = useAgentService();
  const runs = useAgentRuns();
  const [journey, setJourney] = useState<(typeof JOURNEYS)[number]["value"]>("onboarding");
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number]["value"]>("android");
  const [buildId, setBuildId] = useState<string>("v3");
  const [maxScreens, setMaxScreens] = useState(6);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const canRun = ["admin", "engineer", "reviewer"].includes(actor.role);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setRunning(true);
    setError("");
    try {
      const result = await service.startRun({ journey, platform, buildId, maxScreens });
      toast.success(`Run ${result.runId} ${result.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The run could not be started");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Agent runs"
        description="The agent plans tests, runs them, diagnoses what it finds and drafts findings. It writes drafts only — a person promotes, approves, tickets and verifies."
      />

      <div
        role="note"
        className="mb-5 rounded-md border bg-accent px-4 py-3 text-sm text-accent-foreground"
      >
        Engines are simulated: rule checks run against the golden set's recorded accessibility trees, the
        screen-reader walk is a recorded trace, and customer signals are aggregates from the benchmark data. No
        live scanner and no hosted model are called.
      </div>

      {canRun && (
        <Panel title="Start a run" className="mb-6">
          <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4 md:grid-cols-5 md:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="journey">Journey</Label>
              <select
                id="journey"
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                value={journey}
                onChange={(e) => setJourney(e.target.value as typeof journey)}
              >
                {JOURNEYS.map((j) => (
                  <option key={j.value} value={j.value}>
                    {j.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="platform">Platform</Label>
              <select
                id="platform"
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                value={platform}
                onChange={(e) => setPlatform(e.target.value as typeof platform)}
              >
                {PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="build">Build</Label>
              <select
                id="build"
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                value={buildId}
                onChange={(e) => setBuildId(e.target.value)}
              >
                {BUILDS.map((b) => (
                  <option key={b} value={b}>
                    {b} staging build
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="screens">Screens to test</Label>
              <input
                id="screens"
                type="number"
                min={1}
                max={12}
                value={maxScreens}
                onChange={(e) => setMaxScreens(Number(e.target.value))}
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
              />
            </div>
            <Button type="submit" disabled={running}>
              {running ? "Running…" : "Run the agent"}
            </Button>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">
            Capped at 140 steps and 120 seconds. Every tool call, model output and guard verdict is written to
            the run log before anything is drafted.
          </p>
          {error && (
            <div className="mt-3">
              <ErrorState title="The run did not start" message={error} />
            </div>
          )}
        </Panel>
      )}

      {runs.isLoading && <p role="status">Loading runs…</p>}
      {runs.error && (
        <ErrorState
          title="Could not read the run log"
          message={runs.error instanceof Error ? runs.error.message : "Unknown error"}
        />
      )}

      {runs.data && runs.data.length === 0 && (
        <EmptyState title="No agent runs yet">
          {canRun ? "Start one above." : "Your demo role cannot start a run. Switch to engineer or reviewer in Settings."}
        </EmptyState>
      )}

      {runs.data && runs.data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card shadow-card">
          <Table>
            <caption className="sr-only">Agent runs, most recent first</caption>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Steps</TableHead>
                <TableHead>Drafts</TableHead>
                <TableHead>Escalated</TableHead>
                <TableHead>Guard rejections</TableHead>
                <TableHead>Requested by</TableHead>
                <TableHead>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.data.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <Link
                      to="/agent/$runId"
                      params={{ runId: run.id }}
                      className="font-mono text-sm text-primary hover:underline"
                    >
                      {run.id}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {run.task.replaceAll("_", " ")} · {run.provider}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={run.status} />
                    {run.haltReason && (
                      <div className="mt-1 text-xs text-muted-foreground">{run.haltReason}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {run.stepsUsed} / {run.stepCap}
                    <div className="text-xs text-muted-foreground">{run.toolCalls} tool calls</div>
                  </TableCell>
                  <TableCell className="text-sm font-semibold">{run.findingsDrafted}</TableCell>
                  <TableCell className="text-sm">{run.escalations}</TableCell>
                  <TableCell className="text-sm">{run.guardRejections}</TableCell>
                  <TableCell className="text-sm">{run.requestedBy}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtDate(run.startedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
