function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function isAdminUser(user) {
  if (!user) return false;
  return normalizeRole(user.role) === 'admin';
}

module.exports = {
  isAdminUser,
};
