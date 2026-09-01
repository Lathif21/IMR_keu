import { error, fail, redirect } from '@sveltejs/kit';
import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import type { UserRole } from '$lib/domain';
import { isEntityScopedRole } from '$lib/roles';
import type { Actions, PageServerLoad } from './$types';

export interface AdminProfile {
  id: string;
  full_name: string;
  role: UserRole;
  phone: string | null;
  is_active: boolean;
}

const ROLES: UserRole[] = ['direksi', 'manajer_keuangan', 'staf_entitas', 'auditor'];
const MIN_PASSWORD = 8;

/**
 * The only place in the application that holds the service role key.
 *
 * Built per request, never as a module singleton: a singleton is one accidental
 * `export` away from being importable somewhere it has no business being, and
 * it keeps a bypass-everything client alive for the lifetime of the process.
 *
 * `$env/static/private` is what stops this reaching the browser — SvelteKit
 * refuses to bundle it into client code. That refusal is the last line of
 * defence, not the first: nothing below ever returns a raw auth user, and no
 * password is ever logged or sent back.
 */
function adminClient(): SupabaseClient {
  return createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function failLoad(context: string, cause: PostgrestError | Error): never {
  console.error(`[admin/users] ${context}:`, cause.message);
  error(500, 'Gagal memuat daftar pengguna.');
}

function explain(context: string, cause: PostgrestError, fallback: string): string {
  console.error(`[admin/users] ${context}:`, cause.code, cause.message, cause.details);
  return cause.code === 'P0001' ? cause.message : fallback;
}

/**
 * The system must keep at least one active director, because only a director
 * can administer entities, templates and users. Two different paths can break
 * that, and both are checked: deactivating the last one, and demoting them.
 *
 * Demotion is the one that actually bites. Deactivation is already blocked one
 * step earlier by the "not yourself" rule — with a single director left, the
 * only account they could deactivate is their own. Changing their own role has
 * no such shield, and losing the last director that way leaves the admin
 * screens unreachable for everyone, recoverable only with SQL.
 */
async function isLastActiveDirector(
  supabase: SupabaseClient,
  targetId: string
): Promise<boolean> {
  const { data: target } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', targetId)
    .maybeSingle<{ role: UserRole; is_active: boolean }>();

  if (target?.role !== 'direksi' || !target.is_active) return false;

  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'direksi')
    .eq('is_active', true);

  return (count ?? 0) <= 1;
}

const LAST_DIRECTOR_MESSAGE =
  'Ini direksi aktif terakhir. Tanpa satu pun direksi aktif, tidak ada yang dapat mengelola ' +
  'entitas, template, dan pengguna — dan tidak ada jalan kembali lewat aplikasi.';

export const load: PageServerLoad = async ({ locals, url }) => {
  const [profilesResult, accessResult, entitiesResult] = await Promise.all([
    locals.supabase
      .from('profiles')
      .select('id, full_name, role, phone, is_active')
      .order('is_active', { ascending: false })
      .order('full_name')
      .returns<AdminProfile[]>(),
    locals.supabase
      .from('user_entity_access')
      .select('user_id, entity_id')
      .returns<{ user_id: string; entity_id: string }[]>(),
    locals.supabase
      .from('entities')
      .select('id, code, legal_name, is_active')
      .eq('is_active', true)
      .order('code')
      .returns<{ id: string; code: string; legal_name: string; is_active: boolean }[]>()
  ]);

  const firstError = profilesResult.error ?? accessResult.error ?? entitiesResult.error;
  if (firstError) failLoad('profile queries', firstError);

  /**
   * Email lives in `auth.users`, which PostgREST does not expose. Only the
   * address is taken — never the raw user object, which carries tokens and
   * provider metadata nothing on this screen needs.
   */
  const emails = new Map<string, string>();
  const { data: authUsers, error: authError } = await adminClient().auth.admin.listUsers({
    page: 1,
    perPage: 200
  });
  if (authError) failLoad('listUsers', authError);
  for (const user of authUsers?.users ?? []) {
    if (user.email) emails.set(user.id, user.email);
  }

  const accessByUser = new Map<string, string[]>();
  for (const row of accessResult.data ?? []) {
    accessByUser.set(row.user_id, [...(accessByUser.get(row.user_id) ?? []), row.entity_id]);
  }

  const entities = entitiesResult.data ?? [];
  const users = (profilesResult.data ?? []).map((profile) => ({
    ...profile,
    email: emails.get(profile.id) ?? null,
    entityIds: accessByUser.get(profile.id) ?? []
  }));

  return {
    users,
    entities,
    /** Guards the two application-level rules in the actions below. */
    selfId: locals.user?.id ?? null,
    activeDirectors: users.filter((u) => u.role === 'direksi' && u.is_active).length,
    editingId: url.searchParams.get('ubah'),
    creating: url.searchParams.get('baru') !== null
  };
};

export const actions: Actions = {
  /**
   * Two steps that must both land. An auth account without a profile makes
   * `current_user_role()` null, and the person sees an empty application with
   * no explanation — so a failed profile insert takes the auth user with it.
   */
  createUser: async ({ locals, request }) => {
    const form = await request.formData();
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    const password = String(form.get('password') ?? '');
    const fullName = String(form.get('full_name') ?? '').trim();
    const role = String(form.get('role') ?? '') as UserRole;
    const phone = String(form.get('phone') ?? '').trim();

    if (!email.includes('@')) return fail(400, { message: 'Email tidak valid.' });
    if (fullName === '') return fail(400, { message: 'Nama lengkap wajib diisi.' });
    if (!ROLES.includes(role)) return fail(400, { message: 'Peran tidak dikenal.' });
    // Checked on the server, not only in the browser.
    if (password.length < MIN_PASSWORD) {
      return fail(400, { message: `Password minimal ${MIN_PASSWORD} karakter.` });
    }

    const admin = adminClient();

    /**
     * `email_confirm: true` skips verification. There is no SMTP configured,
     * and without this the account cannot log in at all — see the security
     * note in README.md.
     */
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (createError || !created?.user) {
      // The message may name the address; the password is never in it.
      console.error('[admin/users] createUser:', createError?.message);
      return fail(400, {
        message: createError?.message.includes('already')
          ? 'Email itu sudah terdaftar.'
          : 'Gagal membuat akun.'
      });
    }

    const { error: profileError } = await locals.supabase.from('profiles').insert({
      id: created.user.id,
      full_name: fullName,
      role,
      phone: phone === '' ? null : phone
    });

    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return fail(400, {
        message: explain('insert profile', profileError, 'Gagal membuat profil; akun dibatalkan.')
      });
    }

    // Entity links mean something for every role but direksi, which sees all
    // entities without a row here.
    if (isEntityScopedRole(role)) {
      const entityIds = form.getAll('entity_ids').map(String).filter(Boolean);
      if (entityIds.length > 0) {
        const { error: accessError } = await locals.supabase.from('user_entity_access').insert(
          entityIds.map((entity_id) => ({
            user_id: created.user.id,
            entity_id,
            granted_by: locals.user?.id ?? null
          }))
        );
        if (accessError) {
          return fail(400, {
            message: explain('grant access', accessError, 'Akun dibuat, penautan entitas gagal.')
          });
        }
      }
    }

    redirect(303, '/admin/users');
  },

  /**
   * Ordinary profile columns, through the caller's own RLS. No service role:
   * `profiles_manage` already restricts this to direksi, and reaching for a
   * bypass where the policy suffices is how a bypass becomes routine.
   */
  updateUser: async ({ locals, request }) => {
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const fullName = String(form.get('full_name') ?? '').trim();
    const role = String(form.get('role') ?? '') as UserRole;
    const phone = String(form.get('phone') ?? '').trim();

    if (fullName === '') return fail(400, { message: 'Nama lengkap wajib diisi.' });
    if (!ROLES.includes(role)) return fail(400, { message: 'Peran tidak dikenal.' });

    if (role !== 'direksi' && (await isLastActiveDirector(locals.supabase, id))) {
      return fail(400, { message: LAST_DIRECTOR_MESSAGE });
    }

    const { error: updateError } = await locals.supabase
      .from('profiles')
      .update({ full_name: fullName, role, phone: phone === '' ? null : phone })
      .eq('id', id);

    if (updateError) {
      return fail(400, {
        message: explain('update profile', updateError, 'Gagal menyimpan perubahan.')
      });
    }

    /**
     * Promotion to direksi makes the access rows irrelevant, but they are
     * kept: if the role is handed back, the links are still there, and direksi
     * reads every entity through `can_read_all_entities()` regardless.
     *
     * The other three roles all reconcile here. Before entity scoping reached
     * manajer and auditor this branch was `role === 'staf_entitas'`, so
     * editing a manajer silently discarded whatever the form submitted — which
     * was harmless while the rows meant nothing, and would now be the
     * difference between that manajer seeing four entities or none.
     */
    if (isEntityScopedRole(role)) {
      const wanted = new Set(form.getAll('entity_ids').map(String).filter(Boolean));

      const { data: current, error: readError } = await locals.supabase
        .from('user_entity_access')
        .select('entity_id')
        .eq('user_id', id)
        .returns<{ entity_id: string }[]>();

      if (readError) {
        return fail(400, { message: explain('read access', readError, 'Gagal membaca akses.') });
      }

      const have = new Set((current ?? []).map((row) => row.entity_id));
      const toAdd = [...wanted].filter((entityId) => !have.has(entityId));
      const toRemove = [...have].filter((entityId) => !wanted.has(entityId));

      if (toAdd.length > 0) {
        const { error: addError } = await locals.supabase.from('user_entity_access').insert(
          // granted_by comes from the session, never from the form.
          toAdd.map((entity_id) => ({ user_id: id, entity_id, granted_by: locals.user?.id ?? null }))
        );
        if (addError) {
          return fail(400, { message: explain('grant access', addError, 'Gagal menambah akses.') });
        }
      }

      if (toRemove.length > 0) {
        const { error: removeError } = await locals.supabase
          .from('user_entity_access')
          .delete()
          .eq('user_id', id)
          .in('entity_id', toRemove);
        if (removeError) {
          return fail(400, {
            message: explain('revoke access', removeError, 'Gagal mencabut akses.')
          });
        }
      }
    }

    redirect(303, '/admin/users');
  },

  /**
   * Two application-level guards, not triggers. Both mistakes are reversible
   * with one SQL statement and the culprit is in `audit_log` either way —
   * not yet worth enforcing in the database.
   */
  toggleActive: async ({ locals, request }) => {
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const next = form.get('is_active') === 'true';

    if (!next && id === locals.user?.id) {
      return fail(400, { message: 'Tidak dapat menonaktifkan akun Anda sendiri.' });
    }

    if (!next && (await isLastActiveDirector(locals.supabase, id))) {
      return fail(400, { message: LAST_DIRECTOR_MESSAGE });
    }

    const { error: updateError } = await locals.supabase
      .from('profiles')
      .update({ is_active: next })
      .eq('id', id);

    if (updateError) {
      return fail(400, {
        message: explain('toggle profile', updateError, 'Gagal mengubah status pengguna.')
      });
    }

    redirect(303, '/admin/users');
  },

  resetPassword: async ({ request }) => {
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const password = String(form.get('password') ?? '');

    if (password.length < MIN_PASSWORD) {
      return fail(400, { message: `Password minimal ${MIN_PASSWORD} karakter.` });
    }

    const { error: resetError } = await adminClient().auth.admin.updateUserById(id, { password });

    if (resetError) {
      // Deliberately not interpolating anything from the request.
      console.error('[admin/users] resetPassword failed');
      return fail(400, { message: 'Gagal mengganti password.' });
    }

    redirect(303, '/admin/users');
  }
};
