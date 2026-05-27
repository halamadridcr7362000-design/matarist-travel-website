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

  try {
    const store = getStore({
      name: "orders",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN,
    });

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body);
      const existing = await store.get("all-orders");
      let orders = existing ? JSON.parse(existing) : [];
      
      if (body.newOrder) {
        orders.unshift(body.newOrder);
      } else if (body.orders) {
        orders = body.orders;
      }
      
      await store.set("all-orders", JSON.stringify(orders));
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ status: "saved", count: orders.length })
      };
    }

    if (event.httpMethod === "GET") {
      const data = await store.get("all-orders");
      const orders = data ? JSON.parse(data) : [];
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ orders })
      };
    }

  } catch (err) {
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
