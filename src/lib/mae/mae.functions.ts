import { createServerFn } from "@tanstack/react-start";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Server-only call to the read-only RPCs on the external MAE project. Key never leaves the server. */
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<Result<T>> {
  const url = process.env["MAE_SUPABASE_URL"] ?? "https://vpehdvjftwxyfkuuvbfs.supabase.co";
  const key = process.env["MAE_SUPABASE_SECRET_KEY"];
  if (!key) return { ok: false, error: "not_configured" };
  try {
    const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: key, "content-type": "application/json", ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }) },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      console.error("MAE rpc failed", name, res.status, await res.text());
      return { ok: false, error: res.status === 404 ? "functions_missing" : "upstream_error" };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (e) {
    console.error("MAE rpc error", e);
    return { ok: false, error: "upstream_error" };
  }
}

type Counts = Record<string, number>;
export type DatasetStatus = {
  version: string; total: number; by_table: Counts; by_split_name: Counts; manifest_by_split: Counts;
  by_review_status: Counts; by_label_provenance: Counts; human_validated: number;
  last_imported_at: string | null; import_runs: number;
};

// Payloads are returned as JSON strings because row shapes are dynamic.
const asJson = <T,>(r: Result<T>): Result<string> => (r.ok ? { ok: true, data: JSON.stringify(r.data) } : r);

export const getMaeStatus = createServerFn({ method: "GET" }).handler(async () =>
  asJson(await rpc<DatasetStatus>("mae_dataset_status", { p_version: "MAE_Golden_Set_v0.1" })));

export const getMaeInventory = createServerFn({ method: "GET" }).handler(() =>
  rpc<{ table: string; column: string; type: string }[]>("mae_table_inventory", {}));

// Sample retrieval is intentionally disabled until source payload and ground-truth fields are confirmed.
