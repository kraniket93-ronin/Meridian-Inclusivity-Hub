import { type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Radar,
  Inbox,
  ClipboardCheck,
  ShieldCheck,
  Gauge,
  Settings,
  Compass,
  Database,
} from "lucide-react";
import { useDb, useCurrentActor, useDataStatus } from "@/domain/store";
import { DataStatusNotice } from "@/components/app/DataStatusNotice";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/scans", label: "Scans", icon: Radar },
  { to: "/findings", label: "Findings Inbox", icon: Inbox },
  { to: "/review", label: "Review Queue", icon: ClipboardCheck },
  { to: "/verification", label: "Verification", icon: ShieldCheck },
  { to: "/evaluation", label: "Evaluation", icon: Gauge },
  { to: "/dataset", label: "Benchmark Dataset", icon: Database },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const actor = useCurrentActor();
  const status = useDataStatus();
  const pending = useDb((s) => s.reviewTasks.filter((t) => t.status === "pending").length);
  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2"
      >
        Skip to main content
      </a>
      <aside className="hidden w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-2 border-b border-sidebar-border px-5 py-5">
          <Compass className="size-7 text-sidebar-primary" aria-hidden="true" />
          <div className="leading-tight">
            <p className="font-semibold">Meridian</p>
            <p className="text-xs text-sidebar-foreground/80">Inclusive Access Agent</p>
          </div>
        </div>
        <nav aria-label="Primary" className="flex-1 space-y-1 p-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/90 hover:bg-sidebar-accent data-[status=active]:bg-sidebar-accent data-[status=active]:font-semibold data-[status=active]:text-sidebar-accent-foreground data-[status=active]:shadow-[inset_3px_0_0_var(--sidebar-primary)]"
            >
              <Icon className="size-4" aria-hidden="true" />
              <span className="flex-1">{label}</span>
              {to === "/review" && pending > 0 && (
                <span
                  className="rounded-full bg-sidebar-primary px-2 text-xs font-semibold text-sidebar-primary-foreground"
                  aria-label={`${pending} pending`}
                >
                  {pending}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="border-t border-sidebar-border p-4 text-xs text-sidebar-foreground/80">
          {actor.isDemo ? "Demo reviewer" : "Signed in as"}
          <br />
          <span className="font-medium text-sidebar-foreground">{actor.name}</span>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <nav aria-label="Primary mobile" className="flex flex-wrap gap-1 bg-sidebar p-2 md:hidden">
          {NAV.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="whitespace-nowrap rounded px-3 py-2 text-sm text-sidebar-foreground data-[status=active]:bg-sidebar-accent"
            >
              {label}
            </Link>
          ))}
        </nav>
        <div role="note" className="border-b bg-accent px-6 py-2 text-xs text-accent-foreground">
          Advisory tool only — findings and AI suggestions support human review. This is not a
          compliance certification and never blocks releases.
        </div>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full min-w-0 max-w-7xl flex-1 p-3 outline-none sm:p-6"
        >
          <DataStatusNotice status={status} />
          {children}
        </main>
      </div>
    </div>
  );
}
