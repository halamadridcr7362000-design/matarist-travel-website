// Live sitemap for accommodation listings — regenerated from current data
// on every request, so published/rented listings are always accurately
// reflected without any manual upkeep. Unpublished and deleted listings
// (which return 404/410) are excluded.
const { getAllListings, isPubliclyVisible } = require("./_lib/accommodation-store");

exports.handler = async function () {
  const listings = await getAllListings();
  const visible = listings.filter(isPubliclyVisible);

  const urls = visible
    .map((l) => {
      const loc = `https://mataristtravel.com/accommodation/${l.slug}`;
      const lastmod = new Date(l.updatedAt || Date.now()).toISOString();
      return `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://mataristtravel.com/accommodation/</loc></url>
${urls}
</urlset>`;

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300" },
    body: xml,
  };
};
