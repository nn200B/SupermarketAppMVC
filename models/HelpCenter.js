// HelpCenter model: wraps refund and address-change request operations using shared inMemory store

let store = null; // injected from app.js

function init(inMemory) {
  store = inMemory;
}

function getStore() {
  if (!store) throw new Error('HelpCenter store not initialised');
  return store;
}

// Refunds
function addRefundRequest(data, cb) {
  const s = getStore();
  const r = {
    id: s.nextRefundId++,
    userId: data.userId,
    username: data.username,
    orderId: data.orderId,
    reason: data.reason,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  s.refundRequests.push(r);
  if (typeof s.persistStore === 'function') s.persistStore(() => cb && cb(null, r));
  else if (cb) cb(null, r);
}

function updateRefundStatus(id, status, cb) {
  const s = getStore();
  const r = (s.refundRequests || []).find(x => String(x.id) === String(id));
  if (!r) return cb && cb(new Error('Refund not found'));
  r.status = status;
  r.updatedAt = new Date().toISOString();
  if (typeof s.persistStore === 'function') s.persistStore(() => cb && cb(null, r));
  else if (cb) cb(null, r);
}

function getRefunds(cb) {
  const s = getStore();
  const list = (s.refundRequests || []).slice().reverse();
  if (cb) cb(null, list);
}

// Address change
function addAddressChangeRequest(data, cb) {
  const s = getStore();
  const r = {
    id: s.nextAddressChangeId++,
    userId: data.userId,
    username: data.username,
    orderId: data.orderId,
    newAddress: data.newAddress,
    reason: data.reason,
    status: 'submitted',
    createdAt: new Date().toISOString()
  };
  s.addressChangeRequests.push(r);
  if (typeof s.persistStore === 'function') s.persistStore(() => cb && cb(null, r));
  else if (cb) cb(null, r);
}

function getAddressChangeRequests(cb) {
  const s = getStore();
  const list = (s.addressChangeRequests || []).slice().reverse();
  if (cb) cb(null, list);
}

function updateAddressChangeStatus(id, status, cb) {
  const s = getStore();
  const r = (s.addressChangeRequests || []).find(x => String(x.id) === String(id));
  if (!r) return cb && cb(new Error('Address change not found'));
  r.status = status;
  r.updatedAt = new Date().toISOString();
  if (typeof s.persistStore === 'function') s.persistStore(() => cb && cb(null, r));
  else if (cb) cb(null, r);
}

module.exports = {
  init,
  addRefundRequest,
  updateRefundStatus,
  getRefunds,
  addAddressChangeRequest,
  getAddressChangeRequests,
  updateAddressChangeStatus
};
