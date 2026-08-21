/**
 * Domain vocabulary. Mirrors the enums in supabase/migrations — see
 * CONTEXT.md for what each term means in the business.
 *
 * These are hand-written on purpose. `npm run db:types` generates the full
 * table types; this file is the small, stable subset the UI reasons about,
 * so a regenerated file never silently changes a union the views depend on.
 */

export type UserRole = 'direksi' | 'manajer_keuangan' | 'staf_entitas' | 'auditor';

export type PeriodStatus = 'draft' | 'submitted' | 'approved' | 'locked';

export type LineSection =
  | 'revenue'
  | 'cogs'
  | 'opex'
  | 'other_income'
  | 'other_expense'
  | 'tax';

/** 'unknown' is a real value, not a missing one. See ASSUMPTIONS.md A-4. */
export type ReportingBasis = 'cash' | 'accrual' | 'unknown';

/** 'unknown' is a real value, not a missing one. See ASSUMPTIONS.md A-1. */
export type RevenuePresentation = 'gross' | 'net' | 'unknown';

/** Indonesian labels users see. Never translate these in the other direction. */
export const PERIOD_STATUS_LABEL: Record<PeriodStatus, string> = {
  draft: 'Draft',
  submitted: 'Diajukan',
  approved: 'Disetujui',
  locked: 'Dikunci'
};

export const ROLE_LABEL: Record<UserRole, string> = {
  direksi: 'Direksi',
  manajer_keuangan: 'Manajer Keuangan',
  staf_entitas: 'Staf Entitas',
  auditor: 'Auditor'
};

export const REPORTING_BASIS_LABEL: Record<ReportingBasis, string> = {
  cash: 'Basis kas',
  accrual: 'Basis akrual',
  unknown: 'Basis belum ditetapkan'
};

export const REVENUE_PRESENTATION_LABEL: Record<RevenuePresentation, string> = {
  gross: 'Omset bruto (prinsipal)',
  net: 'Omset neto (agen)',
  unknown: 'Penyajian omset belum ditetapkan'
};

/**
 * A `numeric(18,2)` column. PostgREST may serialise it as a JSON number or,
 * depending on version and column width, as a string — so treat it as either
 * and put it through `toAmount()` before any arithmetic. Never let the raw
 * value reach a `+`, where a string would silently concatenate.
 */
export type Numeric = string | number;

/**
 * Row of `v_period_pnl`. Subtotals arrive computed from the view — they are
 * never stored and never recomputed here (CLAUDE.md invariant 2).
 */
export interface PeriodPnl {
  period_id: string;
  entity_id: string;
  period: string;
  status: PeriodStatus;
  entity_code: string;
  entity_name: string;
  business_line: string;
  reporting_basis: ReportingBasis;
  revenue_presentation: RevenuePresentation;
  revenue: Numeric;
  cogs: Numeric;
  opex: Numeric;
  other_income: Numeric;
  other_expense: Numeric;
  tax: Numeric;
  gross_profit: Numeric;
  operating_profit: Numeric;
  net_profit: Numeric;
  net_margin_pct: Numeric | null;
}

/** Row of `v_group_consolidated`. */
export interface GroupConsolidated {
  period: string;
  revenue_sum: Numeric;
  elimination: Numeric;
  revenue_consolidated: Numeric;
  cogs_sum: Numeric;
  opex_sum: Numeric;
  net_profit_consolidated: Numeric;
  is_complete: boolean | null;
  missing_entities: string[] | null;
}

/** Row of `v_period_completeness`. */
export interface PeriodCompleteness {
  period: string;
  expected_entities: number;
  reported_entities: number;
  is_complete: boolean;
  missing_entities: string[] | null;
}

/** Row of `v_period_comparison`. Month-over-month and year-over-year are
 *  separate columns here — the prototype labelled MoM as "YoY". */
export interface PeriodComparison {
  entity_id: string;
  entity_code: string;
  period: string;
  revenue: Numeric;
  net_profit: Numeric;
  revenue_prev_month: Numeric | null;
  net_profit_prev_month: Numeric | null;
  revenue_prev_year: Numeric | null;
  net_profit_prev_year: Numeric | null;
  revenue_mom_pct: Numeric | null;
  revenue_yoy_pct: Numeric | null;
}
