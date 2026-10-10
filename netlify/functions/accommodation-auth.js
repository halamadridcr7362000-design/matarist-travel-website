// Server-side login for the accommodation admin panel.
// Checks the password against a Netlify environment variable (never shipped
// to the client) and issues a signed, time-limited session token that the
// other accommodation functions verify on every write.
const crypto = require("crypto");
const { sign } = require("./_lib/accommodation-security");

const SESSION_HOURS = 12;

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const adminPassword = process.env.ACCOMMODATION_ADMIN_PASSWORD;
  const secret = process.env.ACCOMMODATION_SESSION_SECRET;

  if (!adminPassword || !secret) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Server not configured: set ACCOMMODATION_ADMIN_PASSWORD and ACCOMMODATION_SESSION_SECRET in Netlify environment variables",
      }),
    };
  }

  try {
    const { password } = JSON.parse(event.body || "{}");
    if (typeof password !== "string" || password.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Password required" }) };
    }

    const given = Buffer.from(password);
    const expected = Buffer.from(adminPassword);
    const match = given.length === expected.length && crypto.timingSafeEqual(given, expected);

    if (!match) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Invalid password" }) };
    }

    const exp = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
    const token = sign({ exp }, secret);

    return { statusCode: 200, headers, body: JSON.stringify({ token, expiresAt: exp }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
