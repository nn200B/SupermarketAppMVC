const express = require('express');
const mysql = require('mysql2');
require('dotenv').config();
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const app = express();
const fs = require('fs');
const path = require('path');

// Improve observability: catch top-level errors and log them so we can see why the process exits.
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err && err.stack ? err.stack : String(err));
    try { fs.appendFileSync(path.join(__dirname, 'data', 'server-error.log'), `UNCAUGHT: ${new Date().toISOString()}\n${String(err)}\n${err && err.stack ? err.stack + '\n' : ''}\n`); } catch(e){}
    // don't exit immediately - allow logs to flush
});
process.on('unhandledRejection', (reason) => {
    console.error('UNHANDLED REJECTION:', reason);
    try { fs.appendFileSync(path.join(__dirname, 'data', 'server-error.log'), `UNHANDLED_REJECTION: ${new Date().toISOString()}\n${String(reason)}\n\n`); } catch(e){}
});

console.log('Starting SupermarketAppMVC (pid=' + process.pid + ')');

// Set up multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images'); // Directory to save uploaded files
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname); 
    }
});

const upload = multer({ storage: storage });

let connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Republic_C207',  // Fixed: Removed invalid comment from password string
    database: 'c372_supermarketdb'
});
// If SKIP_DB is enabled we will later overwrite connection with a safe stub to avoid accidental DB calls crashing the app.

// Keep SKIP_DB flag for products/carts; orders use DB when available and fallback to JSON when SKIP_DB=true
const SKIP_DB = String(process.env.SKIP_DB || '').toLowerCase() === 'true';
if (!SKIP_DB) {
    connection.connect((err) => {
            if (err) {
                    console.error('Error connecting to MySQL:', err);
                    return;
            }
            console.log('Connected to MySQL database');

            // Ensure carts table exists (stores JSON cart per user)
            const createCartsTable = `
                CREATE TABLE IF NOT EXISTS carts (
                    userId INT PRIMARY KEY,
                    cartData TEXT
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `;
            connection.query(createCartsTable, (err) => {
                if (err) console.error('Failed to ensure carts table:', err);
            });
            // Ensure categories table exists for admin-managed categories
            const createCategoriesTable = `
                CREATE TABLE IF NOT EXISTS categories (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(64) NOT NULL UNIQUE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `;
            connection.query(createCategoriesTable, (err) => {
                if (err) console.error('Failed to ensure categories table:', err);
            });
            // Ensure payment logs table exists
            const createPaymentLogsTable = `
                CREATE TABLE IF NOT EXISTS payment_logs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    orderId INT NOT NULL,
                    gateway VARCHAR(30) NOT NULL,
                    eventType VARCHAR(30) NOT NULL,
                    status VARCHAR(30) NOT NULL,
                    details TEXT,
                    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    KEY idx_payment_logs_orderId (orderId)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `;
            connection.query(createPaymentLogsTable, (err) => {
                if (err) console.error('Failed to ensure payment_logs table:', err);
            });
    });
} else {
    console.log('SKIP_DB=true -> skipping MySQL connection and using in-memory storage');
}
// In-memory fallback data (used when SKIP_DB=true)
const inMemory = {
    categories: [
        { id: 1, name: 'Fruits' },
        { id: 2, name: 'Vegetables' },
        { id: 3, name: 'Dairy' },
        { id: 4, name: 'Bakery' }
    ],
    products: [
        { id: 1, productName: 'Apples', quantity: 50, price: 1.50, image: 'apples.png', category: 'Fruits' },
        { id: 2, productName: 'Bananas', quantity: 75, price: 0.80, image: 'bananas.png', category: 'Fruits' },
        { id: 3, productName: 'Milk', quantity: 50, price: 3.50, image: 'milk.png', category: 'Dairy' },
        { id: 4, productName: 'Bread', quantity: 80, price: 1.80, image: 'bread.png', category: 'Bakery' },
        { id: 14, productName: 'Tomatoes', quantity: 80, price: 1.50, image: 'tomatoes.png', category: 'Vegetables' },
        { id: 19, productName: 'Broccoli', quantity: 100, price: 5.00, image: 'Broccoli.png', category: 'Vegetables' }
    ],
    nextProductId: 100,
    nextCategoryId: 5,
    orders: [],
    nextOrderId: 1,
    notifications: [],
    nextNotificationId: 1,
    paymentLogs: [],
    nextPaymentLogId: 1,
    refundRequests: [],
    nextRefundId: 1,
    addressChangeRequests: [],
    nextAddressChangeId: 1
};

// Expose store for route helpers (payment receipt notifications)
global.__appStore = inMemory;
global.__persistStore = persistStore;

// JSON-backed dev store (persist in SKIP_DB mode)
const STORE_DIR = path.join(__dirname, 'data');
const STORE_PATH = path.join(STORE_DIR, 'store.json');

function persistStore(cb) {
    try {
        if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
        fs.writeFile(STORE_PATH, JSON.stringify(inMemory, null, 2), 'utf8', (err) => {
            if (err) console.error('Failed to persist store.json:', err);
            if (typeof cb === 'function') cb(err);
        });
    } catch (e) {
        console.error('persistStore error:', e);
        if (typeof cb === 'function') cb(e);
    }
}

function loadStore() {
    try {
        if (fs.existsSync(STORE_PATH)) {
            const raw = fs.readFileSync(STORE_PATH, 'utf8');
            const parsed = JSON.parse(raw || '{}');
            if (parsed && typeof parsed === 'object') {
                inMemory.categories = parsed.categories || inMemory.categories;
                inMemory.products = parsed.products || inMemory.products;
                inMemory.nextProductId = parsed.nextProductId || inMemory.nextProductId;
                inMemory.nextCategoryId = parsed.nextCategoryId || inMemory.nextCategoryId;
                    inMemory.orders = parsed.orders || inMemory.orders;
                    inMemory.nextOrderId = parsed.nextOrderId || inMemory.nextOrderId;
                    inMemory.notifications = parsed.notifications || inMemory.notifications;
                    inMemory.nextNotificationId = parsed.nextNotificationId || inMemory.nextNotificationId;
                    inMemory.refundRequests = parsed.refundRequests || inMemory.refundRequests;
                    inMemory.nextRefundId = parsed.nextRefundId || inMemory.nextRefundId;
                    inMemory.addressChangeRequests = parsed.addressChangeRequests || inMemory.addressChangeRequests;
                    inMemory.nextAddressChangeId = parsed.nextAddressChangeId || inMemory.nextAddressChangeId;
            }
        } else {
            // create store file from defaults
            persistStore(() => {});
        }
    } catch (e) {
        console.error('Failed to load store.json, using defaults:', e);
    }
}

// Load store on startup when SKIP_DB (call after loadStore is defined and inMemory exists)
if (SKIP_DB) loadStore();

// Initialise models that work with the in-memory store
try {
    const NotificationModel = require('./models/Notification');
    inMemory.persistStore = persistStore;
    NotificationModel.init(inMemory);
} catch (e) { /* optional model */ }

try {
    const HelpCenterModel = require('./models/HelpCenter');
    inMemory.persistStore = persistStore;
    HelpCenterModel.init(inMemory);
} catch (e) { /* optional model */ }

// If SKIP_DB is enabled, replace the MySQL connection with a safe stub that won't throw
if (SKIP_DB) {
    connection = {
        query: function(sql, params, cb) {
            // normalize arguments
            if (typeof params === 'function') { cb = params; params = []; }
            // Very small heuristic: if the SQL starts with SELECT return empty array; otherwise return an OK-like object
            const s = (sql || '').toString().trim().toUpperCase();
            if (s.startsWith('SELECT')) return cb && cb(null, []);
            // mimic result object for inserts/updates
            return cb && cb(null, { insertId: 0, affectedRows: 0 });
        }
    };
}

// Helper abstraction so routes can use DB or in-memory fallback
function getCategories(cb) {
    if (SKIP_DB) return cb(null, inMemory.categories.slice());
    connection.query('SELECT * FROM categories ORDER BY name', (err, rows) => {
        if (err) return cb(err);
        return cb(null, rows || []);
    });
}

function addCategory(name, cb) {
    if (!name) return cb(new Error('Missing name'));
    if (SKIP_DB) {
        // avoid duplicates by name
        const existing = inMemory.categories.find(c => c.name.toLowerCase() === name.toLowerCase());
        if (existing) return cb(null, existing);
        const c = { id: inMemory.nextCategoryId++, name };
        inMemory.categories.push(c);
        // persist change
        persistStore(() => cb(null, c));
    }
    connection.query('INSERT IGNORE INTO categories (name) VALUES (?)', [name], (err, result) => {
        if (err) return cb(err);
        // fetch the inserted/existing row
        connection.query('SELECT * FROM categories WHERE name = ?', [name], (sErr, rows) => {
            if (sErr) return cb(sErr);
            return cb(null, rows && rows[0]);
        });
    });
}

function deleteCategoryById(id, cb) {
    if (!id) return cb(new Error('Missing id'));
    if (SKIP_DB) {
        const idx = inMemory.categories.findIndex(c => String(c.id) === String(id));
        if (idx === -1) return cb(null, { affectedRows: 0 });
        inMemory.categories.splice(idx,1);
        // persist change
        persistStore(() => cb(null, { affectedRows: 1 }));
    }
    connection.query('DELETE FROM categories WHERE id = ?', [id], (err, result) => {
        if (err) return cb(err);
        return cb(null, result);
    });
}

function getProducts(filter, cb) {
    // filter: { category }
    if (SKIP_DB) {
        let items = inMemory.products.slice();
        if (filter && filter.category) {
            items = items.filter(p => (p.category || '').toLowerCase() === String(filter.category).toLowerCase());
        }
        return cb(null, items);
    }
    let sql = 'SELECT * FROM products';
    const params = [];
    if (filter && filter.category) {
        sql += ' WHERE category = ?';
        params.push(filter.category);
    }
    connection.query(sql, params, (err, rows) => {
        if (err) return cb(err);
        return cb(null, rows || []);
    });
}

// Orders now handled via models/Order.js for persistence helpers
const OrderModel = require('./models/Order');

// ensure OrderModel is initialised with inMemory store
OrderModel.init(Object.assign(inMemory, { persistStore }));

function addOrder(order, cb) {
    return OrderModel.addOrder(order, cb);
}

function getOrdersByUser(userId, cb) {
    return OrderModel.getOrdersByUser(userId, cb);
}

function getAllOrders(cb) {
    return OrderModel.getAllOrders(cb);
}

// Helpers for refund and address change requests (JSON-backed only)
function addRefundRequest(data, cb) {
    const r = {
        id: inMemory.nextRefundId++,
        userId: data.userId,
        username: data.username,
        orderId: data.orderId,
        reason: data.reason,
        status: 'pending',
        createdAt: new Date().toISOString()
    };
    inMemory.refundRequests.push(r);
    persistStore(() => cb && cb(null, r));
}

function updateRefundStatus(id, status, cb) {
    const r = (inMemory.refundRequests || []).find(x => String(x.id) === String(id));
    if (!r) return cb && cb(new Error('Refund not found'));
    r.status = status;
    if (status === 'approved') {
        r.refundStatus = 'refund accepted';
    } else if (status === 'processing') {
        r.refundStatus = 'processing refund';
    } else if (status === 'completed') {
        r.refundStatus = 'refund completed';
    } else if (status === 'rejected') {
        r.refundStatus = 'refund rejected';
    }
    r.updatedAt = new Date().toISOString();
    persistStore(() => cb && cb(null, r));
}

function getRefunds(cb) {
    const list = (inMemory.refundRequests || []).slice().reverse();
    if (cb) cb(null, list);
}

function addAddressChangeRequest(data, cb) {
    const r = {
        id: inMemory.nextAddressChangeId++,
        userId: data.userId,
        username: data.username,
        orderId: data.orderId,
        newAddress: data.newAddress,
        reason: data.reason,
        status: 'submitted',
        createdAt: new Date().toISOString()
    };
    inMemory.addressChangeRequests.push(r);
    persistStore(() => cb && cb(null, r));
}

function getAddressChangeRequests(cb) {
    const list = (inMemory.addressChangeRequests || []).slice().reverse();
    if (cb) cb(null, list);
}

function updateAddressChangeStatus(id, status, cb) {
    const r = (inMemory.addressChangeRequests || []).find(x => String(x.id) === String(id));
    if (!r) return cb && cb(new Error('Address change not found'));
    r.status = status;
    r.updatedAt = new Date().toISOString();
    persistStore(() => cb && cb(null, r));
}

// Notifications (now primarily handled via models/Notification.js)
function addNotification(data, cb) {
    const NotificationModel = require('./models/Notification');
    // ensure model has access to inMemory + persist
    if (!inMemory.persistStore) {
        inMemory.persistStore = persistStore;
    }
    NotificationModel.init(inMemory);
    return NotificationModel.addNotification(data, cb);
}

function getNotificationsForUser(user, cb) {
    const NotificationModel = require('./models/Notification');
    if (!inMemory.persistStore) {
        inMemory.persistStore = persistStore;
    }
    NotificationModel.init(inMemory);
    return NotificationModel.getNotificationsForUser(user, cb);
}

function markNotificationRead(id, cb) {
    const NotificationModel = require('./models/Notification');
    if (!inMemory.persistStore) {
        inMemory.persistStore = persistStore;
    }
    NotificationModel.init(inMemory);
    return NotificationModel.markNotificationRead(id, cb);
}

function updateOrderStatus(orderId, newStatus, cb) {
    return OrderModel.updateOrderStatus(orderId, newStatus, cb);
}

function addProduct(data, cb) {
    // data: { productName, quantity, price, image, category }
    if (SKIP_DB) {
        const p = {
            id: inMemory.nextProductId++,
            productName: data.productName || 'Unnamed',
            quantity: Number(data.quantity) || 0,
            price: Number(data.price) || 0,
            image: data.image || null,
            category: data.category || null
        };
        inMemory.products.push(p);
        // persist change
        persistStore(() => cb(null, p));
    }
    const sql = 'INSERT INTO products (productName, quantity, price, image, category) VALUES (?, ?, ?, ?, ?)';
    connection.query(sql, [data.productName, data.quantity, data.price, data.image, data.category], (err, result) => {
        if (err) return cb(err);
        // fetch inserted row
        connection.query('SELECT * FROM products WHERE id = ?', [result.insertId], (sErr, rows) => {
            if (sErr) return cb(sErr);
            return cb(null, rows && rows[0]);
        });
    });
}

function getProductById(id, cb) {
    if (SKIP_DB) {
        const p = inMemory.products.find(x => String(x.id) === String(id));
        return cb(null, p ? [p] : []);
    }
    connection.query('SELECT * FROM products WHERE id = ?', [id], (err, rows) => {
        if (err) return cb(err);
        return cb(null, rows || []);
    });
}

// Set up view engine
app.set('view engine', 'ejs');
// enable form and JSON body parsing for all routes
app.use(express.urlencoded({ extended: true })); // for HTML forms
app.use(express.json({
  verify: (req, res, buf) => {
    // needed for HitPay webhook signature validation
    req.rawBody = buf;
  }
})); // for fetch/JSON (PayPal)
//  enable static files
app.use(express.static('public'));

//TO DO: Insert code for Session Middleware below 
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    // Session expires after 1 week of inactivity
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } 
}));

// PayPal API routes
app.use('/paypal', require('./routes/paypal'));
// HitPay API routes
app.use('/hitpay', require('./routes/hitpay'));
// Stripe API routes
app.use('/stripe', require('./routes/stripe'));

app.use(flash());

// Security: prevent caching of sensitive/payment routes
app.use((req, res, next) => {
    const noStorePaths = [
        '/checkout',
        '/delivery-details',
        '/payment-processing',
        '/payment-success',
        '/order-success',
        '/pay/qr',
        '/stripe/success',
        '/paypal/return',
        '/paypal/cancel',
        '/hitpay/return'
    ];
    const hit = noStorePaths.some(p => req.path === p || req.path.startsWith(p + '/'));
    if (hit) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');
    }
    next();
});

// Quick test-login route (always available) placed early so it's reachable even if other routing changes happen.
app.get('/_quick_login', (req, res) => {
    // Create an admin session quickly for testing without DB.
    req.session.user = { id: 1, username: 'dev_admin', role: 'admin' };
    req.session.cart = [];
    // Small confirmation page with a link to inventory
    res.send('<html><body><p>Test admin session created. <a href="/inventory">Go to inventory</a></p></body></html>');
});

// expose cart count to all views via res.locals
app.use((req, res, next) => {
    try {
        const cart = req.session && Array.isArray(req.session.cart) ? req.session.cart : [];
        // total quantity
        const count = cart.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
        res.locals.cartCount = count;
    } catch (e) {
        res.locals.cartCount = 0;
    }
    // Expose unread/new orders count for admin badge
    try {
        if (req.session && req.session.user && req.session.user.role === 'admin') {
            res.locals.newOrdersCount = (inMemory.orders || []).filter(o => o.new).length;
            // Admin notification badge
            res.locals.notificationCount = (inMemory.notifications || []).filter(n => n.role === 'admin' && !n.read).length;
        } else {
            res.locals.newOrdersCount = 0;
            // User notification badge
            const uid = getUserIdFromSessionUser(req.session && req.session.user);
            res.locals.notificationCount = (inMemory.notifications || []).filter(n => n.role === 'user' && !n.read && (n.userId == null || String(n.userId) === String(uid))).length;
        }
    } catch (e) { res.locals.newOrdersCount = 0; }
    next();
});

// Prevent caching of authenticated pages so browser 'back' won't show stale protected pages
app.use((req, res, next) => {
    try {
        // Only set no-cache for HTML responses and when a user was/has been logged in for the session
        // This reduces impact on static assets while protecting sensitive pages from being shown after logout.
        const acceptsHtml = (req.get('Accept') || '').includes('text/html') || req.accepts('html');
        // Apply no-cache headers for HTML responses so browsers will re-request
        // the page when using Back/Forward, ensuring the server can enforce
        // authentication/redirects after logout.
        if (acceptsHtml) {
            res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.set('Pragma', 'no-cache');
            res.set('Expires', '0');
            res.set('Surrogate-Control', 'no-store');
        }
    } catch (e) {
        // noop
    }
    next();
});

// Middleware to check if user is logged in
const checkAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    } else {
        // If this is an AJAX/fetch request, return JSON 401 instead of redirecting HTML
        const acceptsJson = req.xhr || (req.get('Accept') || '').includes('application/json') || req.get('content-type') === 'application/json';
        if (acceptsJson) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        req.flash('error', 'Please log in to view this resource');
        return res.redirect('/login');
    }
};

// Middleware to allow public access when ?public=1 is present
const checkAuthenticatedOrPublic = (req, res, next) => {
    if (req.session && req.session.user) return next();
    if (String(req.query.public || '') === '1') return next();
    const acceptsJson = req.xhr || (req.get('Accept') || '').includes('application/json') || req.get('content-type') === 'application/json';
    if (acceptsJson) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    req.flash('error', 'Please log in to view this resource');
    return res.redirect('/login');
};

// Middleware to check if user is admin
const checkAdmin = (req, res, next) => {
    if (req.session.user.role === 'admin') {
        return next();
    } else {
        req.flash('error', 'Access denied');
        res.redirect('/shopping');
    }
};

// Middleware to block admin users from user-only features (cart)
const checkNotAdmin = (req, res, next) => {
    if (req.session && req.session.user && req.session.user.role === 'admin') {
        // If the client expects JSON (AJAX/fetch), return 403 JSON. Otherwise redirect for normal browsers.
        const acceptsJson = req.xhr || (req.get('Accept') || '').includes('application/json') || req.get('content-type') === 'application/json';
        if (acceptsJson) {
            return res.status(403).json({ error: 'Admins do not use the cart.' });
        }
        req.flash('error', 'Admins do not use the cart.');
        return res.redirect('/inventory');
    }
    return next();
};

// Middleware for form validation
const validateRegistration = (req, res, next) => {
    const { username, email, password, address, contact } = req.body;

    if (!username || !email || !password || !address || !contact) {
        req.flash('error', 'All fields are required.');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }

    if (password.length < 6) {
        req.flash('error', 'Password should be at least 6 or more characters long');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }

    // Force role to be user for all self-registrations
    req.body.role = 'user';
    next();
};

// Define routes
app.get('/',  (req, res) => {
    res.render('index', {user: req.session.user} );
});

app.get('/inventory', checkAuthenticated, checkAdmin, (req, res) => {
        // Fetch products and categories (DB or in-memory)
        getProducts({}, (pErr, products) => {
            if (pErr) {
                console.error('Failed to load products for inventory:', pErr);
                return res.status(500).send('Database error');
            }
            getCategories((cErr, cats) => {
                const categories = (cErr || !cats) ? [] : (cats.map ? cats.map(r => r.name || r) : cats);
                res.render('inventory', { products: products, user: req.session.user, categories });
            });
        });
});

app.get('/register', (req, res) => {
    res.render('register', { messages: req.flash('error'), formData: req.flash('formData')[0] });
});

app.post('/register', validateRegistration, (req, res) => {

    const { username, email, password, address, contact, role } = req.body;

    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
    connection.query(sql, [username, email, password, address, contact, role], (err, result) => {
        if (err) {
            console.error('DB error during registration:', err);
            req.flash('error', 'Registration failed. Try a different email or contact admin.');
            return res.redirect('/register');
        }
        console.log(result);
        req.flash('success', 'Registration successful! Please log in.');
        res.redirect('/login');
    });
});

app.get('/login', (req, res) => {
    res.render('login', { messages: req.flash('success'), errors: req.flash('error') });
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;

    // Validate email and password
    if (!email || !password) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/login');
    }

    const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';
    connection.query(sql, [email, password], (err, results) => {
        if (err) {
            console.error('DB error during login:', err);
            req.flash('error', 'Login failed due to server error.');
            return res.redirect('/login');
        }

        if (results.length > 0) {
            // Successful login
            req.session.user = results[0];

            // load persisted cart for this user
            const uid = getUserIdFromSessionUser(req.session.user);
            loadCartFromDB(uid, (err, savedCart) => {
              if (err) console.error('Failed to load saved cart:', err);
              // If session already has cart items (e.g., guest added items), merge them with savedCart:
              const sessionCart = req.session.cart || [];
              if (sessionCart.length === 0) {
                req.session.cart = savedCart || [];
              } else {
                // merge: keep quantities summed by productId
                const map = {};
                (savedCart || []).forEach(i => { map[String(i.productId || i.id)] = { ...i }; });
                sessionCart.forEach(i => {
                  const key = String(i.productId || i.id);
                  if (map[key]) {
                    map[key].quantity = (map[key].quantity || 0) + (i.quantity || 0);
                  } else {
                    map[key] = { ...i };
                  }
                });
                req.session.cart = Object.values(map).filter(item => item.productId && item.quantity > 0);  // Filter invalid items
              }

              // persist merged session cart back to DB
              const finalUid = uid;
              saveCartToDB(finalUid, req.session.cart, (saveErr) => {
                if (saveErr) console.error('Failed to save merged cart:', saveErr);
                req.flash('success', 'Login successful!');
                if(req.session.user.role == 'user')
                    res.redirect('/shopping');
                else
                    res.redirect('/inventory');
              });
            });
        } else {
            // Invalid credentials
            req.flash('error', 'Invalid email or password.');
            res.redirect('/login');
        }
    });
});

// User profile & password
app.get('/profile', checkAuthenticated, (req, res) => {
    const UserModel = require('./models/User');
    const currentUser = req.session.user;
    UserModel.getUserById(currentUser.id, (err, user) => {
        if (err || !user) {
            req.flash('error', 'Unable to load profile');
            return res.redirect('/');
        }
        res.render('profile', {
            user: currentUser,
            profile: user,
            errors: req.flash('error'),
            success: req.flash('success')
        });
    });
});

app.post('/profile', checkAuthenticated, (req, res) => {
    const UserModel = require('./models/User');
    const currentUser = req.session.user;
    const { username, email, address, contact } = req.body || {};

    if (!username || !email) {
        req.flash('error', 'Name and email are required');
        return res.redirect('/profile');
    }

    UserModel.updateProfile(currentUser.id, { username, email, address, contact }, (err) => {
        if (err) {
            req.flash('error', 'Could not update profile');
            return res.redirect('/profile');
        }
        req.session.user.username = username;
        req.session.user.email = email;
        req.session.user.address = address;
        req.session.user.contact = contact;
        req.flash('success', 'Profile updated successfully');
        return res.redirect('/profile');
    });
});

app.post('/change-password', checkAuthenticated, (req, res) => {
    const UserModel = require('./models/User');
    const currentUser = req.session.user;
    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    const errors = [];

    if (!currentPassword || !newPassword || !confirmPassword) {
        errors.push('All password fields are required');
    }
    if (newPassword && newPassword.length < 8) {
        errors.push('New password must be at least 8 characters');
    }
    if (newPassword && !/[A-Z]/.test(newPassword)) {
        errors.push('New password must contain at least 1 uppercase letter');
    }
    if (newPassword && !/[0-9]/.test(newPassword)) {
        errors.push('New password must contain at least 1 number');
    }
    if (newPassword !== confirmPassword) {
        errors.push('New password and confirmation do not match');
    }

    if (errors.length) {
        errors.forEach(e => req.flash('error', e));
        return res.redirect('/profile');
    }

    UserModel.changePassword(currentUser.id, currentPassword, newPassword, (err, result) => {
        if (err) {
            req.flash('error', 'Could not change password');
            return res.redirect('/profile');
        }
        if (!result || !result.affectedRows) {
            req.flash('error', 'Current password is incorrect');
            return res.redirect('/profile');
        }
        req.flash('success', 'Password changed successfully');
        return res.redirect('/profile');
    });
});

app.get('/shopping', checkAuthenticated, checkNotAdmin, (req, res) => {
        // Optional category filtering from query string.
        const rawCategory = (req.query.category || '').trim();
        const category = (rawCategory && String(rawCategory).toLowerCase() !== 'all') ? rawCategory : '';

        // Load categories and products (DB or in-memory)
        getCategories((cErr, cats) => {
            const categories = (cErr || !cats) ? [] : (cats.map ? cats.map(r => r.name || r) : cats);
            getProducts({ category }, (pErr, products) => {
                if (pErr) {
                    console.error('Failed to load products for shopping:', pErr);
                    return res.status(500).send('Database error');
                }
                res.render('shopping', { user: req.session.user, products: products, category: category, categories });
            });
        });
});

// Allow guests to add to cart (no login required). Admins are still blocked.
app.post('/add-to-cart/:id', checkNotAdmin, (req, res) => {
    const productId = parseInt(req.params.id);
    const quantity = parseInt(req.body && req.body.quantity) || 1;

    // Debug logging to help trace AJAX failures
    try {
        const acceptsJson = req.xhr || (req.get('Accept') || '').includes('application/json') || req.get('content-type') === 'application/json';
        console.log('DEBUG POST /add-to-cart called', { productId, acceptsJson, cookiePresent: !!req.headers.cookie, sessionUser: getUserIdFromSessionUser(req.session && req.session.user) });
    } catch (e) {
        console.log('DEBUG POST /add-to-cart logging failed', e && e.message);
    }
    connection.query('SELECT * FROM products WHERE id = ?', [productId], (error, results) => {
        if (error) {
            console.error('DB error fetching product by id:', error);
            return res.status(500).send('Database error');
        }

        if (results.length > 0) {
            const product = results[0];

            // Ensure session cart exists
            if (!req.session.cart) {
                req.session.cart = [];
            }

            // Current quantity in cart for this product
            const existingItem = req.session.cart.find(item => item.productId === productId);
            const currentQty = existingItem ? (parseInt(existingItem.quantity) || 0) : 0;
            const requestedTotal = currentQty + quantity;

            // If requested quantity exceeds available stock, block and inform user
            if (requestedTotal > product.quantity) {
                const acceptsJson = req.xhr || (req.get('Accept') || '').includes('application/json') || req.get('content-type') === 'application/json';
                const message = `Not enough stock available. Only ${product.quantity} left.`;
                if (acceptsJson) {
                    return res.status(400).json({ success: false, error: message, available: product.quantity, inCart: currentQty });
                }
                req.flash('error', message);
                return res.redirect('/shopping');
            }

            // Otherwise, add/update item in cart
            if (existingItem) {
                existingItem.quantity = requestedTotal;
            } else {
                req.session.cart.push({
                    productId: productId,
                    productName: product.productName,
                    price: product.price,
                    quantity: quantity,
                    image: product.image
                });
            }

                        // save session cart to DB for logged-in user
                        const uid = getUserIdFromSessionUser(req.session.user);
                        const acceptsJson = req.xhr || (req.get('Accept') || '').includes('application/json') || req.get('content-type') === 'application/json';
                        const afterSave = () => {
                            const cartQuantity = (req.session.cart || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0);
                            if (acceptsJson) {
                                return res.json({ success: true, cartLength: req.session.cart.length, cartQuantity });
                            }
                            // For normal form posts, stay on the current page instead of redirecting to /cart.
                            // Redirect back to the referrer (usually /shopping or product page); fallback to /shopping.
                            const referer = req.get('referer') || '/shopping';
                            return res.redirect(referer);
                        };

                        if (uid) {
                            saveCartToDB(uid, req.session.cart, (err) => {
                                if (err) console.error('Failed to save cart after add:', err);
                                return afterSave();
                            });
                        } else {
                            return afterSave();
                        }
        } else {
            res.status(404).send("Product not found");
        }
    });
});

app.get('/cart', checkAuthenticated, checkNotAdmin, (req, res) => {
    const cart = req.session.cart || [];
    res.render('cart', { cart, user: req.session.user, errors: req.flash('error') || [], success: req.flash('success') || [] });
});

// Handle selection of items from cart for checkout
app.post('/cart/selection', checkAuthenticated, checkNotAdmin, (req, res) => {
    const cart = req.session.cart || [];
    let selected = req.body.selected || [];
    if (!Array.isArray(selected)) selected = [selected];
    const selectedIds = new Set(selected.map(x => String(x)));

    const filtered = cart.filter(it => selectedIds.has(String(it.productId)));
    if (!filtered.length) {
        req.flash('error', 'Please select item(s) to check out.');
        return res.redirect('/cart');
    }

    // Store selected items in session for checkout flow
    req.session.selectedCartItems = filtered;
    return res.redirect('/delivery-details');
});

// Clear entire shopping cart
app.post('/cart/clear', checkAuthenticated, checkNotAdmin, (req, res) => {
    req.session.cart = [];
    req.session.selectedCartItems = [];
    const uid = getUserIdFromSessionUser(req.session.user);
    if (uid) {
        saveCartToDB(uid, req.session.cart, (err) => {
            if (err) console.error('Failed to save cart on clear:', err);
            req.flash('success', 'Cart cleared.');
            return res.redirect('/cart');
        });
    } else {
        req.flash('success', 'Cart cleared.');
        return res.redirect('/cart');
    }
});

// Update quantity for an item in the cart (AJAX JSON endpoint)
app.post('/cart/update', checkAuthenticated, checkNotAdmin, (req, res) => {
    const { productId, quantity } = req.body;
    if (!productId) {
        return res.status(400).json({ success: false, message: 'Missing product to update.' });
    }
    const newQty = Number(quantity);
    if (isNaN(newQty) || newQty < 0) {
        return res.status(400).json({ success: false, message: 'Invalid quantity.' });
    }

    if (!req.session.cart || !Array.isArray(req.session.cart)) req.session.cart = [];

    if (newQty === 0) {
        // remove item when quantity is set to zero
        req.session.cart = req.session.cart.filter(item => String(item.productId) !== String(productId));
        const uid = getUserIdFromSessionUser(req.session.user);
        if (uid) {
            saveCartToDB(uid, req.session.cart, (err) => {
                if (err) {
                    console.error('Failed to save cart after quantity 0 remove:', err);
                    return res.status(500).json({ success: false, message: 'Failed to save cart.' });
                }
                return res.json({ success: true, removed: true });
            });
        } else {
            return res.json({ success: true, removed: true });
        }
    } else {
        // update quantity
        let found = false;
        let updatedItem = null;
        req.session.cart = req.session.cart.map(item => {
            if (String(item.productId) === String(productId)) {
                found = true;
                updatedItem = Object.assign({}, item, { quantity: newQty });
                return updatedItem;
            }
            return item;
        });
        if (!found) {
            return res.status(404).json({ success: false, message: 'Item not found in cart.' });
        }
        const uid = getUserIdFromSessionUser(req.session.user);
        if (uid) {
            saveCartToDB(uid, req.session.cart, (err) => {
                if (err) {
                    console.error('Failed to save cart after quantity update:', err);
                    return res.status(500).json({ success: false, message: 'Failed to save cart.' });
                }
                return res.json({ success: true, removed: false, item: updatedItem });
            });
        } else {
            return res.json({ success: true, removed: false, item: updatedItem });
        }
    }
});

// Helper to remove item and persist cart
function removeItemAndSave(req, res, productId) {
    if (!req.session.cart || !Array.isArray(req.session.cart)) req.session.cart = [];
    req.session.cart = req.session.cart.filter(item => String(item.productId) !== String(productId));
    const uid = getUserIdFromSessionUser(req.session.user);
    if (uid) {
        saveCartToDB(uid, req.session.cart, (err) => {
            if (err) console.error('Failed to save cart after delete:', err);
            return res.redirect('/cart');
        });
    } else {
        return res.redirect('/cart');
    }
}

// POST via form body: /cart/delete
app.post('/cart/delete', checkAuthenticated, checkNotAdmin, (req, res) => {
    const productId = req.body.productId || req.body.pid;
    if (!productId) {
        console.warn('No productId provided in body, redirecting to /cart');
        return res.redirect('/cart');
    }
    removeItemAndSave(req, res, productId);
});

// POST via URL param: /cart/delete/:productId
app.post('/cart/delete/:productId', checkAuthenticated, checkNotAdmin, (req, res) => {
    const productId = req.params.productId;
    if (!productId) return res.redirect('/cart');
    removeItemAndSave(req, res, productId);
});

app.get('/logout', (req, res) => {
    // save cart for logged in user before destroying session
    const uid = req.session ? getUserIdFromSessionUser(req.session.user) : null;
    const cartToSave = (req.session && req.session.cart) ? req.session.cart : [];
    if (uid) {
      saveCartToDB(uid, cartToSave, (err) => {
        if (err) console.error('Failed to save cart on logout:', err);
                // Destroy session and clear cookie, redirect to login
                req.session.destroy((destroyErr) => {
                    try { res.clearCookie('connect.sid'); } catch(e){}
                    return res.redirect('/login');
                });
      });
    } else {
            req.session.destroy((destroyErr) => {
                try { res.clearCookie('connect.sid'); } catch(e){}
                return res.redirect('/login');
            });
    }
});

app.get('/product/:id', checkAuthenticated, (req, res) => {
  // Extract the product ID from the request parameters
  const productId = req.params.id;

  // Fetch data from MySQL based on the product ID
  connection.query('SELECT * FROM products WHERE id = ?', [productId], (error, results) => {
      if (error) {
          console.error('DB error fetching product by id:', error);
          return res.status(500).send('Database error');
      }

      // Check if any product with the given ID was found
      if (results.length > 0) {
          // Render HTML page with the product data
          res.render('product', { product: results[0], user: req.session.user  });
      } else {
          // If no product with the given ID was found, render a 404 page or handle it accordingly
          res.status(404).send('Product not found');
      }
  });
});

app.get('/addProduct', checkAuthenticated, checkAdmin, (req, res) => {
    // fetch categories for select dropdown (DB or in-memory)
    getCategories((err, rows) => {
        const categories = (err || !rows) ? [] : (rows.map ? rows.map(r => r.name || r) : rows);
        res.render('addProduct', { user: req.session.user, categories });
    });
});

app.post('/addProduct', checkAuthenticated, checkAdmin, upload.single('image'),  (req, res) => {  // Fixed: Added missing auth middleware
    // Extract product data from the request body
    let { name, quantity, price, category, newCategory } = req.body;
    // If admin provided a newCategory, ensure it's present
    const ensureCategoryThenAddProduct = (cb) => {
        if (newCategory && newCategory.trim()) {
            const newName = newCategory.trim();
            addCategory(newName, (err, row) => {
                if (err) console.error('Failed to insert new category:', err);
                category = newName;
                return cb();
            });
        } else {
            return cb();
        }
    };

    let image = null;
    if (req.file) image = req.file.filename;

    ensureCategoryThenAddProduct(() => {
        // Use helper addProduct which handles DB or in-memory
        addProduct({ productName: name, quantity: quantity, price: price, image: image, category: category }, (err, created) => {
            if (err) {
                console.error('Error adding product:', err);
                return res.status(500).send('Error adding product');
            }
            return res.redirect('/inventory');
        });
    });
});

app.get('/updateProduct/:id',checkAuthenticated, checkAdmin, (req,res) => {
    const productId = req.params.id;
    const sql = 'SELECT * FROM products WHERE id = ?';
    // Fetch data from DB or in-memory
    getProductById(productId, (err, results) => {
        if (err) {
            console.error('DB error fetching product for update:', err);
            return res.status(500).send('Database error');
        }
        if (!results || results.length === 0) return res.status(404).send('Product not found');
        getCategories((cErr, rows) => {
            const categories = (cErr || !rows) ? [] : (rows.map ? rows.map(r => r.name || r) : rows);
            res.render('updateProduct', { product: results[0], user: req.session.user, categories });
        });
    });
});

app.post('/updateProduct/:id', checkAuthenticated, checkAdmin, upload.single('image'), (req, res) => {  // Fixed: Added missing auth middleware
        const productId = req.params.id;
        // Extract product data from the request body
        let { name, quantity, price, category, newCategory } = req.body;
        // If admin provided a newCategory, insert it into categories table (ignore errors)
        if (newCategory && newCategory.trim()) {
            const newName = newCategory.trim();
            addCategory(newName, (err) => {
                if (err) console.error('Failed to insert new category:', err);
            });
            category = newName;
        }
        let image  = req.body.currentImage; //retrieve current image filename
        if (req.file) { //if new image is uploaded
                image = req.file.filename; // set image to be new image filename
        }

        // If running with SKIP_DB, update in-memory product
        if (SKIP_DB) {
            const prod = inMemory.products.find(p => String(p.id) === String(productId));
            if (!prod) return res.status(404).send('Product not found');
            prod.productName = name;
            prod.quantity = Number(quantity) || prod.quantity;
            prod.price = Number(price) || prod.price;
            prod.image = image || prod.image;
            prod.category = category || prod.category;
            // persist change then redirect
            return persistStore(() => res.redirect('/inventory'));
        }

        const updateWithCategory = () => {
            const sql = 'UPDATE products SET productName = ? , quantity = ?, price = ?, image = ?, category = ? WHERE id = ?';
            connection.query(sql, [name, quantity, price, image, category || null, productId], updateCallback);
        };

        const updateWithoutCategory = () => {
            const sql = 'UPDATE products SET productName = ? , quantity = ?, price = ?, image = ? WHERE id = ?';
            connection.query(sql, [name, quantity, price, image, productId], updateCallback);
        };

        const updateCallback = (error, results) => {
            if (error) {
                console.error('Error updating product:', error);
                if (error.code === 'ER_BAD_FIELD_ERROR') {
                    console.log('Category column missing; retrying update without category');
                    return updateWithoutCategory();
                }
                return res.status(500).send('Error updating product');
            }
            return res.redirect('/inventory');
        };

        if (typeof category !== 'undefined') {
            updateWithCategory();
        } else {
            updateWithoutCategory();
        }
});

// Categories routes
// User view: /categories_user (read-only, just to select category and shop)
app.get('/categories_user', checkAuthenticated, (req, res) => {
    if (req.session.user && req.session.user.role === 'admin') {
        return res.redirect('/admin/categories');
    }
    getCategories((err, rows) => {
        if (err) {
            console.error('Failed to load categories:', err);
            return res.status(500).send('Failed to load categories');
        }
        const categories = rows || [];
        return res.render('categories_user', { categories, user: req.session.user });
    });
});

// Admin view: list categories with products under each
app.get('/admin/categories', checkAuthenticated, checkAdmin, (req, res) => {
    getCategories((cErr, catRows) => {
        if (cErr) {
            console.error('Failed to load categories for admin:', cErr);
            req.flash('error', 'Could not load categories');
            return res.redirect('/inventory');
        }
        const categories = catRows || [];
        // load all products once, then group by category name
        getProducts({}, (pErr, products) => {
            if (pErr) {
                console.error('Failed to load products for admin categories:', pErr);
                req.flash('error', 'Could not load products');
                return res.redirect('/inventory');
            }
            const grouped = categories.map(c => {
                const items = (products || []).filter(p => (p.category || '') === c.name);
                return { category: c, products: items };
            });
            res.render('categories', { user: req.session.user, groupedCategories: grouped });
        });
    });
});

// Admin-only category add/delete (users cannot change categories)
app.post('/admin/categories', checkAuthenticated, checkAdmin, (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) {
        req.flash('error', 'Category name is required');
        return res.redirect('/admin/categories');
    }
    addCategory(name, (err) => {
        if (err) {
            console.error('Failed to add category:', err);
            req.flash('error', 'Could not add category');
        } else {
            req.flash('success', 'Category added');
        }
        return res.redirect('/admin/categories');
    });
});

app.post('/admin/categories/:id/delete', checkAuthenticated, checkAdmin, (req, res) => {
    const id = req.params.id;
    deleteCategoryById(id, (err) => {
        if (err) {
            console.error('Failed to delete category:', err);
            req.flash('error', 'Could not delete category');
        } else {
            req.flash('success', 'Category deleted');
        }
        return res.redirect('/admin/categories');
    });
});

// Admin: User Management (list + delete users)
const AdminUserController = require('./controllers/AdminUserController');
app.get('/admin/users', checkAuthenticated, checkAdmin, AdminUserController.list);
app.post('/admin/users/:id/delete', checkAuthenticated, checkAdmin, AdminUserController.delete);

// Admin: own profile (reuse user profile logic but admin-only route + view)
const UserController = require('./controllers/UserController');
app.get('/admin/profile', checkAuthenticated, checkAdmin, (req, res) => {
    // load current admin user details
    const currentUser = req.session.user;
    if (!currentUser) return res.redirect('/login');
    const UserModel = require('./models/User');
    UserModel.getUserById(currentUser.id, (err, user) => {
        if (err || !user) {
            req.flash('error', 'Unable to load admin profile');
            return res.redirect('/inventory');
        }
        res.render('admin_profile', {
            user: currentUser,
            profile: user,
            errors: req.flash('error'),
            success: req.flash('success')
        });
    });
});

app.post('/admin/profile', checkAuthenticated, checkAdmin, (req, res) => {
    const currentUser = req.session.user;
    if (!currentUser) return res.redirect('/login');
    const { username, email, address, contact } = req.body || {};
    if (!username || !email) {
        req.flash('error', 'Name and email are required');
        return res.redirect('/admin/profile');
    }
    const UserModel = require('./models/User');
    UserModel.updateProfile(currentUser.id, { username, email, address, contact }, (err) => {
        if (err) {
            req.flash('error', 'Could not update admin profile');
            return res.redirect('/admin/profile');
        }
        req.session.user.username = username;
        req.session.user.email = email;
        req.session.user.address = address;
        req.session.user.contact = contact;
        req.flash('success', 'Admin profile updated successfully');
        return res.redirect('/admin/profile');
    });
});

// NOTE: Inline quantity update via AJAX removed — quantities are edited via the product Edit form now.

// Admin view of help center requests (delegates to HelpCenterController)
const HelpCenterController = require('./controllers/HelpCenterController');
app.get('/admin/help-center', checkAuthenticated, checkAdmin, HelpCenterController.adminIndex());

// Admin takes decision on refund: approve or reject
app.post('/admin/help-center/refund/:id/decision', checkAuthenticated, checkAdmin, (req, res) => {
    const refundId = req.params.id;
    const decision = (req.body.decision || '').toLowerCase();
    if (decision !== 'approve' && decision !== 'reject') {
        req.flash('error', 'Invalid decision.');
        return res.redirect('/admin/help-center');
    }
    const newStatus = decision === 'approve' ? 'approved' : 'rejected';
    updateRefundStatus(refundId, newStatus, (err, r) => {
        if (err) {
            console.error('Failed to update refund status:', err);
            req.flash('error', 'Could not update refund request.');
        } else {
            // When approved, mark order as refunded/cancelled and remove from active orders
            if (newStatus === 'approved') {
                const idx = (inMemory.orders || []).findIndex(o => String(o.id) === String(r.orderId));
                let removedOrder = null;
                if (idx !== -1) {
                    removedOrder = inMemory.orders.splice(idx, 1)[0];
                }

                // Optional: keep a history array on the refund request
                if (!r.history) r.history = [];
                r.history.push({ status: 'order cancelled and refund accepted', at: new Date().toISOString() });

                persistStore(() => {
                    req.flash('success', `Refund accepted and order #${r.orderId} cancelled.`);
                });

                // Notify user about refund decision
                addNotification({
                    role: 'user',
                    userId: r.userId,
                    type: 'refund',
                    message: `Your order #${r.orderId} has been cancelled and refund accepted.`,
                    link: '/notifications'
                });
            } else {
                req.flash('success', `Refund request #${refundId} rejected.`);
                // Notify user about refund rejection
                addNotification({
                    role: 'user',
                    userId: r.userId,
                    type: 'refund',
                    message: `Your refund request for order #${r.orderId} has been rejected.`,
                    link: '/orders'
                });
            }
        }
        return res.redirect('/admin/help-center');
    });
});

// User: show refund request form for a specific order (only if delivered and no existing refund)
app.get('/orders/:id/refund', checkAuthenticated, (req, res) => {
    const orderId = req.params.id;
    const user = req.session.user;
    if (!user) return res.redirect('/login');

    getOrdersByUser(user.id, (err, list) => {
        if (err || !list) {
            req.flash('error', 'Unable to load order for refund request');
            return res.redirect('/orders');
        }
        const order = list.find(o => String(o.id) === String(orderId));
        if (!order) {
            req.flash('error', 'Order not found');
            return res.redirect('/orders');
        }
        // Only allow refund for delivered orders
        const status = (order.deliveryStatus || order.status || '').toLowerCase();
        if (!status.includes('delivered')) {
            req.flash('error', 'Refunds are only available for delivered orders.');
            return res.redirect('/orders/' + orderId);
        }
        res.render('refund_request', {
            user: req.session.user,
            order,
            errors: req.flash('error')
        });
    });
});

// User: submit refund request
app.post('/orders/:id/refund', checkAuthenticated, (req, res) => {
    const orderId = req.params.id;
    const { reason } = req.body || {};
    const user = req.session.user;
    if (!user) return res.redirect('/login');

    if (!reason || reason.trim().length < 10) {
        req.flash('error', 'Please provide more details for your refund request (at least 10 characters).');
        return res.redirect('/orders/' + orderId + '/refund');
    }

    addRefundRequest({
        userId: user.id,
        username: user.username,
        orderId,
        reason: reason.trim()
    }, (err) => {
        if (err) {
            console.error('Failed to create refund request:', err);
            req.flash('error', 'Could not submit refund request.');
            return res.redirect('/orders/' + orderId + '/refund');
        }
        req.flash('success', 'Your refund request has been submitted. Our team will review it shortly.');
        // notify admin via notification system
        addNotification({
            role: 'admin',
            type: 'refund',
            message: `New refund request for order #${orderId} from ${user.username}.`,
            link: '/admin/help-center'
        });
        return res.redirect('/orders/' + orderId);
    });
});

// Admin takes decision on address change: approve or reject
app.post('/admin/help-center/address-change/:id/decision', checkAuthenticated, checkAdmin, (req, res) => {
    const id = req.params.id;
    const decision = (req.body.decision || '').toLowerCase();

    if (!id || (decision !== 'approve' && decision !== 'reject')) {
        req.flash('error', 'Invalid decision for address change request.');
        return res.redirect('/admin/help-center');
    }

    getAddressChangeRequests((err, list) => {
        if (err) {
            console.error('Failed to load address change requests:', err);
            req.flash('error', 'Could not process address change request.');
            return res.redirect('/admin/help-center');
        }
        const reqItem = (list || []).find(r => String(r.id) === String(id));
        if (!reqItem) {
            req.flash('error', 'Address change request not found.');
            return res.redirect('/admin/help-center');
        }

        const newStatus = decision === 'approve' ? 'approved' : 'rejected';

        // If approved, also update the order's delivery address in the JSON store
        if (decision === 'approve') {
            const order = (inMemory.orders || []).find(o => String(o.id) === String(reqItem.orderId));
            if (order) {
                order.deliveryAddress = reqItem.newAddress;
                if (!order.history) order.history = [];
                order.history.push({ status: 'address updated', at: new Date().toISOString() });
            }
        }

        updateAddressChangeStatus(id, newStatus, (e) => {
            if (e) {
                console.error('Failed to update address change status:', e);
                req.flash('error', 'Could not update address change status.');
            } else {
                req.flash('success', `Address change request ${newStatus}.`);
                // Notify user about address change decision
                addNotification({
                    role: 'user',
                    userId: reqItem.userId,
                    type: 'address',
                    message: `Your address change request for order #${reqItem.orderId} has been ${newStatus}.`,
                    link: '/orders/' + encodeURIComponent(reqItem.orderId)
                });
            }
            persistStore(() => {
                return res.redirect('/admin/help-center');
            });
        });
    });
});

// Notifications center for both user and admin (delegates to NotificationController)
const NotificationController = require('./controllers/NotificationController');
app.get('/notifications', checkAuthenticated, NotificationController.list);
app.post('/notifications/mark-all-read', checkAuthenticated, NotificationController.markAllRead);
app.post('/notifications/:id/read', checkAuthenticated, (req, res) => {
    const id = req.params.id;
    if (!id) return res.redirect('/notifications');
    markNotificationRead(id, (err) => {
        if (err) {
            console.error('Failed to mark notification read:', err);
        }
        // Preserve filters if they exist in the query string
        const q = req.query.q || '';
        const type = req.query.type || '';
        const tab = req.query.tab || '';
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        if (type) params.set('type', type);
        if (tab) params.set('tab', tab);
        const suffix = params.toString() ? ('?' + params.toString()) : '';
        return res.redirect('/notifications' + suffix);
    });
});

// Admin sales analytics page: view revenue & orders by month (paid orders only)
app.get('/admin/sales', checkAuthenticated, checkAdmin, (req, res) => {
    OrderModel.getAllOrders((err, all) => {
        if (err) console.error('Failed to load orders for sales:', err);
        const allOrders = (all || []).filter(o => (o.status || '').toLowerCase() === 'paid');

    // Group by YYYY-MM
    const monthlyMap = {};
    allOrders.forEach(o => {
        const date = o.createdAt ? new Date(o.createdAt) : new Date();
        if (isNaN(date.getTime())) return;
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlyMap[key]) {
            monthlyMap[key] = { key, year: date.getFullYear(), month: date.getMonth() + 1, totalRevenue: 0, orderCount: 0 };
        }
        const amount = Number(o.subtotal || o.total || 0);
        monthlyMap[key].totalRevenue += isNaN(amount) ? 0 : amount;
        monthlyMap[key].orderCount += 1;
    });

    const monthlySummary = Object.values(monthlyMap).sort((a, b) => a.key.localeCompare(b.key));

    // Selected period filter
    // mode: 'all' | 'this-month' | 'last-month' | 'ytd' | 'this-year' | 'custom'
    const mode = (req.query.mode || 'all').trim();
    const monthParam = (req.query.month || '').trim(); // '01'..'12' when mode === 'custom'

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12

    let filteredOrders = allOrders;
    let selectedSummary = null;
    let selectedKey = '';
    if (mode === 'this-month') {
        const key = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
        filteredOrders = allOrders.filter(o => {
            const d = o.createdAt ? new Date(o.createdAt) : new Date();
            if (isNaN(d.getTime())) return false;
            const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            return k === key;
        });
        selectedSummary = monthlyMap[key] || null;
    } else if (mode === 'last-month') {
        let y = currentYear;
        let m = currentMonth - 1;
        if (m === 0) { m = 12; y = currentYear - 1; }
        const key = `${y}-${String(m).padStart(2, '0')}`;
        filteredOrders = allOrders.filter(o => {
            const d = o.createdAt ? new Date(o.createdAt) : new Date();
            if (isNaN(d.getTime())) return false;
            const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            return k === key;
        });
        selectedSummary = monthlyMap[key] || null;
    } else if (mode === 'ytd') {
        filteredOrders = allOrders.filter(o => {
            const d = o.createdAt ? new Date(o.createdAt) : new Date();
            if (isNaN(d.getTime())) return false;
            return d.getFullYear() === currentYear;
        });
        const yKeyPrefix = `${currentYear}-`;
        selectedSummary = Object.values(monthlyMap)
            .filter(m => m.key.startsWith(yKeyPrefix))
            .reduce((acc, m) => {
                if (!acc) acc = { totalRevenue: 0, orderCount: 0 };
                acc.totalRevenue += m.totalRevenue;
                acc.orderCount += m.orderCount;
                return acc;
            }, null);
    } else if (mode === 'this-year') {
        filteredOrders = allOrders.filter(o => {
            const d = o.createdAt ? new Date(o.createdAt) : new Date();
            if (isNaN(d.getTime())) return false;
            return d.getFullYear() === currentYear;
        });
        const yKeyPrefix = `${currentYear}-`;
        selectedSummary = Object.values(monthlyMap)
            .filter(m => m.key.startsWith(yKeyPrefix))
            .reduce((acc, m) => {
                if (!acc) acc = { totalRevenue: 0, orderCount: 0 };
                acc.totalRevenue += m.totalRevenue;
                acc.orderCount += m.orderCount;
                return acc;
            }, null);
    } else if (mode === 'custom' && monthParam) {
        // Use current year + selected month, e.g. 2025-03
        const customKey = `${currentYear}-${monthParam}`;
        filteredOrders = allOrders.filter(o => {
            const d = o.createdAt ? new Date(o.createdAt) : new Date();
            if (isNaN(d.getTime())) return false;
            const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            return k === customKey;
        });
        selectedSummary = monthlyMap[customKey] || null;
        selectedKey = customKey;
    } // else mode === 'all' => keep allOrders and no selectedSummary

        // Payment method breakdown
        const methodMap = {};
        allOrders.forEach(o => {
            const key = String(o.paymentMethod || 'card').toLowerCase();
            if (!methodMap[key]) methodMap[key] = { method: key, count: 0, total: 0 };
            methodMap[key].count += 1;
            methodMap[key].total += Number(o.total || (o.subtotal + o.deliveryCost) || 0);
        });
        const paymentSummary = Object.values(methodMap).sort((a, b) => b.total - a.total);

        res.render('admin_sales', {
            user: req.session.user,
            monthlySummary,
            orders: filteredOrders,
            selectedMonth: selectedKey,
            selectedSummary,
            mode,
            paymentSummary
        });
    });
});

// Admin payment audit log
app.get('/admin/payments/logs', checkAuthenticated, checkAdmin, (req, res) => {
    OrderModel.getPaymentLogs((err, logs) => {
        if (err) console.error('Failed to load payment logs:', err);
        res.render('admin_payment_logs', { user: req.session.user, logs: logs || [] });
    });
});

app.get('/deleteProduct/:id', checkAuthenticated, checkAdmin, (req, res) => {  // Fixed: Added missing auth middleware
    const productId = req.params.id;

    if (SKIP_DB) {
        const idx = inMemory.products.findIndex(p => String(p.id) === String(productId));
        if (idx !== -1) inMemory.products.splice(idx,1);
        // persist change then redirect
        return persistStore(() => res.redirect('/inventory'));
    }

    connection.query('DELETE FROM products WHERE id = ?', [productId], (error, results) => {
        if (error) {
            // Handle any error that occurs during the database operation
            console.error("Error deleting product:", error);
            res.status(500).send('Error deleting product');
        } else {
            // Send a success response
            res.redirect('/inventory');
        }
    });
});

// helper to get numeric user id from session user object
function getUserIdFromSessionUser(user) {
  if (!user) return null;
  return user.id || user.userId || user.ID || null;
}

// Save cart (array) to DB for given userId
// Save cart (array) to DB for given userId
function saveCartToDB(userId, cart, callback) {
    if (!userId) return callback && callback(new Error('Missing userId'));
    const cartJson = JSON.stringify(cart || []);
    if (SKIP_DB) {
        // store in-memory for tests/dev
        saveCartToDB._store = saveCartToDB._store || {};
        saveCartToDB._store[userId] = cartJson;
        return callback && callback(null, { ok: true });
    }
    const sql = 'INSERT INTO carts (userId, cartData) VALUES (?, ?) ON DUPLICATE KEY UPDATE cartData = VALUES(cartData)';
    connection.query(sql, [userId, cartJson], function(err, result) {
        if (err) {
            console.error('Error saving cart to DB:', err);
            return callback && callback(err);
        }
        callback && callback(null, result);
    });
}

// Load cart from DB for given userId
// Load cart from DB for given userId
function loadCartFromDB(userId, callback) {
    if (!userId) return callback && callback(new Error('Missing userId'));
    if (SKIP_DB) {
        const raw = (saveCartToDB._store && saveCartToDB._store[userId]) || '[]';
        try {
            const cart = JSON.parse(raw);
            return callback && callback(null, cart);
        } catch (e) {
            return callback && callback(e);
        }
    }
    const sql = 'SELECT cartData FROM carts WHERE userId = ?';
    connection.query(sql, [userId], function(err, results) {
        if (err) {
            console.error('Error loading cart from DB:', err);
            return callback && callback(err);
        }
        const cart = (results[0] && results[0].cartData) ? JSON.parse(results[0].cartData) : [];
        callback && callback(null, cart);
    });
}

// DELETE cart item via AJAX — updates session and persists cart if helper exists
app.delete('/cart/delete/:productId', checkAuthenticated, checkNotAdmin, (req, res) => {
    const productId = req.params.productId;
    console.log('DEBUG DELETE /cart/delete/:productId called, productId=', productId);
    console.log('DEBUG session.user=', req.session && req.session.user ? getUserIdFromSessionUser(req.session.user) : null);
    if (!req.session.cart || !Array.isArray(req.session.cart)) req.session.cart = [];

    const beforeCount = req.session.cart.length;
    req.session.cart = req.session.cart.filter(item => String(item.productId) !== String(productId));
    const removedCount = beforeCount - req.session.cart.length;
    console.log('DEBUG cart before=', beforeCount, 'after=', req.session.cart.length, 'removed=', removedCount);

    // persist for logged-in user if helpers exist
    try {
        if (typeof getUserIdFromSessionUser === 'function') {
            const uid = getUserIdFromSessionUser(req.session.user);
            if (uid && typeof saveCartToDB === 'function') {
                saveCartToDB(uid, req.session.cart, (err) => {
                    if (err) console.error('Failed to save cart after delete:', err);
                    console.log('DEBUG saved cart to DB for user', uid);
                    return res.json({ success: true, removed: removedCount, cartLength: req.session.cart.length });
                });
                return;
            }
        }
    } catch (e) {
        console.error('Cart persistence helper error:', e);
    }

    return res.json({ success: true, removed: removedCount, cartLength: req.session.cart.length });
});

// Debug endpoint to inspect session and persisted cart for the logged-in user
app.get('/_debug/cart', checkAuthenticated, (req, res) => {
    const uid = getUserIdFromSessionUser(req.session.user);
    loadCartFromDB(uid, (err, persisted) => {
        if (err) return res.status(500).json({ error: 'Failed to load persisted cart', details: String(err) });
        res.json({ session: req.session.cart || [], persisted: persisted || [] });
    });
});

// Development-only helper: create a test login and pre-populate session (always available)
app.post('/_test/login', (req, res) => {
    // create a simple test user and cart in session
    // allow override via form or JSON for quick testing: ?role=admin or { role: 'admin' }
    const role = (req.body && req.body.role) || req.query.role || 'user';
    req.session.user = { id: 1, role: role };
    req.session.cart = [{ productId: '10', productName: 'Sample', price: 1.0, quantity: 2 }];
    // also persist to in-memory store if SKIP_DB
    saveCartToDB(1, req.session.cart, () => {
        res.json({ ok: true, user: req.session.user, cart: req.session.cart });
    });
});
// Convenience GET endpoint for quick testing in a browser
app.get('/_test/login', (req, res) => {
    const role = (req.query && req.query.role) || 'user';
    req.session.user = { id: 1, role: role };
    req.session.cart = [{ productId: '10', productName: 'Sample', price: 1.0, quantity: 2 }];
    saveCartToDB(1, req.session.cart, () => {
        // Redirect admin to inventory, regular users to shopping
        if (role === 'admin') return res.redirect('/inventory');
        return res.redirect('/shopping');
    });
});

// ------------------ Orders / Checkout / Payment routes ------------------

// Use shared estimateDeliveryDate from OrderController for consistency
const OrderController = require('./controllers/OrderController');
const estimateDeliveryDate = OrderController.estimateDeliveryDate;

// Delivery details page
app.get('/delivery-details', checkAuthenticated, checkNotAdmin, (req, res) => {
    const cart = req.session.cart || [];
    if (!cart || cart.length === 0) {
        req.flash('error', 'Your cart is empty.');
        return res.redirect('/cart');
    }
    const errors = req.flash('error');
    res.render('delivery_details', { user: req.session.user, errors });
});

app.post('/delivery-details', checkAuthenticated, checkNotAdmin, (req, res) => {
    const { fullName, street, unit, postalCode, note } = req.body || {};
    if (!fullName || !street || !postalCode) {
        req.flash('error', 'Please fill in name, street and postal code.');
        return res.redirect('/delivery-details');
    }
    req.session.delivery = { fullName, street, unit, postalCode, note };
    return res.redirect('/checkout');
});

// GET checkout page
app.get('/checkout', checkAuthenticated, checkNotAdmin, (req, res) => {
    const baseCart = req.session.cart || [];
    const cart = Array.isArray(req.session.selectedCartItems) && req.session.selectedCartItems.length
        ? req.session.selectedCartItems
        : baseCart;
    if (!cart || cart.length === 0) {
        req.flash('error', 'Your cart is empty.');
        return res.redirect('/cart');
    }
    if (!req.session.delivery) {
        return res.redirect('/delivery-details');
    }
    const subtotal = cart.reduce((s, it) => s + (Number(it.price || 0) * Number(it.quantity || 0)), 0);
    const errors = req.flash('error');
    const success = req.flash('success');
    res.render('checkout', { cart, subtotal, user: req.session.user, errors, success, delivery: req.session.delivery, PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID });
});

// POST checkout -> choose delivery & payment
app.post('/checkout', checkAuthenticated, checkNotAdmin, (req, res) => {
    console.log('POST /checkout body:', req.body);
    const { deliveryOption, paymentMethod } = req.body || {};
        const baseCart = req.session.cart || [];
        const cart = Array.isArray(req.session.selectedCartItems) && req.session.selectedCartItems.length
            ? req.session.selectedCartItems
            : baseCart;

        if (!cart || cart.length === 0) {
                req.flash('error', 'Cart is empty');
                return res.redirect('/cart');
        }

        const subtotal = cart.reduce((s, it) => s + (Number(it.price || 0) * Number(it.quantity || 0)), 0);

        const now = new Date();
        const cutoffHour = 13; // 1pm
        let deliveryCost = 10;

        if (deliveryOption === 'one-day') {
                if (now.getHours() >= cutoffHour) {
                        req.flash('error', 'One-day delivery must be ordered before 1pm. Please choose Normal delivery or order earlier.');
                        return res.redirect('/checkout');
                }
                deliveryCost = 25;
        }

        const total = Number(subtotal) + Number(deliveryCost);

        if (paymentMethod !== 'qr') {
            req.flash('error', 'Please use PayNow, PayPal, or Stripe buttons to complete payment.');
            return res.redirect('/checkout');
        }

        const orderBase = {
            userId: getUserIdFromSessionUser(req.session.user),
            items: cart.slice(),
            subtotal,
            deliveryOption: deliveryOption || 'normal',
            deliveryCost,
            total,
            paymentMethod: 'qr',
            delivery: req.session.delivery || null
        };

        // QR branch
        if (paymentMethod === 'qr') {
                const temp = Object.assign({}, orderBase, {
                        status: 'pending_payment',
                        deliveryStatus: 'processing'
                });
                addOrder(temp, (err, created) => {
                        if (err || !created || !created.id) {
                                console.error('Order create warning (QR):', err);
                                req.flash('error', 'Could not create order. Please try again.');
                                return res.redirect('/checkout');
                        }
                    OrderModel.logPaymentEvent(created.id, 'paynow_qr', 'payment_initiated', 'pending', null);
                        req.session.recentOrderId = created.id;
                        return res.redirect('/pay/qr/' + encodeURIComponent(created.id));
                });
                return;
        }

});

// Payment processing + success redirect
app.get('/payment-processing', (req, res) => {
    if (!req.session.lastOrderId) {
        return res.redirect('/orders');
    }
    res.render('payment_processing', { user: req.session.user });
});

app.get('/payment-success', (req, res) => {
    const id = req.session.lastOrderId;
    if (!id) return res.redirect('/orders');
    req.session.lastOrderId = null; // prevent revisiting payment-processing after success
    return res.redirect('/orders/' + encodeURIComponent(id) + '?public=1');
});

// Order success page (works even if session is missing after third-party redirect)
app.get('/order-success', (req, res) => {
    const orderId = String(req.query.orderId || req.session?.lastOrderId || '').trim();
    const user = req.session?.user || null;

    if (req.session) req.session.lastOrderId = null;
    if (!orderId) {
        return res.render('order_success', { user: user || null, orderId: null, order: null });
    }

    OrderModel.getOrderById(orderId, (err, order) => {
        if (err || !order) {
            return res.render('order_success', { user, orderId, order: null });
        }
        return res.render('order_success', { user, orderId, order });
    });
});

// Public order summary (no login) for post-payment redirects
app.get('/order-summary', (req, res) => {
    const orderId = String(req.query.orderId || '').trim();
    if (!orderId) return res.redirect('/order-success');
    OrderModel.getOrderById(orderId, (err, order) => {
        if (err || !order) return res.redirect('/order-success');
        return res.render('order_detail', { order, user: null });
    });
});

// Public invoice view (no login) for post-payment redirects
app.get('/invoice', (req, res) => {
    const orderId = String(req.query.orderId || '').trim();
    if (!orderId) return res.redirect('/order-success');
    OrderModel.getOrderById(orderId, (err, order) => {
        if (err || !order) return res.redirect('/order-success');
        return res.render('invoice', { order, user: null });
    });
});

// QR payment page (shows QR and allows simulating confirmation)
app.get('/pay/qr/:id', checkAuthenticated, checkNotAdmin, (req, res) => {
    const id = req.params.id;
    OrderModel.getOrderById(id, (err, o) => {
        if (err || !o) return res.status(404).send('Order not found');
        res.render('pay_qr', { order: o, user: req.session.user });
    });
});

// Confirm QR payment (simulate the callback from payment app)
app.post('/pay/qr/:id/confirm', (req, res) => {
    const id = req.params.id;
    OrderModel.getOrderById(id, (err, o) => {
        if (err || !o) return res.status(404).send('Order not found');
        if (String(o.status || '').toLowerCase() === 'paid') {
            return res.redirect('/orders/' + encodeURIComponent(id) + '?public=1');
        }
        OrderModel.markOrderPaid(id, 'paynow_qr', null, null, (err2) => {
            if (err2) {
                console.error('Failed to mark QR order paid:', err2);
                return res.status(500).send('Failed to update order');
            }
            OrderModel.deductStockForOrder(o, (deductErr) => {
                if (deductErr) console.error('Failed to deduct stock (QR):', deductErr);

                try {
                    addNotification({
                        role: 'user',
                        userId: o.userId,
                        type: 'payment',
                        message: `Receipt: Payment received for order #${o.id}.`,
                        link: '/orders/' + encodeURIComponent(o.id) + '/invoice'
                    });
                } catch (e) {
                    console.error('Failed to create receipt notification (QR):', e);
                }

                // clear cart
                if (req.session) {
                    req.session.cart = [];
                    const uid = getUserIdFromSessionUser(req.session.user);
                    if (uid) saveCartToDB(uid, req.session.cart, () => {});
                    req.session.lastOrderId = id;
                }
                return res.redirect('/orders/' + encodeURIComponent(id) + '?public=1');
            });
        });
    });
});

// User Help Center (delegates to HelpCenterController)
app.get('/help-center', checkAuthenticated, checkNotAdmin,
    HelpCenterController.userIndex(getUserIdFromSessionUser, getOrdersByUser));

app.post('/help-center/address-change', checkAuthenticated, checkNotAdmin,
    HelpCenterController.submitAddressChange(getUserIdFromSessionUser, getOrdersByUser));

app.post('/help-center/refund', checkAuthenticated, checkNotAdmin,
    HelpCenterController.submitRefund(getUserIdFromSessionUser, getOrdersByUser));

// User: list orders (delegates to OrderController)
app.get('/orders', checkAuthenticated, OrderController.listUserOrders(getUserIdFromSessionUser));

// User: printable invoice for a specific order (must come before generic /orders/:id)
app.get('/orders/:id/invoice', checkAuthenticatedOrPublic, (req, res) => {
    const id = req.params.id;
    const user = req.session.user || null;
    OrderModel.getOrderById(id, (err, order) => {
        if (err || !order) {
            req.flash('error', 'Order not found.');
            return res.redirect('/orders');
        }
        res.render('invoice', { order, user });
    });
});

// User: order detail (delegates to OrderController)
app.get('/orders/:id', checkAuthenticatedOrPublic, OrderController.userOrderDetail(getUserIdFromSessionUser));

// Admin: view all orders (delegates to OrderController)
app.get('/admin/orders', checkAuthenticated, checkAdmin, OrderController.adminListOrders());

// Admin: update order status (delegates to OrderController)
app.post('/admin/orders/:id/status', checkAuthenticated, checkAdmin, OrderController.adminUpdateStatus());


// Start the server
// Export app for tests and only start server when script is run directly
if (require.main === module) {
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
        console.log('Server is running on http://localhost:' + port);
    });
}

module.exports = app;
