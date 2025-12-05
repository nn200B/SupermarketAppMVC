const db = require('../db');

/**
 * User model (function-based)
 * Table: users
 * Columns (assumed): id (PK), email, password, role
 * Node-style callbacks: callback(err, result)
 */

module.exports = {
  // Admin: list all users
  getAllUsers: function(callback) {
    const sql = 'SELECT id, username, email, address, contact, role FROM users ORDER BY id ASC';
    db.query(sql, [], function(err, rows) {
      if (err) return callback(err);
      return callback(null, rows || []);
    });
  },

  // Admin: delete user by id
  deleteUserById: function(id, callback) {
    const sql = 'DELETE FROM users WHERE id = ?';
    db.query(sql, [id], function(err, result) {
      if (err) return callback(err);
      return callback(null, result);
    });
  },

  createUser: function(user, callback) {
    // user: { email, password, role }
    const sql = 'INSERT INTO users (email, password, role) VALUES (?, ?, ?)';
    db.query(sql, [user.email, user.password, user.role || 'customer'], function(err, result) {
      return callback(err, result);
    });
  },

  getUserByEmail: function(email, callback) {
    const sql = 'SELECT * FROM users WHERE email = ? LIMIT 1';
    db.query(sql, [email], function(err, results) {
      if (err) return callback(err);
      return callback(null, results && results.length ? results[0] : null);
    });
  },

  getUserById: function(id, callback) {
    const sql = 'SELECT * FROM users WHERE id = ? LIMIT 1';
    db.query(sql, [id], function(err, results) {
      if (err) return callback(err);
      return callback(null, results && results.length ? results[0] : null);
    });
  },

  // User: update profile (no password change here)
  updateProfile: function(id, data, callback) {
    const sql = 'UPDATE users SET username = ?, email = ?, address = ?, contact = ? WHERE id = ?';
    db.query(sql, [data.username, data.email, data.address, data.contact, id], function(err, result) {
      return callback(err, result);
    });
  },

  // User: change password with current password check
  changePassword: function(id, currentPassword, newPassword, callback) {
    const sql = 'UPDATE users SET password = SHA1(?) WHERE id = ? AND password = SHA1(?)';
    db.query(sql, [newPassword, id, currentPassword], function(err, result) {
      if (err) return callback(err);
      // affectedRows === 0 means current password did not match
      return callback(null, result);
    });
  }
};
