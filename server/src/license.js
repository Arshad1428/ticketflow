import { verify, createPublicKey } from "node:crypto";
export function validateLicense(env = process.env) {
  if (!env.LICENSE_PUBLIC_KEY) {
    if (env.LICENSE_REQUIRED === "true")
      throw Error("License public key is required");
    return { mode: "development", maxUsers: 1000, modules: ["knowledgeBase"] };
  }
  if (!env.LICENSE_KEY) throw Error("License key required");
  const parts = env.LICENSE_KEY.split(".");
  if (parts.length !== 2) throw Error("Invalid licence");
  const [body, signature] = parts;
  if (
    !body ||
    !signature ||
    !verify(
      null,
      Buffer.from(body),
      createPublicKey(env.LICENSE_PUBLIC_KEY.replaceAll("\\n", "\n")),
      Buffer.from(signature, "base64url"),
    )
  )
    throw Error("Invalid licence signature");
  const claims = JSON.parse(Buffer.from(body, "base64url").toString());
  if (
    claims.installation !== env.INSTALLATION_ID ||
    !Number.isFinite(new Date(claims.expires).getTime()) ||
    new Date(claims.expires) <= new Date() ||
    !Number.isInteger(claims.maxUsers) ||
    claims.maxUsers < 1 ||
    !Array.isArray(claims.modules)
  )
    throw Error("Expired or mismatched licence");
  return { mode: "licensed", ...claims };
}
