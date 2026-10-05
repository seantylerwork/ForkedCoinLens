function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function isAdminUser(user) {
  if (!user) return false;
  return normalizeRole(user.role) === 'admin';
}

// auth user_metadata is writable by the signed-in user themselves
// (supabase.auth.updateUser), so it must never be trusted for admin status -
// every mapped user starts as 'member' here. The real role comes only from
// the profiles table (see mergeProfileRole), which has no client UPDATE
// policy and so can only be changed via the Supabase dashboard or the
// server's service-role key.
function mapSupabaseUser(supabaseUser) {
  if (!supabaseUser) return null;
  const metadata = supabaseUser.user_metadata || {};
  return {
    id: supabaseUser.id,
    name: metadata.display_name || metadata.name || supabaseUser.email || 'Member',
    email: supabaseUser.email || '',
    role: 'member',
    createdAt: supabaseUser.created_at ? new Date(supabaseUser.created_at).getTime() : Date.now(),
  };
}

// Applies the authoritative role from the user's profiles row (fetched
// separately, after auth) onto an already-mapped user.
function mergeProfileRole(user, profileRole) {
  if (!user) return user;
  return { ...user, role: normalizeRole(profileRole) === 'admin' ? 'admin' : 'member' };
}

const FRIENDLY_AUTH_ERRORS = [
  [/already registered/i, 'An account with this email already exists.'],
  [/invalid login credentials/i, 'Incorrect email or password.'],
  [/password should be at least/i, 'Password must be at least 6 characters.'],
];

function friendlyAuthError(error) {
  const message = error?.message || 'Something went wrong. Please try again.';
  const match = FRIENDLY_AUTH_ERRORS.find(([pattern]) => pattern.test(message));
  return match ? match[1] : message;
}

module.exports = {
  isAdminUser,
  mapSupabaseUser,
  mergeProfileRole,
  friendlyAuthError,
};
