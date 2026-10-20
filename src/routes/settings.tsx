import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { CURRENT_USER, setCurrentActor, useCurrentActor, useService } from "@/domain/store";
import type { Role } from "@/domain/types";
import { PageHeader, Panel } from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings · Meridian" },
      { name: "description", content: "Roles, policy sources and integration settings." },
      { property: "og:title", content: "Settings · Meridian" },
      { property: "og:description", content: "Roles and policy sources." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Settings,
});

const ROLES: { role: Role; label: string; can: string }[] = [
  { role: "admin", label: "admin", can: "manage projects, roles and settings" },
  { role: "reviewer", label: "reviewer", can: "approve or reject findings, record verification" },
  { role: "engineer", label: "engineer", can: "remediate approved findings, start scans" },
  { role: "viewer", label: "viewer", can: "read-only" },
];

function Settings() {
  const actor = useCurrentActor();
  const service = useService();
  const [resetting, setResetting] = useState(false);

  async function reset() {
    setResetting(true);
    try {
      await service.resetDemoData();
      toast.success("Demo scenario re-seeded in Supabase");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Workspace configuration. Secrets are stored server-side only."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Demo identity and role">
          <p className="text-sm text-muted-foreground">
            Every approval, rejection and verification is written to the database under this name.
            The prototype has no sign-in: the identity is chosen here so role rules can be
            demonstrated.
          </p>
          <div className="mt-4 space-y-2">
            <Label htmlFor="role">Acting as</Label>
            <select
              id="role"
              className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
              value={actor.role}
              onChange={(e) => {
                const role = e.target.value as Role;
                const name =
                  role === "reviewer"
                    ? CURRENT_USER
                    : `${CURRENT_USER.split(" (")[0]} (Demo ${role})`;
                setCurrentActor({ name, role, isDemo: true });
                toast.success(`Acting as ${role}`);
              }}
            >
              {ROLES.map((r) => (
                <option key={r.role} value={r.role}>
                  {r.label} — {r.can}
                </option>
              ))}
            </select>
            <p className="text-sm">
              Current: <b>{actor.name}</b>
            </p>
          </div>
        </Panel>
        <Panel title="Integrations">
          <ul className="space-y-2 text-sm">
            <li>
              Database: <b>Supabase Postgres</b> (public.app_* tables, server-side key only)
            </li>
            <li>
              Golden set: <b>read-only RPCs</b> on the same project (counts and schema only)
            </li>
            <li>
              LLM provider: <b>mock-deterministic</b> (simulated; no live LLM)
            </li>
            <li>Evidence storage: private bucket contract (not connected)</li>
            <li>Code changes: disabled — the agent never edits code</li>
          </ul>
        </Panel>
        <Panel title="Gate baseline: WCAG 2.1 Level A and AA" className="lg:col-span-2">
          <ul className="flex flex-wrap gap-2 text-sm">
            {[
              "1.1.1",
              "1.3.1",
              "1.4.3",
              "1.4.4",
              "2.2.1",
              "2.4.3",
              "2.4.7",
              "3.1.1",
              "3.1.2",
              "3.3.1",
              "3.3.3",
              "4.1.2",
              "4.1.3",
            ].map((code) => (
              <li key={code}>
                <a
                  className="rounded border bg-muted px-2 py-1 text-primary underline"
                  href={`https://www.w3.org/TR/WCAG21/`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {code}
                </a>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="WCAG 2.2 supplemental (reported, not gating)" className="lg:col-span-2">
          <ul className="flex flex-wrap gap-2 text-sm">
            {["2.5.8", "3.3.7", "3.3.8"].map((code) => (
              <li key={code}>
                <a
                  className="rounded border bg-muted px-2 py-1 text-primary underline"
                  href="https://www.w3.org/TR/WCAG22/"
                  target="_blank"
                  rel="noreferrer"
                >
                  {code}
                </a>
              </li>
            ))}
          </ul>
        </Panel>
        {actor.role !== "viewer" && (
          <Panel title="Demo data" className="lg:col-span-2">
            <p className="mb-3 text-sm text-muted-foreground">
              Clears the app tables in Supabase and re-seeds scan scn-2001 with the eight MAE Golden
              Set v0.1 findings. Verification records and review decisions made during the demo are
              deleted.
            </p>
            <Button variant="outline" disabled={resetting} onClick={() => void reset()}>
              {resetting ? "Resetting…" : "Reset demo data"}
            </Button>
          </Panel>
        )}
      </div>
    </>
  );
}
