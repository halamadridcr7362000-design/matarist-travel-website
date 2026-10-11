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

const GENDER_BADGE = {
  en: { girls: "Women Only", boys: "Men Only" },
  ar: { girls: "للسيدات فقط", boys: "للرجال فقط" },
  tr: { girls: "Sadece Kadın", boys: "Sadece Erkek" },
};

// Pure presentation logic — derives a visual theme from the listing's
// existing genderPolicy free-text field. No new data field, no stored
// listing is changed; this only decides which CSS accent variables apply.
function genderTheme(genderPolicy) {
  const g = String(genderPolicy || "").toLowerCase();
  if (/female|girl|women|woman/.test(g)) return "girls";
  if (/\bmale\b|\bboys?\b|\bmen\b/.test(g)) return "boys";
  return "neutral";
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function errorPage(lang, code, message) {
  const t = LABELS[lang] || LABELS.en;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${code} — MATARIST Accommodation</title><meta name="robots" content="noindex">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600&family=DM+Sans:wght@400;600&display=swap" rel="stylesheet"></head>
  <body style="font-family:'DM Sans',sans-serif;text-align:center;padding:120px 20px;background:#15121b;color:#f3ede4;margin:0">
  <h1 style="font-family:'Cormorant Garamond',serif;font-size:3rem;color:#b8955e;margin-bottom:12px">${code}</h1>
  <p style="color:#a99bb0;margin-bottom:24px">${escapeHtml(message)}</p>
  <a href="/accommodation/" style="color:#b8955e;text-decoration:none;font-weight:600;border:1px solid #362c42;padding:10px 22px;border-radius:8px">${t.back}</a>
  </body></html>`;
}

function page404(lang, msg) {
  const t = LABELS[lang] || LABELS.en;
  return errorPage(lang, 404, msg || t.notFound);
}

function page410(lang) {
  const t = LABELS[lang] || LABELS.en;
  return errorPage(lang, 410, t.gone);
}

function renderListing(listing, lang, previewToken) {
  const isPreview = !!previewToken;
  const t = LABELS[lang] || LABELS.en;
  const pub = toPublicListing(listing);
  const title = `${escapeHtml(pub.title)} — ${escapeHtml(pub.district)} | MATARIST Accommodation`;
  const descSource = pub.description || `${ROOM_TYPE_LABEL[pub.roomType] || pub.roomType} in ${pub.district}, Istanbul.`;
  const description = escapeHtml(String(descSource).slice(0, 160));
  const canonical = `${SITE}/accommodation/${pub.slug}`;
  // In preview mode (a draft/unpublished listing), the photo-serving
  // endpoint requires either a session or this same scoped preview token —
  // a plain <img> can't carry an Authorization header, so the token has to
  // ride along on the image URL itself instead.
  const previewQS = isPreview ? `&preview=${encodeURIComponent(previewToken)}` : "";
  const photoUrl = (k) => `/.netlify/functions/accommodation-listings?photo=${encodeURIComponent(k)}${previewQS}`;
  const firstPhoto = pub.photos && pub.photos[0] ? `${SITE}${photoUrl(pub.photos[0])}` : "";
  const rentedBadge = pub.status === "rented" ? `<div class="status-badge status-rented">${t.rented}</div>` : "";
  const theme = genderTheme(pub.genderPolicy);
  const genderLabels = GENDER_BADGE[lang] || GENDER_BADGE.en;
  const genderBadge = theme === "girls" ? `<div class="status-badge status-gender">${genderLabels.girls}</div>` : theme === "boys" ? `<div class="status-badge status-gender">${genderLabels.boys}</div>` : "";

  const photos = pub.photos || [];
  const galleryHtml = photos.length
    ? `<div class="gallery ${photos.length === 1 ? "single" : ""}">
        <div class="gallery-main"><img src="${photoUrl(photos[0])}" loading="lazy" alt="${escapeHtml(pub.title)}"></div>
        ${photos.length > 1 ? `<div class="gallery-side">${photos.slice(1, 5).map((k) => `<img src="${photoUrl(k)}" loading="lazy" alt="${escapeHtml(pub.title)}">`).join("")}</div>` : ""}
      </div>`
    : `<div class="gallery-empty"><i class="fa-solid fa-image"></i></div>`;

  const mapHtml = typeof pub.lat === "number" && typeof pub.lng === "number"
    ? `<div class="section"><h3>${t.transport}</h3>
       <div id="map"></div>
       <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
       <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
       <script>var m=L.map('map').setView([${pub.lat},${pub.lng}],14);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap contributors'}).addTo(m);L.marker([${pub.lat},${pub.lng}]).addTo(m);</script>`
    : "";
  const waText = encodeURIComponent(`Hi, I'm interested in: ${pub.title} (${pub.district}) — ${canonical}`);

  const stat = (label, value, emphasize) => `<div class="stat${emphasize ? " price" : ""}"><label>${label}</label><span>${value || "—"}</span></div>`;

  return `<!doctype html>
<html lang="${lang}" data-gender="${theme}">
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
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=DM+Sans:wght@400;500;600;700&family=Cairo:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
<style>
:root{
  --bg:#15121b; --surface:#241c30; --surface-2:#2b2138;
  --gold:#b8955e; --gold-light:#d4b480;
  --text:#f3ede4; --text-muted:#a99bb0; --text-faint:#786a85;
  --border:#362c42; --border-soft:#2d2436;
  --accent:#b8955e; --accent-soft:rgba(184,149,94,0.14);
}
[data-gender="girls"]{ --accent:#5b2a86; --accent-soft:rgba(91,42,134,0.20); }
[data-gender="boys"]{ --accent:#5b7290; --accent-soft:rgba(91,114,144,0.18); }
*{box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--text);margin:0;padding:0;-webkit-font-smoothing:antialiased}
[dir="rtl"] body{font-family:'Cairo','DM Sans',sans-serif}
html[lang="ar"]{direction:rtl}
h1,h3{font-family:'Cormorant Garamond',serif;font-weight:600}
html[lang="ar"] h1, html[lang="ar"] h3{font-family:'Cairo',sans-serif;font-weight:700}
.topbar{background:rgba(21,18,27,0.92);border-bottom:1px solid var(--border-soft);padding:16px 5%;position:sticky;top:0;z-index:10}
a.back{color:var(--gold);text-decoration:none;font-size:0.85rem;font-weight:600}
.wrap{max-width:860px;margin:0 auto;padding:28px 5% 70px}
.badges{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.status-badge{display:inline-block;padding:6px 14px;border-radius:20px;font-size:0.72rem;font-weight:700;letter-spacing:0.04em;text-transform:uppercase}
.status-preview{background:#1f6feb;color:#fff}
.status-rented{background:#7a2e2e;color:#f3ede4}
.status-gender{background:var(--accent-soft);border:1px solid var(--accent);color:var(--text)}
h1{font-size:clamp(1.7rem,3.4vw,2.3rem);margin:0 0 6px;line-height:1.2}
.meta{color:var(--text-muted);margin-bottom:22px;font-size:0.92rem}
.meta .dot{margin:0 8px;opacity:0.5}
.gallery{display:grid;grid-template-columns:1.5fr 1fr;gap:8px;margin-bottom:28px;border-radius:16px;overflow:hidden;height:380px}
.gallery.single{grid-template-columns:1fr}
.gallery-main{height:100%}
.gallery-main img{width:100%;height:100%;object-fit:cover;display:block}
.gallery-side{display:grid;grid-template-rows:repeat(2,1fr);gap:8px;height:100%}
.gallery-side img{width:100%;height:100%;object-fit:cover;display:block}
.gallery-empty{height:260px;border-radius:16px;background:var(--surface);display:flex;align-items:center;justify-content:center;color:var(--text-faint);font-size:2rem;margin-bottom:28px}
@media(max-width:640px){.gallery{grid-template-columns:1fr;height:auto}.gallery-side{grid-template-columns:1fr 1fr;grid-template-rows:1fr;height:120px}.gallery-main img{height:220px}}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border-soft);border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:28px}
.stat{background:var(--surface);padding:16px 18px}
.stat label{display:block;font-size:0.68rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-faint);margin-bottom:4px}
.stat span{font-weight:700;color:var(--text);font-size:0.95rem}
.stat.price span{color:var(--gold-light);font-size:1.1rem}
.section{margin:28px 0}
.section h3{font-size:1.05rem;color:var(--gold);margin-bottom:10px;letter-spacing:0.01em}
.section p{color:var(--text-muted);line-height:1.75;font-size:0.94rem}
#map{height:260px;border-radius:14px;border:1px solid var(--border);overflow:hidden;filter:saturate(0.85) brightness(0.92)}
.leaflet-popup-content-wrapper{background:var(--surface);color:var(--text);border-radius:8px}
.wa-btn{display:inline-flex;align-items:center;gap:10px;background:#25D366;color:#fff;padding:15px 30px;border-radius:10px;text-decoration:none;font-weight:700;margin-top:8px;font-size:0.95rem;box-shadow:0 10px 26px rgba(37,211,102,0.25);transition:transform 0.2s}
.wa-btn:hover{transform:translateY(-2px)}
</style>
</head>
<body>
<div class="topbar"><a class="back" href="/accommodation/">&larr; ${t.back}</a></div>
<div class="wrap">
<div class="badges">
${isPreview ? `<div class="status-badge" style="background:#1f6feb;color:#fff">PREVIEW — ${escapeHtml(listing.status)}</div>` : ""}
${rentedBadge}
${genderBadge}
</div>
<h1>${escapeHtml(pub.title)}</h1>
<div class="meta">${escapeHtml(pub.district)}<span class="dot">&middot;</span>${escapeHtml(ROOM_TYPE_LABEL[pub.roomType] || pub.roomType)}</div>
${galleryHtml}
<div class="stats">
${stat(t.rent, `${pub.monthlyRent} ${escapeHtml(pub.currency)}`, true)}
${stat(t.deposit, escapeHtml(pub.deposit))}
${stat(t.bills, escapeHtml(pub.bills))}
${stat(t.furnishing, escapeHtml(pub.furnishing))}
${stat(t.gender, escapeHtml(pub.genderPolicy))}
${stat(t.transport, escapeHtml(pub.transport))}
</div>
${pub.description ? `<div class="section"><h3>${lang === "ar" ? "الوصف" : lang === "tr" ? "Açıklama" : "About this place"}</h3><p>${escapeHtml(pub.description)}</p></div>` : ""}
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
      body: renderListing(listing, lang, qs.preview),
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE },
    body: renderListing(listing, lang),
  };
};
