// Shared server-side session signing/verification for the accommodation
// admin panel. Used by accommodation-auth.js (issues tokens) and by
// accommodation-listings.js / accommodation-transactions.js (verify tokens
// before allowing any write).
const crypto = require("crypto");

// Plain base64 -> base64url (no padding). Written by hand rather than
// relying on Node's "base64url" Buffer encoding, which only exists from
// Node 15.7+ — this works on any Node version Netlify might run.
function toBase64Url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

function sign(payload, secret) {
  const body = toBase64Url(Buffer.from(JSON.stringify(payload)));
  const sig = toBase64Url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

function verifyToken(token, secret) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = toBase64Url(crypto.createHmac("sha256", secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(fromBase64Url(body).toString("utf8"));
  } catch (e) {
    return null;
  }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

// Reads the Bearer token from the request and verifies it.
// Returns the decoded payload on success, or null if missing/invalid/expired.
function requireSession(event) {
  const secret = process.env.ACCOMMODATION_SESSION_SECRET;
  if (!secret) return null;
  const h = event.headers || {};
  const authHeader = h.authorization || h.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  return verifyToken(token, secret);
}

module.exports = { sign, verifyToken, requireSession };
