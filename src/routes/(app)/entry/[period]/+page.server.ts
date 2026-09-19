import { error, fail, redirect } from '@sveltejs/kit';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { OPERATIONAL_SYNC_TOKEN } from '$env/static/private';
import type { LineSection, Numeric, PeriodStatus } from '$lib/domain';
import { AMOUNT_LIMIT, MONTH_PATTERN, formatAmount, parseAmountInput } from '$lib/format';
import { canEnterReports } from '$lib/roles';
import { loadEntryAccess } from '../access';
import { fetchRekapOperasional } from './operational';
import type { Actions, PageServerLoad } from './$types';

interface PeriodRow {
  id: string;
  period: string;
  status: PeriodStatus;
  template_id: string;
  rejection_note: string | null;
}

interface TemplateLine {
  line_code: string;
  line_label: string;
  section: LineSection;
  sort_order: number;
  help_text: string | null;
}

interface ReportLine {
  line_code: string;
  amount: Numeric;
  note: string | null;
}

/**
 * Postgres messages name tables, columns and policies. Everything goes to the
 * server log; the browser gets a fixed sentence.
 *
 * The exception is our own triggers. `guard_period_editable`,
 * `guard_line_code_in_template` and `guard_period_transition` raise messages
 * that were written for the person reading the screen, already in Indonesian.
 * Those pass through verbatim — `P0001` is how they are recognised.
 */
function explain(context: string, cause: PostgrestError, fallback: string): string {
  console.error(`[entry form] ${context}:`, cause.code, cause.message, cause.details);
  return cause.code === 'P0001' ? cause.message : fallback;
}

function failLoad(context: string, cause: PostgrestError): never {
  console.error(`[entry form] ${context}:`, cause.code, cause.message, cause.details);
  error(500, 'Gagal memuat formulir laporan.');
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
  if (!canEnterReports(locals.role)) {
    error(403, 'Laporan diisi oleh staf entitas.');
  }

  // The URL carries YYYY-MM; the column stores the first of the month.
  if (!MONTH_PATTERN.test(params.period)) error(404, 'Periode tidak ditemukan.');

  const { entities, selected, error: accessError } = await loadEntryAccess(
    locals.supabase,
    url.searchParams.get('entitas')
  );
  if (accessError) failLoad('user_entity_access', accessError);
  if (!selected) error(403, 'Akun Anda belum ditautkan ke entitas mana pun. Hubungi direksi.');

  const { data: period, error: periodError } = await locals.supabase
    .from('periods')
    .select('id, period, status, template_id, rejection_note')
    .eq('entity_id', selected.id)
    .eq('period', `${params.period}-01`)
    .maybeSingle<PeriodRow>();

  if (periodError) failLoad('periods', periodError);
  if (!period) error(404, 'Periode ini belum dibuat untuk entitas Anda.');

  const [templateResult, linesResult, syncResult] = await Promise.all([
    /**
     * The template of the period, not the newest one. A period keeps the
     * template it was created with so a historical statement still reads with
     * the labels that were in force when it was filled in.
     */
    locals.supabase
      .from('report_template_lines')
      .select('line_code, line_label, section, sort_order, help_text')
      .eq('template_id', period.template_id)
      .eq('is_active', true)
      .order('sort_order')
      .returns<TemplateLine[]>(),
    locals.supabase
      .from('report_lines')
      .select('line_code, amount, note')
      .eq('period_id', period.id)
      .returns<ReportLine[]>(),
    /**
     * Apakah entitas ini ditautkan ke sistem operasional. Tanpa baris di
     * `operational_sync_config`, tombol tarik data tidak ditampilkan sama
     * sekali — bukan ditampilkan lalu gagal saat ditekan.
     */
    locals.supabase
      .from('operational_sync_config')
      .select('is_active')
      .eq('entity_id', selected.id)
      .maybeSingle<{ is_active: boolean }>()
  ]);

  const firstError = templateResult.error ?? linesResult.error;
  if (firstError) failLoad('template or report lines', firstError);

  /**
   * Kegagalan membaca konfigurasi tidak mematikan layar input. Mengisi
   * laporan secara manual adalah jalur utama; tarik data adalah kemudahan di
   * atasnya. Menjatuhkan seluruh formulir karena tabel konfigurasi bermasalah
   * berarti menukar fitur tambahan dengan fungsi pokok.
   */
  if (syncResult.error) {
    console.error('[entry form] operational_sync_config:', syncResult.error.message);
  }

  return {
    entities,
    selected,
    period,
    month: params.period,
    templateLines: templateResult.data ?? [],
    /**
     * Only the lines that exist. A template line with no row shows 0 — nothing
     * is inserted on load, so opening a period never creates rows and never
     * touches `updated_at` or the audit log.
     */
    reportLines: linesResult.data ?? [],
    operationalSync: syncResult.data?.is_active === true
  };
};

interface LineInput {
  line_code: string;
  amount: number;
  note: string | null;
}

/**
 * Read the posted rows.
 *
 * The line codes come from the form, not from the template, and they are sent
 * to the database as they arrive. That is deliberate:
 * `guard_line_code_in_template` is the authority on which codes exist, and its
 * refusal is a readable Indonesian sentence naming the offending code.
 * Filtering here would instead drop a bad code silently — the exact failure
 * the trigger exists to prevent, moved up a layer.
 */
function collectLines(form: FormData): LineInput[] {
  const prefix = 'amount__';
  const lines: LineInput[] = [];

  for (const [key, value] of form.entries()) {
    if (!key.startsWith(prefix)) continue;
    const code = key.slice(prefix.length);
    if (code === '') continue;

    const note = String(form.get(`note__${code}`) ?? '').trim();
    lines.push({
      line_code: code,
      amount: parseAmountInput(String(value)),
      note: note === '' ? null : note
    });
  }

  return lines;
}

/**
 * Persist the posted rows.
 *
 * A row that is 0 with no note is deleted rather than stored. A statement has
 * far more lines than any one month uses, and keeping zeros would fill
 * `report_lines` with rows that say nothing — and put a row in `audit_log` for
 * each of them.
 *
 * The status is never checked before writing. `guard_period_editable` and the
 * `lines_write` policy decide whether the period is still editable, and their
 * refusal is what the user sees (roles.ts states this explicitly).
 */
async function writeLines(
  supabase: SupabaseClient,
  periodId: string,
  lines: LineInput[]
): Promise<PostgrestError | null> {
  const keep = lines.filter((line) => line.amount !== 0 || line.note !== null);
  const drop = lines
    .filter((line) => line.amount === 0 && line.note === null)
    .map((line) => line.line_code);

  if (keep.length > 0) {
    const { error: upsertError } = await supabase.from('report_lines').upsert(
      keep.map((line) => ({
        period_id: periodId,
        line_code: line.line_code,
        amount: line.amount,
        note: line.note,
        /**
         * Dikirim eksplisit, bukan dibiarkan memakai default kolom.
         *
         * Upsert hanya memperbarui kolom yang ada di payload, jadi tanpa baris
         * ini sebuah baris hasil tarik data yang kemudian dikoreksi orang akan
         * tetap tertandai 'operasional'. Yang ditandai kolom ini adalah siapa
         * yang menulis nilai terakhir, dan di sini yang menulis adalah orang.
         */
        source: 'manual'
      })),
      { onConflict: 'period_id,line_code' }
    );
    if (upsertError) return upsertError;
  }

  if (drop.length > 0) {
    const { error: deleteError } = await supabase
      .from('report_lines')
      .delete()
      .eq('period_id', periodId)
      .in('line_code', drop);
    if (deleteError) return deleteError;
  }

  return null;
}

/** Rejects a value `numeric(18,2)` cannot hold, before Postgres answers 22003
    with a message that names the column instead of the field. */
function tooLarge(lines: LineInput[]): LineInput | undefined {
  return lines.find((line) => Math.abs(line.amount) >= AMOUNT_LIMIT);
}

/**
 * Load the period by (entity, month) the same way `load` does, so an action
 * never takes a period id from the form. The month comes from the route and
 * the entity from the access list; neither is client-chosen.
 */
async function resolvePeriod(
  locals: App.Locals,
  month: string,
  requestedEntity: string
): Promise<
  | { ok: true; periodId: string; entityId: string; entityCode: string; templateId: string }
  | { ok: false; status: number; message: string }
> {
  if (!MONTH_PATTERN.test(month)) {
    return { ok: false, status: 400, message: 'Periode tidak valid.' };
  }

  const { selected, error: accessError } = await loadEntryAccess(locals.supabase, requestedEntity);
  if (accessError) {
    return {
      ok: false,
      status: 500,
      message: explain('user_entity_access', accessError, 'Gagal memeriksa akses entitas.')
    };
  }
  if (!selected) {
    return { ok: false, status: 403, message: 'Akun Anda belum ditautkan ke entitas mana pun.' };
  }

  const { data: period, error: periodError } = await locals.supabase
    .from('periods')
    .select('id, template_id')
    .eq('entity_id', selected.id)
    .eq('period', `${month}-01`)
    .maybeSingle<{ id: string; template_id: string }>();

  if (periodError) {
    return {
      ok: false,
      status: 500,
      message: explain('periods', periodError, 'Gagal memuat periode.')
    };
  }
  if (!period) {
    return { ok: false, status: 404, message: 'Periode ini tidak ada untuk entitas Anda.' };
  }

  return {
    ok: true,
    periodId: period.id,
    entityId: selected.id,
    entityCode: selected.code,
    templateId: period.template_id
  };
}

/**
 * Confirm the write actually landed.
 *
 * A DELETE the `lines_write` USING clause refuses touches zero rows and
 * reports success — see TESTING.md, "How to read a refusal". So a period that
 * left `draft` between page load and submit produces no error at all when the
 * only change was clearing a line to zero. Re-reading the status is not a
 * permission check; the database has already decided. It is the difference
 * between telling the user their edit was saved and telling them the truth.
 */
async function stillDraft(
  supabase: SupabaseClient,
  periodId: string
): Promise<{ draft: boolean; message: string }> {
  const { data } = await supabase
    .from('periods')
    .select('status')
    .eq('id', periodId)
    .maybeSingle<{ status: PeriodStatus }>();

  if (data && data.status !== 'draft') {
    return {
      draft: false,
      message: `Periode ini sudah berstatus ${data.status} dan barisnya tidak dapat diubah. Muat ulang halaman untuk melihat keadaan terkini.`
    };
  }
  return { draft: true, message: '' };
}

export const actions: Actions = {
  /**
   * Tarik angka bulan ini dari sistem operasional ILJ.
   *
   * Mengisi `report_lines` lewat jalur yang sama dengan form biasa: upsert ke
   * tabel yang sama, dengan trigger dan RLS yang sama. Tidak ada jalur khusus,
   * jadi tidak ada yang lolos audit (invarian 4), dan periode non-draft
   * ditolak `guard_period_editable` seperti biasa (invarian 5).
   *
   * Idempoten: menekan tombol dua kali menghasilkan angka yang sama.
   *
   * Yang ditarik tetap bisa dikoreksi. Sinkronisasi mengisi periode draft;
   * yang mengajukan tetap manusia.
   */
  tarikOperasional: async ({ locals, params, request }) => {
    /**
     * Peran diperiksa di sini juga, bukan hanya di `load`. Action adalah
     * endpoint tersendiri — pemeriksaan di `load` tidak menjaganya. RLS tetap
     * yang menegakkan; ini supaya penolakannya terbaca sebagai kalimat, bukan
     * sebagai "permission denied for table report_lines".
     */
    if (!canEnterReports(locals.role)) {
      return fail(403, { message: 'Laporan diisi oleh staf entitas.' });
    }

    const form = await request.formData();
    const target = await resolvePeriod(locals, params.period, String(form.get('entitas') ?? ''));
    if (!target.ok) return fail(target.status, { message: target.message });

    const { data: config, error: configError } = await locals.supabase
      .from('operational_sync_config')
      .select('base_url, is_active')
      .eq('entity_id', target.entityId)
      .maybeSingle<{ base_url: string; is_active: boolean }>();

    if (configError) {
      return fail(500, {
        message: explain('operational_sync_config', configError, 'Gagal memuat konfigurasi integrasi.')
      });
    }
    if (!config || !config.is_active) {
      return fail(400, {
        message: 'Entitas ini tidak ditautkan ke sistem operasional. Hubungi direksi.'
      });
    }

    /**
     * Token dari `$env/static/private`, tidak pernah dari database dan tidak
     * pernah dari klien — sejalan dengan cara service role key ditangani di
     * /admin/users. SvelteKit menolak menyertakan modul ini ke bundel klien,
     * dan itu lapisan pengaman terakhirnya, bukan yang pertama.
     */
    if (OPERATIONAL_SYNC_TOKEN === '') {
      console.error('[tarik operasional] OPERATIONAL_SYNC_TOKEN belum diisi');
      return fail(500, {
        message: 'Token integrasi belum dipasang di portal keuangan. Hubungi direksi.'
      });
    }

    const hasil = await fetchRekapOperasional(
      config.base_url,
      OPERATIONAL_SYNC_TOKEN,
      params.period
    );
    if (!hasil.ok) return fail(hasil.status, { message: hasil.message });

    const { rekap } = hasil;

    /**
     * Jenis pengeluaran yang belum dipetakan menghentikan sinkronisasi
     * (invarian 8). Tidak ada fallback diam-diam ke OPEX_LAIN: biaya yang
     * masuk pos karangan lebih buruk daripada tombol yang menolak bekerja,
     * karena yang pertama tidak pernah ketahuan.
     */
    if (rekap.jenis_belum_dipetakan.length > 0) {
      return fail(409, {
        message:
          'Ada jenis pengeluaran yang belum dipetakan ke pos laporan, jadi tidak ada baris yang ditulis: ' +
          rekap.jenis_belum_dipetakan.join(', ') +
          '. Minta admin operasional melengkapi pemetaannya.'
      });
    }

    const { data: templateLines, error: templateError } = await locals.supabase
      .from('report_template_lines')
      .select('line_code')
      .eq('template_id', target.templateId)
      .eq('is_active', true)
      .returns<{ line_code: string }[]>();

    if (templateError) {
      return fail(500, {
        message: explain('report_template_lines', templateError, 'Gagal memuat template laporan.')
      });
    }

    /**
     * Kode di luar template diperiksa di sini, sebelum menulis apa pun.
     *
     * `guard_line_code_in_template` akan menolaknya juga, tetapi penolakan itu
     * datang per baris di tengah upsert — dan separuh laporan yang tertulis
     * lebih buruk daripada gagal seluruhnya. Periksa dulu, tulis sekali.
     */
    const known = new Set((templateLines ?? []).map((line) => line.line_code));
    const unknown = Object.keys(rekap.baris).filter((code) => !known.has(code));
    if (unknown.length > 0) {
      return fail(409, {
        message:
          'Sistem operasional mengirim pos yang tidak ada di template periode ini, jadi tidak ada baris yang ditulis: ' +
          unknown.join(', ') +
          '. Template mungkin perlu dinaikkan versinya.'
      });
    }

    const rows = Object.entries(rekap.baris).map(([line_code, amount]) => ({
      period_id: target.periodId,
      line_code,
      /**
       * String, bukan number. Nilainya diteruskan apa adanya ke Postgres dan
       * dijadikan `numeric(18,2)` di sana, tanpa pernah melewati float.
       */
      amount,
      source: 'operasional'
    }));

    /**
     * Baris bernilai nol ikut disimpan, berbeda dari jalur form biasa yang
     * menghapusnya.
     *
     * Di form, 0 tanpa catatan berarti "tidak diisi" dan menyimpannya hanya
     * memenuhi tabel dengan baris yang tidak mengatakan apa-apa. Di sini 0
     * berarti "sudah dihitung sistem operasional, hasilnya nol" — pernyataan
     * yang berbeda, dan `source` adalah yang membedakannya.
     *
     * `note` tidak ikut dalam payload, jadi catatan yang sudah ditulis staf
     * tetap utuh: upsert hanya memperbarui kolom yang dikirim.
     */
    const { error: writeError } = await locals.supabase
      .from('report_lines')
      .upsert(rows, { onConflict: 'period_id,line_code' });

    if (writeError) {
      return fail(400, {
        message: explain('report_lines sync', writeError, 'Gagal menulis baris hasil tarik data.')
      });
    }

    // Sama seperti saveDraft: penolakan RLS pada UPDATE tidak menghasilkan
    // error, hanya nol baris tersentuh. Tanpa pemeriksaan ini, periode yang
    // berpindah status di sela-sela akan melaporkan berhasil.
    const state = await stillDraft(locals.supabase, target.periodId);
    if (!state.draft) return fail(409, { message: state.message });

    return {
      pulled: true,
      computedAt: rekap.dihitung_pada,
      lineCount: rows.length,
      sources: rekap.jumlah_sumber,
      rekapOnlyRoutes: rekap.rute_rekap_saja
    };
  },

  saveDraft: async ({ locals, params, request }) => {
    const form = await request.formData();
    const target = await resolvePeriod(locals, params.period, String(form.get('entitas') ?? ''));
    if (!target.ok) return fail(target.status, { message: target.message });

    const lines = collectLines(form);
    const oversized = tooLarge(lines);
    if (oversized) {
      return fail(400, {
        message: `Nominal ${formatAmount(oversized.amount)} pada ${oversized.line_code} terlalu besar untuk disimpan.`
      });
    }

    const writeError = await writeLines(locals.supabase, target.periodId, lines);
    if (writeError) {
      return fail(400, {
        message: explain('report_lines write', writeError, 'Gagal menyimpan baris laporan.')
      });
    }

    const state = await stillDraft(locals.supabase, target.periodId);
    if (!state.draft) return fail(409, { message: state.message });

    return { saved: true };
  },

  submit: async ({ locals, params, request }) => {
    if (!locals.user) redirect(303, '/login');

    const form = await request.formData();
    const target = await resolvePeriod(locals, params.period, String(form.get('entitas') ?? ''));
    if (!target.ok) return fail(target.status, { message: target.message });

    const lines = collectLines(form);
    const oversized = tooLarge(lines);
    if (oversized) {
      return fail(400, {
        message: `Nominal ${formatAmount(oversized.amount)} pada ${oversized.line_code} terlalu besar untuk disimpan.`
      });
    }

    // Save first: submitting is a transition on top of whatever is on screen,
    // and the lines stop being writable the moment the status changes.
    const writeError = await writeLines(locals.supabase, target.periodId, lines);
    if (writeError) {
      return fail(400, {
        message: explain('report_lines write', writeError, 'Gagal menyimpan baris laporan.')
      });
    }

    const state = await stillDraft(locals.supabase, target.periodId);
    if (!state.draft) return fail(409, { message: state.message });

    /**
     * `submitted_by` goes in the same UPDATE as the status, and it has to.
     * `guard_period_transition` requires it to equal `auth.uid()`, and the
     * approval screen later reads it to enforce that a submitter cannot
     * approve their own submission (invariant 6). Filling it in afterwards
     * would leave a submitted period with no submitter, which is the hole
     * that check used to have.
     */
    const { data: updated, error: transitionError } = await locals.supabase
      .from('periods')
      .update({
        status: 'submitted',
        submitted_by: locals.user.id,
        submitted_at: new Date().toISOString()
      })
      .eq('id', target.periodId)
      .select('status')
      .maybeSingle<{ status: PeriodStatus }>();

    if (transitionError) {
      return fail(400, {
        message: explain('periods transition', transitionError, 'Gagal mengajukan laporan.')
      });
    }
    // An UPDATE the USING clause refuses returns no row and no error.
    if (!updated) {
      return fail(403, { message: 'Pengajuan ditolak. Muat ulang halaman dan coba lagi.' });
    }

    redirect(
      303,
      `/entry?entitas=${encodeURIComponent(target.entityCode)}&terkirim=${params.period}`
    );
  }
};
