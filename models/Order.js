let store = null;

function init(inMemory) {
    store = inMemory;
    if (!Array.isArray(store.orders)) store.orders = [];
    if (!store.nextOrderId) store.nextOrderId = 1;
}

function ensureStore() {
    if (!store) throw new Error('Order store not initialised');
}

function addOrder(order, cb) {
    ensureStore();
    const o = Object.assign({}, order);
    if (!store.nextOrderId) store.nextOrderId = 1;
    if (!Array.isArray(store.orders)) store.orders = [];

    o.id = store.nextOrderId++;
    o.createdAt = new Date().toISOString();
    o.status = o.status || 'paid';
    o.deliveryStatus = o.deliveryStatus || 'processing';

    store.orders.push(o);

    if (typeof store.persistStore === 'function') {
        store.persistStore(() => cb && cb(null, o));
    } else {
        cb && cb(null, o);
    }
}

function getOrdersByUser(userId, cb) {
    ensureStore();
    const list = (store.orders || []).filter(o => String(o.userId) === String(userId)).slice().reverse();
    cb && cb(null, list);
}

function getAllOrders(cb) {
    ensureStore();
    const list = (store.orders || []).slice().reverse();
    cb && cb(null, list);
}

function getOrderById(id, cb) {
    ensureStore();
    const o = (store.orders || []).find(x => String(x.id) === String(id)) || null;
    cb && cb(null, o);
}

function updateOrderStatus(orderId, newStatus, cb) {
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
}

module.exports = {
    init,
    addOrder,
    getOrdersByUser,
    getAllOrders,
    getOrderById,
    updateOrderStatus
};
