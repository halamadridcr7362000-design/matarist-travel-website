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
  en: { back: "All Roomist listings", rented: "Rented — currently unavailable", contact: "Ask about this room on WhatsApp", district: "District", type: "Room type", rent: "Monthly rent", deposit: "Deposit", bills: "Bills", furnishing: "Furnishing", gender: "Preference", transport: "Nearby transport", rules: "Rules", video: "Video", watchVideo: "Watch video", notFound: "This listing is no longer available.", gone: "This listing has been removed." },
  ar: { back: "كل إعلانات Roomist", rented: "مؤجرة حالياً — غير متاحة", contact: "اسأل عن هذه الغرفة عبر واتساب", district: "المنطقة", type: "نوع الغرفة", rent: "الإيجار الشهري", deposit: "التأمين", bills: "الفواتير", furnishing: "التأثيث", gender: "التفضيل", transport: "وسائل النقل القريبة", rules: "الشروط", video: "فيديو", watchVideo: "شاهد الفيديو", notFound: "هذا السكن غير متاح حالياً.", gone: "تم حذف هذا السكن." },
  tr: { back: "Tüm Roomist ilanları", rented: "Kiralandı — şu anda uygun değil", contact: "Bu oda hakkında WhatsApp'tan sorun", district: "Semt", type: "Oda tipi", rent: "Aylık kira", deposit: "Depozito", bills: "Faturalar", furnishing: "Eşya durumu", gender: "Tercih", transport: "Yakın ulaşım", rules: "Kurallar", video: "Video", watchVideo: "Videoyu izle", notFound: "Bu ilan artık mevcut değil.", gone: "Bu ilan kaldırıldı." },
};

const ROOM_TYPE_LABEL = { single: "Single room", double: "Double room", shared: "Shared room", apartment: "Entire apartment" };

const GENDER_BADGE = {
  en: { girls: "Women Only", boys: "Men Only", mixed: "Mixed" },
  ar: { girls: "للسيدات فقط", boys: "للرجال فقط", mixed: "مختلط" },
  tr: { girls: "Sadece Kadın", boys: "Sadece Erkek", mixed: "Karma" },
};

// Pure presentation logic — derives a visual theme from the listing's
// existing genderPolicy free-text field. No new data field, no stored
// listing is changed; this only decides which CSS accent variables apply.
// "mixed" must be checked before the female/male patterns: a policy like
// "Mixed (Male & Female)" contains the substring "female", which would
// otherwise misclassify a mixed listing as women-only.
function genderTheme(genderPolicy) {
  const g = String(genderPolicy || "").toLowerCase();
  if (/mixed|both genders|male\s*(&|and)\s*female/.test(g)) return "mixed";
  if (/female|girl|women|woman/.test(g)) return "girls";
  if (/\bmale\b|\bboys?\b|\bmen\b/.test(g)) return "boys";
  return "neutral";
}

// Converts a landlord-supplied link into a safe embed. Only recognized
// YouTube/Vimeo/Google Drive patterns get an <iframe>; anything else (or a
// non-http(s) scheme, e.g. "javascript:") falls back to a plain outbound
// link so an admin-entered URL can never inject an arbitrary embedded origin.
function videoEmbedHtml(url, watchLabel) {
  const raw = String(url || "").trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  let embedSrc = "";
  const yt = raw.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/);
  const vimeo = !yt && raw.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  const drive = !yt && !vimeo && raw.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (yt) embedSrc = `https://www.youtube.com/embed/${yt[1]}`;
  else if (vimeo) embedSrc = `https://player.vimeo.com/video/${vimeo[1]}`;
  else if (drive) embedSrc = `https://drive.google.com/file/d/${drive[1]}/preview`;
  if (embedSrc) {
    return `<div class="video-wrap"><iframe src="${embedSrc}" title="Video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
  }
  return `<p><a href="${escapeHtml(raw)}" target="_blank" rel="noopener noreferrer">${watchLabel} <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:0.75em"></i></a></p>`;
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const GA_SNIPPET = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-RJ10YL2GD4"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-RJ10YL2GD4');</script>`;

function errorPage(lang, code, message) {
  const t = LABELS[lang] || LABELS.en;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">${GA_SNIPPET}<title>${code} — Roomist by MATARIST</title><meta name="robots" content="noindex">
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
  const title = `${escapeHtml(pub.title)} — ${escapeHtml(pub.district)} | Roomist by MATARIST`;
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
  const genderBadge = theme === "girls" ? `<div class="status-badge status-gender">${genderLabels.girls}</div>` : theme === "boys" ? `<div class="status-badge status-gender">${genderLabels.boys}</div>` : theme === "mixed" ? `<div class="status-badge status-gender">${genderLabels.mixed}</div>` : "";

  const photos = pub.photos || [];
  const allPhotoUrls = photos.map(photoUrl);
  const galleryHtml = photos.length
    ? `<div class="gallery ${photos.length === 1 ? "single" : ""}">
        <div class="gallery-main"><img src="${photoUrl(photos[0])}" loading="lazy" alt="${escapeHtml(pub.title)}" onclick="openLightbox(0)"></div>
        ${photos.length > 1 ? `<div class="gallery-side">${photos.slice(1, 5).map((k, i) => `<img src="${photoUrl(k)}" loading="lazy" alt="${escapeHtml(pub.title)}" onclick="openLightbox(${i + 1})">`).join("")}</div>` : ""}
      </div>`
    : `<div class="gallery-empty"><i class="fa-solid fa-image"></i></div>`;

  const mapHtml = typeof pub.lat === "number" && typeof pub.lng === "number"
    ? `<div class="section"><h3>${t.transport}</h3>
       <div id="map"></div>
       <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
       <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
       <script>
       var m=L.map('map',{scrollWheelZoom:false,dragging:false,tap:false}).setView([${pub.lat},${pub.lng}],14);
       L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap contributors'}).addTo(m);
       L.marker([${pub.lat},${pub.lng}]).addTo(m);
       var mapHintText={en:'Tap to interact with the map',ar:'اضغط للتفاعل مع الخريطة',tr:'Haritayla etkileşim için dokunun'};
       var mapHint=document.createElement('div');
       mapHint.className='map-hint';
       mapHint.innerHTML='<span>👆 '+(mapHintText['${lang}']||mapHintText.en)+'</span>';
       mapHint.addEventListener('click',function(){ m.scrollWheelZoom.enable(); m.dragging.enable(); m.tap&&m.tap.enable(); mapHint.classList.add('hidden'); setTimeout(function(){mapHint.remove();},300); });
       m.getContainer().appendChild(mapHint);
       </script>`
    : "";
  const videoUrls = Array.isArray(pub.videoUrls) ? pub.videoUrls.filter(Boolean) : [];
  const videoEmbeds = videoUrls.map((u) => videoEmbedHtml(u, t.watchVideo)).filter(Boolean).join("");
  const videoHtml = videoEmbeds ? `<div class="section"><h3>${t.video}</h3>${videoEmbeds}</div>` : "";
  const waText = encodeURIComponent(`Hi, I'm interested in: ${pub.title} (${pub.district}) — ${canonical}`);

  const stat = (label, value, emphasize) => `<div class="stat${emphasize ? " price" : ""}"><label>${label}</label><span>${value || "—"}</span></div>`;

  return `<!doctype html>
<html lang="${lang}" data-gender="${theme}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${GA_SNIPPET}
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
  --accent:#b8955e; --accent-soft:rgba(184,149,94,0.14); --accent-badge:rgba(184,149,94,0.30); --accent-glow:rgba(184,149,94,0.25);
}
/* Same strength as the hub page: the gender theme overrides the card's
   own --surface, not just the accent color, so "Women Only" / "Men Only"
   listings read as genuinely different-colored pages at a glance. */
[data-gender="girls"]{
  --accent:#e879ad; --accent-soft:rgba(232,121,173,0.22); --accent-badge:rgba(184,52,117,0.65); --accent-glow:rgba(232,121,173,0.32);
  --surface:#3a1a30; --surface-2:#49213c;
}
[data-gender="boys"]{
  --accent:#6b8fb8; --accent-soft:rgba(107,143,184,0.22); --accent-badge:rgba(23,36,58,0.80); --accent-glow:rgba(107,143,184,0.26);
  --surface:#142338; --surface-2:#1a2d47;
}
[data-gender="mixed"]{
  --accent:#b39ddb; --accent-soft:rgba(179,157,219,0.22); --accent-badge:rgba(106,76,147,0.65); --accent-glow:rgba(179,157,219,0.30);
  --surface:#241a3a; --surface-2:#2d2047;
}
*{box-sizing:border-box}
/* Page background: same soft gold/violet/teal ambient glows, dense star
   field, milky-way haze and MATARIST icon watermark as the hub page —
   consistency across the whole accommodation section, not a flat fill. */
body{
  font-family:'DM Sans',sans-serif;background-color:var(--bg);color:var(--text);margin:0;padding:0;-webkit-font-smoothing:antialiased;
  background-image:
    radial-gradient(ellipse 950px 560px at 10% 0%, rgba(184,149,94,0.16), transparent 60%),
    radial-gradient(ellipse 760px 560px at 100% 25%, rgba(184,149,94,0.11), transparent 55%),
    radial-gradient(ellipse 860px 640px at 4% 85%, rgba(184,149,94,0.11), transparent 60%),
    radial-gradient(ellipse 820px 600px at 78% 55%, rgba(120,90,170,0.09), transparent 62%),
    radial-gradient(ellipse 700px 500px at 30% 70%, rgba(70,110,150,0.07), transparent 60%),
    linear-gradient(115deg, transparent 32%, rgba(200,190,255,0.05) 45%, rgba(230,210,255,0.08) 50%, rgba(200,190,255,0.05) 55%, transparent 68%),
    radial-gradient(circle 70px at 13% 16%, rgba(212,180,128,0.4), rgba(212,180,128,0.1) 60%, transparent 78%),
    radial-gradient(circle 50px at 90% 72%, rgba(120,150,200,0.4), rgba(120,150,200,0.1) 60%, transparent 78%),
    radial-gradient(1.4px 1.4px at 15px 25px, rgba(243,237,228,0.8), transparent),
    radial-gradient(1px 1px at 55px 85px, rgba(243,237,228,0.55), transparent),
    radial-gradient(1.6px 1.6px at 95px 40px, rgba(212,180,128,0.7), transparent),
    radial-gradient(1px 1px at 120px 110px, rgba(243,237,228,0.5), transparent),
    radial-gradient(1.3px 1.3px at 35px 140px, rgba(212,180,128,0.6), transparent),
    radial-gradient(1.8px 1.8px at 20px 30px, rgba(243,237,228,0.8), transparent),
    radial-gradient(1.2px 1.2px at 90px 110px, rgba(243,237,228,0.6), transparent),
    radial-gradient(2px 2px at 150px 60px, rgba(212,180,128,0.7), transparent),
    radial-gradient(1.2px 1.2px at 180px 150px, rgba(243,237,228,0.55), transparent),
    radial-gradient(1.5px 1.5px at 50px 170px, rgba(212,180,128,0.6), transparent),
    radial-gradient(1px 1px at 120px 20px, rgba(243,237,228,0.5), transparent),
    radial-gradient(2.4px 2.4px at 60px 90px, rgba(243,237,228,0.75), transparent),
    radial-gradient(1.2px 1.2px at 200px 210px, rgba(212,180,128,0.55), transparent),
    radial-gradient(1.6px 1.6px at 260px 40px, rgba(243,237,228,0.5), transparent),
    radial-gradient(1.2px 1.2px at 320px 260px, rgba(243,237,228,0.45), transparent),
    radial-gradient(2px 2px at 380px 120px, rgba(212,180,128,0.5), transparent),
    url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjM1NCAzMjAgMzM0IDI0MSI+PGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMC4wMDAwMDAsMTAyNC4wMDAwMDApIHNjYWxlKDAuMTAwMDAwLC0wLjEwMDAwMCkiIGZpbGw9InJnYmEoMTg0LDE0OSw5NCwwLjEyKSIgc3Ryb2tlPSJub25lIj48cGF0aCBkPSJNNjYxOSA2OTIxIGMtODYgLTI3IC0zMDMgLTE4NSAtNDE0IC0zMDAgLTI5IC0zMSAtNDcgLTQxIC03MCAtNDEgLTE2IDEgLTE4NyAyMCAtMzgwIDQ0IGwtMzUwIDQ0IC01MyAtNDUgYy0yOSAtMjUgLTUwIC00OSAtNDUgLTU0IDUgLTUgMTM3IC01OSAyOTQgLTEyMSAxNTcgLTYyIDI4NyAtMTE3IDI4OSAtMTIyIDMgLTEyIC02MzYgLTYwNCAtODIwIC03NTggLTMwMSAtMjUzIC02MTggLTQ1MyAtODI3IC01MjQgLTYxIC0yMSAtOTkgLTI3IC0xNzMgLTI4IC0xMjEgLTEgLTE1OSAxOCAtMTk5IDEwMyAtMjMgNTAgLTI2IDY4IC0yNSAxNjEgMCA4NyA1IDExOCAyNyAxNzkgbDI2IDczIC0yNiAtMjMgYy0xMzkgLTEzMCAtMjI2IC0zMzMgLTIwMyAtNDczIDM0IC0yMTEgMjI5IC0zMDEgNTQwIC0yNTEgNDAwIDY1IDc4NCAzMjUgMTY3OSAxMTM5IDExMyAxMDIgMjA4IDE4NiAyMTIgMTg2IDQgMCA1NSAtMTA5IDExNCAtMjQyIDU5IC0xMzQgMTE5IC0yNzAgMTM0IC0zMDIgbDI3IC02MCA1NiA1MCBjMzEgMjcgNTggNTQgNjAgNTkgMyA2IC0xMiAxMzQgLTMzIDI4NSAtMjEgMTUxIC00MyAzMjMgLTUwIDM4MiBsLTEyIDEwOCA5MCA5NCBjMTk4IDIwNiAyODQgMzU3IDIzNiA0MTQgLTIxIDI1IC02NiAzNSAtMTA0IDIzeiIvPjxwYXRoIGQ9Ik00MDMwIDU3OTEgYzAgLTU4OSAyIC02ODAgMTUgLTY5MSAyMCAtMTcgNjkgLTcgMTg4IDM3IGw5NyAzNiAwIDM4NiAwIDM4NiAxNzkgLTI2OSBjOTkgLTE0NyAxODIgLTI3MCAxODUgLTI3MyA0IC00IDE1MiA4NSAyNDkgMTQ4IDggNiAtMTkzIDMxMSAtNTI3IDgwMiBsLTgwIDExNyAtMTUzIDAgLTE1MyAwIDAgLTY3OXoiLz48cGF0aCBkPSJNNTg2MyA1Nzg3IGwtMTQzIC0xMjIgMyAtNDMwIDIgLTQzMCAxNDUgMCAxNDUgMCAzIDU1MyBjMSAzMDMgLTEgNTUyIC01IDU1MSAtNSAwIC03MiAtNTUgLTE1MCAtMTIyeiIvPjwvZz48L3N2Zz4=");
  background-position:0 0, 0 0, 0 0, 0 0, 0 0, 0 0, 0 0, 0 0, 0 0, 0 0, 0 0, 0 0, 0 0, 0 0, 0 0, 0 0, 0 0, 0 0, 0 0, 0 0, 0 0, 0 0, 0 0, 0 0, 78% 60%;
  background-size:auto, auto, auto, auto, auto, auto, auto, auto, 150px 150px, 150px 150px, 150px 150px, 150px 150px, 150px 150px, 260px 260px, 260px 260px, 260px 260px, 260px 260px, 260px 260px, 260px 260px, 420px 420px, 420px 420px, 420px 420px, 420px 420px, 420px 420px, 620px auto;
  background-repeat:no-repeat, no-repeat, no-repeat, no-repeat, no-repeat, no-repeat, no-repeat, no-repeat, repeat, repeat, repeat, repeat, repeat, repeat, repeat, repeat, repeat, repeat, repeat, repeat, repeat, repeat, repeat, repeat, no-repeat;
  background-attachment:fixed;
}
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
.status-gender{background:var(--accent-badge);border:1px solid var(--accent);color:var(--text)}
h1{font-size:clamp(1.7rem,3.4vw,2.3rem);margin:0 0 6px;line-height:1.2}
.meta{color:var(--text-muted);margin-bottom:22px;font-size:0.92rem}
.meta .dot{margin:0 8px;opacity:0.5}
.gallery{display:grid;grid-template-columns:1.5fr 1fr;grid-template-rows:380px;gap:8px;margin-bottom:28px;border-radius:16px;overflow:hidden;height:380px;border:2px solid var(--accent-soft);box-shadow:0 0 0 1px rgba(0,0,0,0.2),0 18px 44px rgba(0,0,0,0.4)}
.gallery.single{grid-template-columns:1fr}
.gallery-main{height:100%;overflow:hidden;position:relative}
.gallery-main::after{content:"";position:absolute;inset:0;background:linear-gradient(to top, rgba(21,18,27,0.35) 0%, transparent 35%);pointer-events:none}
.gallery-main img{width:100%;height:100%;object-fit:cover;display:block;cursor:pointer;transition:transform 0.5s ease}
.gallery-main:hover img{transform:scale(1.045)}
.gallery-side{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(2,1fr);gap:8px;height:100%}
.gallery-side img{width:100%;height:100%;object-fit:cover;display:block;cursor:pointer;transition:transform 0.5s ease}
.gallery-side img:hover{transform:scale(1.08)}
.gallery-empty{height:260px;border-radius:16px;background:var(--surface);border:2px solid var(--accent-soft);display:flex;align-items:center;justify-content:center;color:var(--text-faint);font-size:2rem;margin-bottom:28px}
@media(prefers-reduced-motion:reduce){.gallery-main img,.gallery-side img{transition:none}}
@media(max-width:640px){.gallery{grid-template-columns:1fr;height:auto}.gallery-side{grid-template-columns:1fr 1fr;grid-template-rows:1fr;height:120px}.gallery-main img{height:220px}}
.lightbox{position:fixed;inset:0;background:rgba(10,8,14,0.94);display:none;align-items:center;justify-content:center;z-index:1000;padding:24px}
.lightbox.open{display:flex}
.lightbox img{max-width:min(92vw,1100px);max-height:86vh;object-fit:contain;border-radius:10px}
.lightbox-close{position:absolute;top:18px;inset-inline-end:24px;background:rgba(255,255,255,0.08);border:1px solid var(--border);color:var(--text);width:40px;height:40px;border-radius:50%;cursor:pointer;font-size:1.1rem;display:flex;align-items:center;justify-content:center}
.lightbox-nav{position:absolute;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.08);border:1px solid var(--border);color:var(--text);width:46px;height:46px;border-radius:50%;cursor:pointer;font-size:1.2rem;display:flex;align-items:center;justify-content:center}
.lightbox-prev{inset-inline-start:16px}
.lightbox-next{inset-inline-end:16px}
.lightbox-count{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);color:var(--text-muted);font-size:0.82rem}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border-soft);border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:28px}
.stat{background:var(--surface);padding:16px 18px}
.stat label{display:block;font-size:0.68rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-faint);margin-bottom:4px}
.stat span{font-weight:700;color:var(--text);font-size:0.95rem}
.stat.price span{color:var(--gold-light);font-size:1.1rem}
.section{margin:28px 0}
.section h3{font-size:1.05rem;color:var(--gold);margin-bottom:10px;letter-spacing:0.01em}
.section p{color:var(--text-muted);line-height:1.75;font-size:0.94rem}
.video-wrap{position:relative;padding-top:56.25%;border-radius:14px;overflow:hidden;border:1px solid var(--border);background:var(--surface);margin-bottom:12px}
.video-wrap iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
#map{height:260px;border-radius:14px;border:1px solid var(--border);overflow:hidden;filter:saturate(0.85) brightness(0.92)}
.leaflet-popup-content-wrapper{background:var(--surface);color:var(--text);border-radius:8px}
.map-hint{position:absolute;inset:0;background:rgba(21,18,27,0.45);display:flex;align-items:center;justify-content:center;z-index:1000;cursor:pointer;transition:opacity 0.25s ease;opacity:1}
.map-hint.hidden{opacity:0;pointer-events:none}
.map-hint span{background:rgba(21,18,27,0.88);color:var(--text);border:1px solid var(--gold);padding:9px 18px;border-radius:20px;font-size:0.82rem;font-weight:600;pointer-events:none;white-space:nowrap}
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
${videoHtml}
${pub.rules ? `<div class="section"><h3>${t.rules}</h3><p>${escapeHtml(pub.rules)}</p></div>` : ""}
${mapHtml}
<a class="wa-btn" href="https://wa.me/${WHATSAPP}?text=${waText}" target="_blank" rel="noopener">
<i class="fa-brands fa-whatsapp"></i> ${t.contact}
</a>
</div>

<div class="lightbox" id="lightbox" onclick="if(event.target===this)closeLightbox()">
  <button class="lightbox-close" onclick="closeLightbox()"><i class="fa-solid fa-xmark"></i></button>
  <button class="lightbox-nav lightbox-prev" onclick="lightboxStep(-1)"><i class="fa-solid fa-chevron-left"></i></button>
  <img id="lightbox-img" src="" alt="${escapeHtml(pub.title)}">
  <button class="lightbox-nav lightbox-next" onclick="lightboxStep(1)"><i class="fa-solid fa-chevron-right"></i></button>
  <div class="lightbox-count" id="lightbox-count"></div>
</div>
<script>
// Photos clicked in the gallery open here. Uses the full photo list (not
// just the few shown in the grid) so visitors can browse every photo even
// if a listing has more than fit on screen.
const LIGHTBOX_PHOTOS = ${JSON.stringify(allPhotoUrls)};
let lightboxIndex = 0;
function openLightbox(i){
  lightboxIndex = i;
  updateLightbox();
  document.getElementById('lightbox').classList.add('open');
}
function closeLightbox(){ document.getElementById('lightbox').classList.remove('open'); }
function lightboxStep(d){
  lightboxIndex = (lightboxIndex + d + LIGHTBOX_PHOTOS.length) % LIGHTBOX_PHOTOS.length;
  updateLightbox();
}
function updateLightbox(){
  document.getElementById('lightbox-img').src = LIGHTBOX_PHOTOS[lightboxIndex];
  document.getElementById('lightbox-count').textContent = (lightboxIndex+1) + ' / ' + LIGHTBOX_PHOTOS.length;
}
document.addEventListener('keydown', e=>{
  if(!document.getElementById('lightbox').classList.contains('open')) return;
  if(e.key==='Escape') closeLightbox();
  if(e.key==='ArrowRight') lightboxStep(1);
  if(e.key==='ArrowLeft') lightboxStep(-1);
});
</script>
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
