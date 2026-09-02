/**
 * Makes the Prisma datasource match the database it is actually pointed at.
 *
 * The schema is written for SQLite, because that is what makes a local
 * checkout work with `npm install` and nothing else. A deployed instance
 * cannot use it: serverless filesystems are ephemeral, so the database file
 * would be discarded on every deploy.
 *
 * Rather than keep two schemas in step by hand — the reliable way to end up
 * with a production table that quietly differs from the local one — the single
 * schema is rewritten at build time to match the connection string. Every
 * model, index and relation stays in one file.
 *
 * Runs on a managed host only. A local build is left completely alone, so a
 * checkout keeps its SQLite schema and `npm run build` on a laptop changes
 * nothing in the working tree.
 */
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const SCHEMA = "prisma/schema.prisma";

const url = (process.env.DATABASE_URL ?? "").trim();

/**
 * Each host advertises itself. Keying off the host rather than off the
 * connection string is deliberate: someone pointing a local checkout at a
 * Postgres instance to try something should not find their schema file
 * rewritten underneath them.
 */
const HOSTS = [
  ["VERCEL", "Vercel"],
  ["RENDER", "Render"],
];
const host = HOSTS.find(([key]) => Boolean(process.env[key]));
const isPostgres = /^postgres(ql)?:\/\//i.test(url);

if (!host) {
  console.log("[deploy] not on a managed host — leaving the SQLite schema untouched.");
  process.exit(0);
}
console.log(`[deploy] building on ${host[1]}.`);

if (!url) {
  console.error(
    `[deploy] DATABASE_URL is not set. Add a Postgres connection string in the ${host[1]} service's environment variables.`,
  );
  process.exit(1);
}

if (!isPostgres) {
  console.error(
    `[deploy] DATABASE_URL does not look like Postgres (${url.slice(0, 12)}...). ` +
      "A deployed instance needs Postgres — SQLite is a file on a disk that does not persist.",
  );
  process.exit(1);
}

const schema = await readFile(SCHEMA, "utf8");
const rewritten = schema.replace(
  /datasource\s+db\s*\{[^}]*\}/m,
  `datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}`,
);

if (rewritten === schema) {
  console.error("[deploy] could not find the datasource block to rewrite.");
  process.exit(1);
}

await writeFile(SCHEMA, rewritten);
console.log("[deploy] datasource switched to postgresql.");

/**
 * `db push` rather than `migrate deploy`: the committed migrations are SQLite
 * SQL and will not run on Postgres. Pushing derives the tables from the schema
 * directly, which is idempotent and correct for a database this app owns
 * outright. The trade is that production has no migration history — acceptable
 * here, and worth revisiting if this ever holds data that matters to anyone
 * other than its owner.
 */
console.log("[deploy] syncing the database schema...");
const { stdout, stderr } = await run("npx", ["prisma", "db", "push", "--skip-generate"], {
  env: process.env,
  shell: process.platform === "win32",
});
process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
/**
 * Grandfather accounts that predate email verification.
 *
 * Production syncs with `db push`, which reconciles the schema and never runs
 * a migration file, so a data backfill has to happen here or not at all.
 * Sign-in now refuses an unverified account, and every account created before
 * verification existed has a null there — leaving them would lock every
 * existing user out of their own data, including whoever deployed this.
 *
 * Idempotent by construction: it only touches rows that are still null, so it
 * can run on every deploy forever and will do nothing after the first.
 */
console.log("[deploy] grandfathering pre-verification accounts...");
try {
  const { stdout: backfilled } = await run(
    "npx",
    ["prisma", "db", "execute", "--url", url, "--file", "prisma/backfill/verify-existing-accounts.sql"],
    { env: process.env, shell: process.platform === "win32" },
  );
  if (backfilled) process.stdout.write(backfilled);
} catch (err) {
  // Must not take a deploy down: the schema is already correct and the app
  // runs. It would leave old accounts locked out, which is loud enough to
  // notice and fixed by re-running the deploy.
  console.error("[deploy] backfill failed:", err.message);
}

console.log("[deploy] database ready.");
