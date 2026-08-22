import { error, fail, redirect } from '@sveltejs/kit';
import type { PostgrestError } from '@supabase/supabase-js';
import type { PeriodStatus } from '$lib/domain';
import { MONTH_PATTERN, currentPeriod, formatPeriod, nextPeriod, periodToMonth } from '$lib/format';
import { canEnterReports } from '$lib/roles';
import { loadEntryAccess, type EntryEntity } from './access';
import type { Actions, PageServerLoad } from './$types';

interface PeriodRow {
  id: string;
  period: string;
  status: PeriodStatus;
  updated_at: string;
}

/**
 * Postgres messages name tables, columns and policies — the schema map an
 * attacker is probing for. Same split as `(app)/+page.server.ts`: everything
 * to the server log, a fixed sentence to the browser.
 *
 * The exception is our own `raise exception` triggers. Those messages were
 * written for the person reading the screen and are already in Indonesian, so
 * they pass through as they are. `P0001` is how they are recognised.
 */
function explain(context: string, cause: PostgrestError, fallback: string): string {
  console.error(`[entry] ${context}:`, cause.code, cause.message, cause.details);
  return cause.code === 'P0001' ? cause.message : fallback;
}

function failLoad(context: string, cause: PostgrestError): never {
  console.error(`[entry] ${context}:`, cause.code, cause.message, cause.details);
  error(500, 'Gagal memuat daftar periode.');
}

/**
 * One shape for every branch. SvelteKit widens a load's return type before it
 * reaches the component, so a discriminated union would not narrow there.
 */
const EMPTY = {
  wrongRole: false,
  entities: [] as EntryEntity[],
  selected: null as EntryEntity | null,
  periods: [] as PeriodRow[],
  defaultMonth: '',
  submittedPeriod: null as string | null
};

export const load: PageServerLoad = async ({ locals, url }) => {
  /**
   * Only entity staff fill in a report (`roles.ts`). This is UI shaping, not
   * the boundary: a manager who posts to the actions below is still stopped
   * by RLS and the period triggers, not by this branch.
   */
  if (!canEnterReports(locals.role)) return { ...EMPTY, wrongRole: true };

  const { entities, selected, error: accessError } = await loadEntryAccess(
    locals.supabase,
    url.searchParams.get('entitas')
  );
  if (accessError) failLoad('user_entity_access', accessError);

  // No entity linked to the account. An empty screen with an instruction, not
  // a 500 — the fix is an administrative one and the user needs to be told.
  if (!selected) return { ...EMPTY, entities };

  const { data, error: periodsError } = await locals.supabase
    .from('periods')
    .select('id, period, status, updated_at')
    .eq('entity_id', selected.id)
    .order('period', { ascending: false })
    .returns<PeriodRow[]>();

  if (periodsError) failLoad('periods', periodsError);

  const periods = data ?? [];

  /**
   * The month after the newest period, whatever its status — a gap is much
   * more likely a month nobody has filled in yet than a month to skip. With
   * no periods at all, the current month in Jakarta.
   */
  const defaultMonth = periodToMonth(
    periods.length > 0 ? nextPeriod(periods[0].period) : currentPeriod()
  );

  return {
    ...EMPTY,
    entities,
    selected,
    periods,
    defaultMonth,
    submittedPeriod: url.searchParams.get('terkirim')
  };
};

export const actions: Actions = {
  /**
   * A period needs a template, and the template decides which line codes
   * exist. Creating one without a template would leave a period whose every
   * subsequent line is refused by `guard_line_code_in_template` — a period
   * that can never be filled in.
   */
  createPeriod: async ({ locals, request }) => {
    const form = await request.formData();
    const month = String(form.get('bulan') ?? '').trim();

    if (!MONTH_PATTERN.test(month)) {
      return fail(400, { message: 'Bulan tidak valid. Pilih bulan dalam format YYYY-MM.' });
    }

    // The entity arrives in the POST, so it is re-resolved against the access
    // list rather than trusted.
    const { selected, error: accessError } = await loadEntryAccess(
      locals.supabase,
      String(form.get('entitas') ?? '')
    );
    if (accessError) {
      return fail(500, {
        message: explain('user_entity_access', accessError, 'Gagal memeriksa akses entitas.')
      });
    }
    if (!selected) {
      return fail(403, { message: 'Akun Anda belum ditautkan ke entitas mana pun.' });
    }

    const { data: template, error: templateError } = await locals.supabase
      .from('report_templates')
      .select('id')
      .eq('business_line', selected.business_line)
      .eq('is_active', true)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (templateError) {
      return fail(500, {
        message: explain('report_templates', templateError, 'Gagal memuat template laporan.')
      });
    }
    if (!template) {
      return fail(400, { message: 'Belum ada template laporan untuk lini usaha ini.' });
    }

    /**
     * `status`, `submitted_by` and `created_by` are deliberately absent.
     * `guard_period_insert` forces the status to draft, clears every
     * workflow-trail column and sets `created_by` from `auth.uid()` — a value
     * sent from here would either be overwritten or rejected.
     */
    const { error: insertError } = await locals.supabase.from('periods').insert({
      entity_id: selected.id,
      period: `${month}-01`,
      template_id: template.id
    });

    if (insertError) {
      // 23505 is the (entity_id, period) unique index. Its own message names
      // the constraint, which tells the user nothing.
      const fallback =
        insertError.code === '23505'
          ? `Periode ${formatPeriod(`${month}-01`)} sudah ada untuk ${selected.code}.`
          : 'Gagal membuat periode baru.';
      return fail(400, { message: explain('periods insert', insertError, fallback) });
    }

    redirect(303, `/entry/${month}?entitas=${encodeURIComponent(selected.code)}`);
  }
};
