import { createFileRoute, Link } from "@tanstack/react-router";
import { useDb } from "@/domain/store";
import { EmptyState, PageHeader, Panel, SeverityBadge } from "@/components/app/ui-bits";
import { FindingActions } from "@/components/app/FindingActions";
import { locationLabel } from "@/domain/presentation";

export const Route = createFileRoute("/review")({
  head: () => ({
    meta: [
      { title: "Review Queue · Meridian" },
      { name: "description", content: "Human review of findings and AI suggestions." },
      { property: "og:title", content: "Review Queue · Meridian" },
      { property: "og:description", content: "Human review of findings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Review,
});

function Review() {
  const db = useDb((s) => s);
  const pending = db.findings.filter((f) => ["in_review", "held_for_expert_review"].includes(f.status));
  return (
    <>
      <PageHeader title="Review Queue" description="Approve or reject findings. Approval allows remediation; it does not verify a fix." />
      {pending.length === 0 ? <EmptyState title="Queue is clear" /> : (
        <div className="space-y-3">
          {pending.map((f) => {
            const rec = db.recommendations.find((r) => r.findingId === f.id);
            return (
              <Panel key={f.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link to="/findings/$findingId" params={{ findingId: f.id }} className="font-medium text-primary hover:underline">{f.title}</Link>
                    <p className="text-xs text-muted-foreground">{locationLabel(f)}</p>
                    {rec && <p className="mt-2 text-sm">AI suggestion: {rec.summary}</p>}
                  </div>
                  <div className="flex flex-wrap items-start gap-2"><SeverityBadge severity={f.severity} />
                    <FindingActions finding={f} />
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
