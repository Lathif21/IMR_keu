import { error } from '@sveltejs/kit';
import type { PostgrestError } from '@supabase/supabase-js';
import type { PeriodPnl, ReportingBasis, RevenuePresentation } from '$lib/domain';
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
  is_active: boolean;
}

function fail(context: string, cause: PostgrestError): never {
  console.error(`[entities] ${context}:`, cause.code, cause.message, cause.details);
  error(500, 'Gagal memuat daftar entitas.');
}

/**
 * The index of the P&L screen. No role check: RLS decides what comes back.
 * `has_entity_access()` already limits `staf_entitas` to its own entity, so
 * that account sees exactly one card — which is correct, and needs no special
 * explanation on screen.
 */
export const load: PageServerLoad = async ({ locals }) => {
  const [entitiesResult, pnlResult] = await Promise.all([
    locals.supabase
      .from('entities')
      .select(
        'id, code, legal_name, business_line, icon_key, theme_color, reporting_basis, revenue_presentation, is_active'
      )
      /**
       * Inactive entities are kept, unlike on the dashboard. Deactivating is
       * how an entity stops being expected to report — it is not a way to
       * retire its books. Filtering them out here would make a deactivated
       * PT's whole financial history unreachable from the UI, which is
       * exactly what an auditor would come looking for.
       */
      .order('is_active', { ascending: false })
      .order('code')
      .returns<EntityRow[]>(),
    /**
     * Every period the caller may read, newest first. Two things are picked
     * out of it below: the newest approved period, which is the figure worth
     * showing, and the newest period of any status, which is where the card
     * should link — a draft month is still the one someone opening this
     * screen is most likely looking for.
     */
    locals.supabase
      .from('v_period_pnl')
      .select('entity_id, period, status, net_profit, revenue')
      .order('period', { ascending: false })
      .returns<Pick<PeriodPnl, 'entity_id' | 'period' | 'status' | 'net_profit' | 'revenue'>[]>()
  ]);

  const firstError = entitiesResult.error ?? pnlResult.error;
  if (firstError) fail('entities or v_period_pnl', firstError);

  const rows = pnlResult.data ?? [];

  const cards = (entitiesResult.data ?? []).map((entity) => {
    const mine = rows.filter((row) => row.entity_id === entity.id);
    return {
      entity,
      latest: mine[0] ?? null,
      lastApproved: mine.find((row) => row.status === 'approved' || row.status === 'locked') ?? null,
      periodCount: mine.length
    };
  });

  return { cards };
};
