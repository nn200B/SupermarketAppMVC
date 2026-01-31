// paypalClient.js
const checkoutNodeJssdk = require('@paypal/checkout-server-sdk');

function client() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const mode = process.env.PAYPAL_MODE;
  let environment;
  if (mode !== 'live') {
    environment = new checkoutNodeJssdk.core.SandboxEnvironment(clientId, clientSecret);
  } else {
    environment = new checkoutNodeJssdk.core.LiveEnvironment(clientId, clientSecret);
  }
  return new checkoutNodeJssdk.core.PayPalHttpClient(environment);
}

module.exports = { client };