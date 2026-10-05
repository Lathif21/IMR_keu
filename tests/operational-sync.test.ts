/**
 * Tarik data operasional (Fase 3, Tugas 10).
 *
 * Yang diuji di sini adalah jalur tulisnya, bukan panggilan HTTP-nya: apa
 * yang terjadi pada `report_lines` ketika angka dari sistem operasional
 * masuk, dan apa yang terjadi ketika seharusnya tidak masuk.
 *
 * Dua hal yang gagalnya paling mahal dan paling sunyi:
 *
 *   - nominal yang lewat float. "200445000.00" yang menjadi 200444999.99
 *     tidak memunculkan error di mana pun; ia hanya membuat laporan meleset
 *     satu sen dan baru ketahuan saat ada yang menjumlahkan ulang.
 *   - penulisan sebagian. Kalau satu pos ditolak di tengah jalan, sisanya
 *     tidak boleh ikut tertulis — separuh laporan lebih buruk daripada tidak
 *     ada laporan, karena ia terlihat lengkap.
 *
 * Pemeriksaan bentuk respons dan pemetaan biaya diuji tanpa database di
 * `operational-mapping.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  closeDb,
  entityId,
  resetFixture,
  seedPeriod,
  signIn,
  sql,
  templateId
} from './helpers';

let staff: SupabaseClient;
let director: SupabaseClient;

let ilj: string;
let template: string;

/** Bentuk baris yang dikirim action `tarikOperasional`. */
function syncRows(periodId: string, baris: Record<string, string>) {
  return Object.entries(baris).map(([line_code, amount]) => ({
    period_id: periodId,
    line_code,
    amount,
    source: 'operasional'
  }));
}

beforeAll(async () => {
  await resetFixture();

  ilj = await entityId('ILJ');
  template = await templateId();

  staff = await signIn('staf.ilj');
  director = await signIn('direksi');
});

afterAll(closeDb);

describe('template trucking v2', () => {
  /**
   * Tanpa kedua baris ini, dua pos yang sudah lama ada di sistem operasional
   * (gaji_telly dan paguyuban) tidak punya tempat di laporan, dan
   * `guard_line_code_in_template` akan menolak keduanya.
   */
  it('menyediakan COGS_TELLY dan COGS_PAGUYUBAN di seksi cogs', async () => {
    const rows = await sql<{ line_code: string; section: string }>(
      `select line_code, section::text from report_template_lines
        where template_id = $1 and line_code in ('COGS_TELLY', 'COGS_PAGUYUBAN')
        order by line_code`,
      [template]
    );

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.section === 'cogs')).toBe(true);
  });

  /**
   * v2 adalah salinan v1 ditambah dua baris, bukan template yang ditulis
   * ulang. Pos yang hilang di v2 berarti periode baru kehilangan pos yang
   * periode lama punya, tanpa ada yang memutuskannya.
   */
  it('memuat seluruh pos v1', async () => {
    const hilang = await sql<{ line_code: string }>(
      `select v1.line_code
         from report_template_lines v1
        where v1.template_id = '11111111-1111-1111-1111-111111111111'
          and not exists (
            select 1 from report_template_lines v2
             where v2.template_id = $1 and v2.line_code = v1.line_code
          )`,
      [template]
    );

    expect(hilang).toEqual([]);
  });

  /**
   * Periode yang sudah ada tetap menunjuk v1 dan harus terbaca persis seperti
   * sebelumnya. Template yang sudah dipakai periode non-draft itu beku.
   */
  it('membiarkan baris v1 apa adanya', async () => {
    const [v1] = await sql<{ jumlah: string }>(
      `select count(*)::text as jumlah from report_template_lines
        where template_id = '11111111-1111-1111-1111-111111111111' and is_active`
    );
    expect(Number(v1.jumlah)).toBeGreaterThan(0);
  });
});

describe('penulisan hasil tarik data', () => {
  /**
   * Inti invarian 3. Nominal dikirim sebagai string dari sistem operasional
   * sampai ke Postgres tanpa pernah menjadi float; kalau ada satu saja
   * konversi di tengah jalan, angka ini yang pertama meleset.
   */
  it('menyimpan nominal string persis seperti dikirim', async () => {
    const period = await seedPeriod({
      entityCode: 'ILJ',
      period: '2029-03-01',
      status: 'draft',
      lines: []
    });

    const { error } = await staff
      .from('report_lines')
      .upsert(syncRows(period, { COGS_REKANAN: '200445000.00' }), {
        onConflict: 'period_id,line_code'
      });
    expect(error).toBeNull();

    const [row] = await sql<{ amount: string }>(
      "select amount::text from report_lines where period_id = $1 and line_code = 'COGS_REKANAN'",
      [period]
    );
    expect(row.amount).toBe('200445000.00');
  });

  it('menandai barisnya sebagai berasal dari sistem operasional', async () => {
    const period = await seedPeriod({
      entityCode: 'ILJ',
      period: '2029-04-01',
      status: 'draft',
      lines: []
    });

    await staff
      .from('report_lines')
      .upsert(syncRows(period, { REV_TAGIHAN: '241500000.00' }), {
        onConflict: 'period_id,line_code'
      });

    const [row] = await sql<{ source: string }>(
      "select source from report_lines where period_id = $1 and line_code = 'REV_TAGIHAN'",
      [period]
    );
    expect(row.source).toBe('operasional');
  });

  /**
   * Jalur form mengirim `source: 'manual'` secara eksplisit. Tanpa itu,
   * upsert hanya memperbarui kolom yang dikirim dan baris yang sudah
   * dikoreksi orang akan tetap tertandai 'operasional' — penanda yang
   * berbohong lebih buruk daripada tidak ada penanda.
   */
  it('kembali ke manual setelah dikoreksi lewat form', async () => {
    const period = await seedPeriod({
      entityCode: 'ILJ',
      period: '2029-05-01',
      status: 'draft',
      lines: []
    });

    await staff
      .from('report_lines')
      .upsert(syncRows(period, { REV_TAGIHAN: '241500000.00' }), {
        onConflict: 'period_id,line_code'
      });

    // Bentuk payload yang sama dengan writeLines() di +page.server.ts.
    await staff.from('report_lines').upsert(
      [
        {
          period_id: period,
          line_code: 'REV_TAGIHAN',
          amount: 250_000_000,
          note: 'koreksi invoice susulan',
          source: 'manual'
        }
      ],
      { onConflict: 'period_id,line_code' }
    );

    const [row] = await sql<{ source: string; amount: string }>(
      "select source, amount::text from report_lines where period_id = $1 and line_code = 'REV_TAGIHAN'",
      [period]
    );
    expect(row.source).toBe('manual');
    expect(row.amount).toBe('250000000.00');
  });

  /** Menekan tombol dua kali harus menghasilkan keadaan yang sama persis. */
  it('idempoten: tarik dua kali menghasilkan hasil identik', async () => {
    const period = await seedPeriod({
      entityCode: 'ILJ',
      period: '2029-06-01',
      status: 'draft',
      lines: []
    });

    const baris = { REV_TAGIHAN: '241500000.00', COGS_PAJAK: '4830000.00' };

    for (let i = 0; i < 2; i++) {
      const { error } = await staff
        .from('report_lines')
        .upsert(syncRows(period, baris), { onConflict: 'period_id,line_code' });
      expect(error).toBeNull();
    }

    const rows = await sql<{ line_code: string; amount: string }>(
      'select line_code, amount::text from report_lines where period_id = $1 order by line_code',
      [period]
    );

    expect(rows).toEqual([
      { line_code: 'COGS_PAJAK', amount: '4830000.00' },
      { line_code: 'REV_TAGIHAN', amount: '241500000.00' }
    ]);
  });

  /**
   * Baris bernilai nol tetap disimpan di jalur ini, berbeda dari jalur form.
   * Nol di sini berarti "sistem operasional sudah menghitungnya, hasilnya
   * nol" — pernyataan yang berbeda dari "belum diisi".
   */
  it('menyimpan baris bernilai nol', async () => {
    const period = await seedPeriod({
      entityCode: 'ILJ',
      period: '2029-07-01',
      status: 'draft',
      lines: []
    });

    await staff
      .from('report_lines')
      .upsert(syncRows(period, { COGS_SAKU: '0.00' }), { onConflict: 'period_id,line_code' });

    const rows = await sql<{ amount: string; source: string }>(
      "select amount::text, source from report_lines where period_id = $1 and line_code = 'COGS_SAKU'",
      [period]
    );
    expect(rows).toEqual([{ amount: '0.00', source: 'operasional' }]);
  });
});

describe('penolakan', () => {
  /**
   * Invarian 5. Triggernya sudah berbahasa Indonesia, dan pesannya harus
   * sampai ke layar apa adanya — bukan diganti "gagal menyimpan".
   */
  it('menolak tarik data pada periode submitted, dengan pesan P0001', async () => {
    const period = await seedPeriod({
      entityCode: 'ILJ',
      period: '2029-08-01',
      status: 'submitted',
      lines: [{ line_code: 'REV_TAGIHAN', amount: 1_000_000 }]
    });

    const { error } = await staff
      .from('report_lines')
      .upsert(syncRows(period, { REV_TAGIHAN: '241500000.00' }), {
        onConflict: 'period_id,line_code'
      });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('P0001');
    expect(error?.message).toMatch(/draft/i);

    const [row] = await sql<{ amount: string }>(
      "select amount::text from report_lines where period_id = $1 and line_code = 'REV_TAGIHAN'",
      [period]
    );
    expect(row.amount).toBe('1000000.00');
  });

  /**
   * Kode di luar template ditolak sebelum satu baris pun tertulis. Action
   * memeriksanya lebih dulu justru supaya penolakan trigger tidak datang di
   * tengah upsert dan meninggalkan laporan separuh jadi.
   */
  it('tidak menulis satu pun baris ketika ada kode di luar template', async () => {
    const period = await seedPeriod({
      entityCode: 'ILJ',
      period: '2029-09-01',
      status: 'draft',
      lines: []
    });

    const { error } = await staff.from('report_lines').upsert(
      syncRows(period, {
        REV_TAGIHAN: '241500000.00',
        COGS_TIDAK_ADA: '1000.00'
      }),
      { onConflict: 'period_id,line_code' }
    );

    expect(error).not.toBeNull();

    const rows = await sql('select 1 from report_lines where period_id = $1', [period]);
    expect(rows).toEqual([]);
  });

  /** `source` bukan teks bebas: nilai di luar tiga yang dikenal ditolak. */
  it('menolak nilai source yang tidak dikenal', async () => {
    const period = await seedPeriod({
      entityCode: 'ILJ',
      period: '2029-10-01',
      status: 'draft',
      lines: []
    });

    await expect(
      sql(
        "insert into report_lines (period_id, line_code, amount, source) values ($1, 'REV_TAGIHAN', 1, 'entah')",
        [period]
      )
    ).rejects.toThrow();
  });

  /**
   * Staf entitas A tidak bisa menarik data untuk entitas B. Yang menolak
   * adalah RLS, bukan pemeriksaan di action — pemeriksaan di sana hanya
   * membuat pesannya terbaca.
   */
  it('staf ILJ tidak dapat menulis ke periode entitas lain', async () => {
    const period = await seedPeriod({
      entityCode: 'AMDK',
      period: '2029-11-01',
      status: 'draft',
      lines: []
    });

    const { error } = await staff
      .from('report_lines')
      .upsert(syncRows(period, { REV_TAGIHAN: '1000000.00' }), {
        onConflict: 'period_id,line_code'
      });

    expect(error).not.toBeNull();

    const rows = await sql('select 1 from report_lines where period_id = $1', [period]);
    expect(rows).toEqual([]);
  });
});

describe('operational_sync_config', () => {
  it('dapat dibaca staf entitasnya sendiri', async () => {
    await sql(
      `insert into operational_sync_config (entity_id, base_url)
       values ($1, 'https://operasional.example.test')
       on conflict (entity_id) do update set base_url = excluded.base_url`,
      [ilj]
    );

    const { data, error } = await staff
      .from('operational_sync_config')
      .select('base_url, is_active')
      .eq('entity_id', ilj)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data?.base_url).toBe('https://operasional.example.test');
  });

  it('tidak dapat diubah staf, hanya direksi', async () => {
    const amdk = await entityId('AMDK');

    const ditolak = await staff
      .from('operational_sync_config')
      .insert({ entity_id: amdk, base_url: 'https://palsu.example.test' });
    expect(ditolak.error).not.toBeNull();

    const diterima = await director
      .from('operational_sync_config')
      .insert({ entity_id: amdk, base_url: 'https://amdk.example.test' });
    expect(diterima.error).toBeNull();
  });

  /**
   * Alamat sistem operasional menentukan dari mana angka laporan berasal.
   * Perubahannya harus meninggalkan jejak, sama seperti perubahan peran.
   */
  it('perubahannya tercatat di audit_log', async () => {
    const before = await sql<{ jumlah: string }>(
      "select count(*)::text as jumlah from audit_log where table_name = 'operational_sync_config'"
    );

    await director
      .from('operational_sync_config')
      .update({ base_url: 'https://operasional-baru.example.test' })
      .eq('entity_id', ilj);

    const after = await sql<{ jumlah: string }>(
      "select count(*)::text as jumlah from audit_log where table_name = 'operational_sync_config'"
    );

    expect(Number(after[0].jumlah)).toBeGreaterThan(Number(before[0].jumlah));
  });

  /** Alamat tanpa skema, atau dengan garis miring penutup, membuat URL ganda. */
  it('menolak base_url yang tidak berbentuk alamat', async () => {
    const garam = await entityId('GARAM');

    await expect(
      sql('insert into operational_sync_config (entity_id, base_url) values ($1, $2)', [
        garam,
        'operasional.example.test'
      ])
    ).rejects.toThrow();

    await expect(
      sql('insert into operational_sync_config (entity_id, base_url) values ($1, $2)', [
        garam,
        'https://operasional.example.test/'
      ])
    ).rejects.toThrow();
  });
});

describe('operational_expense_mapping', () => {
  /**
   * Action tarik data berjalan dengan sesi staf. Kalau staf tidak bisa
   * membaca pemetaan, seluruh pengeluaran jatuh ke Beban Operasional Lain
   * tanpa ada yang salah di mana pun selain angkanya.
   */
  it('dapat dibaca staf entitasnya sendiri', async () => {
    await sql(
      `insert into operational_expense_mapping (entity_id, source, jenis, line_code)
       values ($1, 'pengeluaran', 'Sewa Kantor', 'OPEX_SEWA')
       on conflict (entity_id, source, jenis) do update set line_code = excluded.line_code`,
      [ilj]
    );

    const { data, error } = await staff
      .from('operational_expense_mapping')
      .select('source, jenis, line_code')
      .eq('entity_id', ilj);

    expect(error).toBeNull();
    expect(data).toContainEqual({ source: 'pengeluaran', jenis: 'Sewa Kantor', line_code: 'OPEX_SEWA' });
  });

  /** Pemetaan menentukan pos sebuah biaya: keputusan direksi, bukan staf. */
  it('tidak dapat diubah staf, hanya direksi', async () => {
    const ditolak = await staff
      .from('operational_expense_mapping')
      .insert({ entity_id: ilj, source: 'pengeluaran', jenis: 'ATK', line_code: 'OPEX_ATK' });
    expect(ditolak.error).not.toBeNull();

    const diterima = await director
      .from('operational_expense_mapping')
      .insert({ entity_id: ilj, source: 'honor_telly', jenis: 'Gaji Admin Bulanan', line_code: null });
    expect(diterima.error).toBeNull();
  });

  it('perubahannya tercatat di audit_log', async () => {
    const before = await sql<{ jumlah: string }>(
      "select count(*)::text as jumlah from audit_log where table_name = 'operational_expense_mapping'"
    );

    await director
      .from('operational_expense_mapping')
      .update({ line_code: 'OPEX_LAIN' })
      .eq('entity_id', ilj)
      .eq('jenis', 'Sewa Kantor');

    const after = await sql<{ jumlah: string }>(
      "select count(*)::text as jumlah from audit_log where table_name = 'operational_expense_mapping'"
    );

    expect(Number(after[0].jumlah)).toBeGreaterThan(Number(before[0].jumlah));
  });

  it('menolak sumber yang tidak dikenal dan jenis kosong', async () => {
    await expect(
      sql(
        "insert into operational_expense_mapping (entity_id, source, jenis) values ($1, 'kas_kecil', 'ATK')",
        [ilj]
      )
    ).rejects.toThrow();

    await expect(
      sql(
        "insert into operational_expense_mapping (entity_id, source, jenis) values ($1, 'pengeluaran', '  ')",
        [ilj]
      )
    ).rejects.toThrow();
  });
});

