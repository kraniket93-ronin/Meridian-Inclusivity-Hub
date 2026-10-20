import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getMaeInventory, getMaeStatus, type DatasetStatus } from "@/lib/mae/mae.functions";
import { PageHeader, Panel } from "@/components/app/ui-bits";

export const Route = createFileRoute("/dataset")({
  head: () => ({
    meta: [
      { title: "Benchmark Dataset · Meridian" },
      { name: "description", content: "MAE Golden Set v0.1 import status and schema inventory." },
      { property: "og:title", content: "Benchmark Dataset · Meridian" },
      { property: "og:description", content: "MAE Golden Set v0.1 status and schema." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dataset,
});

const MSG: Record<string, string> = {
  not_configured: "Not connected yet: the server secret MAE_SUPABASE_SECRET_KEY has not been added.",
  functions_missing: "Connected, but the read-only dataset functions have not been installed on the external project.",
  upstream_error: "The dataset service could not be reached. Try again shortly.",
  bad_payload: "The dataset service replied with data this page could not read.",
};

function Dataset() {
  const status = useServerFn(getMaeStatus);
  const inventory = useServerFn(getMaeInventory);
  const [st, setSt] = useState<DatasetStatus | null>(null);
  const [inv, setInv] = useState<{ table: string; column: string; type: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [s, i] = await Promise.all([status(), inventory()]);
      if (!alive) return;
      if (s.ok) {
        try {
          setSt(JSON.parse(s.data) as DatasetStatus);
        } catch {
          setErr("bad_payload");
        }
      } else {
        setErr(s.error);
      }
      if (i.ok) setInv(i.data);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [status, inventory]);



  return (
    <>
      <PageHeader title="Benchmark Dataset" description="MAE Golden Set v0.1 — read through a server-only connection. Only counts and column names are shown — no record contents." />
      <div role="note" className="mb-4 rounded-md border bg-accent px-4 py-2 text-sm text-accent-foreground">
        Synthetic benchmark data. Labels are not human-validated or production-approved. Test/evaluation records stay isolated in the database.
      </div>
      {loading && <p role="status">Loading dataset status…</p>}
      {err && <p role="alert" className="mb-4 rounded-md border border-destructive p-3 text-sm">{MSG[err] ?? err}</p>}
      {st && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Import status">
            <p className="text-3xl font-semibold">{st.total.toLocaleString()}</p>
            <p className="text-sm text-muted-foreground">records in {st.version}</p>
            <p className="mt-2 text-sm">Import runs: {st.import_runs} · Last imported: {st.last_imported_at ?? "—"}</p>
            <p className="text-sm">Human-validated records: {st.human_validated.toLocaleString()}</p>
          </Panel>
          {([["Records by table", st.by_table], ["Records by split_name", st.by_split_name], ["Split manifest by split", st.manifest_by_split], ["Review status", st.by_review_status], ["Label provenance", st.by_label_provenance]] as const).map(([t, c]) => (
            <Panel key={t} title={t}><ul className="text-sm">{Object.entries(c).map(([k, v]) => <li key={k}>{k}: {v.toLocaleString()}</li>)}</ul></Panel>
          ))}
          <Panel title="Schema inventory">
            <ul className="max-h-64 overflow-auto font-mono text-xs">{inv.map((c) => <li key={c.table + c.column}>{c.table}.{c.column} <span className="text-muted-foreground">{c.type}</span></li>)}</ul>
          </Panel>
          <Panel title="Sample records" className="lg:col-span-2">
            <p className="text-sm">Disabled. Record contents stay in the database until the source payload and ground-truth fields are confirmed.</p>
          </Panel>
        </div>
      )}
    </>
  );
}
