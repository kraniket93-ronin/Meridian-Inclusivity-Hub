import { createFileRoute, Link } from "@tanstack/react-router";
import { useDataStatus, useDb } from "@/domain/store";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  SeverityBadge,
  StatusBadge,
  fmtDate,
} from "@/components/app/ui-bits";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/scans/$scanId")({
  head: ({ params }) => ({
    meta: [
      { title: `Scan ${params.scanId} · Meridian` },
      { name: "description", content: "Scan job progress and the findings it produced." },
      { property: "og:title", content: `Scan ${params.scanId} · Meridian` },
      { property: "og:description", content: "Scan job progress and findings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: ScanErrorPage,
  component: ScanDetail,
});

/** Route-level boundary: a failure here shows the scan's id and a way back, never a blank page. */
function ScanErrorPage() {
  const { scanId } = Route.useParams();
  return (
    <>
      <PageHeader title="This scan could not be displayed" description={`Scan ID: ${scanId}`} />
      <Link to="/scans" className="text-primary underline">
        Back to all scans
      </Link>
    </>
  );
}

function ScanDetail() {
  const { scanId } = Route.useParams();
  const scan = useDb((s) => s.scans.find((x) => x.id === scanId));
  const job = useDb((s) => s.scanJobs.find((j) => j.scanId === scanId));
  const project = useDb((s) => s.projects.find((p) => p.id === scan?.projectId));
  const findings = useDb((s) => s.findings.filter((f) => f.scanId === scanId));
  const status = useDataStatus();

  if (!scan) {
    if (status.isLoading) return <p role="status">Loading scan {scanId}…</p>;
    return (
      <>
        <PageHeader title="This scan could not be displayed" description={`Scan ID: ${scanId}`} />
        <Link to="/scans" className="text-primary underline">
          Back to all scans
        </Link>
      </>
    );
  }
  const busy = scan.status === "queued" || scan.status === "running";

  return (
    <>
      <p className="mb-2 text-sm">
        <Link to="/scans" className="text-primary hover:underline">
          ← All scans
        </Link>
      </p>
      <PageHeader
        title={`Scan ${scan.id}`}
        description={`${project?.name ?? ""} · ${scan.targetUrl}`}
      />
      <p className="mb-3 text-sm">Scope: {scan.scope}</p>
      <p className="mb-5 text-sm text-muted-foreground">Engines: {scan.engines.join(" · ")}</p>
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Job">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Scan status</dt>
              <dd>
                <StatusBadge status={scan.status} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Job status</dt>
              <dd>{job ? <StatusBadge status={job.status} /> : "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Attempts</dt>
              <dd>{job?.attempts ?? 0}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Created</dt>
              <dd>{fmtDate(scan.createdAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Completed</dt>
              <dd>{fmtDate(scan.completedAt)}</dd>
            </div>
          </dl>
          <div className="mt-4" aria-live="polite">
            <Progress value={job?.progress ?? 0} aria-label="Scan progress" />
            <p className="mt-1 text-xs text-muted-foreground">{job?.progress ?? 0}% complete</p>
          </div>
          {job?.error && (
            <div className="mt-4">
              <ErrorState title="Job failed" message={job.error} />
            </div>
          )}
        </Panel>
        <Panel title={`Findings (${findings.length})`} className="lg:col-span-2">
          {busy ? (
            <div className="space-y-2" aria-busy="true" aria-label="Loading findings">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : findings.length === 0 ? (
            <EmptyState title="No findings">
              {scan.status === "failed"
                ? "The scan did not complete."
                : "No issues detected by automated rules. Manual testing is still recommended."}
            </EmptyState>
          ) : (
            <ul className="divide-y">
              {findings.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <Link
                    to="/findings/$findingId"
                    params={{ findingId: f.id }}
                    className="font-medium text-primary hover:underline"
                  >
                    {f.title}
                  </Link>
                  <span className="flex gap-2">
                    <SeverityBadge severity={f.severity} />
                    <StatusBadge status={f.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
