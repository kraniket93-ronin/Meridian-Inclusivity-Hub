import { createFileRoute, Link } from "@tanstack/react-router";
import { useDb } from "@/domain/store";
import { PageHeader, Panel, SeverityBadge, StatusBadge, fmtDate } from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { SEVERITY_ORDER } from "@/domain/workflow";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard · Meridian Inclusive Access Agent" },
      { name: "description", content: "Overview of accessibility scans, open findings, review workload and verification progress." },
      { property: "og:title", content: "Dashboard · Meridian Inclusive Access Agent" },
      { property: "og:description", content: "Overview of accessibility scans, findings, review and verification." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const db = useDb((s) => s);
  const open = db.findings.filter((f) => !["verified", "rejected"].includes(f.status));
  const verified = db.findings.filter((f) => f.status === "verified").length;
  const pending = db.reviewTasks.filter((t) => t.status === "pending").length;
  const ready = db.findings.filter((f) => f.status === "ready_for_verification").length;
  const stats = [
    { label: "Open findings", value: open.length, to: "/findings" },
    { label: "Awaiting review", value: pending, to: "/review" },
    { label: "Ready to verify", value: ready, to: "/verification" },
    { label: "Human-verified fixes", value: verified, to: "/verification" },
  ] as const;
  const max = Math.max(1, ...SEVERITY_ORDER.map((s) => open.filter((f) => f.severity === s).length));

  return (
    <>
      <PageHeader title="Dashboard" description="Meridian Mobile App — MVP journeys · Onboarding (12 steps) · Dispute filing (9 steps) · Android, iOS, Web"
        actions={<Button asChild><Link to="/scans">New scan</Link></Button>} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} to={s.to} className="rounded-lg border bg-card p-5 shadow-card transition hover:border-primary">
            <p className="text-sm text-muted-foreground">{s.label}</p>
            <p className="mt-2 text-3xl font-semibold">{s.value}</p>
          </Link>
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel title="Open findings by severity">
          <ul className="space-y-3">
            {SEVERITY_ORDER.map((sev) => {
              const n = open.filter((f) => f.severity === sev).length;
              return (
                <li key={sev} className="flex items-center gap-3">
                  <span className="w-20"><SeverityBadge severity={sev} /></span>
                  <div className="h-2 flex-1 rounded bg-muted" aria-hidden="true"><div className="h-2 rounded bg-primary" style={{ width: `${(n / max) * 100}%` }} /></div>
                  <span className="w-6 text-right text-sm font-medium">{n}</span>
                </li>
              );
            })}
          </ul>
        </Panel>
        <Panel title="Recent scans" className="lg:col-span-2">
          <ul className="divide-y">
            {db.scans.slice(0, 5).map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <Link to="/scans/$scanId" params={{ scanId: s.id }} className="font-mono text-sm text-primary underline-offset-2 hover:underline">{s.id} · {s.targetUrl}</Link>
                <span className="flex items-center gap-3 text-xs text-muted-foreground"><StatusBadge status={s.status} />{fmtDate(s.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Recent activity" className="lg:col-span-3">
          <ul className="divide-y text-sm">
            {db.auditEvents.slice(0, 6).map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span><span className="font-medium">{e.actor}</span> · <code className="font-mono text-xs">{e.action}</code> · {e.entityId}</span>
                <span className="text-muted-foreground">{fmtDate(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
