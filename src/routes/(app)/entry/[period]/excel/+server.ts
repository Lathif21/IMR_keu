import { error } from '@sveltejs/kit';
import { LINE_SECTION_LABEL, LINE_SECTION_ORDER, type LineSection, type Numeric } from '$lib/domain';
import { MONTH_PATTERN, formatPeriod } from '$lib/format';
import { canEnterReports } from '$lib/roles';
import { buildWorkbook } from '$lib/server/report-excel';
import { loadEntryAccess } from '../../access';
import type { RequestHandler } from './$types';

/**
 * Template Excel untuk satu periode: pos-pos template periode itu, berisi
 * angka yang sudah tersimpan. Dipakai untuk mengisi laporan di Excel lalu
 * mengunggahnya kembali, atau sekadar mengekspor laporan yang sudah ada.
 *
 * Akses mengikuti layar input: entitas yang boleh dibuka pengguna, dan semua
 * bacaan lewat RLS sesi pengguna itu sendiri.
 */
export const GET: RequestHandler = async ({ locals, params, url }) => {
  if (!canEnterReports(locals.role)) error(403, 'Laporan diisi oleh staf entitas.');
  if (!MONTH_PATTERN.test(params.period)) error(404, 'Periode tidak ditemukan.');

  const { selected, error: accessError } = await loadEntryAccess(
    locals.supabase,
    url.searchParams.get('entitas')
  );
  if (accessError || !selected) error(403, 'Akun Anda belum ditautkan ke entitas ini.');

  const { data: period } = await locals.supabase
    .from('periods')
    .select('id, template_id')
    .eq('entity_id', selected.id)
    .eq('period', `${params.period}-01`)
    .maybeSingle<{ id: string; template_id: string }>();
  if (!period) error(404, 'Periode ini belum dibuat untuk entitas Anda.');

  const [linesResult, valuesResult] = await Promise.all([
    locals.supabase
      .from('report_template_lines')
      .select('line_code, line_label, section, sort_order')
      .eq('template_id', period.template_id)
      .eq('is_active', true)
      .order('sort_order')
      .returns<{ line_code: string; line_label: string; section: LineSection; sort_order: number }[]>(),
    locals.supabase
      .from('report_lines')
      .select('line_code, amount, note')
      .eq('period_id', period.id)
      .returns<{ line_code: string; amount: Numeric; note: string | null }[]>()
  ]);
  if (linesResult.error || valuesResult.error) {
    console.error('[entry excel]', linesResult.error?.message ?? valuesResult.error?.message);
    error(500, 'Gagal menyiapkan file Excel.');
  }

  const values = new Map((valuesResult.data ?? []).map((v) => [v.line_code, v]));
  const lines = [...(linesResult.data ?? [])]
    .sort(
      (a, b) =>
        LINE_SECTION_ORDER.indexOf(a.section) - LINE_SECTION_ORDER.indexOf(b.section) ||
        a.sort_order - b.sort_order
    )
    .map((line) => ({
      line_code: line.line_code,
      line_label: line.line_label,
      section_label: LINE_SECTION_LABEL[line.section],
      amount: values.get(line.line_code)?.amount ?? null,
      note: values.get(line.line_code)?.note ?? null
    }));

  const file = await buildWorkbook(
    `Laporan Laba Rugi — ${selected.legal_name} — ${formatPeriod(`${params.period}-01`)}`,
    { entity: selected.code, month: params.period, templateId: period.template_id },
    lines
  );

  return new Response(new Uint8Array(file), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="laporan-${selected.code}-${params.period}.xlsx"`,
      'Cache-Control': 'no-store'
    }
  });
};
