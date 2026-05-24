const { getStore } = require("@netlify/blobs");

exports.handler = async function(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const store = getStore("matarist-orders");

  try {
    if (event.httpMethod === "POST") {
      const { orders } = JSON.parse(event.body);
      await store.setJSON("all-orders", orders);
      return { statusCode: 200, headers, body: JSON.stringify({ status: "saved" }) };
    }

    if (event.httpMethod === "GET") {
      const orders = await store.get("all-orders", { type: "json" });
      return { statusCode: 200, headers, body: JSON.stringify({ orders: orders || [] }) };
    }

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
