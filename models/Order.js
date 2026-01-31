const connection = require('../db');

let store = null;

function init(inMemory) {
    store = inMemory;
    if (!Array.isArray(store.orders)) store.orders = [];
    if (!store.nextOrderId) store.nextOrderId = 1;
}

function ensureStore() {
    if (!store) throw new Error('Order store not initialised');
}

function usingDb() {
    return String(process.env.SKIP_DB || '').toLowerCase() !== 'true';
}

function mapOrderRows(rows) {
    const map = new Map();
    (rows || []).forEach(r => {
        let o = map.get(r.id);
        if (!o) {
            o = {
                id: r.id,
                userId: r.userId,
                subtotal: Number(r.subtotal || 0),
                deliveryOption: r.deliveryOption,
                deliveryCost: Number(r.deliveryCost || 0),
                total: Number(r.total || 0),
                paymentMethod: r.paymentMethod,
                status: r.status,
                deliveryStatus: r.deliveryStatus,
                createdAt: r.createdAt,
                items: []
            };
            map.set(r.id, o);
        }
        if (r.itemId) {
            o.items.push({
                id: r.itemId,
                productId: r.productId,
                productName: r.productName,
                price: Number(r.price || 0),
                quantity: Number(r.quantity || 0)
            });
        }
    });
    return Array.from(map.values());
}

function logPaymentEvent(orderId, gateway, eventType, status, details, cb) {
    const safeGateway = gateway || 'unknown';
    const safeEvent = eventType || 'event';
    const safeStatus = status || 'unknown';
    const detailStr = details ? JSON.stringify(details) : null;

    if (!usingDb()) {
        ensureStore();
        if (!Array.isArray(store.paymentLogs)) store.paymentLogs = [];
        if (!store.nextPaymentLogId) store.nextPaymentLogId = 1;
        store.paymentLogs.push({
            id: store.nextPaymentLogId++,
            orderId: orderId,
            gateway: safeGateway,
            eventType: safeEvent,
            status: safeStatus,
            details: detailStr,
            createdAt: new Date().toISOString()
        });
        if (typeof store.persistStore === 'function') {
            store.persistStore(() => cb && cb(null, { ok: true }));
        } else {
            cb && cb(null, { ok: true });
        }
        return;
    }

    const sql = 'INSERT INTO payment_logs (orderId, gateway, eventType, status, details) VALUES (?, ?, ?, ?, ?)';
    connection.query(sql, [orderId, safeGateway, safeEvent, safeStatus, detailStr], (err) => {
        if (err) return cb && cb(err);
        return cb && cb(null, { ok: true });
    });
}

function addOrder(order, cb) {
    if (!usingDb()) {
        ensureStore();
        const o = Object.assign({}, order);
        if (!store.nextOrderId) store.nextOrderId = 1;
        if (!Array.isArray(store.orders)) store.orders = [];

        o.id = store.nextOrderId++;
        o.createdAt = new Date().toISOString();
        o.status = o.status || 'PENDING'; // PAID or PENDING
        o.paid_at = o.paid_at || null;
        o.paypal_order_id = o.paypal_order_id || null;
        o.paypal_capture_id = o.paypal_capture_id || null;
        o.payer_email = o.payer_email || null;
        o.deliveryStatus = o.deliveryStatus || 'processing';

        store.orders.push(o);

            logPaymentEvent(o.id, o.paymentMethod || 'card', 'order_created', o.status, { total: o.total });

        if (typeof store.persistStore === 'function') {
            store.persistStore(() => cb && cb(null, o));
        } else {
            cb && cb(null, o);
        }
        return;
    }

    const createdAt = new Date();
    const o = Object.assign({}, order, {
        createdAt: createdAt.toISOString(),
        status: order.status || 'pending_payment',
        deliveryStatus: order.deliveryStatus || 'processing'
    });

    const insertOrderSql =
        'INSERT INTO orders (userId, subtotal, deliveryOption, deliveryCost, total, paymentMethod, status, deliveryStatus, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';

    const params = [
        o.userId,
        o.subtotal,
        o.deliveryOption || 'normal',
        o.deliveryCost,
        o.total,
        o.paymentMethod || 'card',
        o.status,
        o.deliveryStatus,
        createdAt
    ];

    connection.query(insertOrderSql, params, (err, result) => {
        if (err) return cb && cb(err);
        const orderId = result.insertId;
        o.id = orderId;

        const items = Array.isArray(o.items) ? o.items : [];
        const gateway = o.paymentMethod || 'card';
        logPaymentEvent(orderId, gateway, 'order_created', o.status, { total: o.total });

        if (!items.length) {
            return cb && cb(null, o);
        }

        const values = items.map(it => [
            orderId,
            Number(it.productId || it.id || 0),
            it.productName || it.name || 'Item',
            Number(it.price || 0),
            Number(it.quantity || 0)
        ]);

        connection.query(
            'INSERT INTO order_items (orderId, productId, productName, price, quantity) VALUES ?',
            [values],
            (err2) => {
                if (err2) return cb && cb(err2);
                return cb && cb(null, o);
            }
        );
    });
}

function markOrderPaid(orderId, paypalOrderId, paypalCaptureId, payerEmail, cb) {
    if (!usingDb()) {
        ensureStore();
        const o = (store.orders || []).find(x => String(x.id) === String(orderId));
        if (!o) return cb && cb(new Error('Order not found'));
        if (String(o.status || '').toLowerCase() === 'paid') {
            return cb && cb(null, o);
        }
        o.status = 'paid';
        o.paid_at = new Date().toISOString();
        o.paypal_order_id = paypalOrderId;
        o.paypal_capture_id = paypalCaptureId;
        o.payer_email = payerEmail;
        logPaymentEvent(o.id, o.paymentMethod || 'card', 'payment_succeeded', 'paid', null);
        if (typeof store.persistStore === 'function') {
            store.persistStore(() => cb && cb(null, o));
        } else {
            cb && cb(null, o);
        }
        return;
    }

    getOrderById(orderId, (err, current) => {
        if (err || !current) return cb && cb(err || new Error('Order not found'));
        if (String(current.status || '').toLowerCase() === 'paid') {
            return cb && cb(null, current);
        }
        const sql = 'UPDATE orders SET status = ?, paymentMethod = COALESCE(paymentMethod, ?), deliveryStatus = COALESCE(deliveryStatus, ?) WHERE id = ?';
        connection.query(sql, ['paid', current.paymentMethod || 'card', 'processing', orderId], (err2) => {
            if (err2) return cb && cb(err2);
            logPaymentEvent(orderId, current.paymentMethod || 'card', 'payment_succeeded', 'paid', null);
            return getOrderById(orderId, cb);
        });
    });
}

function getOrdersByUser(userId, cb) {
    if (!usingDb()) {
        ensureStore();
        const list = (store.orders || []).filter(o => String(o.userId) === String(userId)).slice().reverse();
        cb && cb(null, list);
        return;
    }

    const sql =
        'SELECT o.*, i.id AS itemId, i.productId, i.productName, i.price, i.quantity ' +
        'FROM orders o ' +
        'LEFT JOIN order_items i ON o.id = i.orderId ' +
        'WHERE o.userId = ? ' +
        'ORDER BY o.id DESC, i.id ASC';

    connection.query(sql, [userId], (err, rows) => {
        if (err) return cb && cb(err);
        return cb && cb(null, mapOrderRows(rows));
    });
}

function getAllOrders(cb) {
    if (!usingDb()) {
        ensureStore();
        const list = (store.orders || []).slice().reverse();
        cb && cb(null, list);
        return;
    }

    const sql =
        'SELECT o.*, i.id AS itemId, i.productId, i.productName, i.price, i.quantity ' +
        'FROM orders o ' +
        'LEFT JOIN order_items i ON o.id = i.orderId ' +
        'ORDER BY o.id DESC, i.id ASC';

    connection.query(sql, (err, rows) => {
        if (err) return cb && cb(err);
        return cb && cb(null, mapOrderRows(rows));
    });
}

function getOrderById(id, cb) {
    if (!usingDb()) {
        ensureStore();
        const o = (store.orders || []).find(x => String(x.id) === String(id)) || null;
        cb && cb(null, o);
        return;
    }

    const sql =
        'SELECT o.*, i.id AS itemId, i.productId, i.productName, i.price, i.quantity ' +
        'FROM orders o ' +
        'LEFT JOIN order_items i ON o.id = i.orderId ' +
        'WHERE o.id = ? ' +
        'ORDER BY i.id ASC';

    connection.query(sql, [id], (err, rows) => {
        if (err) return cb && cb(err);
        const list = mapOrderRows(rows);
        return cb && cb(null, list[0] || null);
    });
}

function updateOrderStatus(orderId, newStatus, cb) {
    if (!usingDb()) {
        ensureStore();
        const o = (store.orders || []).find(x => String(x.id) === String(orderId));
        if (!o) return cb && cb(new Error('Order not found'));
        o.deliveryStatus = newStatus;
        if (!o.history) o.history = [];
        o.history.push({ status: newStatus, at: new Date().toISOString() });

        if (typeof store.persistStore === 'function') {
            store.persistStore(() => cb && cb(null, o));
        } else {
            cb && cb(null, o);
        }
        return;
    }

    const sql = 'UPDATE orders SET deliveryStatus = ? WHERE id = ?';
    connection.query(sql, [newStatus, orderId], (err) => {
        if (err) return cb && cb(err);
        return getOrderById(orderId, cb);
    });
}

function deductStockForOrder(order, cb) {
    if (!order || !Array.isArray(order.items)) return cb && cb(null, { ok: true });

    if (!usingDb()) {
        ensureStore();
        const products = store.products || [];
        (order.items || []).forEach(item => {
            const pid = item.productId || item.id;
            const qty = Number(item.quantity) || 0;
            if (!pid || qty <= 0) return;
            const p = products.find(x => String(x.id) === String(pid));
            if (!p) return;
            const current = Number(p.quantity || 0);
            p.quantity = Math.max(current - qty, 0);
        });
        if (typeof store.persistStore === 'function') {
            store.persistStore(() => cb && cb(null, { ok: true }));
        } else {
            cb && cb(null, { ok: true });
        }
        return;
    }

    const items = order.items || [];
    if (!items.length) return cb && cb(null, { ok: true });

    let pending = items.length;
    let failed = false;
    items.forEach(item => {
        const pid = item.productId || item.id;
        const qty = Number(item.quantity) || 0;
        if (!pid || qty <= 0) {
            pending -= 1;
            if (pending === 0 && !failed) cb && cb(null, { ok: true });
            return;
        }
        const sql = 'UPDATE products SET quantity = GREATEST(quantity - ?, 0) WHERE id = ?';
        connection.query(sql, [qty, pid], (err) => {
            if (err && !failed) {
                failed = true;
                return cb && cb(err);
            }
            pending -= 1;
            if (pending === 0 && !failed) cb && cb(null, { ok: true });
        });
    });
}

function getPaymentLogs(cb) {
    if (!usingDb()) {
        ensureStore();
        const list = (store.paymentLogs || []).slice().reverse();
        return cb && cb(null, list);
    }
    const sql = 'SELECT * FROM payment_logs ORDER BY id DESC';
    connection.query(sql, (err, rows) => {
        if (err) return cb && cb(err);
        return cb && cb(null, rows || []);
    });
}

module.exports = {
    init,
    addOrder,
    getOrdersByUser,
    getAllOrders,
    getOrderById,
    updateOrderStatus,
    markOrderPaid,
    logPaymentEvent,
    deductStockForOrder,
    getPaymentLogs
};
