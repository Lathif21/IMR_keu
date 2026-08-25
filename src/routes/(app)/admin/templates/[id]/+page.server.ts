import { error, fail, redirect } from '@sveltejs/kit';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { LINE_SECTION_ORDER, type LineSection } from '$lib/domain';
import type { Actions, PageServerLoad } from './$types';

export interface TemplateLine {
  id: string;
  line_code: string;
  line_label: string;
  section: LineSection;
  sort_order: number;
  help_text: string | null;
  is_active: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINE_CODE = /^[A-Z0-9_]{1,40}$/;

function failLoad(context: string, cause: PostgrestError): never {
  console.error(`[admin/template] ${context}:`, cause.code, cause.message, cause.details);
  error(500, 'Gagal memuat template.');
}

function explain(context: string, cause: PostgrestError, fallback: string): string {
  console.error(`[admin/template] ${context}:`, cause.code, cause.message, cause.details);
  if (cause.code === 'P0001') return cause.message;
  if (cause.code === '23505') return 'Kode baris itu sudah ada di template ini.';
  return fallback;
}

/**
 * A template used by any period that has left draft is frozen.
 *
 * `v_period_pnl` decides which bucket a figure lands in by joining to
 * `report_template_lines.section`. Changing a line's section moves every
 * historical figure filed under that code from, say, cost of sales to
 * operating expenses — across every period that ever used the template,
 * locked ones included. Gross profit for the whole history changes, and
 * nothing raises an error.
 *
 * Adding a line is in fact safe. But sorting safe edits from unsafe ones
 * produces a rule people have to remember; refusing all of them is one
 * sentence and has no edge cases.
 */
async function lockedBy(supabase: SupabaseClient, templateId: string): Promise<number> {
  const { count, error: countError } = await supabase
    .from('periods')
    .select('id', { count: 'exact', head: true })
    .eq('template_id', templateId)
    .neq('status', 'draft');

  if (countError) failLoad('count periods', countError);
  return count ?? 0;
}

export const load: PageServerLoad = async ({ locals, params }) => {
  if (!UUID.test(params.id)) error(404, 'Template tidak ditemukan.');

  const { data: template, error: templateError } = await locals.supabase
    .from('report_templates')
    .select('id, code, name, business_line, version, is_active')
    .eq('id', params.id)
    .maybeSingle<{
      id: string;
      code: string;
      name: string;
      business_line: string | null;
      version: number;
      is_active: boolean;
    }>();

  if (templateError) failLoad('report_templates', templateError);
  if (!template) error(404, 'Template tidak ditemukan.');

  const [linesResult, usedCodes, frozenCount] = await Promise.all([
    locals.supabase
      .from('report_template_lines')
      .select('id, line_code, line_label, section, sort_order, help_text, is_active')
      .eq('template_id', template.id)
      .order('sort_order')
      .returns<TemplateLine[]>(),
    /**
     * Which line codes already carry stored figures. Renaming one of those
     * strands the amounts: they stay in `report_lines`, but
     * `guard_line_code_in_template` makes them unreachable and `v_period_pnl`
     * loses their section.
     */
    locals.supabase
      .from('report_lines')
      .select('line_code, periods!inner(template_id)')
      .eq('periods.template_id', template.id)
      .returns<{ line_code: string }[]>(),
    lockedBy(locals.supabase, template.id)
  ]);

  if (linesResult.error) failLoad('report_template_lines', linesResult.error);
  if (usedCodes.error) failLoad('report_lines usage', usedCodes.error);

  return {
    template,
    lines: linesResult.data ?? [],
    usedLineCodes: [...new Set((usedCodes.data ?? []).map((row) => row.line_code))],
    frozenCount,
    sectionOrder: LINE_SECTION_ORDER
  };
};

/** Every mutating action refuses once the template is in use. */
async function guardEditable(
  supabase: SupabaseClient,
  templateId: string
): Promise<string | null> {
  const used = await lockedBy(supabase, templateId);
  if (used === 0) return null;
  return (
    `Template ini dipakai ${used} periode yang sudah keluar dari draft. ` +
    'Duplikasi ke versi baru untuk mengubahnya — periode lama harus tetap terbaca ' +
    'dengan struktur yang berlaku saat itu.'
  );
}

export const actions: Actions = {
  addLine: async ({ locals, params, request }) => {
    const frozen = await guardEditable(locals.supabase, params.id);
    if (frozen) return fail(400, { message: frozen });

    const form = await request.formData();
    const lineCode = String(form.get('line_code') ?? '').trim().toUpperCase();
    const lineLabel = String(form.get('line_label') ?? '').trim();
    const section = String(form.get('section') ?? '') as LineSection;

    if (!LINE_CODE.test(lineCode)) {
      return fail(400, { message: 'Kode baris wajib huruf kapital, angka, atau garis bawah.' });
    }
    if (lineLabel === '') return fail(400, { message: 'Nama pos wajib diisi.' });
    if (!LINE_SECTION_ORDER.includes(section)) {
      return fail(400, { message: 'Bagian laporan tidak dikenal.' });
    }

    // Append to the end of its section, leaving room between neighbours.
    const { data: last } = await locals.supabase
      .from('report_template_lines')
      .select('sort_order')
      .eq('template_id', params.id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle<{ sort_order: number }>();

    const { error: insertError } = await locals.supabase.from('report_template_lines').insert({
      template_id: params.id,
      line_code: lineCode,
      line_label: lineLabel,
      section,
      sort_order: (last?.sort_order ?? 0) + 10,
      help_text: String(form.get('help_text') ?? '').trim() || null
    });

    if (insertError) {
      return fail(400, { message: explain('insert line', insertError, 'Gagal menambah baris.') });
    }

    redirect(303, `/admin/templates/${params.id}`);
  },

  updateLine: async ({ locals, params, request }) => {
    const frozen = await guardEditable(locals.supabase, params.id);
    if (frozen) return fail(400, { message: frozen });

    const form = await request.formData();
    const lineId = String(form.get('line_id') ?? '');
    const lineLabel = String(form.get('line_label') ?? '').trim();
    const section = String(form.get('section') ?? '') as LineSection;

    if (lineLabel === '') return fail(400, { message: 'Nama pos wajib diisi.' });
    if (!LINE_SECTION_ORDER.includes(section)) {
      return fail(400, { message: 'Bagian laporan tidak dikenal.' });
    }

    /**
     * `line_code` is deliberately absent from the update. A code that already
     * carries figures must not move, and one that does not is not worth a
     * second code path — delete and re-add instead.
     */
    const { error: updateError } = await locals.supabase
      .from('report_template_lines')
      .update({
        line_label: lineLabel,
        section,
        help_text: String(form.get('help_text') ?? '').trim() || null
      })
      .eq('id', lineId)
      .eq('template_id', params.id);

    if (updateError) {
      return fail(400, { message: explain('update line', updateError, 'Gagal menyimpan baris.') });
    }

    redirect(303, `/admin/templates/${params.id}`);
  },

  /**
   * Safe for history: `v_period_pnl` joins without filtering `is_active`, so
   * past figures keep their section. `guard_line_code_in_template` does filter
   * it, so new input on a retired line is refused. Verified — that pairing is
   * exactly the behaviour wanted.
   */
  toggleLine: async ({ locals, params, request }) => {
    const frozen = await guardEditable(locals.supabase, params.id);
    if (frozen) return fail(400, { message: frozen });

    const form = await request.formData();
    const { error: updateError } = await locals.supabase
      .from('report_template_lines')
      .update({ is_active: form.get('is_active') === 'true' })
      .eq('id', String(form.get('line_id') ?? ''))
      .eq('template_id', params.id);

    if (updateError) {
      return fail(400, { message: explain('toggle line', updateError, 'Gagal mengubah baris.') });
    }

    redirect(303, `/admin/templates/${params.id}`);
  },

  /**
   * Swapped through an RPC, not two updates. PostgREST gives each request its
   * own transaction, so two updates would commit separately and the first
   * commit already holds a duplicate `sort_order` — the deferred constraint
   * needs both writes inside one transaction. See migration 20250103000000.
   */
  moveLine: async ({ locals, params, request }) => {
    const frozen = await guardEditable(locals.supabase, params.id);
    if (frozen) return fail(400, { message: frozen });

    const form = await request.formData();
    const { error: rpcError } = await locals.supabase.rpc('swap_template_line_order', {
      p_a: String(form.get('line_id') ?? ''),
      p_b: String(form.get('swap_with') ?? '')
    });

    if (rpcError) {
      return fail(400, { message: explain('swap order', rpcError, 'Gagal mengubah urutan.') });
    }

    redirect(303, `/admin/templates/${params.id}`);
  },

  /**
   * The escape hatch from the freeze. Old periods keep pointing at the old
   * `template_id`, so their reports do not move — which is the whole point.
   */
  duplicate: async ({ locals, params }) => {
    const { data: source, error: sourceError } = await locals.supabase
      .from('report_templates')
      .select('code, name, business_line, version')
      .eq('id', params.id)
      .single<{ code: string; name: string; business_line: string | null; version: number }>();

    if (sourceError) {
      return fail(400, { message: explain('read template', sourceError, 'Gagal membaca template.') });
    }

    // Highest existing version for this code, so duplicating twice does not collide.
    const { data: newest } = await locals.supabase
      .from('report_templates')
      .select('version')
      .eq('code', source.code)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle<{ version: number }>();

    const { data: created, error: insertError } = await locals.supabase
      .from('report_templates')
      .insert({
        code: source.code,
        name: source.name,
        business_line: source.business_line,
        version: (newest?.version ?? source.version) + 1,
        is_active: true
      })
      .select('id')
      .single<{ id: string }>();

    if (insertError || !created) {
      return fail(400, {
        message: explain('duplicate template', insertError!, 'Gagal menduplikasi template.')
      });
    }

    const { data: lines, error: linesError } = await locals.supabase
      .from('report_template_lines')
      .select('line_code, line_label, section, sort_order, help_text, is_active')
      .eq('template_id', params.id)
      .order('sort_order');

    if (linesError) {
      return fail(400, { message: explain('read lines', linesError, 'Gagal menyalin baris.') });
    }

    if ((lines ?? []).length > 0) {
      const { error: copyError } = await locals.supabase
        .from('report_template_lines')
        .insert((lines ?? []).map((line) => ({ ...line, template_id: created.id })));

      if (copyError) {
        return fail(400, { message: explain('copy lines', copyError, 'Gagal menyalin baris.') });
      }
    }

    // Only now retire the old one: if anything above failed, the line still
    // has a working active template.
    const { error: retireError } = await locals.supabase
      .from('report_templates')
      .update({ is_active: false })
      .eq('id', params.id);

    if (retireError) {
      return fail(400, {
        message: explain('retire old version', retireError, 'Versi baru dibuat, versi lama gagal dinonaktifkan.')
      });
    }

    redirect(303, `/admin/templates/${created.id}`);
  },

  toggleTemplate: async ({ locals, params, request }) => {
    const form = await request.formData();
    const next = form.get('is_active') === 'true';

    if (next) {
      /**
       * A template with no revenue line yields a statement whose every margin
       * is null — `v_period_pnl` divides by a revenue of zero. Refused before
       * anyone can file against it.
       */
      const { count, error: countError } = await locals.supabase
        .from('report_template_lines')
        .select('id', { count: 'exact', head: true })
        .eq('template_id', params.id)
        .eq('section', 'revenue')
        .eq('is_active', true);

      if (countError) {
        return fail(400, { message: explain('count revenue lines', countError, 'Gagal memeriksa template.') });
      }
      if ((count ?? 0) === 0) {
        return fail(400, {
          message:
            'Template harus punya minimal satu baris pendapatan sebelum diaktifkan. ' +
            'Tanpa itu seluruh margin laporannya kosong.'
        });
      }
    }

    const { error: updateError } = await locals.supabase
      .from('report_templates')
      .update({ is_active: next })
      .eq('id', params.id);

    if (updateError) {
      return fail(400, {
        message: explain('toggle template', updateError, 'Gagal mengubah status template.')
      });
    }

    redirect(303, `/admin/templates/${params.id}`);
  }
};
