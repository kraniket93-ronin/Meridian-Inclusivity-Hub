// Server-only client for the Meridian app tables (public.app_*) that live in the same
// Supabase project as MAE Golden Set v0.1. It uses the project's secret key, so it must
// never be imported from a route file or a *.functions.ts module at the top level —
// load it inside a server handler:
//   const { appDb } = await import("@/integrations/supabase/mae-app.server");
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_URL = "https://vpehdvjftwxyfkuuvbfs.supabase.co";

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "Supabase is not configured. Set MAE_SUPABASE_URL and MAE_SUPABASE_SECRET_KEY in .env (server-only).",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

function build(): SupabaseClient {
  const url = process.env["MAE_SUPABASE_URL"] ?? DEFAULT_URL;
  const key = process.env["MAE_SUPABASE_SECRET_KEY"];
  if (!key) throw new SupabaseNotConfiguredError();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      // New-style secret keys (sb_secret_…) are opaque: they go in apikey, not as a bearer JWT.
      fetch: (input, init) => {
        const headers = new Headers(init?.headers ?? undefined);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

let client: SupabaseClient | undefined;

export function appDbIsConfigured(): boolean {
  return Boolean(process.env["MAE_SUPABASE_SECRET_KEY"]);
}

export function getAppDb(): SupabaseClient {
  if (!client) client = build();
  return client;
}
