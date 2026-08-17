const DEFAULT_ADMIN_CODE = 'COINLENS-ADMIN';

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function isAdminRole(role) {
  return normalizeRole(role) === 'admin';
}

function isAdminCodeValid(code, configuredCode = '') {
  const input = String(code || '').trim();
  if (!input) return false;

  const candidates = [configuredCode, DEFAULT_ADMIN_CODE].filter(Boolean).map((value) => String(value).trim());
  return candidates.includes(input);
}

function isAdminUser(user, configuredCode = '') {
  if (!user) return false;
  if (isAdminRole(user.role)) return true;
  if (isAdminCodeValid(user.adminCode, configuredCode)) return true;
  return String(user.email || '').trim().toLowerCase() === 'admin@coinlens.app';
}

module.exports = {
  DEFAULT_ADMIN_CODE,
  isAdminCodeValid,
  isAdminUser,
};
