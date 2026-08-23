import { error } from '@sveltejs/kit';
import type { PostgrestError } from '@supabase/supabase-js';
import type {
  LineSection,
  Numeric,
  PeriodComparison,
  PeriodPnl,
  PeriodStatus,
  ReportingBasis,
  RevenuePresentation
} from '$lib/domain';
import { MONTH_PATTERN, monthToPeriod, previousPeriod } from '$lib/format';
import type { PageServerLoad } from './$types';

interface EntityRow {
  id: string;
  code: string;
  legal_name: string;
  business_line: string;
  reporting_basis: ReportingBasis;
  revenue_presentation: RevenuePresentation;
}

interface PeriodRow {
  id: string;
  period: string;
  status: PeriodStatus;
  template_id: string;
}

export interface TemplateLine {
  line_code: string;
  line_label: string;
  section: LineSection;
  sort_order: number;
}

export interface ReportLine {
  line_code: string;
  amount: Numeric;
  note: string | null;
}

interface OpenPolicy {
  policy_key: string;
  entity_id: string | null;
}

/**
 * Postgres messages name tables, columns and policies — the schema map an
 * attacker is probing for. Same split as the dashboard: everything to the
 * server log, a fixed sentence to the browser.
 */
function fail(context: string, cause: PostgrestError): never {
  console.error(`[pnl] ${context}:`, cause.code, cause.message, cause.details);
  error(500, 'Gagal memuat laporan.');
}

/**
 * `[id]` reaches Postgres as a `uuid`, and a malformed one comes back as
 * 22P02 — a 500 describing a type cast, for what is really just a bad URL.
 * Checked here so it reads as the 404 it is.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async ({ locals, params }) => {
  if (!UUID_PATTERN.test(params.id)) error(404, 'Entitas tidak ditemukan.');
  if (!MONTH_PATTERN.test(params.period)) error(404, 'Periode tidak ditemukan.');

  const period = monthToPeriod(params.period);

  /**
   * No role check anywhere in this file. RLS is the boundary (invariant 1):
   * `has_entity_access()` limits `staf_entitas` to its own entity, and
   * `v_period_pnl` is `security_invoker`, so it narrows in step. An entity the
   * caller may not read comes back as zero rows — which has to be a 404 and
   * not an empty page, or the screen tells them the report is missing when it
   * is only invisible to them.
   */
  const { data: entity, error: entityError } = await locals.supabase
    .from('entities')
    .select('id, code, legal_name, business_line, reporting_basis, revenue_presentation')
    .eq('id', params.id)
    .maybeSingle<EntityRow>();

  if (entityError) fail('entities', entityError);
  if (!entity) error(404, 'Entitas tidak ditemukan.');

  // Every period of this entity: the picker needs the list, and the requested
  // month has to be found in it anyway.
  const { data: periodRows, error: periodsError } = await locals.supabase
    .from('periods')
    .select('id, period, status, template_id')
    .eq('entity_id', entity.id)
    .order('period', { ascending: false })
    .returns<PeriodRow[]>();

  if (periodsError) fail('periods', periodsError);

  const periods = periodRows ?? [];
  const current = periods.find((row) => row.period === period);
  if (!current) error(404, 'Periode ini tidak ada untuk entitas tersebut.');

  const prior = periods.find((row) => row.period === previousPeriod(period)) ?? null;

  const [pnlResult, priorPnlResult, comparisonResult, templateResult, linesResult, priorLinesResult, policiesResult] =
    await Promise.all([
      locals.supabase
        .from('v_period_pnl')
        .select('*')
        .eq('period_id', current.id)
        .maybeSingle<PeriodPnl>(),
      prior
        ? locals.supabase
            .from('v_period_pnl')
            .select('*')
            .eq('period_id', prior.id)
            .maybeSingle<PeriodPnl>()
        : Promise.resolve({ data: null, error: null }),
      locals.supabase
        .from('v_period_comparison')
        .select('*')
        .eq('entity_id', entity.id)
        .eq('period', period)
        .maybeSingle<PeriodComparison>(),
      /**
       * The template the period was created with, not the newest one. A
       * historical statement has to read with the labels that were in force
       * when it was filled in (invariant 7 — templates are versioned data).
       */
      locals.supabase
        .from('report_template_lines')
        .select('line_code, line_label, section, sort_order')
        .eq('template_id', current.template_id)
        .order('sort_order')
        .returns<TemplateLine[]>(),
      locals.supabase
        .from('report_lines')
        .select('line_code, amount, note')
        .eq('period_id', current.id)
        .returns<ReportLine[]>(),
      prior
        ? locals.supabase
            .from('report_lines')
            .select('line_code, amount, note')
            .eq('period_id', prior.id)
            .returns<ReportLine[]>()
        : Promise.resolve({ data: [] as ReportLine[], error: null }),
      /**
       * Policies with no decision, for this entity or for the whole group.
       * The figures on this page depend on them, so the page has to say so
       * rather than present a provisional number as final (invariant 8).
       */
      locals.supabase
        .from('accounting_policies')
        .select('policy_key, entity_id')
        .is('chosen_value', null)
        .or(`entity_id.is.null,entity_id.eq.${entity.id}`)
        .returns<OpenPolicy[]>()
    ]);

  const firstError =
    pnlResult.error ??
    priorPnlResult.error ??
    comparisonResult.error ??
    templateResult.error ??
    linesResult.error ??
    priorLinesResult.error ??
    policiesResult.error;
  if (firstError) fail('report queries', firstError);

  // A period row exists but the view refuses it: treat it the same as absent.
  if (!pnlResult.data) error(404, 'Laporan periode ini tidak tersedia.');

  return {
    entity,
    period,
    month: params.period,
    status: current.status,
    /** Subtotals come from here and are never recomputed (invariant 2). */
    pnl: pnlResult.data,
    priorPnl: priorPnlResult.data,
    priorPeriod: prior?.period ?? null,
    comparison: comparisonResult.data,
    templateLines: templateResult.data ?? [],
    reportLines: linesResult.data ?? [],
    priorLines: priorLinesResult.data ?? [],
    periods: periods.map(({ id, period: p, status }) => ({ id, period: p, status })),
    openPolicies: policiesResult.data ?? []
  };
};
