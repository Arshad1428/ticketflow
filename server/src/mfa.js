import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function secret() {
  const bytes = randomBytes(20);
  let bits = 0,
    v = 0,
    out = "";
  for (const b of bytes) {
    v = (v << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(v >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}
function decode(s) {
  let bits = 0,
    v = 0;
  const bytes = [];
  for (const c of s) {
    v = (v << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bytes.push((v >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
export function code(s, time = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30000)));
  const h = createHmac("sha1", decode(s)).update(counter).digest(),
    offset = h[19] & 15;
  return ((h.readUInt32BE(offset) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}
export function valid(s, value) {
  if (!/^\d{6}$/.test(value || "")) return false;
  return [-1, 0, 1].some((n) =>
    timingSafeEqual(
      Buffer.from(code(s, Date.now() + n * 30000)),
      Buffer.from(value),
    ),
  );
}
const key = () =>
  createHash("sha256")
    .update(process.env.MFA_ENCRYPTION_KEY || process.env.JWT_SECRET)
    .digest();
export function encrypt(s) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([c.update(s, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ciphertext]).toString("base64");
}
export function decrypt(s) {
  const b = Buffer.from(s, "base64"),
    c = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  c.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([c.update(b.subarray(28)), c.final()]).toString();
}
