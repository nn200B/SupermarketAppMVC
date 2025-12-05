const mysql = require('mysql2');

// lightweight cart controller that uses session and can fetch product details from DB
const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'Republic_C207',
  database: 'c372_supermarketdb'
});

function renderCart(req, res) {
  const cart = (req.session && req.session.cart) ? req.session.cart : [];
  return res.render('cart', { cart, user: req.session && req.session.user ? req.session.user : null });
}

module.exports = {
  getCart(req, res) {
    if (req.accepts && req.accepts('html')) return renderCart(req, res);
    const cart = (req.session && req.session.cart) ? req.session.cart : [];
    return res.json(cart);
  },

  // add via POST /add-to-cart/:id or POST /cart/add
  addToCart(req, res) {
    const idFromParam = req.params && req.params.id ? req.params.id : null;
    const productId = idFromParam || (req.body && req.body.productId);
    const qty = Number(req.body && req.body.quantity) || 1;
    if (!productId) return res.status(400).send('productId required');
    if (!req.session) req.session = {};
    if (!req.session.cart) req.session.cart = [];

    // fetch product details to display in cart
    connection.query('SELECT * FROM products WHERE id = ?', [productId], (err, results) => {
      if (err) return res.status(500).send('Server error');
      const product = (results && results[0]) ? results[0] : null;
      const existing = req.session.cart.find(i => String(i.productId) === String(productId));
      if (existing) existing.quantity = (existing.quantity || 0) + qty;
      else req.session.cart.push({ productId, productName: product ? product.productName : undefined, price: product ? product.price : undefined, image: product ? product.image : undefined, quantity: qty });
      if (req.accepts && req.accepts('html')) return res.redirect('/cart');
      return res.json({ message: 'Added to cart', cart: req.session.cart });
    });
  },

  removeFromCart(req, res) {
    const productId = req.body && req.body.productId;
    if (!productId) return res.status(400).send('productId required');
    if (!req.session || !req.session.cart) return res.status(400).send('Cart empty');
    req.session.cart = req.session.cart.filter(i => String(i.productId) !== String(productId));
    if (req.accepts && req.accepts('html')) return res.redirect('/cart');
    return res.json({ message: 'Removed', cart: req.session.cart });
  },

  clearCart(req, res) {
    if (req.session) req.session.cart = [];
    if (req.accepts && req.accepts('html')) return res.redirect('/cart');
    return res.json({ message: 'Cart cleared' });
  }
};

