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

async function handlePost(event) {
  const session = requireSession(event);
  if (!session) {
    return { statusCode: 401, headers: jsonHeaders(), body: JSON.stringify({ error: "Unauthorized" }) };
  }

  const body = JSON.parse(event.body || "{}");
  const action = body.action;
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
    const allowed = ["draft", "published", "rented", "unpublished", "deleted"];
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
