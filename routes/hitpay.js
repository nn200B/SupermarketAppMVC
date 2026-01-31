// routes/hitpay.js
const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const { hitpay } = require("../hitpayClient");
const OrderModel = require("../models/Order");
const Notification = require("../models/Notification");

function addReceiptNotification(order) {
  try {
    const store = global.__appStore;
    if (!store) return;
    store.persistStore = global.__persistStore;
    Notification.init(store);
    Notification.addNotification({
      role: "user",
      userId: order.userId,
      type: "payment",
      message: `Receipt: Payment received for order #${order.id}.`,
      link: "/orders/" + encodeURIComponent(order.id) + "/invoice"
    });
  } catch (e) {
    console.error("Failed to add receipt notification:", e);
  }
}

// helper
function getUserId(req) {
  return req.session?.user?.id;
}

// --------------------
// 1) Create PayNow payment (HitPay hosted)
// POST /hitpay/create-payment
// --------------------
router.post("/create-payment", async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Not logged in" });

    const baseCart = req.session.cart || [];
    const cart =
      Array.isArray(req.session.selectedCartItems) && req.session.selectedCartItems.length
        ? req.session.selectedCartItems
        : baseCart;

    if (!cart.length) return res.status(400).json({ error: "Cart is empty" });
    if (!req.session.delivery) return res.status(400).json({ error: "Missing delivery details" });

    // subtotal
    const subtotal = cart.reduce(
      (s, it) => s + Number(it.price || 0) * Number(it.quantity || 0),
      0
    );

    // delivery logic (same as your checkout flow)
    const deliveryOption = req.body?.deliveryOption || "normal";
    const cutoffHour = 13;
    const now = new Date();

    let deliveryCost = 10;
    if (deliveryOption === "one-day") {
      if (now.getHours() >= cutoffHour) {
        return res.status(400).json({
          error: "One-day delivery must be ordered before 1pm. Choose normal delivery.",
        });
      }
      deliveryCost = 25;
    }

    const total = Number(subtotal) + Number(deliveryCost);

    // Create a pending order in your JSON store
    OrderModel.addOrder(
      {
        userId,
        items: cart.slice(),
        subtotal,
        deliveryOption,
        deliveryCost,
        total,
        paymentMethod: "paynow_hitpay",
        status: "pending_payment",
        deliveryStatus: "processing",
        delivery: req.session.delivery,
      },
      async (err, order) => {
        if (err || !order?.id) {
          console.error("Order create failed:", err);
          return res.status(500).json({ error: "Failed to create order" });
        }

        // IMPORTANT: must be public https URL, NOT localhost
        const base = (process.env.BASE_URL || "").replace(/\/$/, "");
        if (!base || base.includes("localhost")) {
          return res.status(500).json({
            error:
              "BASE_URL is not set to a public HTTPS URL. Set BASE_URL to your ngrok https URL (example: https://xxxx.ngrok-free.app).",
          });
        }

        const webhookUrl = `${base}/hitpay/webhook`;
        const redirectUrl = `${base}/hitpay/return?orderId=${encodeURIComponent(order.id)}`;

        // HitPay payload (PayNow online)
        const payload = {
          amount: total.toFixed(2),
          currency: "SGD",
          reference_number: `ORDER-${order.id}`,
          email: req.session.user?.email || "test@example.com",
          redirect_url: redirectUrl,
          webhook: webhookUrl,
          purpose: `Order #${order.id}`,
          payment_methods: ["paynow_online"],
        };

        try {
          const response = await hitpay().post("/v1/payment-requests", payload);

          // HitPay usually returns a hosted URL to redirect user to
          // (field name can be "url" depending on API version)
          const payUrl = response.data?.url || response.data?.payment_url;

          if (!payUrl) {
            console.error("HitPay response missing url:", response.data);
            return res.status(500).json({ error: "HitPay did not return a payment URL" });
          }

          OrderModel.logPaymentEvent(order.id, 'hitpay', 'payment_initiated', 'pending', null);

          return res.json({ url: payUrl, orderId: order.id });
        } catch (e) {
          // Print the useful part (HitPay validation errors)
          console.error("HitPay API error:", e?.response?.data || e.message);
          OrderModel.logPaymentEvent(order.id, 'hitpay', 'payment_failed', 'failed', { message: e?.message || 'HitPay rejected' });
          return res.status(400).json({
            error: "HitPay rejected the request",
            details: e?.response?.data || null,
          });
        }
      }
    );
  } catch (e) {
    console.error("Create payment error:", e);
    return res.status(500).json({ error: "Failed to create payment" });
  }
});

// Retry PayNow payment for an existing pending order
router.post("/retry/:id", async (req, res) => {
  try {
    const orderId = req.params.id;
    if (!orderId) return res.status(400).json({ error: "Missing orderId" });

    OrderModel.getOrderById(orderId, async (err, order) => {
      if (err || !order) return res.status(404).json({ error: "Order not found" });
      if (String(order.status || '').toLowerCase() === 'paid') {
        return res.status(409).json({ error: "Order already paid" });
      }

      const base = (process.env.BASE_URL || "").replace(/\/$/, "");
      if (!base || base.includes("localhost")) {
        return res.status(500).json({
          error:
            "BASE_URL is not set to a public HTTPS URL. Set BASE_URL to your ngrok https URL (example: https://xxxx.ngrok-free.app).",
        });
      }

      const webhookUrl = `${base}/hitpay/webhook`;
      const redirectUrl = `${base}/hitpay/return?orderId=${encodeURIComponent(order.id)}`;

      const payload = {
        amount: Number(order.total || (order.subtotal + order.deliveryCost)).toFixed(2),
        currency: "SGD",
        reference_number: `ORDER-${order.id}`,
        email: order.payer_email || req.session?.user?.email || "test@example.com",
        redirect_url: redirectUrl,
        webhook: webhookUrl,
        purpose: `Order #${order.id}`,
        payment_methods: ["paynow_online"],
      };

      try {
        const response = await hitpay().post("/v1/payment-requests", payload);
        const payUrl = response.data?.url || response.data?.payment_url;
        if (!payUrl) {
          console.error("HitPay response missing url:", response.data);
          return res.status(500).json({ error: "HitPay did not return a payment URL" });
        }
        OrderModel.logPaymentEvent(order.id, 'hitpay', 'payment_retry', 'pending', null);
        return res.json({ url: payUrl, orderId: order.id });
      } catch (e) {
        console.error("HitPay retry error:", e?.response?.data || e.message);
        return res.status(400).json({
          error: "HitPay rejected the request",
          details: e?.response?.data || null,
        });
      }
    });
  } catch (e) {
    console.error("Retry payment error:", e);
    return res.status(500).json({ error: "Failed to retry payment" });
  }
});

// --------------------
// 2) Return URL after user completes payment on HitPay page
// GET /hitpay/return?reference_number=ORDER-123...
// --------------------
router.get("/return", (req, res) => {
  const directOrderId = String(req.query.orderId || '').trim();
  if (directOrderId) {
    if (req.session) req.session.lastOrderId = directOrderId;
    return res.redirect("/orders/" + encodeURIComponent(directOrderId) + "?public=1");
  }

  // HitPay usually includes reference_number in query params
  const ref = String(
    req.query.reference_number ||
      req.query.reference ||
      req.query.referenceNumber ||
      req.query.order_id ||
      ""
  );
  const orderId = ref.replace("ORDER-", "");

  if (orderId) {
    if (req.session) req.session.lastOrderId = orderId;
    return res.redirect("/orders/" + encodeURIComponent(orderId) + "?public=1");
  }

  return res.redirect("/orders");
});

// --------------------
// 3) Webhook (server-to-server) confirms payment status
// POST /hitpay/webhook
// --------------------
router.post("/webhook", (req, res) => {
  try {
    const signature = req.headers["x-hitpay-signature"];
    const raw = req.rawBody; // we will set this in app.js

    if (!raw) {
      return res.status(400).send("Missing raw body. Configure express.json verify() in app.js.");
    }
    if (!process.env.HITPAY_SALT) {
      return res.status(500).send("Missing HITPAY_SALT in .env");
    }

    const expected = crypto
      .createHmac("sha256", process.env.HITPAY_SALT)
      .update(raw)
      .digest("hex");

    if (!signature || signature !== expected) {
      console.error("Invalid HitPay signature");
      return res.status(401).send("Invalid signature");
    }

    const data = JSON.parse(raw.toString("utf8"));

    // HitPay docs: webhook status often "completed" for success
    if (String(data.status || "").toLowerCase() !== "completed") {
      return res.send("IGNORED");
    }

    const ref = String(data.reference_number || "");
    const orderId = ref.replace("ORDER-", "");
    if (!orderId) return res.send("NO ORDER");

    OrderModel.getOrderById(orderId, (err, order) => {
      if (err || !order) return res.send("NO ORDER");
      if (String(order.status || '').toLowerCase() === 'paid') return res.send("OK");

      OrderModel.markOrderPaid(
        orderId,
        data.payment_request_id || null,
        data.payment_id || null,
        data.email || data.customer_email || null,
        (err2, updated) => {
          if (err2) return res.status(500).send("ERROR");
          const paidOrder = updated || order;
          OrderModel.deductStockForOrder(paidOrder, () => {
            addReceiptNotification(paidOrder);
            res.send("OK");
          });
        }
      );
    });
  } catch (e) {
    console.error("HitPay webhook error:", e);
    res.status(500).send("ERROR");
  }
});

module.exports = router;
