import type { ReactNode } from "react";
import { AlertTriangle, Inbox, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FindingStatus, ScanStatus, Severity, JobStatus } from "@/domain/types";
import { SEVERITY_DEFINITIONS } from "@/domain/presentation";

export function DemoBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border border-brand-orange bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground", className)}>
      <FlaskConical className="size-3" aria-hidden="true" /> Demo data
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="break-words text-2xl font-semibold">{title}</h1>
          <DemoBadge />
        </div>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </header>
  );
}

const sevClass: Record<Severity, string> = {
  critical: "bg-sev-critical-bg text-sev-critical border-sev-critical/30",
  high: "bg-sev-serious-bg text-sev-serious border-sev-serious/30",
  medium: "bg-sev-moderate-bg text-sev-moderate border-sev-moderate/30",
  low: "bg-sev-minor-bg text-sev-minor border-sev-minor/30",
};
export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span tabIndex={0} title={SEVERITY_DEFINITIONS[severity]} aria-label={`${severity}: ${SEVERITY_DEFINITIONS[severity]}`} className={cn("inline-flex rounded border px-2 py-0.5 text-xs font-semibold capitalize", sevClass[severity])}>{severity}</span>;
}

const statusClass: Record<string, string> = {
  verified: "bg-success-bg text-success border-success/30",
  completed: "bg-success-bg text-success border-success/30",
  succeeded: "bg-success-bg text-success border-success/30",
  approved: "bg-success-bg text-success border-success/30",
  pass: "bg-success-bg text-success border-success/30",
  failed: "bg-sev-critical-bg text-sev-critical border-sev-critical/30",
  fail: "bg-sev-critical-bg text-sev-critical border-sev-critical/30",
  failed_validation: "bg-sev-critical-bg text-sev-critical border-sev-critical/30",
  rejected: "bg-muted text-muted-foreground border-border",
  reopened: "bg-sev-serious-bg text-sev-serious border-sev-serious/30",
};
export function StatusBadge({ status }: { status: FindingStatus | ScanStatus | JobStatus | string }) {
  return (
    <span className={cn("inline-flex rounded border px-2 py-0.5 text-xs font-medium", statusClass[status] ?? "bg-secondary text-secondary-foreground border-border")}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card p-10 text-center">
      <Inbox className="size-8 text-muted-foreground" aria-hidden="true" />
      <p className="mt-3 font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", message }: { title?: string; message: string }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-sev-critical-bg p-4 text-sev-critical">
      <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div><p className="font-semibold">{title}</p><p className="text-sm">{message}</p></div>
    </div>
  );
}

export function Panel({ title, children, className, actions }: { title?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cn("rounded-lg border bg-card p-5 shadow-card", className)} aria-label={title}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "—");
