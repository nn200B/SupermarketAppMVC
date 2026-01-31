const Order = require('../models/Order');
const Notification = require('../models/Notification');

function estimateDeliveryDate(createdAtIso, deliveryOption) {
    try {
        const created = new Date(createdAtIso || new Date().toISOString());
        const addBusinessDays = (date, days) => {
            const d = new Date(date);
            let added = 0;
            while (added < days) {
                d.setDate(d.getDate() + 1);
                const day = d.getDay();
                if (day !== 0 && day !== 6) added++;
            }
            return d;
        };

        if (deliveryOption === 'one-day') {
            return addBusinessDays(created, 1).toISOString();
        }
        return addBusinessDays(created, 3).toISOString();
    } catch (e) {
        return new Date().toISOString();
    }
}

function listUserOrders(getUserIdFromSessionUser) {
    return (req, res) => {
        const uid = getUserIdFromSessionUser(req.session.user);
        Order.getOrdersByUser(uid, (err, orders) => {
            if (err) {
                console.error('Failed to fetch orders:', err);
            }

            const safeOrders = (orders || []).map(o => {
                o.estimatedDelivery = estimateDeliveryDate(o.createdAt, o.deliveryOption);
                return o;
            });

            return res.render('orders', { orders: safeOrders, user: req.session.user });
        });
    };
}

function userOrderDetail(getUserIdFromSessionUser) {
    return (req, res) => {
        const id = req.params.id;
        const isPublic = String(req.query.public || '') === '1';
        const uid = getUserIdFromSessionUser(req.session.user);
        Order.getOrderById(id, (err, o) => {
            if (err) {
                console.error('Failed to fetch order:', err);
                return res.status(500).send('Server error');
            }
            if (!o) return res.status(404).send('Order not found');
            if (!isPublic && String(o.userId) !== String(uid) && !(req.session.user && req.session.user.role === 'admin')) {
                return res.status(403).send('Access denied');
            }
            o.estimatedDelivery = estimateDeliveryDate(o.createdAt, o.deliveryOption);
            res.render('order_detail', { order: o, user: req.session.user });
        });
    };
}

function adminListOrders() {
    return (req, res) => {
        Order.getAllOrders((err, orders) => {
            if (err) {
                console.error('Failed to fetch all orders:', err);
            }

            const safeOrders = (orders || []).map(o => {
                o.estimatedDelivery = estimateDeliveryDate(o.createdAt, o.deliveryOption);
                return o;
            });

            const errors = req.flash('error');
            const success = req.flash('success');
            return res.render('admin_orders', { orders: safeOrders, user: req.session.user, errors, success });
        });
    };
}

function adminUpdateStatus() {
    return (req, res) => {
        const id = req.params.id;
        const status = req.body.status;
        if (!status) return res.redirect('/admin/orders');
        Order.updateOrderStatus(id, status, (err, updated) => {
            if (err) {
                console.error('Failed to update order status:', err);
                req.flash('error', 'Could not update status. Please try again.');
            } else {
                req.flash('success', 'Status updated');

                // Notify the user about delivery status change
                try {
                    if (updated && updated.userId) {
                        Notification.addNotification({
                            role: 'user',
                            userId: updated.userId,
                            type: 'order-status',
                            message: `Your order #${updated.id} delivery status is now "${status}".`,
                            link: '/orders/' + encodeURIComponent(updated.id)
                        }, () => {});
                    }
                } catch (e) {
                    console.error('Failed to create notification for order status change:', e);
                }
            }
            return res.redirect('/admin/orders');
        });
    };
}

module.exports = {
    listUserOrders,
    userOrderDetail,
    adminListOrders,
    adminUpdateStatus,
    estimateDeliveryDate
};
