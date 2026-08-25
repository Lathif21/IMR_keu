import { error, fail, redirect } from '@sveltejs/kit';
import type { PostgrestError } from '@supabase/supabase-js';
import type { PeriodStatus } from '$lib/domain';
import type { Actions, PageServerLoad } from './$types';

export interface TemplateRow {
  id: string;
  code: string;
  name: string;
  business_line: string | null;
  version: number;
  is_active: boolean;
}

function failLoad(context: string, cause: PostgrestError): never {
  console.error(`[admin/templates] ${context}:`, cause.code, cause.message, cause.details);
  error(500, 'Gagal memuat daftar template.');
}

function explain(context: string, cause: PostgrestError, fallback: string): string {
  console.error(`[admin/templates] ${context}:`, cause.code, cause.message, cause.details);
  if (cause.code === 'P0001') return cause.message;
  if (cause.code === '23505') return 'Kode dan versi template itu sudah ada.';
  return fallback;
}

const CODE_PATTERN = /^[A-Z0-9_]{1,30}$/;

export const load: PageServerLoad = async ({ locals, url }) => {
  const [templatesResult, linesResult, periodsResult, entitiesResult] = await Promise.all([
    locals.supabase
      .from('report_templates')
      .select('id, code, name, business_line, version, is_active')
      .order('business_line')
      .order('code')
      .order('version', { ascending: false })
      .returns<TemplateRow[]>(),
    locals.supabase
      .from('report_template_lines')
      .select('template_id, is_active')
      .returns<{ template_id: string; is_active: boolean }[]>(),
    locals.supabase
      .from('periods')
      .select('template_id, status')
      .returns<{ template_id: string; status: PeriodStatus }[]>(),
    // Business lines that exist but may have nothing to report with.
    locals.supabase
      .from('entities')
      .select('business_line, is_active')
      .eq('is_active', true)
      .returns<{ business_line: string; is_active: boolean }[]>()
  ]);

  const firstError =
    templatesResult.error ?? linesResult.error ?? periodsResult.error ?? entitiesResult.error;
  if (firstError) failLoad('template queries', firstError);

  const activeLines = new Map<string, number>();
  for (const line of linesResult.data ?? []) {
    if (!line.is_active) continue;
    activeLines.set(line.template_id, (activeLines.get(line.template_id) ?? 0) + 1);
  }

  const periodCount = new Map<string, number>();
  for (const period of periodsResult.data ?? []) {
    periodCount.set(period.template_id, (periodCount.get(period.template_id) ?? 0) + 1);
  }

  const templates = (templatesResult.data ?? []).map((template) => ({
    ...template,
    activeLines: activeLines.get(template.id) ?? 0,
    periods: periodCount.get(template.id) ?? 0
  }));

  /**
   * A business line with no active template cannot report at all: `/entry`
   * refuses to create a period without one. The gap is listed rather than
   * left implicit — nobody goes looking for a template that was never made.
   */
  const covered = new Set(
    templates.filter((t) => t.is_active).map((t) => t.business_line).filter(Boolean)
  );
  const uncoveredLines = [
    ...new Set((entitiesResult.data ?? []).map((e) => e.business_line))
  ]
    .filter((line) => !covered.has(line))
    .sort();

  return {
    templates,
    uncoveredLines,
    /** Templates that can be copied when starting a new one. */
    copyable: templates.map((t) => ({ id: t.id, label: `${t.code} v${t.version} — ${t.name}` })),
    creating: url.searchParams.get('baru'),
    businessLines: [...new Set((entitiesResult.data ?? []).map((e) => e.business_line))].sort()
  };
};

export const actions: Actions = {
  /**
   * Empty, or copied from an existing template. Copying is the common case:
   * operating expenses look much the same across business lines, and only the
   * cost of sales differs.
   */
  createTemplate: async ({ locals, request }) => {
    const form = await request.formData();
    const code = String(form.get('code') ?? '').trim().toUpperCase();
    const name = String(form.get('name') ?? '').trim();
    const businessLine = String(form.get('business_line') ?? '').trim();
    const copyFrom = String(form.get('copy_from') ?? '').trim();

    if (!CODE_PATTERN.test(code)) {
      return fail(400, {
        message: 'Kode template wajib diisi, huruf/angka kapital dan garis bawah, maksimal 30.'
      });
    }
    if (name === '') return fail(400, { message: 'Nama template wajib diisi.' });
    if (businessLine === '') return fail(400, { message: 'Lini usaha wajib diisi.' });

    /**
     * Created inactive. A template with no revenue line produces a statement
     * whose every margin is null, so activation is a separate step that
     * checks for one.
     */
    const { data: created, error: insertError } = await locals.supabase
      .from('report_templates')
      .insert({ code, name, business_line: businessLine, version: 1, is_active: false })
      .select('id')
      .single<{ id: string }>();

    if (insertError || !created) {
      return fail(400, {
        message: explain('insert template', insertError!, 'Gagal membuat template.')
      });
    }

    if (copyFrom !== '') {
      const { data: source, error: sourceError } = await locals.supabase
        .from('report_template_lines')
        .select('line_code, line_label, section, sort_order, help_text, is_active')
        .eq('template_id', copyFrom)
        .order('sort_order');

      if (sourceError) {
        return fail(400, {
          message: explain('read source template', sourceError, 'Gagal menyalin baris template.')
        });
      }

      if ((source ?? []).length > 0) {
        const { error: copyError } = await locals.supabase
          .from('report_template_lines')
          .insert((source ?? []).map((line) => ({ ...line, template_id: created.id })));

        if (copyError) {
          return fail(400, {
            message: explain('copy template lines', copyError, 'Gagal menyalin baris template.')
          });
        }
      }
    }

    redirect(303, `/admin/templates/${created.id}`);
  }
};
