import { error, fail } from '@sveltejs/kit';
import type { PostgrestError } from '@supabase/supabase-js';
import { OPERATIONAL_SYNC_TOKEN } from '$env/static/private';
import {
  POS_BELUM_DIPETAKAN,
  fetchJenisPengeluaran,
  type PemetaanBiaya,
  type SumberBiaya
} from '../../entry/[period]/operational';
import type { Actions, PageServerLoad } from './$types';

/**
 * Pemetaan biaya sistem operasional ke pos laporan.
 *
 * Keputusan 4 Oktober 2026: pemetaan diatur di portal keuangan, bukan di
 * Laravel. Jenis yang belum dipetakan masuk Beban Operasional Lain saat tarik
 * data, dan disebut di layar input — layar ini tempat menyelesaikannya.
 */

/** Nilai pilihan di form. Selain dua ini, nilainya adalah line_code. */
const BELUM = '';
const TIDAK_DITARIK = '-';

interface LinkedEntity {
  entity_id: string;
  entities: { code: string; legal_name: string; business_line: string } | null;
}

function failLoad(context: string, cause: PostgrestError): never {
  console.error(`[admin/pemetaan-biaya] ${context}:`, cause.code, cause.message, cause.details);
  error(500, 'Gagal memuat pemetaan biaya.');
}

function explain(context: string, cause: PostgrestError, fallback: string): string {
  console.error(`[admin/pemetaan-biaya] ${context}:`, cause.code, cause.message, cause.details);
  return cause.code === 'P0001' ? cause.message : fallback;
}

const key = (source: string, jenis: string) => JSON.stringify([source, jenis]);

/**
 * Pos yang boleh dipilih: seksi `opex` di template aktif terbaru lini usaha
 * entitas — template yang dipakai periode berikutnya. Periode lama yang
 * memakai template lain tetap dijaga pemeriksaan kode di action tarik data.
 */
async function opexLines(supabase: App.Locals['supabase'], businessLine: string) {
  const { data: template, error: templateError } = await supabase
    .from('report_templates')
    .select('id')
    .eq('business_line', businessLine)
    .eq('is_active', true)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (templateError) return { lines: [], error: templateError };
  if (!template) return { lines: [], error: null };

  const { data, error: linesError } = await supabase
    .from('report_template_lines')
    .select('line_code, line_label')
    .eq('template_id', template.id)
    .eq('section', 'opex')
    .eq('is_active', true)
    .order('sort_order')
    .returns<{ line_code: string; line_label: string }[]>();

  return { lines: data ?? [], error: linesError };
}

async function linkedEntities(supabase: App.Locals['supabase']) {
  return supabase
    .from('operational_sync_config')
    .select('entity_id, entities(code, legal_name, business_line)')
    .eq('is_active', true)
    .returns<LinkedEntity[]>();
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const { data: linked, error: linkedError } = await linkedEntities(locals.supabase);
  if (linkedError) failLoad('operational_sync_config', linkedError);

  const entities = (linked ?? [])
    .filter((row) => row.entities)
    .map((row) => ({ id: row.entity_id, ...row.entities! }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const selected = entities.find((e) => e.code === url.searchParams.get('entitas')) ?? entities[0];
  if (!selected) {
    return { entities, selected: null, rows: [], lines: [], fetchError: null, fallbackCode: POS_BELUM_DIPETAKAN };
  }

  const [mappingResult, linesResult, configResult] = await Promise.all([
    locals.supabase
      .from('operational_expense_mapping')
      .select('source, jenis, line_code')
      .eq('entity_id', selected.id)
      .returns<PemetaanBiaya[]>(),
    opexLines(locals.supabase, selected.business_line),
    locals.supabase
      .from('operational_sync_config')
      .select('base_url')
      .eq('entity_id', selected.id)
      .single<{ base_url: string }>()
  ]);

  const firstError = mappingResult.error ?? linesResult.error ?? configResult.error;
  if (firstError) failLoad('mapping, template or config', firstError);

  /**
   * Daftar jenis dari sistem operasional. Kalau gagal, layar tetap bisa
   * dipakai untuk pemetaan yang sudah ada — pesan kegagalannya ditampilkan,
   * bukan menjatuhkan seluruh halaman.
   */
  let fetchError: string | null = null;
  let recorded: { sumber: SumberBiaya; jenis: string; baris: number; terakhir: string | null }[] = [];
  if (OPERATIONAL_SYNC_TOKEN === '') {
    fetchError = 'Token integrasi belum dipasang di portal keuangan, jadi daftar jenis tidak dapat diambil.';
  } else {
    const hasil = await fetchJenisPengeluaran(configResult.data!.base_url, OPERATIONAL_SYNC_TOKEN);
    if (hasil.ok) recorded = hasil.jenis;
    else fetchError = hasil.message;
  }

  /**
   * Gabungan jenis yang tercatat di sistem operasional dan jenis yang sudah
   * punya pemetaan. Pemetaan untuk jenis yang sudah tidak dipakai tetap
   * ditampilkan: menghapusnya diam-diam akan mengubah laporan kalau jenis itu
   * dipakai lagi.
   */
  const mapping = new Map((mappingResult.data ?? []).map((m) => [key(m.source, m.jenis), m]));
  const rows = recorded.map((item) => {
    const aturan = mapping.get(key(item.sumber, item.jenis));
    mapping.delete(key(item.sumber, item.jenis));
    return {
      sumber: item.sumber,
      jenis: item.jenis,
      baris: item.baris,
      terakhir: item.terakhir,
      pilihan: aturan ? (aturan.line_code ?? TIDAK_DITARIK) : BELUM
    };
  });
  for (const aturan of mapping.values()) {
    rows.push({
      sumber: aturan.source,
      jenis: aturan.jenis,
      baris: 0,
      terakhir: null,
      pilihan: aturan.line_code ?? TIDAK_DITARIK
    });
  }

  // Yang belum dipetakan di atas: itu yang perlu dikerjakan.
  rows.sort(
    (a, b) =>
      Number(a.pilihan !== BELUM) - Number(b.pilihan !== BELUM) ||
      a.sumber.localeCompare(b.sumber) ||
      a.jenis.localeCompare(b.jenis)
  );

  return {
    entities,
    selected,
    rows,
    lines: linesResult.lines,
    fetchError,
    fallbackCode: POS_BELUM_DIPETAKAN
  };
};

export const actions: Actions = {
  /**
   * Satu tombol simpan untuk seluruh daftar. Baris yang tidak berubah tidak
   * ditulis, jadi audit_log hanya mencatat keputusan yang benar-benar diambil.
   */
  save: async ({ locals, request }) => {
    const form = await request.formData();
    const entityId = String(form.get('entity_id') ?? '');

    const { data: linked, error: linkedError } = await linkedEntities(locals.supabase);
    if (linkedError) {
      return fail(500, { message: explain('operational_sync_config', linkedError, 'Gagal memuat entitas.') });
    }
    const entity = (linked ?? []).find((row) => row.entity_id === entityId)?.entities;
    if (!entity) return fail(400, { message: 'Entitas ini tidak ditautkan ke sistem operasional.' });

    const { lines, error: linesError } = await opexLines(locals.supabase, entity.business_line);
    if (linesError) {
      return fail(500, { message: explain('template lines', linesError, 'Gagal memuat template laporan.') });
    }
    const allowed = new Set(lines.map((line) => line.line_code));

    const { data: existing, error: existingError } = await locals.supabase
      .from('operational_expense_mapping')
      .select('source, jenis, line_code')
      .eq('entity_id', entityId)
      .returns<PemetaanBiaya[]>();
    if (existingError) {
      return fail(500, { message: explain('read mapping', existingError, 'Gagal memuat pemetaan biaya.') });
    }
    const current = new Map((existing ?? []).map((m) => [key(m.source, m.jenis), m]));

    const sumber = form.getAll('sumber').map(String);
    const jenis = form.getAll('jenis').map(String);
    const pilihan = form.getAll('pilihan').map(String);
    if (sumber.length !== jenis.length || jenis.length !== pilihan.length) {
      return fail(400, { message: 'Formulir tidak lengkap. Muat ulang halaman dan coba lagi.' });
    }

    const upserts: { entity_id: string; source: SumberBiaya; jenis: string; line_code: string | null }[] = [];
    const deletes: { source: string; jenis: string }[] = [];

    for (let i = 0; i < jenis.length; i++) {
      const source = sumber[i];
      if (source !== 'pengeluaran' && source !== 'honor_telly') {
        return fail(400, { message: 'Sumber biaya tidak dikenali.' });
      }
      const choice = pilihan[i];
      if (choice !== BELUM && choice !== TIDAK_DITARIK && !allowed.has(choice)) {
        return fail(400, { message: `Pos ${choice} tidak ada di template aktif.` });
      }

      const before = current.get(key(source, jenis[i]));
      if (choice === BELUM) {
        if (before) deletes.push({ source, jenis: jenis[i] });
        continue;
      }
      const lineCode = choice === TIDAK_DITARIK ? null : choice;
      if (before && before.line_code === lineCode) continue;
      upserts.push({ entity_id: entityId, source, jenis: jenis[i], line_code: lineCode });
    }

    if (upserts.length > 0) {
      const { error: upsertError } = await locals.supabase
        .from('operational_expense_mapping')
        .upsert(upserts, { onConflict: 'entity_id,source,jenis' });
      if (upsertError) {
        return fail(400, { message: explain('upsert mapping', upsertError, 'Gagal menyimpan pemetaan.') });
      }
    }

    for (const target of deletes) {
      const { error: deleteError } = await locals.supabase
        .from('operational_expense_mapping')
        .delete()
        .eq('entity_id', entityId)
        .eq('source', target.source)
        .eq('jenis', target.jenis);
      if (deleteError) {
        return fail(400, { message: explain('delete mapping', deleteError, 'Gagal menghapus pemetaan.') });
      }
    }

    return { saved: upserts.length + deletes.length };
  }
};
