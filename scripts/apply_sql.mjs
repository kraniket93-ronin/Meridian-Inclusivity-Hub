// Applies .sql files to the project database over a direct Postgres connection.
// Used for DDL, which the REST API cannot do.
//
//   DATABASE_URL="postgresql://…" node scripts/apply_sql.mjs db/supabase/001_app_schema.sql …
//
// DATABASE_URL is read from the environment or from .env (DATABASE_URL=…). It is only
// needed for schema changes; the running app uses MAE_SUPABASE_SECRET_KEY instead.
import { readFileSync } from "node:fs";
import postgres from "postgres";

function urlFromEnvFile() {
  try {
    const line = readFileSync(new URL("../.env", import.meta.url), "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    return line
      ?.slice("DATABASE_URL=".length)
      .trim()
      .replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

const url = process.env["DATABASE_URL"] || urlFromEnvFile();
const files = process.argv.slice(2);
if (!url) throw new Error("Set DATABASE_URL (environment or .env).");
if (!files.length) throw new Error("Pass one or more .sql files to apply.");

// Parse the URL ourselves: the password is percent-encoded (an '@' in the password
// is '%40'), and passing it through decoded avoids any driver-side ambiguity.
const parsed = new URL(url);
const sql = postgres({
  host: parsed.hostname,
  port: Number(parsed.port || 5432),
  database: parsed.pathname.replace(/^\//, "") || "postgres",
  username: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  ssl: "require",
  max: 1,
  prepare: false,
  connect_timeout: 20,
  idle_timeout: 5,
});

try {
  const [{ current_user: user, current_database: db }] =
    await sql`select current_user, current_database()`;
  console.log(`connected: ${user}@${db}`);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    process.stdout.write(`applying ${file} (${text.length} bytes)… `);
    await sql.unsafe(text);
    console.log("ok");
  }
  const tables = await sql`
    select table_name, (select count(*) from information_schema.columns c
                        where c.table_schema = t.table_schema and c.table_name = t.table_name) as cols
    from information_schema.tables t
    where t.table_schema = 'public' and t.table_name like 'app\\_%'
    order by 1`;
  console.log(`\napp_* tables (${tables.length}):`);
  for (const t of tables) console.log(`  ${t.table_name} (${t.cols} columns)`);
} finally {
  await sql.end({ timeout: 5 });
}
