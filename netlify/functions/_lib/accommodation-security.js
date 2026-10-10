// Shared server-side session signing/verification for the accommodation
// admin panel. Used by accommodation-auth.js (issues tokens) and by
// accommodation-listings.js / accommodation-transactions.js (verify tokens
// before allowing any write).
const crypto = require("crypto");

function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyToken(token, secret) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
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
