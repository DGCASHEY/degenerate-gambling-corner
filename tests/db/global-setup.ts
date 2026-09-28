import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import type { TestProject } from "vitest/node";

// Starts a real, throwaway Postgres 17 before any test runs, loads the
// Supabase stand-in and every migration, and deletes it all afterwards.

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });
}

export default async function setup(project: TestProject) {
  const databaseDir = mkdtempSync(join(tmpdir(), "dgc-test-db-"));
  const port = await freePort();
  const server = new EmbeddedPostgres({
    databaseDir,
    port,
    user: "postgres",
    password: "postgres",
    persistent: false,
    // UTF-8 like Supabase. Without this, Windows picks WIN1252 and any
    // emoji (say, in a client word) is refused.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
  });

  await server.initialise();
  await server.start();
  await server.createDatabase("dgc_test");

  const databaseUrl = `postgres://postgres:postgres@127.0.0.1:${port}/dgc_test`;
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      readFileSync(join(process.cwd(), "tests/db/supabase-stub.sql"), "utf8"),
    );
    const migrations = join(process.cwd(), "supabase/migrations");
    for (const file of readdirSync(migrations).sort()) {
      if (file.endsWith(".sql")) {
        await client.query(readFileSync(join(migrations, file), "utf8"));
      }
    }
  } finally {
    await client.end();
  }

  project.provide("databaseUrl", databaseUrl);

  return async () => {
    await server.stop();
    rmSync(databaseDir, { recursive: true, force: true });
  };
}
