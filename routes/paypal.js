// routes/paypal.js
const express = require("express");
const router = express.Router();
const paypalClient = require("../paypalClient");
const checkoutSdk = require("@paypal/checkout-server-sdk");
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

// Helper: get userId from session
function getUserIdFromSession(req) {
  return req.session && req.session.user && (req.session.user.id || req.session.user.userId);
}

// Helper: calculate totals from session (same logic as your /checkout)
function computeTotalsFromSession(req) {
  const baseCart = req.session.cart || [];
  const cart =
    Array.isArray(req.session.selectedCartItems) && req.session.selectedCartItems.length
      ? req.session.selectedCartItems
      : baseCart;

  if (!cart || cart.length === 0) {
    return { error: "Cart is empty" };
  }
  if (!req.session.delivery) {
    return { error: "Missing delivery details" };
  }

  const subtotal = cart.reduce(
    (s, it) => s + Number(it.price || 0) * Number(it.quantity || 0),
    0
  );

  // default normal delivery
  const deliveryOption = req.session.deliveryOption || "normal";
  let deliveryCost = 10;

  // replicate your 1pm cutoff logic if needed:
  if (deliveryOption === "one-day") {
    const now = new Date();
    const cutoffHour = 13;
    if (now.getHours() >= cutoffHour) {
      return { error: "One-day delivery must be ordered before 1pm" };
    }
    deliveryCost = 25;
  }

  const total = Number(subtotal) + Number(deliveryCost);

  return { cart, subtotal, deliveryOption, deliveryCost, total };
}

// POST /paypal/create-order
router.post("/create-order", (req, res) => {
  const userId = getUserIdFromSession(req);
  if (!userId) return res.status(401).json({ error: "Not logged in" });

  // set deliveryOption from req if you have a selector on checkout page
  // (optional) allow client to send { deliveryOption } but DO NOT accept price from client.
  if (req.body && req.body.deliveryOption) {
    req.session.deliveryOption = req.body.deliveryOption;
  }

  const totals = computeTotalsFromSession(req);
  if (totals.error) return res.status(400).json({ error: totals.error });

  const { cart, subtotal, deliveryOption, deliveryCost, total } = totals;

  // Create a pending order locally BEFORE calling PayPal
  const pendingOrder = {
    userId,
    items: cart.slice(),
    subtotal,
    deliveryOption,
    deliveryCost,
    total,
    paymentMethod: "paypal",
    status: "pending_payment",
    deliveryStatus: "processing",
    delivery: req.session.delivery || null,
  };

  OrderModel.addOrder(pendingOrder, (err, created) => {
    if (err || !created || !created.id) {
      console.error("Failed to create pending order:", err);
      return res.status(500).json({ error: "Failed to create pending order" });
    }

    // Store pending order id in session so capture can finalize it
    req.session.paypalPendingOrderId = created.id;
    OrderModel.logPaymentEvent(created.id, 'paypal', 'payment_initiated', 'pending', null);

    const request = new checkoutSdk.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: String(created.id),
          description: `Supermarket Order #${created.id}`,
          amount: {
            currency_code: "SGD",
            value: Number(total).toFixed(2),
          },
        },
      ],
    });

    paypalClient
      .client()
      .execute(request)
      .then((paypalOrder) => res.json({ id: paypalOrder.result.id }))
      .catch((e) => {
        console.error("PayPal create order error:", e);
        OrderModel.logPaymentEvent(created.id, 'paypal', 'payment_failed', 'failed', { message: e?.message || 'create order failed' });
        return res.status(500).json({ error: "Failed to create PayPal order" });
      });
  });
});

// POST /paypal/capture-order
router.post("/capture-order", (req, res) => {
  const { orderID } = req.body || {};
  const userId = getUserIdFromSession(req);
  if (!orderID) return res.status(400).json({ error: "Missing orderID" });
  if (!userId) return res.status(401).json({ error: "Not logged in" });

  const localOrderId = req.session.paypalPendingOrderId;
  if (!localOrderId) return res.status(400).json({ error: "No pending PayPal order in session" });

  OrderModel.getOrderById(localOrderId, (err, order) => {
    if (err || !order) return res.status(404).json({ error: "Local order not found" });
    if (String(order.userId) !== String(userId)) return res.status(403).json({ error: "Forbidden" });

    // prevent duplicates
    if (String(order.status).toLowerCase() === "paid") {
      return res.status(409).json({ error: "Order already paid" });
    }

    const request = new checkoutSdk.orders.OrdersCaptureRequest(orderID);
    request.requestBody({});

    paypalClient
      .client()
      .execute(request)
      .then((capture) => {
        if (capture.result.status !== "COMPLETED") {
          return res.status(400).json({ error: "Payment not completed", details: capture.result });
        }

        const payerEmail = capture.result.payer?.email_address || null;

        // Get a real captureId if available
        const captureId =
          capture.result.purchase_units?.[0]?.payments?.captures?.[0]?.id || null;

        // Mark local order paid
        OrderModel.markOrderPaid(
          localOrderId,
          orderID,
          captureId,
          payerEmail,
          (err2) => {
            if (err2) {
              console.error("Failed to mark order paid:", err2);
              return res.status(500).json({ error: "Failed to update order as paid" });
            }
            OrderModel.deductStockForOrder(order, (deductErr) => {
              if (deductErr) console.error("Failed to deduct stock (PayPal):", deductErr);

              addReceiptNotification(order);

              // clear cart (same as your card branch)
              if (Array.isArray(req.session.selectedCartItems) && req.session.selectedCartItems.length) {
                const selectedIds = new Set(req.session.selectedCartItems.map(it => String(it.productId)));
                req.session.cart = (req.session.cart || []).filter(it => !selectedIds.has(String(it.productId)));
                req.session.selectedCartItems = [];
              } else {
                req.session.cart = [];
              }

              // cleanup
              req.session.lastOrderId = localOrderId;
              req.session.paypalPendingOrderId = null;

              return res.json({ ok: true, redirect: "/payment-processing" });
            });
          }
        );
      })
      .catch((e) => {
        console.error("PayPal capture error:", e);
        return res.status(500).json({ error: "Failed to capture PayPal order" });
      });
  });
});

// Retry PayPal payment for an existing pending order
router.post("/retry/:id", (req, res) => {
  const orderId = req.params.id;
  if (!orderId) return res.status(400).json({ error: "Missing orderId" });

  OrderModel.getOrderById(orderId, (err, order) => {
    if (err || !order) return res.status(404).json({ error: "Order not found" });
    if (String(order.status || '').toLowerCase() === 'paid') {
      return res.status(409).json({ error: "Order already paid" });
    }

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;

    const request = new checkoutSdk.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: String(order.id),
          description: `Supermarket Order #${order.id}`,
          amount: {
            currency_code: "SGD",
            value: Number(order.total || (order.subtotal + order.deliveryCost)).toFixed(2),
          },
        },
      ],
      application_context: {
        return_url: `${baseUrl}/paypal/return`,
        cancel_url: `${baseUrl}/paypal/cancel`,
      }
    });

    paypalClient
      .client()
      .execute(request)
      .then((paypalOrder) => {
        const approveLink = (paypalOrder.result.links || []).find(l => l.rel === 'approve');
        req.session.paypalPendingOrderId = order.id;
        OrderModel.logPaymentEvent(order.id, 'paypal', 'payment_retry', 'pending', null);
        return res.json({ url: approveLink ? approveLink.href : null, id: paypalOrder.result.id });
      })
      .catch((e) => {
        console.error("PayPal retry error:", e);
        return res.status(500).json({ error: "Failed to retry PayPal order" });
      });
  });
});

// PayPal return handler for retry flow (captures payment server-side)
router.get("/return", (req, res) => {
  const orderID = req.query.token;
  const localOrderId = req.session?.paypalPendingOrderId;
  if (!orderID || !localOrderId) return res.redirect("/orders");

  OrderModel.getOrderById(localOrderId, (err, order) => {
    if (err || !order) return res.redirect("/orders");
    if (String(order.status || '').toLowerCase() === 'paid') {
      if (req.session) req.session.paypalPendingOrderId = null;
      return res.redirect("/orders/" + encodeURIComponent(localOrderId) + "?public=1");
    }

    const request = new checkoutSdk.orders.OrdersCaptureRequest(orderID);
    request.requestBody({});

    paypalClient
      .client()
      .execute(request)
      .then((capture) => {
        if (capture.result.status !== "COMPLETED") {
          return res.redirect("/orders/" + encodeURIComponent(localOrderId) + "?public=1");
        }

        const payerEmail = capture.result.payer?.email_address || null;
        const captureId =
          capture.result.purchase_units?.[0]?.payments?.captures?.[0]?.id || null;

        OrderModel.markOrderPaid(
          localOrderId,
          orderID,
          captureId,
          payerEmail,
          (err2) => {
            if (err2) return res.redirect("/orders");

            OrderModel.deductStockForOrder(order, () => {
              addReceiptNotification(order);
              if (req.session) req.session.paypalPendingOrderId = null;
              return res.redirect("/orders/" + encodeURIComponent(localOrderId) + "?public=1");
            });
          }
        );
      })
      .catch(() => res.redirect("/orders"));
  });
});

router.get("/cancel", (req, res) => {
  return res.redirect("/checkout");
});

module.exports = router;
