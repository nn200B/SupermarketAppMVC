const UserModel = require('../models/User');

module.exports = {
  // GET /admin/users
  list(req, res) {
    UserModel.getAllUsers((err, users) => {
      if (err) {
        console.error('Failed to load users for admin management:', err);
        req.flash('error', 'Could not load users.');
        return res.redirect('/inventory');
      }
      res.render('admin_users', {
        user: req.session.user,
        users: users || [],
        errors: req.flash('error'),
        success: req.flash('success')
      });
    });
  },

  // POST /admin/users/:id/delete
  delete(req, res) {
    const id = req.params.id;
    if (!id) {
      req.flash('error', 'Missing user id.');
      return res.redirect('/admin/users');
    }

    // Prevent admin from deleting themselves or any other admin
    if (req.session && req.session.user && String(req.session.user.id) === String(id)) {
      req.flash('error', 'You cannot delete your own account while logged in.');
      return res.redirect('/admin/users');
    }

    // Check target user's role before deletion
    UserModel.getUserById(id, (findErr, targetUser) => {
      if (findErr) {
        console.error('Failed to load user for deletion:', findErr);
        req.flash('error', 'Could not delete user.');
        return res.redirect('/admin/users');
      }

      if (!targetUser) {
        req.flash('error', 'User not found or already deleted.');
        return res.redirect('/admin/users');
      }

      if (String(targetUser.role).toLowerCase() === 'admin') {
        req.flash('error', 'You cannot delete another admin account.');
        return res.redirect('/admin/users');
      }

      UserModel.deleteUserById(id, (err, result) => {
        if (err) {
          console.error('Failed to delete user:', err);
          req.flash('error', 'Could not delete user.');
        } else if (!result || !result.affectedRows) {
          req.flash('error', 'User not found or already deleted.');
        } else {
          req.flash('success', 'User account deleted successfully.');
        }
        return res.redirect('/admin/users');
      });
    });
  }
};
