// CRUD for accommodation listing content + photos.
// Public GET returns only published/rented listings with an allow-listed
// field set (never owner contact info or anything financial).
// Every write requires a valid signed session token (server-side check),
// never a client-side password check.
const crypto = require("crypto");
const { requireSession, sign, verifyToken } = require("./_lib/accommodation-security");
const {
  getAllListings,
  saveAllListings,
  toPublicListing,
  isPubliclyVisible,
} = require("./_lib/accommodation-store");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonHeaders() {
  return { ...headers, "Content-Type": "application/json" };
}

const TURKISH_FOLD = { ı: "i", İ: "i", ş: "s", Ş: "s", ğ: "g", Ğ: "g", ü: "u", Ü: "u", ö: "o", Ö: "o", ç: "c", Ç: "c" };

function slugify(text) {
  const folded = String(text || "")
    .split("")
    .map((ch) => TURKISH_FOLD[ch] || ch)
    .join("");
  return (
    folded
      .toLowerCase()
      .trim()
      .replace(/[^\u0000-\u007f]/g, "") // drop remaining non-ASCII (e.g. Arabic script) — keeps URLs stable
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "listing"
  );
}

function uniqueSlug(base, existingSlugs) {
  let slug = base;
  let n = 2;
  while (existingSlugs.includes(slug)) {
    slug = `${base}-${n}`;
    n++;
  }
  return slug;
}

// Exported for testing; Netlify Functions only ever invoke exports.handler,
// so these extra exports have no effect in production.
exports.slugify = slugify;
exports.uniqueSlug = uniqueSlug;

function extractLatLng(str) {
  let m = str.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  m = str.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  m = str.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  return null;
}

const ALLOWED_MAPS_HOSTS = ["maps.app.goo.gl", "goo.gl", "maps.google.com", "www.google.com", "google.com"];

// Resolves a Google Maps link to {lat, lng} by following redirects
// server-side (never executes JS, so it only finds coordinates that ride
// along in the URL itself — see the comment on the resolveMapLink action
// above for what this does and doesn't cover).
async function resolveGoogleMapsLink(inputUrl) {
  let parsed;
  try {
    parsed = new URL(inputUrl);
  } catch (e) {
    return null;
  }
  if (!ALLOWED_MAPS_HOSTS.some((h) => parsed.hostname === h || parsed.hostname.endsWith("." + h))) {
    return null;
  }

  const direct = extractLatLng(decodeURIComponent(inputUrl));
  if (direct) return direct;

  let current = inputUrl;
  for (let hop = 0; hop < 4; hop++) {
    let res;
    try {
      res = await fetch(current, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0" } });
    } catch (e) {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      const found = extractLatLng(decodeURIComponent(loc));
      if (found) return found;
      current = loc;
      continue;
    }
    break;
  }
  return null;
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    if (event.httpMethod === "GET") {
      return await handleGet(event);
    }
    if (event.httpMethod === "POST") {
      return await handlePost(event);
    }
    return { statusCode: 405, headers: jsonHeaders(), body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (err) {
    return { statusCode: 500, headers: jsonHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};

async function handleGet(event) {
  const qs = event.queryStringParameters || {};

  // Serve a stored photo's raw bytes.
  if (qs.photo) {
    return servePhoto(event, qs.photo);
  }

  const session = requireSession(event);

  // Lets admin-listings.html auto-fill the map pin from a pasted Google
  // Maps link instead of clicking the map by hand. Only handles the common
  // case where the coordinates ride along on an HTTP redirect (confirmed
  // live: most maps.app.goo.gl links 302 straight to a URL containing
  // !3d<lat>!4d<lng> or @<lat>,<lng>). Some short links only resolve to a
  // place ID with no coordinates anywhere in the redirect chain — those
  // need the Places API (a paid, separately-configured dependency) to
  // resolve, so this intentionally reports "not resolved" for them rather
  // than guessing; the admin still places the pin by hand in that case.
  if (qs.action === "resolveMapLink") {
    if (!session) {
      return { statusCode: 401, headers: jsonHeaders(), body: JSON.stringify({ error: "Unauthorized" }) };
    }
    if (!qs.url) {
      return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: "Missing url" }) };
    }
    const coords = await resolveGoogleMapsLink(qs.url);
    return { statusCode: 200, headers: jsonHeaders(), body: JSON.stringify(coords ? { resolved: true, ...coords } : { resolved: false }) };
  }

  const listings = await getAllListings();

  // Lets admin-listings.html open a "Preview" tab for a draft/unpublished
  // listing. window.open() can't carry an Authorization header, so this
  // mints a short-lived signed token instead, scoped to one listing.
  if (qs.action === "previewToken") {
    if (!session) {
      return { statusCode: 401, headers: jsonHeaders(), body: JSON.stringify({ error: "Unauthorized" }) };
    }
    const listing = listings.find((l) => l.id === qs.id);
    if (!listing) {
      return { statusCode: 404, headers: jsonHeaders(), body: JSON.stringify({ error: "Listing not found" }) };
    }
    const secret = process.env.ACCOMMODATION_SESSION_SECRET;
    const token = sign({ listingId: listing.id, exp: Date.now() + 10 * 60 * 1000 }, secret);
    return { statusCode: 200, headers: jsonHeaders(), body: JSON.stringify({ token, slug: listing.slug }) };
  }

  if (qs.admin) {
    if (!session) {
      return { statusCode: 401, headers: jsonHeaders(), body: JSON.stringify({ error: "Unauthorized" }) };
    }
    return { statusCode: 200, headers: jsonHeaders(), body: JSON.stringify({ listings }) };
  }

  const pub = listings.filter(isPubliclyVisible).map(toPublicListing);
  return { statusCode: 200, headers: jsonHeaders(), body: JSON.stringify({ listings: pub }) };
}

async function servePhoto(event, key) {
  const listings = await getAllListings();
  const owner = listings.find((l) => (l.photos || []).includes(key));
  const session = requireSession(event);

  // A plain <img> tag can't carry an Authorization header, so the admin's
  // draft preview page (listing-page.js, isPreview mode) passes the same
  // scoped preview token it was opened with on each photo's own URL too.
  // Verified the same way as the page-level preview: signed, short-lived,
  // and scoped to this specific listing's id — not a general bypass.
  const qs = event.queryStringParameters || {};
  const secret = process.env.ACCOMMODATION_SESSION_SECRET;
  const previewPayload = owner && secret ? verifyToken(qs.preview, secret) : null;
  const validPreview = previewPayload && previewPayload.listingId === (owner && owner.id);

  if (!owner || (!isPubliclyVisible(owner) && !session && !validPreview)) {
    return { statusCode: 404, headers, body: "Not found" };
  }

  const { listingsStore } = require("./_lib/accommodation-store");
  const res = await listingsStore().getWithMetadata(key, { type: "arrayBuffer" });
  if (!res) {
    return { statusCode: 404, headers, body: "Not found" };
  }

  return {
    statusCode: 200,
    headers: {
      ...headers,
      "Content-Type": (res.metadata && res.metadata.contentType) || "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    },
    body: Buffer.from(res.data).toString("base64"),
    isBase64Encoded: true,
  };
}

// Per-field length caps for an anonymous owner submission. handleOwnerSubmit
// below builds the stored record field-by-field (its own allow-list) rather
// than copying body keys — a public caller never gets to set status, slug,
// id, or anything not explicitly read out there, no matter what else is in
// the request body.
const OWNER_SUBMIT_MAX_LEN = { title: 120, district: 80, description: 2000, rules: 1000, ownerContact: 120, deposit: 80, bills: 120, furnishing: 80, genderPolicy: 40, transport: 160 };
const ALLOWED_ROOM_TYPES = ["single", "double", "shared", "apartment"];
const ALLOWED_CURRENCIES = ["TRY", "USD", "EUR"];
const OWNER_SUBMIT_MAX_PHOTOS = 8;
const OWNER_SUBMIT_MAX_PHOTO_BYTES = 2 * 1024 * 1024; // base64-decoded size

async function handlePost(event) {
  const body = JSON.parse(event.body || "{}");
  const action = body.action;

  // These two run WITHOUT a session — they're how a property owner submits
  // their own listing from the public site. Everything else below still
  // requires an admin session, same as before.
  if (action === "submit") return handleOwnerSubmit(body);
  if (action === "submitPhoto") return handleOwnerSubmitPhoto(body);

  const session = requireSession(event);
  if (!session) {
    return { statusCode: 401, headers: jsonHeaders(), body: JSON.stringify({ error: "Unauthorized" }) };
  }

  const listings = await getAllListings();

  if (action === "create") {
    const base = slugify(`${body.title || ""}-${body.district || ""}`);
    const slug = uniqueSlug(base, listings.map((l) => l.slug));
    const now = Date.now();
    const listing = {
      id: crypto.randomUUID(),
      slug,
      status: "draft",
      title: body.title || "",
      district: body.district || "",
      roomType: body.roomType || "single",
      monthlyRent: parseFloat(body.monthlyRent) || 0,
      currency: body.currency || "TRY",
      deposit: body.deposit || "",
      bills: body.bills || "",
      furnishing: body.furnishing || "",
      genderPolicy: body.genderPolicy || "",
      transport: body.transport || "",
      rules: body.rules || "",
      description: body.description || "",
      photos: [],
      videoUrls: Array.isArray(body.videoUrls) ? body.videoUrls.filter((u) => typeof u === "string" && u.trim()) : [],
      lat: typeof body.lat === "number" ? body.lat : null,
      lng: typeof body.lng === "number" ? body.lng : null,
      ownerContact: body.ownerContact || "",
      createdAt: now,
      updatedAt: now,
    };
    listings.push(listing);
    await saveAllListings(listings);
    return { statusCode: 200, headers: jsonHeaders(), body: JSON.stringify({ listing }) };
  }

  // All other actions operate on an existing listing.
  const idx = listings.findIndex((l) => l.id === body.id);
  if (idx === -1) {
    return { statusCode: 404, headers: jsonHeaders(), body: JSON.stringify({ error: "Listing not found" }) };
  }

  if (action === "update") {
    const editable = [
      "title", "district", "roomType", "monthlyRent", "currency", "deposit",
      "bills", "furnishing", "genderPolicy", "transport", "rules",
      "description", "videoUrls", "lat", "lng", "ownerContact",
    ];
    for (const f of editable) {
      if (body[f] === undefined) continue;
      listings[idx][f] = f === "videoUrls" && Array.isArray(body[f])
        ? body[f].filter((u) => typeof u === "string" && u.trim())
        : body[f];
    }
    listings[idx].updatedAt = Date.now();
    await saveAllListings(listings);
    return { statusCode: 200, headers: jsonHeaders(), body: JSON.stringify({ listing: listings[idx] }) };
  }

  if (action === "setStatus") {
    const allowed = ["draft", "pending", "published", "rented", "unpublished", "rejected", "deleted"];
    if (!allowed.includes(body.status)) {
      return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: "Invalid status" }) };
    }
    // Soft-delete only: keep the record (and its slug) so deleted listings
    // can correctly return 410 Gone instead of an indistinguishable 404.
    listings[idx].status = body.status;
    listings[idx].updatedAt = Date.now();
    await saveAllListings(listings);
    return { statusCode: 200, headers: jsonHeaders(), body: JSON.stringify({ listing: listings[idx] }) };
  }

  if (action === "uploadPhoto") {
    const key = `photo:${crypto.randomUUID()}`;
    const buffer = Buffer.from(body.imageBase64, "base64");
    const { listingsStore } = require("./_lib/accommodation-store");
    await listingsStore().set(key, buffer, { metadata: { contentType: body.contentType || "image/jpeg" } });
    listings[idx].photos = [...(listings[idx].photos || []), key];
    listings[idx].updatedAt = Date.now();
    await saveAllListings(listings);
    return { statusCode: 200, headers: jsonHeaders(), body: JSON.stringify({ key, listing: listings[idx] }) };
  }

  if (action === "reorderPhotos") {
    const current = listings[idx].photos || [];
    const next = Array.isArray(body.photos) ? body.photos : current;
    // Only accept a reorder of the same set — never let this silently drop/add keys.
    const sameSet = current.length === next.length && current.every((k) => next.includes(k));
    if (!sameSet) {
      return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: "Photo set mismatch" }) };
    }
    listings[idx].photos = next;
    listings[idx].updatedAt = Date.now();
    await saveAllListings(listings);
    return { statusCode: 200, headers: jsonHeaders(), body: JSON.stringify({ listing: listings[idx] }) };
  }

  if (action === "removePhoto") {
    listings[idx].photos = (listings[idx].photos || []).filter((k) => k !== body.photoKey);
    listings[idx].updatedAt = Date.now();
    await saveAllListings(listings);
    const { listingsStore } = require("./_lib/accommodation-store");
    try {
      await listingsStore().delete(body.photoKey);
    } catch (e) {
      /* best-effort cleanup */
    }
    return { statusCode: 200, headers: jsonHeaders(), body: JSON.stringify({ listing: listings[idx] }) };
  }

  return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: "Unknown action" }) };
}

// Public, unauthenticated: a property owner submitting their own place.
// Always lands as status "pending" — never visible on the public site
// (isPubliclyVisible only allows "published"/"rented") and never editable
// or deletable by the submitter again, only by an admin session. This is
// the entire trust boundary: anyone can call this, so it must be unable to
// do anything beyond create one inert, invisible, hand-picked-fields record.
async function handleOwnerSubmit(body) {
  // Honeypot: a hidden field real visitors never fill in. A bot that fills
  // every input it finds trips this, and we quietly pretend success so it
  // doesn't learn to look for a different signal.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return { statusCode: 200, headers: jsonHeaders(), body: JSON.stringify({ ok: true }) };
  }

  const title = String(body.title || "").trim();
  const district = String(body.district || "").trim();
  const ownerContact = String(body.ownerContact || "").trim();
  if (!title || !district || !ownerContact) {
    return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: "Title, district and a contact number are required" }) };
  }
  for (const [field, max] of Object.entries(OWNER_SUBMIT_MAX_LEN)) {
    if (typeof body[field] === "string" && body[field].length > max) {
      return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: `${field} is too long (max ${max} characters)` }) };
    }
  }
  const roomType = ALLOWED_ROOM_TYPES.includes(body.roomType) ? body.roomType : "single";
  const currency = ALLOWED_CURRENCIES.includes(body.currency) ? body.currency : "TRY";
  const monthlyRent = Math.max(0, Math.min(1000000, parseFloat(body.monthlyRent) || 0));
  const lat = typeof body.lat === "number" && body.lat >= -90 && body.lat <= 90 ? body.lat : null;
  const lng = typeof body.lng === "number" && body.lng >= -180 && body.lng <= 180 ? body.lng : null;

  const listings = await getAllListings();
  const base = slugify(`${title}-${district}`);
  const slug = uniqueSlug(base, listings.map((l) => l.slug));
  const now = Date.now();
  const listing = {
    id: crypto.randomUUID(),
    slug,
    status: "pending",
    title,
    district,
    roomType,
    monthlyRent,
    currency,
    deposit: String(body.deposit || "").trim(),
    bills: String(body.bills || "").trim(),
    furnishing: String(body.furnishing || "").trim(),
    genderPolicy: String(body.genderPolicy || "").trim(),
    transport: String(body.transport || "").trim(),
    rules: String(body.rules || "").trim(),
    description: String(body.description || "").trim(),
    photos: [],
    videoUrls: [],
    lat,
    lng,
    ownerContact,
    submittedByOwner: true,
    createdAt: now,
    updatedAt: now,
  };
  listings.push(listing);
  await saveAllListings(listings);

  // Scoped, short-lived token: lets this same submitter attach photos to
  // THIS listing only, for the next 30 minutes, and nothing else — it
  // can't touch any other listing or any other field.
  const secret = process.env.ACCOMMODATION_SESSION_SECRET;
  const submissionToken = secret
    ? sign({ listingId: listing.id, purpose: "ownerUpload", exp: Date.now() + 30 * 60 * 1000 }, secret)
    : null;

  return {
    statusCode: 200,
    headers: jsonHeaders(),
    body: JSON.stringify({ id: listing.id, submissionToken }),
  };
}

async function handleOwnerSubmitPhoto(body) {
  const secret = process.env.ACCOMMODATION_SESSION_SECRET;
  const payload = secret ? verifyToken(body.submissionToken, secret) : null;
  if (!payload || payload.purpose !== "ownerUpload" || payload.listingId !== body.id) {
    return { statusCode: 401, headers: jsonHeaders(), body: JSON.stringify({ error: "Invalid or expired submission link" }) };
  }

  const listings = await getAllListings();
  const idx = listings.findIndex((l) => l.id === body.id);
  if (idx === -1 || listings[idx].status !== "pending") {
    // Already reviewed (or gone) — the token's one-time window has closed.
    return { statusCode: 409, headers: jsonHeaders(), body: JSON.stringify({ error: "This submission is no longer accepting photos" }) };
  }
  if ((listings[idx].photos || []).length >= OWNER_SUBMIT_MAX_PHOTOS) {
    return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: `Maximum ${OWNER_SUBMIT_MAX_PHOTOS} photos` }) };
  }

  let buffer;
  try {
    buffer = Buffer.from(body.imageBase64 || "", "base64");
  } catch (e) {
    return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: "Invalid image data" }) };
  }
  if (!buffer.length || buffer.length > OWNER_SUBMIT_MAX_PHOTO_BYTES) {
    return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: "Image too large" }) };
  }

  const key = `photo:${crypto.randomUUID()}`;
  const { listingsStore } = require("./_lib/accommodation-store");
  await listingsStore().set(key, buffer, { metadata: { contentType: /^image\/(jpeg|png|webp)$/.test(body.contentType) ? body.contentType : "image/jpeg" } });
  listings[idx].photos = [...(listings[idx].photos || []), key];
  listings[idx].updatedAt = Date.now();
  await saveAllListings(listings);

  return { statusCode: 200, headers: jsonHeaders(), body: JSON.stringify({ ok: true, photoCount: listings[idx].photos.length }) };
}
