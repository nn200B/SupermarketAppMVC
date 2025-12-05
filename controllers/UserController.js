const UserModel = require('../models/User');

module.exports = {
  register(req, res) {
    const { username, email, password, address, contact } = req.body || {};
    if (!username || !email || !password) return res.status(400).render('register', { error: 'Required fields missing' });

    // Reuse existing registration logic from app.js (SHA1 in DB)
    const db = require('../db');
    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
    const finalRole = 'user';
    db.query(sql, [username, email, password, address, contact, finalRole], (err, result) => {
      if (err) return res.status(500).render('register', { error: 'Registration failed' });
      if (req.session) req.session.user = { id: result.insertId, username, email, role: finalRole };
      req.flash('success', 'Registration successful');
      return res.redirect('/');
    });
  },

  login(req, res) {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).render('login', { error: 'Required fields missing' });
    const db = require('../db');
    const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';
    db.query(sql, [email, password], (err, results) => {
      if (err) return res.status(500).render('login', { error: 'Login failed' });
      if (!results || results.length === 0) return res.status(401).render('login', { error: 'Invalid credentials' });
      const user = results[0];
      if (req.session) req.session.user = user;
      req.flash('success', 'Login successful');
      if (user.role === 'admin') return res.redirect('/inventory');
      return res.redirect('/shopping');
    });
  },

  logout(req, res) {
    if (req.session) {
      req.session.destroy(() => res.redirect('/'));
      return;
    }
    return res.redirect('/');
  },

  checkAuth(req, res, next) {
    if (req.session && req.session.user) return next();
    req.flash('error', 'Please log in');
    return res.redirect('/login');
  },

  checkAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.role === 'admin') return next();
    req.flash('error', 'Admin access required');
    return res.redirect('/');
  },

  // GET /profile
  profile(req, res) {
    const currentUser = req.session && req.session.user;
    if (!currentUser) return res.redirect('/login');

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
  },

  // POST /profile
  updateProfile(req, res) {
    const currentUser = req.session && req.session.user;
    if (!currentUser) return res.redirect('/login');

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

      // keep session in sync
      req.session.user.username = username;
      req.session.user.email = email;
      req.session.user.address = address;
      req.session.user.contact = contact;

      req.flash('success', 'Profile updated successfully');
      return res.redirect('/profile');
    });
  },

  // POST /change-password
  changePassword(req, res) {
    const currentUser = req.session && req.session.user;
    if (!currentUser) return res.redirect('/login');

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
  }
};
