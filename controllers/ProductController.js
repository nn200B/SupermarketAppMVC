const mysql = require('mysql2');

// DB connection (same config as app.js). Update password if necessary.
const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'Republic_C207',
  database: 'c372_supermarketdb'
});

function renderWithUser(req, res, view, data) {
  const user = req.session && req.session.user ? req.session.user : null;
  return res.render(view, Object.assign({}, data, { user }));
}

module.exports = {
  // list products for /, /inventory, /shopping
  listAllProducts(req, res) {
    connection.query('SELECT * FROM products', (err, results) => {
      if (err) return res.status(500).send('Server error');
      if (req.path === '/inventory') return renderWithUser(req, res, 'inventory', { products: results });
      if (req.path === '/shopping') return renderWithUser(req, res, 'shopping', { products: results });
      return renderWithUser(req, res, 'index', { products: results });
    });
  },

  getProductById(req, res) {
    const id = req.params.id;
    if (!id) return res.status(400).send('Missing id');
    connection.query('SELECT * FROM products WHERE id = ?', [id], (err, results) => {
      if (err) return res.status(500).send('Server error');
      if (!results || results.length === 0) return res.status(404).send('Product not found');
      return renderWithUser(req, res, 'product', { product: results[0] });
    });
  },

  addProduct(req, res) {
    const name = req.body.name || req.body.productName;
    const quantity = Number(req.body.quantity) || 0;
    const price = Number(req.body.price) || 0;
    const image = req.file ? req.file.filename : null;
    if (!name) return res.status(400).send('productName required');
    const sql = 'INSERT INTO products (productName, quantity, price, image) VALUES (?, ?, ?, ?)';
    connection.query(sql, [name, quantity, price, image], (err) => {
      if (err) return res.status(500).send('Error adding product');
      return res.redirect('/inventory');
    });
  },

  showUpdateForm(req, res) {
    const id = req.params.id;
    if (!id) return res.status(400).send('Missing id');
    connection.query('SELECT * FROM products WHERE id = ?', [id], (err, results) => {
      if (err) return res.status(500).send('Server error');
      if (!results || results.length === 0) return res.status(404).send('Product not found');
      return renderWithUser(req, res, 'updateProduct', { product: results[0] });
    });
  },

  updateProduct(req, res) {
    const id = req.params.id;
    if (!id) return res.status(400).send('Missing id');
    const name = req.body.name || req.body.productName;
    const quantity = typeof req.body.quantity !== 'undefined' ? Number(req.body.quantity) : null;
    const price = typeof req.body.price !== 'undefined' ? Number(req.body.price) : null;
    let image = req.body.currentImage || null;
    if (req.file && req.file.filename) image = req.file.filename;
    const sql = 'UPDATE products SET productName = ?, quantity = ?, price = ?, image = ? WHERE id = ?';
    connection.query(sql, [name, quantity, price, image, id], (err) => {
      if (err) return res.status(500).send('Error updating product');
      return res.redirect('/inventory');
    });
  },

  deleteProduct(req, res) {
    const id = req.params.id;
    if (!id) return res.status(400).send('Missing id');
    connection.query('DELETE FROM products WHERE id = ?', [id], (err) => {
      if (err) return res.status(500).send('Error deleting product');
      return res.redirect('/inventory');
    });
  }
};

