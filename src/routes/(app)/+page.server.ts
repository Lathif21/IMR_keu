import { error } from '@sveltejs/kit';
import type { PostgrestError } from '@supabase/supabase-js';
import type {
  GroupConsolidated,
  PeriodCompleteness,
  PeriodPnl,
  ReportingBasis,
  RevenuePresentation
} from '$lib/domain';
import { previousPeriod } from '$lib/format';
import { canReadAllEntities } from '$lib/roles';
import type { PageServerLoad } from './$types';

interface EntityRow {
  id: string;
  code: string;
  legal_name: string;
  business_line: string;
  icon_key: string;
  theme_color: string;
  reporting_basis: ReportingBasis;
  revenue_presentation: RevenuePresentation;
}

interface OpenPolicy {
  policy_key: string;
  entity_id: string | null;
}

/**
 * Postgres messages name tables, columns and policies. That is exactly what
 * an attacker probing the schema wants, so it goes to the server log and the
 * browser gets a fixed sentence.
 */
function fail(context: string, cause: PostgrestError): never {
  console.error(`[dashboard] ${context}:`, cause.code, cause.message, cause.details);
  error(500, 'Gagal memuat data dasbor.');
}

/**
 * One shape for every branch. SvelteKit widens a load's return type before it
 * reaches the component, so a discriminated union would not narrow there —
 * returning the same keys with empty defaults keeps the page honest without
 * non-null assertions.
 */
const EMPTY = {
  scoped: false,
  periods: [] as PeriodCompleteness[],
  period: null as string | null,
  completeness: null as PeriodCompleteness | null,
  consolidated: null as GroupConsolidated | null,
  previous: null as GroupConsolidated | null,
  pnl: [] as PeriodPnl[],
  entities: [] as EntityRow[],
  openPolicies: [] as OpenPolicy[]
};

export const load: PageServerLoad = async ({ locals, url }) => {
  /**
   * A group total read under entity-scoped RLS is a different number, not a
   * smaller one (CONTEXT.md, "Kelengkapan"). Entity staff see only their own
   * entity, so rendering a "consolidated" figure for them would quietly show
   * one entity's revenue as the group's. Refuse instead.
   */
  if (!canReadAllEntities(locals.role)) {
    return { ...EMPTY, scoped: true };
  }

  const { supabase } = locals;

  const { data: periodRows, error: periodsError } = await supabase
    .from('v_period_completeness')
    .select('period, expected_entities, reported_entities, is_complete, missing_entities')
    .order('period', { ascending: false })
    .returns<PeriodCompleteness[]>();

  if (periodsError) fail('v_period_completeness', periodsError);

  const periods = periodRows ?? [];
  if (periods.length === 0) return { ...EMPTY, periods };

  // An unknown ?periode= falls back to the newest period rather than 404ing —
  // a stale bookmark should still land somewhere truthful.
  const requested = url.searchParams.get('periode');
  const selected = periods.find((p) => p.period === requested) ?? periods[0];
  const period = selected.period;

  const [consolidatedResult, previousResult, pnlResult, entitiesResult, policiesResult] =
    await Promise.all([
      supabase
        .from('v_group_consolidated')
        .select('*')
        .eq('period', period)
        .maybeSingle<GroupConsolidated>(),
      supabase
        .from('v_group_consolidated')
        .select('*')
        .eq('period', previousPeriod(period))
        .maybeSingle<GroupConsolidated>(),
      supabase.from('v_period_pnl').select('*').eq('period', period).returns<PeriodPnl[]>(),
      supabase
        .from('entities')
        .select(
          'id, code, legal_name, business_line, icon_key, theme_color, reporting_basis, revenue_presentation'
        )
        .eq('is_active', true)
        .order('code')
        .returns<EntityRow[]>(),
      // chosen_value IS NULL means the accountant has not decided. The UI has
      // to surface that rather than pick a default (invariant 8).
      supabase
        .from('accounting_policies')
        .select('policy_key, entity_id')
        .is('chosen_value', null)
        .returns<OpenPolicy[]>()
    ]);

  const firstError =
    consolidatedResult.error ??
    previousResult.error ??
    pnlResult.error ??
    entitiesResult.error ??
    policiesResult.error;
  if (firstError) fail('dashboard queries', firstError);

  return {
    ...EMPTY,
    periods,
    period,
    completeness: selected,
    consolidated: consolidatedResult.data,
    /** Previous calendar month. Month-over-month — not year-over-year. */
    previous: previousResult.data,
    pnl: pnlResult.data ?? [],
    entities: entitiesResult.data ?? [],
    openPolicies: policiesResult.data ?? []
  };
};
