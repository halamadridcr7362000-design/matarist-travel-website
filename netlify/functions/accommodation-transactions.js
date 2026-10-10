// CRUD for accommodation financial transactions — separate Netlify Blobs
// store from both "orders" (aviation) and "accommodation-listings" (room
// content), so a full-array rewrite on any one of the three can never
// clobber another.
//
// Business model: MATARIST earns a commission from the CLIENT. Monthly rent
// is the landlord's money and is never counted as revenue. Only amounts
// actually collected/paid are ever reported as revenue/profit — "agreed"
// figures are tracked for the admin's own visibility only.
const crypto = require("crypto");
const { requireSession } = require("./_lib/accommodation-security");
const { getTransactionsWithEtag, updateTransactions, withDerived } = require("./_lib/accommodation-store");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

function nextOrderRef(transactions) {
  const nums = transactions
    .map((t) => (t.order_ref || "").match(/^ACC-(\d+)$/))
    .filter(Boolean)
    .map((m) => parseInt(m[1], 10));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `ACC-${String(next).padStart(4, "0")}`;
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    if (event.httpMethod === "GET") return await handleGet(event);
    if (event.httpMethod === "POST") return await handlePost(event);
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

async function handleGet(event) {
  const qs = event.queryStringParameters || {};

  // Used only by accounts.html to fold accommodation into the shared
  // company totals. Deliberately returns the SAME trust tier as the
  // existing orders.js (no server-side auth on reads today) but a much
  // narrower allow-list: no client identity, no landlord identity, no
  // payment line items — only the figures accounts.html's reporting needs.
  if (qs.action === "accounting-summary") {
    const { data } = await getTransactionsWithEtag();
    const summary = data
      .filter((t) => t.status !== "cancelled")
      .map(withDerived)
      .map((t) => ({
        id: t.createdAt,
        order_ref: t.order_ref,
        date: t.createdAt,
        confirmed_at: t.createdAt,
        status: "تم التأكيد", // matches the Arabic "confirmed" string accounts.html already filters on
        base_price: 0,
        final_price: t.commissionCollected,
        profit_amount: t.realizedProfit,
      }));
    return { statusCode: 200, headers, body: JSON.stringify({ transactions: summary }) };
  }

  const session = requireSession(event);
  if (!session) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
  }
  const { data } = await getTransactionsWithEtag();
  return { statusCode: 200, headers, body: JSON.stringify({ transactions: data.map(withDerived) }) };
}

async function handlePost(event) {
  const session = requireSession(event);
  if (!session) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  const body = JSON.parse(event.body || "{}");
  const action = body.action;

  try {
    if (action === "create") {
      let created;
      await updateTransactions((transactions) => {
        const order_ref = nextOrderRef(transactions);
        const method = body.commissionMethod === "fixed" ? "fixed" : "percentage";
        const monthlyRent = parseFloat(body.monthlyRent) || 0;
        const percentage = parseFloat(body.commissionPercentage) || 0;
        const commissionAgreed =
          method === "fixed" ? parseFloat(body.commissionAgreed) || 0 : Math.round((monthlyRent * percentage) / 100);
        const now = Date.now();
        created = {
          order_ref,
          listingId: body.listingId || "",
          listingSlug: body.listingSlug || "",
          clientName: body.clientName || "",
          clientPhone: body.clientPhone || "",
          status: "active",
          monthlyRent,
          commissionMethod: method,
          commissionPercentage: percentage,
          commissionAgreed,
          payments: [],
          landlordShareAgreed: parseFloat(body.landlordShareAgreed) || 0,
          landlordSharePayments: [],
          expenses: [],
          notes: body.notes || "",
          createdAt: now,
          updatedAt: now,
        };
        return [...transactions, created];
      });
      return { statusCode: 200, headers, body: JSON.stringify({ transaction: withDerived(created) }) };
    }

    if (action === "update") {
      let updated;
      await updateTransactions((transactions) => {
        const idx = transactions.findIndex((t) => t.order_ref === body.order_ref);
        if (idx === -1) throw new Error("Transaction not found");
        const editable = [
          "clientName", "clientPhone", "commissionMethod", "commissionPercentage",
          "commissionAgreed", "landlordShareAgreed", "notes",
        ];
        for (const f of editable) {
          if (body[f] !== undefined) transactions[idx][f] = body[f];
        }
        transactions[idx].updatedAt = Date.now();
        updated = transactions[idx];
        return transactions;
      });
      return { statusCode: 200, headers, body: JSON.stringify({ transaction: withDerived(updated) }) };
    }

    if (action === "setStatus") {
      let updated;
      await updateTransactions((transactions) => {
        const idx = transactions.findIndex((t) => t.order_ref === body.order_ref);
        if (idx === -1) throw new Error("Transaction not found");
        transactions[idx].status = body.status === "cancelled" ? "cancelled" : "active";
        transactions[idx].updatedAt = Date.now();
        updated = transactions[idx];
        return transactions;
      });
      return { statusCode: 200, headers, body: JSON.stringify({ transaction: withDerived(updated) }) };
    }

    // Records a client commission payment or a landlord-share payout.
    // Idempotent via payment_id: resubmitting the same payment_id (double
    // click, retry) updates nothing extra — it's a no-op, not a duplicate.
    if (action === "addPayment") {
      const kind = body.kind === "landlordShare" ? "landlordSharePayments" : "payments";
      const paymentId = body.payment_id || crypto.randomUUID();
      let updated;
      await updateTransactions((transactions) => {
        const idx = transactions.findIndex((t) => t.order_ref === body.order_ref);
        if (idx === -1) throw new Error("Transaction not found");
        const tx = transactions[idx];
        tx[kind] = tx[kind] || [];
        const already = tx[kind].some((p) => p.payment_id === paymentId);
        if (!already) {
          tx[kind].push({
            payment_id: paymentId,
            amount: parseFloat(body.amount) || 0,
            date: body.date || new Date().toISOString().slice(0, 10),
            note: body.note || "",
          });
          tx.updatedAt = Date.now();
        }
        updated = tx;
        return transactions;
      });
      return { statusCode: 200, headers, body: JSON.stringify({ transaction: withDerived(updated) }) };
    }

    if (action === "addExpense") {
      let updated;
      await updateTransactions((transactions) => {
        const idx = transactions.findIndex((t) => t.order_ref === body.order_ref);
        if (idx === -1) throw new Error("Transaction not found");
        const tx = transactions[idx];
        tx.expenses = tx.expenses || [];
        tx.expenses.push({
          id: crypto.randomUUID(),
          description: body.description || "",
          amountAgreed: parseFloat(body.amountAgreed) || 0,
          amountPaid: 0,
        });
        tx.updatedAt = Date.now();
        updated = tx;
        return transactions;
      });
      return { statusCode: 200, headers, body: JSON.stringify({ transaction: withDerived(updated) }) };
    }

    // Idempotent for the same reason as addPayment.
    if (action === "payExpense") {
      const paymentId = body.payment_id || crypto.randomUUID();
      let updated;
      await updateTransactions((transactions) => {
        const idx = transactions.findIndex((t) => t.order_ref === body.order_ref);
        if (idx === -1) throw new Error("Transaction not found");
        const tx = transactions[idx];
        const exp = (tx.expenses || []).find((e) => e.id === body.expenseId);
        if (!exp) throw new Error("Expense not found");
        exp.paidLog = exp.paidLog || [];
        const already = exp.paidLog.some((p) => p.payment_id === paymentId);
        if (!already) {
          exp.paidLog.push({ payment_id: paymentId, amount: parseFloat(body.amount) || 0 });
          exp.amountPaid = exp.paidLog.reduce((s, p) => s + p.amount, 0);
          tx.updatedAt = Date.now();
        }
        updated = tx;
        return transactions;
      });
      return { statusCode: 200, headers, body: JSON.stringify({ transaction: withDerived(updated) }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown action" }) };
  } catch (err) {
    const isConflict = /concurrent writes/i.test(err.message);
    return {
      statusCode: isConflict ? 409 : 400,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
