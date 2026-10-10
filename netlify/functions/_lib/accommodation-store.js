// Shared data-access helpers for the accommodation feature.
// Two independent Netlify Blobs stores, separate from the existing
// "orders" store used by aviation — this is the fix that prevents a
// full-array rewrite on one side from ever clobbering the other.
const { getStore } = require("@netlify/blobs");

const LISTINGS_KEY = "all-listings";
const TRANSACTIONS_KEY = "all-transactions";

// This site's Blobs automatic context injection isn't active (confirmed by
// testing against a live deploy preview) — the existing orders.js already
// works around this by passing siteID/token explicitly from the same env
// vars Netlify Blobs is already configured with here. Reusing that exact
// pattern, so no new environment variables are needed for storage.
function blobsCreds() {
  return { siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN };
}

function listingsStore() {
  return getStore({ name: "accommodation-listings", consistency: "strong", ...blobsCreds() });
}

function transactionsStore() {
  return getStore({ name: "accommodation-transactions", consistency: "strong", ...blobsCreds() });
}

async function getAllListings() {
  const data = await listingsStore().get(LISTINGS_KEY, { type: "json" });
  return data || [];
}

async function saveAllListings(listings) {
  await listingsStore().setJSON(LISTINGS_KEY, listings);
}

// Fields a visitor is ever allowed to see. Deliberately an allow-list
// (not a block-list) so a new private field added later is safe by default.
const PUBLIC_LISTING_FIELDS = [
  "id", "slug", "status", "title", "district", "roomType", "monthlyRent",
  "currency", "deposit", "bills", "furnishing", "genderPolicy", "transport",
  "rules", "description", "photos", "lat", "lng", "updatedAt",
];

function toPublicListing(listing) {
  const out = {};
  for (const f of PUBLIC_LISTING_FIELDS) out[f] = listing[f];
  return out;
}

function isPubliclyVisible(listing) {
  return !!listing && (listing.status === "published" || listing.status === "rented");
}

// --- Transactions store, with ETag-guarded conditional writes ---
// Netlify Blobs documents onlyIfMatch/onlyIfNew as an optimistic-concurrency
// check. Tested live against this account's actual Blobs setup (manual
// siteID/token credentials, same as orders.js uses) and setJSON did not
// return the documented {modified, etag} result — it came back undefined,
// so relying on that contract broke every write. Using a version counter
// stored in the data itself instead: fully application-level, works
// regardless of what the SDK does internally, and needs no particular
// Blobs feature to be present. It is a best-effort check (there's a small
// window between the verifying re-read and another write), not a true
// atomic guarantee — reasonable for a solo admin's occasional writes,
// which is the actual usage pattern here.
async function getTransactionsRaw() {
  const data = await transactionsStore().get(TRANSACTIONS_KEY, { type: "json" });
  return data && Array.isArray(data.items) ? data : { version: 0, items: [] };
}

async function getTransactionsWithEtag() {
  const raw = await getTransactionsRaw();
  return { data: raw.items, etag: String(raw.version) };
}

// mutateFn(currentArray) -> newArray. Retries on a detected conflict.
async function updateTransactions(mutateFn, maxAttempts = 4) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const current = await getTransactionsRaw();
    const nextItems = mutateFn(current.items);
    const nextVersion = current.version + 1;
    await transactionsStore().setJSON(TRANSACTIONS_KEY, { version: nextVersion, items: nextItems });
    const verify = await getTransactionsRaw();
    if (verify.version === nextVersion) return nextItems;
    // Someone else wrote in between (their version won) — retry from fresh data.
  }
  throw new Error("Could not save transaction after several attempts due to concurrent writes. Please retry.");
}

function withDerived(tx) {
  const sum = (arr, field) => (arr || []).reduce((s, p) => s + (parseFloat(p[field]) || 0), 0);
  const commissionCollected = sum(tx.payments, "amount");
  const landlordSharePaid = sum(tx.landlordSharePayments, "amount");
  const expensesPaidTotal = (tx.expenses || []).reduce((s, e) => s + (parseFloat(e.amountPaid) || 0), 0);
  const expensesAgreedTotal = (tx.expenses || []).reduce((s, e) => s + (parseFloat(e.amountAgreed) || 0), 0);
  const commissionAgreed = parseFloat(tx.commissionAgreed) || 0;
  const landlordShareAgreed = parseFloat(tx.landlordShareAgreed) || 0;
  return {
    ...tx,
    commissionCollected,
    commissionOutstanding: Math.max(0, commissionAgreed - commissionCollected),
    landlordSharePaid,
    landlordShareOutstanding: Math.max(0, landlordShareAgreed - landlordSharePaid),
    expensesPaidTotal,
    expensesAgreedTotal,
    realizedProfit: commissionCollected - landlordSharePaid - expensesPaidTotal,
    expectedProfit: commissionAgreed - landlordShareAgreed - expensesAgreedTotal,
    clientPaymentStatus: commissionCollected <= 0 ? "unpaid" : commissionCollected >= commissionAgreed ? "paid" : "partial",
  };
}

module.exports = {
  listingsStore,
  transactionsStore,
  getAllListings,
  saveAllListings,
  toPublicListing,
  isPubliclyVisible,
  getTransactionsWithEtag,
  updateTransactions,
  withDerived,
  LISTINGS_KEY,
  TRANSACTIONS_KEY,
};
