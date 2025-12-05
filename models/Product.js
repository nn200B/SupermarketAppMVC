const db = require('../db');

/**
 * Product model (function-based)
 * Table: students
 * Columns: productId (PK), name, quantity, price, image
 * Node-style callbacks: callback(err, result)
 */

module.exports = {
  getAllProducts: function(callback) {
    const sql = 'SELECT * FROM students';
    db.query(sql, function(err, results) {
      return callback(err, results);
    });
  },

  getProductById: function(productId, callback) {
    const sql = 'SELECT * FROM students WHERE productId = ? LIMIT 1';
    db.query(sql, [productId], function(err, results) {
      if (err) return callback(err);
      return callback(null, results && results.length ? results[0] : null);
    });
  },

  addProduct: function(product, callback) {
    // product: { name, quantity, price, image }
    const sql = 'INSERT INTO students (name, quantity, price, image) VALUES (?, ?, ?, ?)';
    db.query(sql, [product.name, product.quantity, product.price, product.image], function(err, result) {
      return callback(err, result);
    });
  },

  updateProduct: function(productId, product, callback) {
    // product: { name, quantity, price, image }
    const sql = 'UPDATE students SET name = ?, quantity = ?, price = ?, image = ? WHERE productId = ?';
    db.query(sql, [product.name, product.quantity, product.price, product.image, productId], function(err, result) {
      return callback(err, result);
    });
  },

  deleteProduct: function(productId, callback) {
    const sql = 'DELETE FROM students WHERE productId = ?';
    db.query(sql, [productId], function(err, result) {
      return callback(err, result);
    });
  }
};

