import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useDb, useCurrentActor, useDataStatus, useService } from "@/domain/store";
import { generateRecommendation } from "@/lib/ai/recommendation.functions";
import {
  ErrorState,
  PageHeader,
  Panel,
  SeverityBadge,
  StatusBadge,
  fmtDate,
} from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { FindingActions } from "@/components/app/FindingActions";
import { SourceCitation, TypeBadge } from "@/components/app/FindingBadges";
import {
  BASELINE_LABELS,
  DEMO_NOTE,
  GATE_LABELS,
  SEVERITY_DEFINITIONS,
  locationLabel,
  wcagVerdict,
} from "@/domain/presentation";

export const Route = createFileRoute("/findings/$findingId")({
  head: ({ params }) => ({
    meta: [
      { title: `Finding ${params.findingId} · Meridian` },
      {
        name: "description",
        content: "Synthetic MAE finding evidence, WCAG classification and human review.",
      },
      { property: "og:title", content: `Finding ${params.findingId} · Meridian` },
      { property: "og:description", content: "Synthetic MAE evidence and advisory workflow." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: FindingErrorPage,
  component: FindingDetail,
});

/** Route-level boundary: a failure here shows the finding's id and a way back, never a blank page. */
function FindingErrorPage() {
  const { findingId } = Route.useParams();
  return (
    <>
      <PageHeader
        title="This finding could not be displayed"
        description={`Finding ID: ${findingId}`}
      />
      <Button asChild variant="outline">
        <Link to="/findings">Back to Findings Inbox</Link>
      </Button>
    </>
  );
}

function FindingDetail() {
  const { findingId } = Route.useParams();
  const db = useDb((s) => s);
  const actor = useCurrentActor();
  const service = useService();
  const f = db.findings.find((x) => x.id === findingId);
  const rec = db.recommendations.find((r) => r.findingId === findingId);
  const gen = useServerFn(generateRecommendation);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const status = useDataStatus();
  if (!f) {
    // While the first read is in flight, "not found" would be a lie.
    if (status.isLoading) return <p role="status">Loading finding {findingId}…</p>;
    return (
      <>
        <PageHeader
          title="This finding could not be displayed"
          description={`Finding ID: ${findingId}`}
        />
        <Link to="/findings" className="text-primary underline">
          Back to Findings Inbox
        </Link>
      </>
    );
  }

  async function suggest() {
    if (!f) return;
    setLoading(true);
    setError("");
    try {
      const result = await gen({
        data: {
          findingId: f.id,
          ruleId: f.findingType,
          wcag: f.wcag || "n/a",
          selector: f.screenId,
          snippet: f.evidence,
        },
      });
      if (result.ok) {
        await service.saveRecommendation(f.id, result.data, result.run);
        toast.success("Mock suggestion stored — advisory only, needs human review");
      } else {
        await service.saveFailedModelRun(f.id, result.run);
        setError(result.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }
  return (
    <article className="min-w-0 space-y-5 break-words">
      <Link to="/findings" className="text-sm text-primary hover:underline">
        ← Findings Inbox
      </Link>
      <PageHeader title={f.title} description={DEMO_NOTE} />
      <div className="space-y-2">
        <p className="text-sm">
          <b>{f.id}</b> · Source record: <span className="font-mono">{f.goldenSetId}</span>
        </p>
        <p className="text-sm">
          {locationLabel(f)} · <code>{f.screenId}</code>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={f.status} />
          <SeverityBadge severity={f.severity} />
          <TypeBadge type={f.findingType} />
        </div>
        <p className="text-sm font-semibold">
          Priority score: {f.priorityScore} · {f.priorityBand}
        </p>
      </div>
      <Panel title="Is this a WCAG failure?">
        <p className="font-semibold">{wcagVerdict(f)}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {f.wcagCriteria?.map((c) => (
            <span key={c} className="rounded border bg-muted px-2 py-1 text-xs">
              WCAG {c}
            </span>
          ))}
          {f.wcagVersion && (
            <span className="rounded border bg-muted px-2 py-1 text-xs">{f.wcagVersion}</span>
          )}
          {f.conformanceLevel && (
            <span className="rounded border bg-muted px-2 py-1 text-xs">
              Level {f.conformanceLevel}
            </span>
          )}
          <span className="rounded border bg-secondary px-2 py-1 text-xs text-secondary-foreground">
            {BASELINE_LABELS[f.baselineStatus]}
          </span>
        </div>
        {f.callout && (
          <p className="mt-3 border-l-4 border-brand-orange bg-accent p-3 text-sm text-accent-foreground">
            {f.callout}
          </p>
        )}
        {f.description && <p className="mt-3 text-sm">{f.description}</p>}
      </Panel>
      <Panel title="Recommendation">
        <p className="text-xl font-semibold">{GATE_LABELS[f.gateRecommendation]}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Recommendation only. The agent never blocks a release, approves a waiver or closes a
          finding; a person decides.
        </p>
        <p className="mt-3 text-sm">
          <b>Escalate to:</b> {f.escalateTo}
        </p>
        <p className="mt-1 text-sm">
          Human review: {f.requiresHumanReview ? "Required" : "Not required"}
        </p>
        {f.extraNote && <p className="mt-3 text-sm">{f.extraNote}</p>}
      </Panel>
      <Panel title="Evidence">
        <p className="text-sm">{f.evidence}</p>
        {f.nodeIds && <p className="mt-2 font-mono text-xs">Node IDs: {f.nodeIds.join(", ")}</p>}
        {f.simulationTrace && (
          <p className="mt-2 text-sm text-muted-foreground">{f.simulationTrace}</p>
        )}
      </Panel>
      <Panel title="Who is affected">
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="font-semibold">Affected user need</dt>
            <dd>{f.affectedUserNeed}</dd>
          </div>
          <div>
            <dt className="font-semibold">Affected groups</dt>
            <dd>{f.affectedGroups.join(", ")}</dd>
          </div>
          <div>
            <dt className="font-semibold">User impact</dt>
            <dd>
              {f.userImpact === "task_blocked"
                ? "Blocks the task"
                : "Slows the task or causes errors"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold capitalize">{f.severity} severity</dt>
            <dd>{SEVERITY_DEFINITIONS[f.severity]}</dd>
          </div>
        </dl>
      </Panel>
      <Panel title="Confidence">
        <p className="text-sm">
          <b className="capitalize">{f.confidence}</b> · Evidence strength, not a probability
        </p>
        {f.abstentionReason && (
          <p className="mt-3 rounded border border-sev-moderate/30 bg-sev-moderate-bg p-3 text-sm text-sev-moderate">
            {f.abstentionReason}
          </p>
        )}
      </Panel>
      <Panel title="Fix">
        <span className="text-xs font-semibold text-muted-foreground">
          Suggested — never auto-applied
        </span>
        <p className="mt-2 text-sm">{f.recommendedFix}</p>
        <p className="mt-3 text-sm text-muted-foreground">{f.fixRationale}</p>
        {actor.role !== "viewer" && (
          <Button
            className="mt-4 h-auto min-h-9 whitespace-normal"
            size="sm"
            variant="outline"
            onClick={suggest}
            disabled={loading}
          >
            {loading ? "Generating…" : "Generate mock AI suggestion"}
          </Button>
        )}
        {error && (
          <div className="mt-3">
            <ErrorState message={error} />
          </div>
        )}
        {rec && (
          <div className="mt-3 space-y-2 border-t pt-3 text-sm">
            <p className="font-medium">Mock AI suggestion (advisory)</p>
            <p>{rec.summary}</p>
            <p>{rec.proposedFix}</p>
            <p className="text-muted-foreground">{rec.rationale}</p>
          </div>
        )}
      </Panel>
      <Panel title="Verification steps">
        <p className="text-sm">{f.verificationSteps}</p>
        {f.status === "ready_for_verification" && (
          <Button asChild variant="outline" className="mt-3">
            <Link to="/verification">Record verification</Link>
          </Button>
        )}
      </Panel>
      <Panel title="Sources">
        <ul className="divide-y">
          {f.policySources.map((source) => (
            <SourceCitation key={source.id} source={source} />
          ))}
        </ul>
      </Panel>
      <Panel title="Activity">
        <p className="text-sm">
          Created by scan{" "}
          <Link
            to="/scans/$scanId"
            params={{ scanId: f.scanId }}
            className="text-primary underline"
          >
            {f.scanId}
          </Link>{" "}
          (mock engines) · {fmtDate(f.createdAt)}
        </p>
        <ul className="my-3 divide-y text-sm">
          {db.auditEvents
            .filter((e) => e.entityId === f.id)
            .map((e) => (
              <li key={e.id} className="py-2">
                <b>{e.actor}</b> · {e.action} · {fmtDate(e.createdAt)}
              </li>
            ))}
        </ul>
        <FindingActions finding={f} />
      </Panel>
    </article>
  );
}
