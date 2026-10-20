import type { DataError } from "@/domain/data.functions";
import { Button } from "@/components/ui/button";

export interface DataStatus {
  isLoading: boolean;
  isFetching: boolean;
  code: DataError | null;
  message: string | null;
  refetch: () => void;
}

const MESSAGES: Record<DataError, { title: string; body: string }> = {
  not_configured: {
    title: "Database not connected",
    body: "Add MAE_SUPABASE_URL and MAE_SUPABASE_SECRET_KEY to .env (server-only values), then restart the dev server.",
  },
  schema_missing: {
    title: "Application tables are missing",
    body: "Run db/supabase/001_app_schema.sql and db/supabase/002_seed_mvp_scenario.sql in the Supabase SQL editor, then reload.",
  },
  upstream_error: {
    title: "Could not read from the database",
    body: "The request to Supabase failed. Check the project status and try again.",
  },
  forbidden: { title: "Not allowed", body: "The current demo role cannot perform that action." },
  invalid: { title: "Request rejected", body: "The database rejected the request." },
};

export function DataStatusNotice({ status }: { status: DataStatus }) {
  if (status.code) {
    const copy = MESSAGES[status.code];
    return (
      <div
        role="alert"
        className="mb-5 rounded-lg border border-destructive/40 bg-sev-critical-bg p-4 text-sev-critical"
      >
        <p className="font-semibold">{copy.title}</p>
        <p className="mt-1 text-sm">{copy.body}</p>
        <p className="mt-2 break-words font-mono text-xs opacity-80">{status.message}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => status.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  if (status.isLoading) {
    return (
      <p
        role="status"
        className="mb-5 rounded-md border bg-card px-4 py-2 text-sm text-muted-foreground"
      >
        Loading records from Supabase…
      </p>
    );
  }
  return null;
}
