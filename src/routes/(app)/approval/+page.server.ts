import { error, fail, redirect } from '@sveltejs/kit';
import type { PostgrestError } from '@supabase/supabase-js';
import type {
  PeriodCompleteness,
  PeriodPnl,
  PeriodStatus,
  ReportingBasis,
  RevenuePresentation
} from '$lib/domain';
import { MONTH_PATTERN, periodToMonth, previousPeriod } from '$lib/format';
import { canApprove, canReadAllEntities, canUnlockPeriod } from '$lib/roles';
import type { Actions, PageServerLoad } from './$types';

interface EntityRow {
  id: string;
  code: string;
  legal_name: string;
  business_line: string;
  theme_color: string;
  reporting_basis: ReportingBasis;
  revenue_presentation: RevenuePresentation;
}

interface PeriodRow {
  id: string;
  entity_id: string;
  period: string;
  status: PeriodStatus;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  locked_by: string | null;
  locked_at: string | null;
  rejection_note: string | null;
}

function fail500(context: string, cause: PostgrestError): never {
  console.error(`[approval] ${context}:`, cause.code, cause.message, cause.details);
  error(500, 'Gagal memuat antrean persetujuan.');
}

/**
 * Our own triggers raise messages written for the person reading the screen,
 * already in Indonesian — "Pengaju tidak dapat menyetujui submission-nya
 * sendiri" is the whole explanation. Those pass through verbatim; everything
 * else names tables and policies and stays in the log.
 */
function explain(context: string, cause: PostgrestError, fallback: string): string {
  console.error(`[approval] ${context}:`, cause.code, cause.message, cause.details);
  return cause.code === 'P0001' ? cause.message : fallback;
}

/**
 * Queue order: what needs a decision first. `submitted` is the only status
 * with work attached, then the two that have not been submitted yet, then the
 * ones already settled.
 */
const STATUS_RANK: Record<PeriodStatus | 'missing', number> = {
  submitted: 0,
  draft: 1,
  missing: 2,
  approved: 3,
  locked: 4
};

export const load: PageServerLoad = async ({ locals, url }) => {
  /**
   * Reviewing is reading, and an auditor reads everything (`can_read_all_
   * entities()`). The action buttons are gated separately on `canApprove()`,
   * so an auditor sees the queue and no controls — which is also what RLS
   * enforces: `periods_update` excludes `is_readonly_role()`.
   *
   * Entity staff have no business here at all and go to the dashboard, which
   * points them at their own entry screen.
   */
  if (!canReadAllEntities(locals.role)) redirect(303, '/');

  const { supabase } = locals;

  // The period has to be resolved before the rest can be queried for it.
  const { data: completenessRows, error: completenessError } = await supabase
    .from('v_period_completeness')
    .select('period, expected_entities, reported_entities, is_complete, missing_entities')
    .order('period', { ascending: false })
    .returns<PeriodCompleteness[]>();

  if (completenessError) fail500('v_period_completeness', completenessError);

  const months = (completenessRows ?? []).map((row) => ({
    ...row,
    month: periodToMonth(row.period)
  }));

  const requested = url.searchParams.get('periode');
  // An unknown or malformed ?periode= falls back to the newest month rather
  // than 404ing — a stale bookmark should still land somewhere truthful.
  const selected =
    (requested && MONTH_PATTERN.test(requested)
      ? months.find((row) => row.month === requested)
      : null) ?? months[0];

  const EMPTY = {
    months,
    month: null as string | null,
    completeness: null as PeriodCompleteness | null,
    rows: [] as QueueRow[],
    expandedId: null as string | null,
    canApprove: canApprove(locals.role),
    canUnlock: canUnlockPeriod(locals.role),
    userId: locals.user?.id ?? null
  };

  if (!selected) return EMPTY;

  const period = selected.period;

  const [entitiesResult, periodsResult, pnlResult, previousResult] = await Promise.all([
    supabase
      .from('entities')
      .select(
        'id, code, legal_name, business_line, theme_color, reporting_basis, revenue_presentation'
      )
      .eq('is_active', true)
      .order('code')
      .returns<EntityRow[]>(),
    supabase
      .from('periods')
      .select(
        'id, entity_id, period, status, submitted_by, submitted_at, approved_by, approved_at, locked_by, locked_at, rejection_note'
      )
      .eq('period', period)
      .returns<PeriodRow[]>(),
    supabase.from('v_period_pnl').select('*').eq('period', period).returns<PeriodPnl[]>(),
    /** Month-over-month comparison. The previous calendar month, not last
        year — the prototype labelled one as the other. */
    supabase
      .from('v_period_pnl')
      .select('*')
      .eq('period', previousPeriod(period))
      .returns<PeriodPnl[]>()
  ]);

  const firstError =
    entitiesResult.error ?? periodsResult.error ?? pnlResult.error ?? previousResult.error;
  if (firstError) fail500('approval queue queries', firstError);

  const entities = entitiesResult.data ?? [];
  const periods = periodsResult.data ?? [];

  /**
   * Names, not UUIDs. Only the actors actually on screen are fetched — the
   * whole `profiles` table is not this screen's business, and it grows.
   */
  const actorIds = [
    ...new Set(
      periods.flatMap((row) =>
        [row.submitted_by, row.approved_by, row.locked_by].filter(
          (id): id is string => id !== null
        )
      )
    )
  ];

  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', actorIds)
      .returns<{ id: string; full_name: string }[]>();

    if (profilesError) fail500('profiles', profilesError);
    for (const profile of profiles ?? []) names.set(profile.id, profile.full_name);
  }

  const pnlByEntity = new Map((pnlResult.data ?? []).map((row) => [row.entity_id, row]));
  const previousByEntity = new Map((previousResult.data ?? []).map((row) => [row.entity_id, row]));
  const periodByEntity = new Map(periods.map((row) => [row.entity_id, row]));

  /**
   * One row per active entity, whether or not it has a period. An entity that
   * has not started has to be visible as not started — the prototype dropped
   * non-reporting entities, which made a partial queue look complete.
   */
  const rows: QueueRow[] = entities
    .map((entity) => {
      const row = periodByEntity.get(entity.id) ?? null;
      return {
        entity,
        period: row,
        pnl: pnlByEntity.get(entity.id) ?? null,
        previous: previousByEntity.get(entity.id) ?? null,
        submitterName: row?.submitted_by ? (names.get(row.submitted_by) ?? null) : null,
        approverName: row?.approved_by ? (names.get(row.approved_by) ?? null) : null,
        lockerName: row?.locked_by ? (names.get(row.locked_by) ?? null) : null
      };
    })
    .sort((a, b) => {
      const rankA = STATUS_RANK[a.period?.status ?? 'missing'];
      const rankB = STATUS_RANK[b.period?.status ?? 'missing'];
      return rankA - rankB || a.entity.code.localeCompare(b.entity.code, 'id');
    });

  /**
   * Which review panel is open lives in the URL, not in component state. It
   * survives an action, a reload and a shared link, and it works with
   * JavaScript off — the panel is the screen, so it cannot depend on JS.
   */
  const requestedPanel = url.searchParams.get('buka');
  const expandedId = rows.some((row) => row.period?.id === requestedPanel)
    ? requestedPanel
    : null;

  return {
    ...EMPTY,
    month: selected.month,
    completeness: selected,
    rows,
    expandedId
  };
};

export interface QueueRow {
  entity: EntityRow;
  period: PeriodRow | null;
  pnl: PeriodPnl | null;
  previous: PeriodPnl | null;
  submitterName: string | null;
  approverName: string | null;
  lockerName: string | null;
}

/**
 * Every action is the same shape: one UPDATE on `periods`, then read back
 * whether it landed.
 *
 * Nothing here checks the role or the current status first. `guard_period_
 * transition` owns the rules — which transitions exist, who may perform them,
 * that an actor column must be the caller, that a submitter cannot approve
 * their own work — and its refusals are already written for the user. A second
 * copy of those rules in TypeScript could only ever disagree with the first.
 *
 * The read-back matters: an UPDATE the RLS USING clause refuses returns an
 * empty result and no error (TESTING.md, "How to read a refusal"). Without it
 * an auditor pressing a button they should not have would be told it worked.
 */
type Transition = { ok: true } | { ok: false; status: number; message: string };

async function transition(
  locals: App.Locals,
  periodId: string,
  patch: Record<string, unknown>,
  context: string,
  fallback: string
): Promise<Transition> {
  const { data, error: updateError } = await locals.supabase
    .from('periods')
    .update(patch)
    .eq('id', periodId)
    .select('status')
    .maybeSingle<{ status: PeriodStatus }>();

  if (updateError) {
    return { ok: false, status: 400, message: explain(context, updateError, fallback) };
  }
  if (!data) {
    return {
      ok: false,
      status: 403,
      message:
        'Perubahan ini ditolak untuk akun Anda. Muat ulang halaman untuk melihat keadaan terkini.'
    };
  }
  return { ok: true };
}

function periodIdFrom(form: FormData): string | null {
  const id = String(form.get('periodId') ?? '').trim();
  return id === '' ? null : id;
}

export const actions: Actions = {
  approve: async ({ locals, request }) => {
    if (!locals.user) redirect(303, '/login');
    const form = await request.formData();
    const periodId = periodIdFrom(form);
    if (!periodId) return fail(400, { message: 'Periode tidak dikenali.' });

    /**
     * `approved_by` goes in the same UPDATE as the status. The trigger
     * requires it to equal `auth.uid()`, and the segregation-of-duties check
     * compares it against `submitted_by` — omitting it used to make that
     * comparison evaluate to NULL and pass silently.
     */
    const result = await transition(
      locals,
      periodId,
      {
        status: 'approved',
        approved_by: locals.user.id,
        approved_at: new Date().toISOString()
      },
      'approve',
      'Gagal menyetujui periode.'
    );
    if (!result.ok) return fail(result.status, { message: result.message });
    return { done: 'approve' as const };
  },

  reject: async ({ locals, request }) => {
    const form = await request.formData();
    const periodId = periodIdFrom(form);
    if (!periodId) return fail(400, { message: 'Periode tidak dikenali.' });

    /**
     * The note is not validated here. The textarea is `required`, so the
     * browser stops an empty one before it is sent; if it arrives empty
     * anyway the trigger refuses it with its own sentence, which is the
     * message worth showing. A duplicate check here would only be a second
     * place for the rule to drift.
     */
    const result = await transition(
      locals,
      periodId,
      { status: 'draft', rejection_note: String(form.get('note') ?? '') },
      'reject',
      'Gagal menolak periode.'
    );
    if (!result.ok) return fail(result.status, { message: result.message });
    return { done: 'reject' as const };
  },

  lock: async ({ locals, request }) => {
    if (!locals.user) redirect(303, '/login');
    const form = await request.formData();
    const periodId = periodIdFrom(form);
    if (!periodId) return fail(400, { message: 'Periode tidak dikenali.' });

    const result = await transition(
      locals,
      periodId,
      {
        status: 'locked',
        locked_by: locals.user.id,
        locked_at: new Date().toISOString()
      },
      'lock',
      'Gagal mengunci periode.'
    );
    if (!result.ok) return fail(result.status, { message: result.message });
    return { done: 'lock' as const };
  },

  /**
   * Unlocking is `locked -> draft`, and every return to draft carries a
   * mandatory note — the trigger requires one for `locked` exactly as it does
   * for `submitted`. Reopening a period that was declared final needs a
   * written reason more, not less, so the form collects one.
   */
  unlock: async ({ locals, request }) => {
    const form = await request.formData();
    const periodId = periodIdFrom(form);
    if (!periodId) return fail(400, { message: 'Periode tidak dikenali.' });

    const result = await transition(
      locals,
      periodId,
      { status: 'draft', rejection_note: String(form.get('note') ?? '') },
      'unlock',
      'Gagal membuka kunci periode.'
    );
    if (!result.ok) return fail(result.status, { message: result.message });
    return { done: 'unlock' as const };
  }
};
