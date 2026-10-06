import test from "node:test";
import assert from "node:assert/strict";
import { businessMinutes, effectiveElapsed, slaState } from "../src/sla.js";
import { validateLicense } from "../src/license.js";
import { generateKeyPairSync, sign } from "node:crypto";
const c = {
  timezone: "Asia/Kolkata",
  days: [1, 2, 3, 4, 5],
  start: "09:00",
  end: "18:00",
  holidays: [],
};
test("business hours excludes nights and weekends", () => {
  assert.equal(
    businessMinutes(
      "2026-10-02T17:00:00+05:30",
      "2026-10-05T10:00:00+05:30",
      c,
    ),
    120,
  );
});
test("holidays excluded", () =>
  assert.equal(
    businessMinutes("2026-10-02T17:00:00+05:30", "2026-10-05T10:00:00+05:30", {
      ...c,
      holidays: ["2026-10-05"],
    }),
    60,
  ));
test("partial minutes and before opening", () =>
  assert.equal(
    businessMinutes(
      "2026-10-06T08:00:00+05:30",
      "2026-10-06T09:01:30+05:30",
      c,
    ),
    1.5,
  ));
test("DST uses local business calendar", () =>
  assert.equal(
    businessMinutes("2026-03-06T17:00:00-05:00", "2026-03-09T10:00:00-04:00", {
      ...c,
      timezone: "America/New_York",
    }),
    120,
  ));
test("waiting on client pauses timers", () =>
  assert.equal(
    effectiveElapsed(
      {
        status: "Waiting on Client",
        elapsed_minutes: 17,
        last_tick: "2026-10-05",
        calendar: c,
      },
      new Date("2026-10-06"),
    ),
    17,
  ));
test("response met leaves resolution target active", () =>
  assert.equal(
    slaState(
      {
        status: "In Progress",
        responded_at: "2026-10-06",
        resolution_minutes: 100,
        response_minutes: 10,
        elapsed_minutes: 80,
        last_tick: "2026-10-06T00:00Z",
        calendar: c,
      },
      new Date("2026-10-06T00:00Z"),
    ).state,
    "at-risk",
  ));
test("signed licence rejects tampering and wrong installation", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const body = Buffer.from(
    JSON.stringify({
      installation: "demo",
      expires: "2099-01-01",
      maxUsers: 10,
      modules: [],
    }),
  ).toString("base64url");
  const env = {
    LICENSE_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }),
    LICENSE_KEY:
      body +
      "." +
      sign(null, Buffer.from(body), privateKey).toString("base64url"),
    INSTALLATION_ID: "demo",
  };
  assert.equal(validateLicense(env).maxUsers, 10);
  assert.throws(() => validateLicense({ ...env, INSTALLATION_ID: "other" }));
  assert.throws(() =>
    validateLicense({ ...env, LICENSE_KEY: env.LICENSE_KEY + "a" }),
  );
});

test("TOTP RFC vector and encrypted secret round trip", async () => {
  process.env.JWT_SECRET = "test-secret-for-encryption-is-long-enough";
  const { code, secret, valid, encrypt, decrypt } =
    await import("../src/mfa.js");
  assert.equal(code("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59000), "287082");
  const s = secret();
  assert.equal(decrypt(encrypt(s)), s);
  assert.ok(valid(s, code(s)));
  assert.equal(valid(s, "123"), false);
});
