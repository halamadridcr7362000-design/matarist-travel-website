// CRUD for the "sign up for updates" client list.
// Public POST (action "subscribe") lets any site visitor register — no
// session required, same trust model as handleOwnerSubmit in
// accommodation-listings.js: the handler builds the stored record
// field-by-field from an allow-list, so a public caller can never set
// anything beyond these specific fields.
// Reading/deleting subscribers always requires a valid admin session.
const crypto = require("crypto");
const { requireSession } = require("./_lib/accommodation-security");
const { getAllSubscribers, saveAllSubscribers } = require("./_lib/accommodation-store");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonHeaders() {
  return { ...headers, "Content-Type": "application/json" };
}

const MAX_LEN = { name: 80, whatsapp: 30, district: 80, genderPolicy: 20, roomType: 20 };
const ALLOWED_GENDER = ["", "girls", "boys", "mixed"];
const ALLOWED_ROOM_TYPES = ["", "single", "double", "shared", "apartment"];

// Keeps only digits/leading "+" — good enough to build a wa.me link later
// without storing whatever stray punctuation a visitor types.
function normalizeWhatsapp(raw) {
  const trimmed = String(raw || "").trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  return plus + trimmed.replace(/[^\d]/g, "");
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    if (event.httpMethod === "GET") return await handleGet(event);
    if (event.httpMethod === "POST") return await handlePost(event);
    return { statusCode: 405, headers: jsonHeaders(), body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (err) {
    return { statusCode: 500, headers: jsonHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};

async function handleGet(event) {
  const session = requireSession(event);
  if (!session) {
    return { statusCode: 401, headers: jsonHeaders(), body: JSON.stringify({ error: "Unauthorized" }) };
  }
  const subscribers = await getAllSubscribers();
  return { statusCode: 200, headers: jsonHeaders(), body: JSON.stringify({ subscribers }) };
}

async function handlePost(event) {
  const body = JSON.parse(event.body || "{}");

  if (body.action === "subscribe") return handleSubscribe(body);

  const session = requireSession(event);
  if (!session) {
    return { statusCode: 401, headers: jsonHeaders(), body: JSON.stringify({ error: "Unauthorized" }) };
  }

  if (body.action === "delete") {
    const subscribers = await getAllSubscribers();
    const next = subscribers.filter((s) => s.id !== body.id);
    await saveAllSubscribers(next);
    return { statusCode: 200, headers: jsonHeaders(), body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: "Unknown action" }) };
}

// Public, unauthenticated: any site visitor signing up for updates.
async function handleSubscribe(body) {
  // Honeypot: a hidden field real visitors never fill in — same pattern as
  // the owner-submission honeypot in accommodation-listings.js.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return { statusCode: 200, headers: jsonHeaders(), body: JSON.stringify({ ok: true }) };
  }

  const whatsapp = normalizeWhatsapp(body.whatsapp);
  if (whatsapp.replace(/[^\d]/g, "").length < 8) {
    return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: "A valid WhatsApp number is required" }) };
  }
  for (const [field, max] of Object.entries(MAX_LEN)) {
    if (typeof body[field] === "string" && body[field].length > max) {
      return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: `${field} is too long` }) };
    }
  }

  const name = String(body.name || "").trim();
  const district = String(body.district || "").trim();
  const genderPolicy = ALLOWED_GENDER.includes(body.genderPolicy) ? body.genderPolicy : "";
  const roomType = ALLOWED_ROOM_TYPES.includes(body.roomType) ? body.roomType : "";
  const maxPrice = body.maxPrice !== undefined && body.maxPrice !== null && body.maxPrice !== ""
    ? Math.max(0, Math.min(1000000, parseFloat(body.maxPrice) || 0))
    : null;

  const subscribers = await getAllSubscribers();

  // Same person re-subscribing (e.g. updating their preferences) updates
  // their existing record instead of creating a duplicate — matched on the
  // normalized WhatsApp number, which is the one stable identifier here.
  const existingIdx = subscribers.findIndex((s) => s.whatsapp === whatsapp);
  const now = Date.now();
  const record = {
    id: existingIdx !== -1 ? subscribers[existingIdx].id : crypto.randomUUID(),
    name,
    whatsapp,
    district,
    genderPolicy,
    roomType,
    maxPrice,
    createdAt: existingIdx !== -1 ? subscribers[existingIdx].createdAt : now,
    updatedAt: now,
  };

  if (existingIdx !== -1) subscribers[existingIdx] = record;
  else subscribers.push(record);

  await saveAllSubscribers(subscribers);
  return { statusCode: 200, headers: jsonHeaders(), body: JSON.stringify({ ok: true }) };
}
