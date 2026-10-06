import { generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs";
if (process.argv[2] === "keygen") {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  fs.writeFileSync(
    "licence-private.pem",
    privateKey.export({ type: "pkcs8", format: "pem" }),
    { mode: 0o600 },
  );
  fs.writeFileSync(
    "licence-public.pem",
    publicKey.export({ type: "spki", format: "pem" }),
  );
  console.log(
    "Created issuer keys. Keep private key outside customer installations.",
  );
} else if (process.argv[2] === "issue") {
  const [installation, expires, maxUsers] = process.argv.slice(3);
  if (!installation || !expires || !maxUsers)
    throw Error(
      "Usage: node scripts/license.mjs issue INSTALLATION YYYY-MM-DD MAX_USERS",
    );
  const body = Buffer.from(
    JSON.stringify({
      installation,
      expires,
      maxUsers: Number(maxUsers),
      modules: ["knowledgeBase"],
    }),
  ).toString("base64url");
  console.log(
    body +
      "." +
      sign(
        null,
        Buffer.from(body),
        fs.readFileSync("licence-private.pem"),
      ).toString("base64url"),
  );
} else
  console.log(
    "Usage: node scripts/license.mjs keygen | issue INSTALLATION YYYY-MM-DD MAX_USERS",
  );
