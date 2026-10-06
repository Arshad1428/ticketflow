import "dotenv/config";
import pg from "pg";
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const q = (text, params = []) => pool.query(text, params);
export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
