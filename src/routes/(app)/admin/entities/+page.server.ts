import { error, fail, redirect } from '@sveltejs/kit';
import type { PostgrestError } from '@supabase/supabase-js';
import type { PeriodStatus, ReportingBasis, RevenuePresentation } from '$lib/domain';
import type { Actions, PageServerLoad } from './$types';

export interface AdminEntity {
  id: string;
  code: string;
  legal_name: string;
  npwp: string | null;
  business_line: string;
  icon_key: string;
  theme_color: string;
  ownership_pct: string | number;
  fiscal_year_start_month: number;
  reporting_basis: ReportingBasis;
  revenue_presentation: RevenuePresentation;
  is_active: boolean;
}

export interface BasisDecision {
  policy_key: string;
  entity_id: string | null;
  chosen_value: string | null;
  rationale: string | null;
  decided_by: string | null;
  decided_at: string | null;
  effective_from: string | null;
}

function failLoad(context: string, cause: PostgrestError): never {
  console.error(`[admin/entities] ${context}:`, cause.code, cause.message, cause.details);
  error(500, 'Gagal memuat daftar entitas.');
}

/**
 * Postgres messages name tables, columns and constraints. Our own triggers and
 * RPCs raise `P0001` with Indonesian sentences written for the person reading
 * the screen — those pass through. Everything else goes to the log.
 */
function explain(context: string, cause: PostgrestError, fallback: string): string {
  console.error(`[admin/entities] ${context}:`, cause.code, cause.message, cause.details);
  return cause.code === 'P0001' ? cause.message : fallback;
}

/**
 * `code` and `npwp` are both unique. 23505 names the index in a message no
 * user should read, so it is translated into the field that actually clashed.
 */
function duplicateMessage(cause: PostgrestError): string | null {
  if (cause.code !== '23505') return null;
  const detail = `${cause.message} ${cause.details ?? ''}`;
  if (detail.includes('npwp')) return 'NPWP itu sudah dipakai entitas lain.';
  if (detail.includes('code')) return 'Kode entitas itu sudah dipakai.';
  return 'Nilai itu sudah dipakai entitas lain.';
}

const CODE_PATTERN = /^[A-Z0-9]{1,10}$/;

/** Reads the shared fields; `null` when something is wrong with them. */
function readEntityForm(form: FormData): { values: Record<string, unknown>; message?: string } {
  const code = String(form.get('code') ?? '').trim().toUpperCase();
  const legalName = String(form.get('legal_name') ?? '').trim();
  const businessLine = String(form.get('business_line') ?? '').trim();
  const npwp = String(form.get('npwp') ?? '').trim();

  if (!CODE_PATTERN.test(code)) {
    return { values: {}, message: 'Kode wajib diisi, huruf/angka kapital, maksimal 10 karakter.' };
  }
  if (legalName === '') return { values: {}, message: 'Nama badan hukum wajib diisi.' };
  if (businessLine === '') return { values: {}, message: 'Lini usaha wajib diisi.' };

  return {
    values: {
      code,
      legal_name: legalName,
      business_line: businessLine,
      npwp: npwp === '' ? null : npwp,
      icon_key: String(form.get('icon_key') ?? 'building'),
      theme_color: String(form.get('theme_color') ?? '#64748b')
    }
  };
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const [entitiesResult, periodsResult, templatesResult, policiesResult] = await Promise.all([
    locals.supabase
      .from('entities')
      .select(
        'id, code, legal_name, npwp, business_line, icon_key, theme_color, ownership_pct, fiscal_year_start_month, reporting_basis, revenue_presentation, is_active'
      )
      .order('is_active', { ascending: false })
      .order('code')
      .returns<AdminEntity[]>(),
    /**
     * Counted here rather than in SQL: PostgREST cannot group, and four
     * entities' worth of periods is a handful of rows. If this ever grows,
     * it becomes a view.
     */
    locals.supabase
      .from('periods')
      .select('entity_id, status')
      .returns<{ entity_id: string; status: PeriodStatus }[]>(),
    // Which business lines can actually be reported on at all.
    locals.supabase
      .from('report_templates')
      .select('business_line, is_active')
      .eq('is_active', true)
      .returns<{ business_line: string | null; is_active: boolean }[]>(),
    locals.supabase
      .from('accounting_policies')
      .select('policy_key, entity_id, chosen_value, rationale, decided_by, decided_at, effective_from')
      .in('policy_key', ['reporting_basis', 'revenue_presentation'])
      .order('effective_from', { ascending: false })
      .returns<BasisDecision[]>()
  ]);

  const firstError =
    entitiesResult.error ?? periodsResult.error ?? templatesResult.error ?? policiesResult.error;
  if (firstError) failLoad('admin entity queries', firstError);

  const periods = periodsResult.data ?? [];
  const reported = new Map<string, number>();
  for (const row of periods) {
    if (row.status !== 'approved' && row.status !== 'locked') continue;
    reported.set(row.entity_id, (reported.get(row.entity_id) ?? 0) + 1);
  }

  const linesWithTemplate = new Set(
    (templatesResult.data ?? []).map((row) => row.business_line).filter((line): line is string => line !== null)
  );

  const entities = (entitiesResult.data ?? []).map((entity) => ({
    ...entity,
    approvedPeriods: reported.get(entity.id) ?? 0,
    hasTemplate: linesWithTemplate.has(entity.business_line)
  }));

  return {
    entities,
    /** For the datalist: a typo here silently breaks template matching. */
    businessLines: [...new Set(entities.map((e) => e.business_line))].sort(),
    decisions: policiesResult.data ?? [],
    /** Server-driven panels, so they survive a reload and work without JS. */
    editingId: url.searchParams.get('ubah'),
    basisId: url.searchParams.get('basis'),
    creating: url.searchParams.get('baru') !== null
  };
};

export const actions: Actions = {
  createEntity: async ({ locals, request }) => {
    const form = await request.formData();
    const { values, message } = readEntityForm(form);
    if (message) return fail(400, { message });

    /**
     * `reporting_basis` and `revenue_presentation` are absent on purpose. They
     * default to `unknown`, and setting them needs a written reason the person
     * creating an entity does not necessarily have yet (ASSUMPTIONS.md A-1).
     * That is a separate decision, made through the basis dialog.
     */
    const { error: insertError } = await locals.supabase.from('entities').insert(values);

    if (insertError) {
      const duplicate = duplicateMessage(insertError);
      return fail(400, {
        message: duplicate ?? explain('insert entity', insertError, 'Gagal membuat entitas.')
      });
    }

    redirect(303, '/admin/entities');
  },

  updateEntity: async ({ locals, request }) => {
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const { values, message } = readEntityForm(form);
    if (message) return fail(400, { message });

    const ownership = Number(form.get('ownership_pct') ?? 100);
    const fiscalMonth = Number(form.get('fiscal_year_start_month') ?? 1);

    if (!(ownership > 0 && ownership <= 100)) {
      return fail(400, { message: 'Persentase kepemilikan harus di antara 0 dan 100.' });
    }
    if (!Number.isInteger(fiscalMonth) || fiscalMonth < 1 || fiscalMonth > 12) {
      return fail(400, { message: 'Bulan awal tahun buku harus 1–12.' });
    }

    const { error: updateError } = await locals.supabase
      .from('entities')
      .update({ ...values, ownership_pct: ownership, fiscal_year_start_month: fiscalMonth })
      .eq('id', id);

    if (updateError) {
      const duplicate = duplicateMessage(updateError);
      return fail(400, {
        message: duplicate ?? explain('update entity', updateError, 'Gagal menyimpan perubahan.')
      });
    }

    redirect(303, '/admin/entities');
  },

  /**
   * The only route that may change these two columns. A direct update is
   * refused by `entities_basis_guard` — see migration 20250103000000.
   */
  setBasis: async ({ locals, request }) => {
    const form = await request.formData();
    const rationale = String(form.get('rationale') ?? '').trim();
    const effectiveFrom = String(form.get('effective_from') ?? '').trim();

    if (rationale.length < 10) {
      return fail(400, {
        message: 'Tulis alasannya sebagai kalimat utuh — ini yang dibaca direksi berikutnya.'
      });
    }
    if (effectiveFrom === '') {
      return fail(400, { message: 'Tanggal mulai berlaku wajib diisi.' });
    }

    const { error: rpcError } = await locals.supabase.rpc('set_entity_reporting_basis', {
      p_entity_id: String(form.get('id') ?? ''),
      p_basis: String(form.get('reporting_basis') ?? 'unknown'),
      p_presentation: String(form.get('revenue_presentation') ?? 'unknown'),
      p_rationale: rationale,
      p_effective_from: effectiveFrom
    });

    if (rpcError) {
      return fail(400, {
        message: explain('set_entity_reporting_basis', rpcError, 'Gagal menetapkan basis pelaporan.')
      });
    }

    redirect(303, '/admin/entities');
  },

  /**
   * No delete action anywhere. `periods.entity_id` is `on delete restrict`, so
   * an entity that has ever reported cannot be removed — offering a button
   * that always fails is worse than not offering one.
   */
  toggleActive: async ({ locals, request }) => {
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const next = form.get('is_active') === 'true';

    const { error: updateError } = await locals.supabase
      .from('entities')
      .update({ is_active: next })
      .eq('id', id);

    if (updateError) {
      return fail(400, {
        message: explain('toggle entity', updateError, 'Gagal mengubah status entitas.')
      });
    }

    redirect(303, '/admin/entities');
  }
};
