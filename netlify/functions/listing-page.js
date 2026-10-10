// Server-rendered individual listing page.
// Returns a complete HTML document (real title/meta description/canonical/
// OG tags + visible content) so search engines see real content on the
// first response, not a JS-filled shell. Routed here via netlify.toml for
// /accommodation/:slug — works identically for a direct visit, a shared
// link, or a page refresh, since the redirect applies at every request.
const { getAllListings, toPublicListing, isPubliclyVisible } = require("./_lib/accommodation-store");
const { verifyToken } = require("./_lib/accommodation-security");

const SITE = "https://mataristtravel.com";
const WHATSAPP = "905451218167";

const LABELS = {
  en: { back: "All accommodation listings", rented: "Rented — currently unavailable", contact: "Ask about this room on WhatsApp", district: "District", type: "Room type", rent: "Monthly rent", deposit: "Deposit", bills: "Bills", furnishing: "Furnishing", gender: "Preference", transport: "Nearby transport", rules: "Rules", notFound: "This listing is no longer available.", gone: "This listing has been removed." },
  ar: { back: "كل السكنات المتاحة", rented: "مؤجرة حالياً — غير متاحة", contact: "اسأل عن هذه الغرفة عبر واتساب", district: "المنطقة", type: "نوع الغرفة", rent: "الإيجار الشهري", deposit: "التأمين", bills: "الفواتير", furnishing: "التأثيث", gender: "التفضيل", transport: "وسائل النقل القريبة", rules: "الشروط", notFound: "هذا السكن غير متاح حالياً.", gone: "تم حذف هذا السكن." },
  tr: { back: "Tüm konaklama ilanları", rented: "Kiralandı — şu anda uygun değil", contact: "Bu oda hakkında WhatsApp'tan sorun", district: "Semt", type: "Oda tipi", rent: "Aylık kira", deposit: "Depozito", bills: "Faturalar", furnishing: "Eşya durumu", gender: "Tercih", transport: "Yakın ulaşım", rules: "Kurallar", notFound: "Bu ilan artık mevcut değil.", gone: "Bu ilan kaldırıldı." },
};

const ROOM_TYPE_LABEL = { single: "Single room", double: "Double room", shared: "Shared room", apartment: "Entire apartment" };

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function page404(lang, msg) {
  const t = LABELS[lang] || LABELS.en;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>404 — MATARIST Accommodation</title><meta name="robots" content="noindex"></head>
  <body style="font-family:sans-serif;text-align:center;padding:80px 20px;background:#0d1117;color:#e6edf3">
  <h1>404</h1><p>${escapeHtml(msg || t.notFound)}</p><a href="/accommodation/" style="color:#c9a84c">${t.back}</a>
  </body></html>`;
}

function page410(lang) {
  const t = LABELS[lang] || LABELS.en;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>410 — MATARIST Accommodation</title><meta name="robots" content="noindex"></head>
  <body style="font-family:sans-serif;text-align:center;padding:80px 20px;background:#0d1117;color:#e6edf3">
  <h1>410</h1><p>${t.gone}</p><a href="/accommodation/" style="color:#c9a84c">${t.back}</a>
  </body></html>`;
}

function renderListing(listing, lang, isPreview) {
  const t = LABELS[lang] || LABELS.en;
  const pub = toPublicListing(listing);
  const title = `${escapeHtml(pub.title)} — ${escapeHtml(pub.district)} | MATARIST Accommodation`;
  const descSource = pub.description || `${ROOM_TYPE_LABEL[pub.roomType] || pub.roomType} in ${pub.district}, Istanbul.`;
  const description = escapeHtml(String(descSource).slice(0, 160));
  const canonical = `${SITE}/accommodation/${pub.slug}`;
  const firstPhoto = pub.photos && pub.photos[0] ? `${SITE}/.netlify/functions/accommodation-listings?photo=${encodeURIComponent(pub.photos[0])}` : "";
  const rentedBadge = pub.status === "rented" ? `<div style="background:#da3633;color:#fff;padding:8px 16px;border-radius:6px;display:inline-block;margin-bottom:16px;font-weight:700">${t.rented}</div>` : "";
  const photosHtml = (pub.photos || [])
    .map((k) => `<img src="/.netlify/functions/accommodation-listings?photo=${encodeURIComponent(k)}" loading="lazy" style="width:100%;border-radius:8px;margin-bottom:10px" alt="${escapeHtml(pub.title)}">`)
    .join("");
  const mapHtml = typeof pub.lat === "number" && typeof pub.lng === "number"
    ? `<div id="map" style="height:280px;border-radius:8px;margin:16px 0"></div>
       <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
       <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
       <script>var m=L.map('map').setView([${pub.lat},${pub.lng}],14);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap contributors'}).addTo(m);L.marker([${pub.lat},${pub.lng}]).addTo(m);</script>`
    : "";
  const waText = encodeURIComponent(`Hi, I'm interested in: ${pub.title} (${pub.district}) — ${canonical}`);

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonical}">
${firstPhoto ? `<meta property="og:image" content="${firstPhoto}">` : ""}
${isPreview ? `<meta name="robots" content="noindex, nofollow">` : ""}
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
body{font-family:'DM Sans',sans-serif;background:#0f1d3d;color:#fff;margin:0;padding:0}
.wrap{max-width:720px;margin:0 auto;padding:24px 20px 60px}
a.back{color:#c9a84c;text-decoration:none;font-size:0.9rem}
h1{font-size:1.6rem;margin:14px 0 4px}
.meta{color:rgba(255,255,255,0.65);margin-bottom:18px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:20px 0;background:rgba(255,255,255,0.05);border-radius:8px;padding:16px}
.grid div label{display:block;font-size:0.72rem;color:rgba(255,255,255,0.5)}
.grid div span{font-weight:700}
.section{margin:18px 0}
.section h3{font-size:0.95rem;color:#c9a84c;margin-bottom:6px}
.wa-btn{display:inline-flex;align-items:center;gap:8px;background:#25D366;color:#fff;padding:14px 26px;border-radius:6px;text-decoration:none;font-weight:700;margin-top:10px}
</style>
</head>
<body>
<div class="wrap">
<a class="back" href="/accommodation/">&larr; ${t.back}</a>
${isPreview ? `<div style="background:#1f6feb;color:#fff;padding:8px 16px;border-radius:6px;display:inline-block;margin-bottom:16px;font-weight:700">PREVIEW — status: ${escapeHtml(listing.status)}, not publicly visible</div>` : ""}
${rentedBadge}
<h1>${escapeHtml(pub.title)}</h1>
<div class="meta">${escapeHtml(pub.district)} · ${escapeHtml(ROOM_TYPE_LABEL[pub.roomType] || pub.roomType)}</div>
${photosHtml}
<div class="grid">
<div><label>${t.rent}</label><span>${pub.monthlyRent} ${escapeHtml(pub.currency)}</span></div>
<div><label>${t.deposit}</label><span>${escapeHtml(pub.deposit) || "—"}</span></div>
<div><label>${t.bills}</label><span>${escapeHtml(pub.bills) || "—"}</span></div>
<div><label>${t.furnishing}</label><span>${escapeHtml(pub.furnishing) || "—"}</span></div>
<div><label>${t.gender}</label><span>${escapeHtml(pub.genderPolicy) || "—"}</span></div>
<div><label>${t.transport}</label><span>${escapeHtml(pub.transport) || "—"}</span></div>
</div>
${pub.description ? `<div class="section"><p>${escapeHtml(pub.description)}</p></div>` : ""}
${pub.rules ? `<div class="section"><h3>${t.rules}</h3><p>${escapeHtml(pub.rules)}</p></div>` : ""}
${mapHtml}
<a class="wa-btn" href="https://wa.me/${WHATSAPP}?text=${waText}" target="_blank" rel="noopener">
<i class="fa-brands fa-whatsapp"></i> ${t.contact}
</a>
</div>
</body>
</html>`;
}

exports.handler = async function (event) {
  const qs = event.queryStringParameters || {};
  const lang = ["ar", "en", "tr"].includes(qs.lang) ? qs.lang : "en";

  // Netlify's netlify.toml placeholder substitution in a redirect's `to`
  // query string (to = ".../listing-page?slug=:slug") was confirmed live
  // to NOT reach the function — event.queryStringParameters never contained
  // `slug` when requested through the /accommodation/:slug redirect, even
  // though `force = true` was set. event.path DOES correctly reflect the
  // original request path through that same redirect, so the slug is
  // derived from there instead, with qs.slug kept as a fallback for direct
  // function calls (e.g. from admin-listings.html's own fetches).
  const pathSlug = decodeURIComponent((event.path || "").replace(/^\/accommodation\/?/, ""));
  const slug = qs.slug || pathSlug;

  // Every response here explicitly opts out of caching — "changes reflected
  // correctly" when publishing/unpublishing/renting a listing is a hard
  // requirement and nothing here is expensive enough to need edge caching.
  const NO_STORE = { "Cache-Control": "no-store" };

  if (!slug) {
    return { statusCode: 404, headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE }, body: page404(lang) };
  }

  const listings = await getAllListings();
  const listing = listings.find((l) => l.slug === slug);

  if (!listing) {
    return { statusCode: 404, headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE }, body: page404(lang) };
  }

  if (listing.status === "deleted") {
    return { statusCode: 410, headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE }, body: page410(lang) };
  }

  if (listing.status === "draft" || listing.status === "unpublished") {
    const secret = process.env.ACCOMMODATION_SESSION_SECRET;
    const previewPayload = secret ? verifyToken(qs.preview, secret) : null;
    const validPreview = previewPayload && previewPayload.listingId === listing.id;
    if (!validPreview) {
      return { statusCode: 404, headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE }, body: page404(lang) };
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE },
      body: renderListing(listing, lang, true),
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE },
    body: renderListing(listing, lang),
  };
};
