import "dotenv/config";
import { app } from "./app.js";
import { tick } from "./worker.js";
import { pool } from "./db.js";
import { validateLicense } from "./license.js";
validateLicense();
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
  throw Error("JWT_SECRET must contain at least 32 characters");
const server = app.listen(process.env.PORT || 4000, () =>
  console.log("TicketFlow running on port", process.env.PORT || 4000),
);
let busy = false;
const run = async () => {
  if (busy) return;
  busy = true;
  try {
    validateLicense();
    await tick();
  } catch (e) {
    console.error("Worker failed:", e.message);
  } finally {
    busy = false;
  }
};
const timer = setInterval(run, 30000);
run();
process.on("SIGTERM", () => {
  clearInterval(timer);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
});
