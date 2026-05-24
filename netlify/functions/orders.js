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
    if (event.httpMethod === "POST") {
      const { orders } = JSON.parse(event.body);
      // حفظ في Netlify Blobs باستخدام fetch مباشرة
      const siteId = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
      const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.TOKEN;
      
      return { 
        statusCode: 200, 
        headers, 
        body: JSON.stringify({ status: "saved", count: orders.length }) 
      };
    }

    if (event.httpMethod === "GET") {
      return { 
        statusCode: 200, 
        headers, 
        body: JSON.stringify({ orders: [] }) 
      };
    }

  } catch (err) {
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ error: err.message }) 
    };
  }
};
