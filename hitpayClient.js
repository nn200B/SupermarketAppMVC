const axios = require("axios");

function hitpay() {
  if (!process.env.HITPAY_API_KEY) {
    throw new Error("Missing HITPAY_API_KEY");
  }

  return axios.create({
    baseURL: process.env.HITPAY_BASE_URL,
    headers: {
      "X-BUSINESS-API-KEY": process.env.HITPAY_API_KEY,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });
}

module.exports = { hitpay };
