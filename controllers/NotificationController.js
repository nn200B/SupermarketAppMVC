// NotificationController: handles /notifications page for both users and admins

const Notification = require('../models/Notification');

module.exports = {
  list(req, res) {
    if (!req.session || !req.session.user) {
      return res.redirect('/login');
    }
    // Normalise query parameters to safe strings
    const qParam = Array.isArray(req.query.q) ? req.query.q[0] : (req.query.q || '');
    const typeParam = Array.isArray(req.query.type) ? req.query.type[0] : (req.query.type || '');
    const tabParam = Array.isArray(req.query.tab) ? req.query.tab[0] : (req.query.tab || 'all');

    const rawQ = String(qParam || '').trim();
    const rawType = String(typeParam || '').trim();
    const tab = String(tabParam || 'all').toLowerCase(); // 'all' | 'unread' | 'read'

    Notification.getNotificationsForUser(req.session.user, (err, list) => {
      if (err) {
        console.error('Failed to load notifications:', err);
        req.flash('error', 'Could not load notifications');
        return res.redirect('/');
      }
      let filtered = list || [];

      // Tab filter: all / unread / read
      if (tab === 'unread') {
        filtered = filtered.filter(n => !n.read);
      } else if (tab === 'read') {
        filtered = filtered.filter(n => n.read);
      }

      // Keyword search on message text (case-insensitive)
      if (rawQ) {
        const qLower = rawQ.toLowerCase();
        filtered = filtered.filter(n => (n.message || '').toLowerCase().includes(qLower));
      }

      // Type/category filter (e.g., order, refund, address, help, info)
      if (rawType) {
        filtered = filtered.filter(n => (n.type || '').toLowerCase() === rawType.toLowerCase());
      }

      res.render('notifications', {
        user: req.session.user,
        notifications: filtered,
        errors: req.flash('error'),
        success: req.flash('success'),
        q: rawQ,
        type: rawType,
        tab: tab
      });
    });
  },

  // POST /notifications/mark-all-read
  markAllRead(req, res) {
    if (!req.session || !req.session.user) {
      return res.redirect('/login');
    }
    Notification.markAllForUserAsRead(req.session.user, (err) => {
      if (err) {
        console.error('Failed to mark notifications as read:', err);
        req.flash('error', 'Could not mark notifications as read.');
      } else {
        req.flash('success', 'All notifications marked as read.');
      }
      // Preserve current filters when redirecting back (normalise like list)
      const qParam = Array.isArray(req.query.q) ? req.query.q[0] : (req.query.q || '');
      const typeParam = Array.isArray(req.query.type) ? req.query.type[0] : (req.query.type || '');
      const tabParam = Array.isArray(req.query.tab) ? req.query.tab[0] : (req.query.tab || 'all');

      const q = String(qParam || '').trim();
      const type = String(typeParam || '').trim();
      const tab = String(tabParam || '').trim();
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (type) params.set('type', type);
      if (tab) params.set('tab', tab);
      const suffix = params.toString() ? ('?' + params.toString()) : '';
      return res.redirect('/notifications' + suffix);
    });
  }
};
