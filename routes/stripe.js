const express = require("express");
const router = express.Router();
const { stripe } = require("../stripeClient");
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

function getUserIdFromSession(req) {
  return req.session && req.session.user && (req.session.user.id || req.session.user.userId);
}

function computeTotalsFromSession(req) {
  const baseCart = req.session.cart || [];
  const cart =
    Array.isArray(req.session.selectedCartItems) && req.session.selectedCartItems.length
      ? req.session.selectedCartItems
      : baseCart;

  if (!cart || cart.length === 0) return { error: "Cart is empty" };
  if (!req.session.delivery) return { error: "Missing delivery details" };

  const subtotal = cart.reduce(
    (s, it) => s + Number(it.price || 0) * Number(it.quantity || 0),
    0
  );

  const deliveryOption = req.session.deliveryOption || "normal";
  let deliveryCost = 10;

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

router.post("/create-checkout-session", async (req, res) => {
  try {
    const userId = getUserIdFromSession(req);
    if (!userId) return res.status(401).json({ error: "Not logged in" });

    if (req.body && req.body.deliveryOption) {
      req.session.deliveryOption = req.body.deliveryOption;
    }

    const totals = computeTotalsFromSession(req);
    if (totals.error) return res.status(400).json({ error: totals.error });

    const { cart, subtotal, deliveryOption, deliveryCost, total } = totals;

    const pendingOrder = {
      userId,
      items: cart.slice(),
      subtotal,
      deliveryOption,
      deliveryCost,
      total,
      paymentMethod: "stripe",
      status: "pending_payment",
      deliveryStatus: "processing",
      delivery: req.session.delivery || null,
    };

    OrderModel.addOrder(pendingOrder, async (err, created) => {
      if (err || !created || !created.id) {
        console.error("Failed to create pending order:", err);
        return res.status(500).json({ error: "Failed to create pending order" });
      }

      req.session.stripePendingOrderId = created.id;

      const amountInCents = Math.round(Number(total) * 100);
      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;

      const session = await stripe().checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "sgd",
              unit_amount: amountInCents,
              product_data: { name: `Supermarket Order #${created.id}` },
            },
          },
        ],
        metadata: {
          localOrderId: String(created.id),
          userId: String(userId),
        },
        success_url: `${baseUrl}/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/stripe/cancel`,
      });

      OrderModel.logPaymentEvent(created.id, 'stripe', 'payment_initiated', 'pending', null);

      return res.json({ url: session.url });
    });
  } catch (e) {
    console.error("Stripe create session error:", e?.raw?.message || e?.message || e);
    return res.status(500).json({
      error: "Failed to create Stripe session",
      details: e?.raw?.message || e?.message || "Unknown Stripe error"
    });
  }
});

// Retry Stripe payment for an existing pending order
router.post("/retry/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: "Missing orderId" });

    OrderModel.getOrderById(id, async (err, order) => {
      if (err || !order) return res.status(404).json({ error: "Order not found" });
      if (String(order.status || '').toLowerCase() === 'paid') {
        return res.status(409).json({ error: "Order already paid" });
      }

      const amountInCents = Math.round(Number(order.total || (order.subtotal + order.deliveryCost)) * 100);
      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;

      const session = await stripe().checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "sgd",
              unit_amount: amountInCents,
              product_data: { name: `Supermarket Order #${order.id}` },
            },
          },
        ],
        metadata: {
          localOrderId: String(order.id),
          userId: String(order.userId),
        },
        success_url: `${baseUrl}/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/stripe/cancel`,
      });

      if (req.session) req.session.stripePendingOrderId = order.id;
      OrderModel.logPaymentEvent(order.id, 'stripe', 'payment_retry', 'pending', null);
      return res.json({ url: session.url });
    });
  } catch (e) {
    console.error("Stripe retry error:", e?.raw?.message || e?.message || e);
    return res.status(500).json({ error: "Failed to retry Stripe payment" });
  }
});

router.get("/success", async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId) return res.status(400).send("Missing session_id");

    const s = await stripe().checkout.sessions.retrieve(sessionId);

    if (s.payment_status !== "paid") {
      return res.status(400).send("Payment not completed");
    }

    const localOrderId = req.session?.stripePendingOrderId || s.metadata?.localOrderId;
    if (!localOrderId) return res.status(400).send("Missing local order reference");

    OrderModel.getOrderById(localOrderId, (err, order) => {
      if (err || !order) return res.status(404).send("Local order not found");

      if (String(order.status).toLowerCase() === "paid") {
        if (req.session) {
          req.session.lastOrderId = localOrderId;
          req.session.stripePendingOrderId = null;
        }
        return res.redirect("/orders/" + encodeURIComponent(localOrderId) + "?public=1");
      }

      const payerEmail = s.customer_details?.email || null;

      OrderModel.markOrderPaid(
        localOrderId,
        `stripe_session_${sessionId}`,
        `stripe_pi_${s.payment_intent}`,
        payerEmail,
        (err2) => {
          if (err2) {
            console.error("Failed to mark order paid:", err2);
            return res.status(500).send("Failed to update order");
          }
          OrderModel.deductStockForOrder(order, (deductErr) => {
            if (deductErr) console.error("Failed to deduct stock (Stripe):", deductErr);

            addReceiptNotification(order);

            if (req.session) {
              if (Array.isArray(req.session.selectedCartItems) && req.session.selectedCartItems.length) {
                const selectedIds = new Set(req.session.selectedCartItems.map(it => String(it.productId)));
                req.session.cart = (req.session.cart || []).filter(it => !selectedIds.has(String(it.productId)));
                req.session.selectedCartItems = [];
              } else {
                req.session.cart = [];
              }

              req.session.lastOrderId = localOrderId;
              req.session.stripePendingOrderId = null;
            }
            return res.redirect("/orders/" + encodeURIComponent(localOrderId) + "?public=1");
          });
        }
      );
    });
  } catch (e) {
    console.error("Stripe success error:", e);
    return res.status(500).send("Stripe success handling failed");
  }
});

router.get("/cancel", (req, res) => {
  req.flash("error", "Stripe payment cancelled.");
  return res.redirect("/checkout");
});

module.exports = router;
