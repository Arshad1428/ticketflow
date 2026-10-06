import { pool, tx } from "./db.js";
import fs from "node:fs/promises";
export async function migrate() {
  await tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(882021)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
    );
    for (const name of (
      await fs.readdir(new URL("../migrations/", import.meta.url))
    ).sort()) {
      if (
        !(await c.query("SELECT 1 FROM migrations WHERE name=$1", [name]))
          .rowCount
      ) {
        await c.query(
          await fs.readFile(
            new URL("../migrations/" + name, import.meta.url),
            "utf8",
          ),
        );
        await c.query("INSERT INTO migrations(name) VALUES($1)", [name]);
        console.log("Applied", name);
      }
    }
  });
}
await migrate();
await pool.end();
