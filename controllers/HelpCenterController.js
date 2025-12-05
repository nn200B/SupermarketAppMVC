// HelpCenterController: user and admin help center flows

const HelpCenter = require('../models/HelpCenter');
const Notification = require('../models/Notification');

// This controller assumes app.js still provides getUserIdFromSessionUser and getOrdersByUser

module.exports = {
  // User help center main page
  userIndex(getUserIdFromSessionUser, getOrdersByUser) {
    return (req, res) => {
      const userId = getUserIdFromSessionUser(req.session.user);
      getOrdersByUser(userId, (err, orders) => {
        if (err) {
          console.error('Failed to load orders for help center:', err);
          req.flash('error', 'Could not load orders');
          return res.redirect('/orders');
        }
        const eligibleAddressOrders = (orders || []).filter(o => {
          const status = (o.deliveryStatus || '').toLowerCase();
          return status === 'packed' || status === 'item packed';
        });
        const refundableOrders = (orders || []).filter(o => (o.status || '').toLowerCase() === 'paid');
        const errors = req.flash('error');
        const success = req.flash('success');
        res.render('help_center', {
          user: req.session.user,
          eligibleAddressOrders,
          refundableOrders,
          errors,
          success
        });
      });
    };
  },

  submitAddressChange(getUserIdFromSessionUser, getOrdersByUser) {
    return (req, res) => {
      const userId = getUserIdFromSessionUser(req.session.user);
      const { orderId, newAddress, reason } = req.body || {};
      if (!orderId || !newAddress) {
        req.flash('error', 'Please select an order and provide a new address.');
        return res.redirect('/help-center');
      }
      getOrdersByUser(userId, (err, orders) => {
        if (err) {
          console.error('Failed to load orders for address change:', err);
          req.flash('error', 'Could not submit request');
          return res.redirect('/help-center');
        }
        const order = (orders || []).find(o => String(o.id) === String(orderId));
        if (!order) {
          req.flash('error', 'Order not found.');
          return res.redirect('/help-center');
        }
        const status = (order.deliveryStatus || '').toLowerCase();
        if (status !== 'packed' && status !== 'item packed') {
          req.flash('error', 'Address change is only allowed when the order status is "item packed".');
          return res.redirect('/help-center');
        }
        HelpCenter.addAddressChangeRequest({
          userId,
          username: req.session.user.username,
          orderId: order.id,
          newAddress,
          reason
        }, (e) => {
          if (e) {
            console.error('Failed to save address change request:', e);
            req.flash('error', 'Could not submit request. Please try again.');
          } else {
            req.flash('success', 'Address change request submitted. Our team will review it.');
            // Notify admin and user
            Notification.addNotification({
              role: 'admin',
              type: 'address',
              message: `New address change request for order #${order.id} from ${req.session.user.username}.`,
              link: '/admin/help-center'
            });
            Notification.addNotification({
              role: 'user',
              userId,
              type: 'address',
              message: `Your address change request for order #${order.id} has been submitted.`,
              link: '/help-center'
            });
          }
          return res.redirect('/help-center');
        });
      });
    };
  },

  submitRefund(getUserIdFromSessionUser, getOrdersByUser) {
    return (req, res) => {
      const userId = getUserIdFromSessionUser(req.session.user);
      const { orderId, reason } = req.body || {};
      if (!orderId || !reason) {
        req.flash('error', 'Please select an order and provide a reason for refund.');
        return res.redirect('/help-center');
      }
      getOrdersByUser(userId, (err, orders) => {
        if (err) {
          console.error('Failed to load orders for refund:', err);
          req.flash('error', 'Could not submit request');
          return res.redirect('/help-center');
        }
        const order = (orders || []).find(o => String(o.id) === String(orderId));
        if (!order) {
          req.flash('error', 'Order not found.');
          return res.redirect('/help-center');
        }
        if ((order.status || '').toLowerCase() !== 'paid') {
          req.flash('error', 'Only paid orders can be refunded.');
          return res.redirect('/help-center');
        }
        HelpCenter.addRefundRequest({
          userId,
          username: req.session.user.username,
          orderId: order.id,
          reason
        }, (e) => {
          if (e) {
            console.error('Failed to save refund request:', e);
            req.flash('error', 'Could not submit refund request.');
          } else {
            req.flash('success', 'Refund request submitted. We will notify you once it is reviewed.');
            Notification.addNotification({
              role: 'admin',
              type: 'refund',
              message: `New refund request for order #${order.id} from ${req.session.user.username}.`,
              link: '/admin/help-center'
            });
            Notification.addNotification({
              role: 'user',
              userId,
              type: 'refund',
              message: `Your refund request for order #${order.id} has been submitted.`,
              link: '/help-center'
            });
          }
          return res.redirect('/help-center');
        });
      });
    };
  },

  // Admin help center list
  adminIndex() {
    return (req, res) => {
      HelpCenter.getRefunds((rErr, refunds) => {
        if (rErr) {
          console.error('Failed to load refunds:', rErr);
        }
        HelpCenter.getAddressChangeRequests((aErr, addressChanges) => {
          if (aErr) {
            console.error('Failed to load address changes:', aErr);
          }
          res.render('admin_help_center', {
            user: req.session.user,
            refunds: refunds || [],
            addressChanges: addressChanges || [],
            errors: req.flash('error'),
            success: req.flash('success')
          });
        });
      });
    };
  }
};
