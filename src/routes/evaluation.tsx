import { createFileRoute } from "@tanstack/react-router";
import { useDb } from "@/domain/store";
import { PageHeader, Panel, StatusBadge, fmtDate } from "@/components/app/ui-bits";

export const Route = createFileRoute("/evaluation")({
  head: () => ({
    meta: [
      { title: "Evaluation · Meridian" },
      {
        name: "description",
        content: "Model run quality: schema validation and reviewer agreement.",
      },
      { property: "og:title", content: "Evaluation · Meridian" },
      { property: "og:description", content: "Model run quality metrics." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Evaluation,
});

function Evaluation() {
  const db = useDb((s) => s);
  const runs = db.modelRuns;
  const ok = runs.filter((r) => r.status === "succeeded").length;
  const decided = db.reviewTasks.filter((t) => t.status !== "pending");
  const approved = decided.filter((t) => t.status === "approved").length;
  const verifiedRuns = db.verificationRuns.length;
  const avg = runs.length ? Math.round(runs.reduce((a, r) => a + r.latencyMs, 0) / runs.length) : 0;
  const stats: [string, string, string][] = [
    [
      "Schema-valid model outputs",
      runs.length ? `${ok} of ${runs.length}` : "0 of 0",
      "Outputs that passed the finding schema before being stored.",
    ],
    [
      "Specialist agreement",
      decided.length ? `${approved} of ${decided.length}` : "0 of 0",
      "Review decisions recorded in this database, not a quality score.",
    ],
    [
      "Human verification runs",
      String(verifiedRuns),
      "Fixes checked by a named person. AI suggestions never count.",
    ],
    [
      "Mean adapter latency",
      runs.length ? `${avg} ms` : "—",
      "Mock provider; no live model is called.",
    ],
  ];
  return (
    <>
      <PageHeader
        title="Evaluation"
        description="Counts from this prototype's own database, each shown with its denominator."
      />
      <div
        role="note"
        className="mb-5 rounded-md border bg-accent px-4 py-3 text-sm text-accent-foreground"
      >
        These are prototype counters, not an agent evaluation. Detection precision and recall,
        missed-critical count, over-claim rate and the 230 safety cases are measured offline against
        MAE Golden Set v0.1 on grouped train/dev/test splits, and reported per customer group — see
        the Agent Training and Evaluation Spec. No number here should be read as real-world
        accuracy: every golden label is synthetic and unreviewed.
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(([label, value, note]) => (
          <Panel key={label}>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 text-3xl font-semibold">{value}</p>
            <p className="mt-2 text-xs text-muted-foreground">{note}</p>
          </Panel>
        ))}
      </div>
      <Panel title="Model runs">
        <ul className="divide-y text-sm">
          {runs.map((r) => (
            <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span className="font-mono text-xs">
                {r.id} · {r.findingId} · {r.model} · {r.promptVersion} · {r.latencyMs}ms
              </span>
              <span className="flex gap-2">
                <StatusBadge status={r.status} />
                {fmtDate(r.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
