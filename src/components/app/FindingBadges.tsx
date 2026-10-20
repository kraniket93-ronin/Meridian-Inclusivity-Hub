import type { FindingType, PolicySource } from "@/domain/types";
import { SOURCE_LABELS, TYPE_LABELS } from "@/domain/presentation";

export function TypeBadge({ type }: { type: FindingType }) {
  return <span className="inline-flex rounded border bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">{TYPE_LABELS[type]}</span>;
}
export function SourceCitation({ source }: { source: PolicySource }) {
  const color = source.status === "verified" ? "bg-success-bg text-success" : source.status === "partially_verified" ? "bg-sev-moderate-bg text-sev-moderate" : "bg-muted text-muted-foreground";
  return <li className="flex flex-wrap items-start gap-2 py-2 text-sm">
    <span className={source.status === "unverified" ? "line-through" : ""}>{source.id} · {source.title}</span>
    <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${color}`}>{SOURCE_LABELS[source.status]}</span>
  </li>;
}