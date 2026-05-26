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
    const store = getStore("orders");

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body);
      
      // لو بعتلنا order واحد جديد
      if (body.newOrder) {
        const existing = await store.get("all-orders");
        const orders = existing ? JSON.parse(existing) : [];
        orders.unshift(body.newOrder);
        await store.set("all-orders", JSON.stringify(orders));
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ status: "saved", count: orders.length })
        };
      }
      
      // لو بعتلنا كل الأوردرات (من admin)
      if (body.orders) {
        await store.set("all-orders", JSON.stringify(body.orders));
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ status: "saved", count: body.orders.length })
        };
      }
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
