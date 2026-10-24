/**
 * Evaluates whether the current user satisfies a route access rule.
 * Supported rules: 'public', 'authenticated', 'private', 'protected',
 * or role match expressions like "profile === 'Admin_c'".
 */
export function verifyRouteAccess(rule, user) {
  if (!rule || rule === 'public') return true;
  if (!user) return false;
  if (rule === 'authenticated' || rule === 'private' || rule === 'protected') return true;

  const profile = String(user.profile || '').trim();

  if (rule === "profile === 'Admin_c'" || rule === 'admin' || rule === 'Admin_c') {
    return profile === 'Admin_c';
  }

  if (rule === "profile === 'Manager_c'" || rule === 'manager' || rule === 'Manager_c') {
    return profile === 'Manager_c';
  }

  if (typeof rule === 'function') {
    return Boolean(rule(user));
  }

  return false;
}
