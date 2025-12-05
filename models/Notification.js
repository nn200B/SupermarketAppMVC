// Notification model: wraps in-memory notification operations from app.js style store

let store = null; // will be injected from app.js so we share the same inMemory object

function init(inMemory) {
  store = inMemory;
}

function getStore() {
  if (!store) throw new Error('Notification store not initialised');
  return store;
}

function addNotification(data, cb) {
  const s = getStore();
  const n = {
    id: s.nextNotificationId++,
    userId: data.userId || null,
    role: data.role || null,
    type: data.type || 'info',
    message: data.message || '',
    link: data.link || null,
    createdAt: new Date().toISOString(),
    read: false
  };
  s.notifications.push(n);
  if (typeof s.persistStore === 'function') s.persistStore(() => cb && cb(null, n));
  else if (cb) cb(null, n);
}

function getNotificationsForUser(user, cb) {
  const s = getStore();
  const uid = user && (user.id || user.userId);
  const role = user && user.role;
  const list = (s.notifications || []).filter(n => {
    if (role === 'admin') return n.role === 'admin';
    return n.role === 'user' && (n.userId == null || String(n.userId) === String(uid));
  }).slice().reverse();
  if (cb) cb(null, list);
}

function markNotificationRead(id, cb) {
  const s = getStore();
  const n = (s.notifications || []).find(x => String(x.id) === String(id));
  if (!n) return cb && cb(new Error('Notification not found'));
  n.read = true;
  n.readAt = new Date().toISOString();
  if (typeof s.persistStore === 'function') s.persistStore(() => cb && cb(null, n));
  else if (cb) cb(null, n);
}

function markAllForUserAsRead(user, cb) {
  const s = getStore();
  const uid = user && (user.id || user.userId);
  const role = user && user.role;
  const now = new Date().toISOString();

  (s.notifications || []).forEach(n => {
    const isTarget = (role === 'admin')
      ? (n.role === 'admin')
      : (n.role === 'user' && (n.userId == null || String(n.userId) === String(uid)));
    if (isTarget) {
      n.read = true;
      n.readAt = now;
    }
  });

  if (typeof s.persistStore === 'function') s.persistStore(() => cb && cb(null));
  else if (cb) cb(null);
}

module.exports = { init, addNotification, getNotificationsForUser, markNotificationRead, markAllForUserAsRead };
