import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useDb } from "@/domain/store";
import { EmptyState, PageHeader, SeverityBadge, StatusBadge } from "@/components/app/ui-bits";
import { TypeBadge } from "@/components/app/FindingBadges";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SEVERITY_ORDER } from "@/domain/workflow";
import {
  DEMO_NOTE,
  GATE_LABELS,
  JOURNEY_LABELS,
  PLATFORM_LABELS,
  TYPE_LABELS,
} from "@/domain/presentation";
import type { Finding, FindingType } from "@/domain/types";

export const Route = createFileRoute("/findings/")({
  head: () => ({
    meta: [
      { title: "Findings Inbox · Meridian" },
      {
        name: "description",
        content:
          "Triage accessibility and inclusion findings by type, journey, severity and status.",
      },
      { property: "og:title", content: "Findings Inbox · Meridian" },
      { property: "og:description", content: "Triage accessibility findings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FindingsInbox,
});

const STATUSES = [
  "open",
  "in_review",
  "awaiting_compliance",
  "held_for_expert_review",
  "remediation_in_progress",
  "ready_for_verification",
  "verified",
  "rejected",
];
const TYPES = Object.keys(TYPE_LABELS) as FindingType[];

function wcagCell(f: Finding) {
  if (f.findingType !== "wcag_failure" || !f.wcagCriteria?.length) {
    return <span className="text-muted-foreground">Not a WCAG failure</span>;
  }
  return (
    <span>
      {f.wcagCriteria.join(", ")}
      {f.conformanceLevel ? ` · Level ${f.conformanceLevel}` : ""}
    </span>
  );
}

function FindingsInbox() {
  const findings = useDb((s) => s.findings);
  const [q, setQ] = useState("");
  const [sev, setSev] = useState("all");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [journey, setJourney] = useState("all");

  const rows = findings
    .filter(
      (f) => (sev === "all" || f.severity === sev) && (status === "all" || f.status === status),
    )
    .filter(
      (f) =>
        (type === "all" || f.findingType === type) && (journey === "all" || f.journey === journey),
    )
    .filter(
      (f) =>
        !q ||
        `${f.title} ${f.goldenSetId} ${f.wcagCriteria?.join(" ") ?? ""} ${f.screenId} ${f.stepName}`
          .toLowerCase()
          .includes(q.toLowerCase()),
    )
    .sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
        b.priorityScore - a.priorityScore,
    );

  return (
    <>
      <PageHeader title="Findings Inbox" description={DEMO_NOTE} />
      <p className="mb-4 text-sm text-muted-foreground">
        Each finding is a candidate that needs human review. Only three of the eight are WCAG
        failures — the rest are what a checklist either misses or would wrongly call a violation.
      </p>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" role="search">
        <div className="space-y-1.5">
          <Label htmlFor="q">Search</Label>
          <Input
            id="q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Title, record, screen, step…"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="type">Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger id="type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="journey">Journey</Label>
          <Select value={journey} onValueChange={setJourney}>
            <SelectTrigger id="journey">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All journeys</SelectItem>
              <SelectItem value="onboarding">Onboarding</SelectItem>
              <SelectItem value="dispute_filing">Dispute filing</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sev">Severity</Label>
          <Select value={sev} onValueChange={setSev}>
            <SelectTrigger id="sev">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              {SEVERITY_ORDER.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="st">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="st">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replaceAll("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {rows.length} findings shown
      </p>
      {rows.length === 0 ? (
        <EmptyState title="No findings match these filters" />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card shadow-card">
          <Table>
            <caption className="sr-only">Findings, highest severity first</caption>
            <TableHeader>
              <TableRow>
                <TableHead>Finding</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>WCAG</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Gate recommendation</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="min-w-56">
                    <Link
                      to="/findings/$findingId"
                      params={{ findingId: f.id }}
                      className="font-medium text-primary hover:underline"
                    >
                      {f.title}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {JOURNEY_LABELS[f.journey]} · Step {f.stepNo} · {f.stepName} ·{" "}
                      {PLATFORM_LABELS[f.platform]}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">{f.goldenSetId}</div>
                  </TableCell>
                  <TableCell>
                    <TypeBadge type={f.findingType} />
                  </TableCell>
                  <TableCell className="text-sm">{wcagCell(f)}</TableCell>
                  <TableCell>
                    <SeverityBadge severity={f.severity} />
                  </TableCell>
                  <TableCell className="text-sm">{GATE_LABELS[f.gateRecommendation]}</TableCell>
                  <TableCell>
                    <StatusBadge status={f.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
