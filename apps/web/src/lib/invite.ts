import { supabaseService } from './supabase/service';

/**
 * Find the Auth login for an email, or create one (email confirmed, no password — they sign in with an emailed code).
 * The ONLY service-role use in a user-facing action. Callers must have checked the signed-in person's users.manage first; everything that
 * touches the school (membership, role, guardian/staff link) is then done by invite_member() as that person, under the database's rules.
 * Creating a login gives no access to anything by itself: a login without a school membership sees nothing.
 */
export async function findOrCreateLogin(email: string, fullName: string): Promise<{ id: string; created: boolean }> {
  const svc = supabaseService();
  const { data: existing, error: e1 } = await svc.rpc('auth_user_id', { p_email: email });
  if (e1) throw new Error('lookup_failed');
  if (existing) return { id: existing as string, created: false };
  const { data, error } = await svc.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: fullName } });
  if (error || !data.user) {
    // a race with another invite for the same email: look it up again
    const { data: again } = await svc.rpc('auth_user_id', { p_email: email });
    if (again) return { id: again as string, created: false };
    throw new Error('create_failed');
  }
  return { id: data.user.id, created: true };
}
