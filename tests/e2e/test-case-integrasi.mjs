/**
 * End-to-end lewat browser untuk docs/TEST-CASE-INTEGRASI.md (A1–F3), plus
 * tarik data periode nyata Oktober 2026 (O1).
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   node tests/e2e/test-case-integrasi.mjs
 *
 * Kredensial dibaca dari variabel environment (OPS_EMAIL, OPS_PASSWORD,
 * KEU_STAF_EMAIL, KEU_STAF_PASSWORD, KEU_DIREKSI_EMAIL, KEU_DIREKSI_PASSWORD)
 * atau, kalau kosong, dari docs/KREDENSIAL.local.md. Tidak ada yang dicetak.
 *
 * Data uji: Desember 2026, semua nama berawalan UJI-INTEGRASI, dan selalu
 * dibersihkan di akhir — juga ketika langkah sebelumnya gagal.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const OPS = 'https://imr-operasional.vercel.app';
const KEU = 'https://imr-keu.vercel.app';
const BULAN = 12;
const TAHUN = 2026;
const PERIODE = `${TAHUN}-${String(BULAN).padStart(2, '0')}`;
const OKTOBER = '2026-10';
const OUT = fileURLToPath(new URL('./hasil/test-case/', import.meta.url));

// ── Kredensial ────────────────────────────────────────────────────────────

function kredensial() {
  let tabel = '';
  try {
    tabel = readFileSync(fileURLToPath(new URL('../../docs/KREDENSIAL.local.md', import.meta.url)), 'utf8');
  } catch {
    /* hanya env */
  }
  const baris = (platform, peran) => {
    const row = tabel
      .split('\n')
      .find((l) => l.startsWith(`| ${platform} |`) && l.split('|')[3]?.trim().startsWith(peran));
    if (!row) return { email: '', password: '' };
    const kolom = row.split('|').map((s) => s.trim());
    return { email: kolom[4] ?? '', password: kolom[5] ?? '' };
  };
  const ops = baris('Sistem Operasional', 'admin');
  const dir = baris('Portal Keuangan', 'direksi');
  const staf = baris('Portal Keuangan', 'staf entitas ILJ');
  const hasil = {
    ops: { email: process.env.OPS_EMAIL || ops.email, password: process.env.OPS_PASSWORD || ops.password },
    direksi: { email: process.env.KEU_DIREKSI_EMAIL || dir.email, password: process.env.KEU_DIREKSI_PASSWORD || dir.password },
    staf: { email: process.env.KEU_STAF_EMAIL || staf.email, password: process.env.KEU_STAF_PASSWORD || staf.password }
  };
  // Direksi opsional: tanpa akun itu, kasus pemetaan (A1, D*, E3, F3) dilewati.
  const kosong = ['ops', 'staf'].filter((k) => !hasil[k].email || !hasil[k].password);
  if (kosong.length) throw new Error(`Kredensial belum lengkap untuk: ${kosong.join(', ')}`);
  return hasil;
}

const AKUN = kredensial();
const ADA_DIREKSI = Boolean(AKUN.direksi.email && AKUN.direksi.password);

// ── Data uji ──────────────────────────────────────────────────────────────

const UJI = {
  pemilik: 'UJI-INTEGRASI Pemilik',
  nopol: 'UJI 1234 IT',
  kapal: 'UJI-INTEGRASI KM Satu',
  asal: 'UJI Gudang',
  tujuan: 'UJI Pelabuhan',
  telly: 'UJI-INTEGRASI Telly',
  admin: 'UJI-INTEGRASI Admin'
};
const JENIS = {
  sewa: 'UJI-INTEGRASI Sewa',
  atk: 'UJI-INTEGRASI ATK',
  atkLain: 'UJI-INTEGRASI ATK Lain',
  gaji: 'UJI-INTEGRASI Gaji'
};
const GAJI_ADMIN = 'Gaji Admin Bulanan';
const PENGELUARAN = [
  [JENIS.sewa, 1_500_000],
  [JENIS.atk, 80_000],
  [JENIS.atkLain, 20_000],
  [JENIS.gaji, 4_000_000]
];
const INPUT = { biayaOps: 300_000, ritase: 2, tonase: 10, ongkos: 20_000, saku: 150_000, terpal: 50_000, gajiAdmin: 5_000_000 };

const POS_OPS = ['REV_TAGIHAN', 'COGS_PAJAK', 'COGS_REKANAN', 'COGS_SAKU', 'COGS_TERPAL', 'COGS_OPS', 'COGS_TELLY', 'COGS_PAGUYUBAN'];
const POS_OPEX = ['OPEX_SEWA', 'OPEX_ATK', 'OPEX_GAJI', 'OPEX_LAIN'];
const SEMUA = [...POS_OPS, ...POS_OPEX];

// ── Pencatatan ────────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });
const hasil = [];
let nomorFoto = 0;

/** `lulus` null = dilewati. */
function catat(id, lulus, detail) {
  hasil.push({ id, lulus, detail });
  console.log(`${lulus === null ? 'LEWAT' : lulus ? 'LULUS' : 'GAGAL'}  ${id}  ${detail}`);
}

const lewati = (...ids) => ids.forEach((id) => catat(id, null, 'butuh akun direksi'));

async function foto(page, nama) {
  nomorFoto += 1;
  await page
    .screenshot({ path: join(OUT, `${String(nomorFoto).padStart(2, '0')}-${nama}.png`), fullPage: true })
    .catch(() => {});
}

/** "1.897,50" -> 1897.5; "Rp 4.400" -> 4400; "" -> 0. */
function angka(teks) {
  const bersih = String(teks ?? '').replace(/[^0-9,-]/g, '').replace(',', '.');
  return bersih === '' || bersih === '-' ? 0 : Number(bersih);
}

const rp = (n) => n.toLocaleString('id-ID');

function cocok(dapat, harap) {
  const beda = Object.keys(harap).filter((k) => dapat[k] !== harap[k]);
  return {
    lulus: beda.length === 0,
    detail: beda.length
      ? beda.map((k) => `${k} dapat ${rp(dapat[k])}, harap ${rp(harap[k])}`).join('; ')
      : Object.keys(harap).map((k) => `${k}=${rp(dapat[k])}`).join(', ')
  };
}

// ── Sistem operasional ────────────────────────────────────────────────────

async function masukOps(page) {
  await page.goto(`${OPS}/login`);
  await page.fill('input[name="email"]', AKUN.ops.email);
  await page.fill('input[name="password"]', AKUN.ops.password);
  await Promise.all([page.waitForNavigation(), page.click('button[type="submit"]')]);
  if (page.url().includes('/login')) throw new Error('Login sistem operasional gagal');
}

async function tutupPopup(page) {
  const ok = page.locator('.swal2-popup .swal2-confirm');
  if (await ok.waitFor({ state: 'visible', timeout: 2_500 }).then(() => true, () => false)) {
    await ok.click();
    await page.locator('.swal2-popup').waitFor({ state: 'hidden' }).catch(() => {});
  }
}

async function buka(page, path) {
  await page.goto(`${OPS}${path}`, { waitUntil: 'networkidle' });
  await tutupPopup(page);
}

async function hapusBaris(page, path, penanda, tombol) {
  let n = 0;
  for (let i = 0; i < 10; i++) {
    await buka(page, path);
    const baris = page.locator('tr', { hasText: penanda }).first();
    if ((await baris.count()) === 0) break;
    await baris.locator(tombol).first().click();
    const ya = page.locator('.swal2-confirm');
    await ya.waitFor({ state: 'visible', timeout: 10_000 });
    await Promise.all([page.waitForNavigation({ timeout: 30_000 }), ya.click()]);
    n += 1;
  }
  return n;
}

async function bersihkanOps(page) {
  const p = `?bulan=${BULAN}&tahun=${TAHUN}`;
  const n = {
    pengeluaran: await hapusBaris(page, `/pengeluaran${p}`, 'UJI-INTEGRASI', 'button:has-text("Hapus")'),
    kegiatan: await hapusBaris(page, `/transaksi-operasional${p}`, UJI.kapal, 'button[title="Hapus data kapal ini"]'),
    kapal: await hapusBaris(page, '/kapal', UJI.kapal, 'button[title="Hapus"]'),
    kendaraan: await hapusBaris(page, '/kendaraan', UJI.nopol, 'button[\\@click^="confirmHapusKendaraan"]'),
    pemilik: await hapusBaris(page, '/pemilik', UJI.pemilik, 'button[\\@click^="confirmHapusPemilik"]'),
    karyawanTelly: await hapusBaris(page, '/karyawan', UJI.telly, 'button[\\@click^="confirmHapusKaryawan"]'),
    karyawanAdmin: await hapusAdminUji()
  };
  await buka(page, `/laporan/pendapatan${p}`);
  return n;
}

/**
 * Karyawan yang punya baris gaji tidak boleh dihapus (KaryawanController
 * ::destroy), dan tidak ada layar untuk menghapus baris gaji admin. Jadi
 * karyawan admin uji dibersihkan langsung di database sistem operasional,
 * dalam satu transaksi yang batal kalau yang tersentuh bukan tepat satu baris
 * gaji admin dan satu karyawan bernama UJI-INTEGRASI Admin.
 */
async function hapusAdminUji() {
  const { createRequire } = await import('node:module');
  const pg = createRequire(import.meta.url)('pg');
  const env = readFileSync(fileURLToPath(new URL('../../../LaporanKeuangan/.env', import.meta.url)), 'utf8');
  const url = new URL(env.match(/^DATABASE_URL_UNPOOLED="?([^"\n]+)"?/m)[1]);
  url.searchParams.delete('channel_binding');
  url.searchParams.set('sslmode', 'verify-full');

  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  try {
    await c.query('begin');
    const k = (await c.query("select id from karyawan where nama = $1 and jabatan = 'Admin'", [UJI.admin])).rows;
    if (k.length === 0) {
      await c.query('rollback');
      return 0;
    }
    if (k.length !== 1) throw new Error(`karyawan ${UJI.admin} ada ${k.length}`);
    const g = await c.query(
      'delete from gaji_telly where karyawan_id = $1 and transaksi_id is null and operasional_rekap_id is null',
      [k[0].id]
    );
    if (g.rowCount > 1) throw new Error(`baris gaji admin uji ${g.rowCount}`);
    const d = await c.query('delete from karyawan where id = $1', [k[0].id]);
    if (d.rowCount !== 1) throw new Error('karyawan admin uji tidak terhapus');
    await c.query('commit');
    return 1;
  } catch (error) {
    await c.query('rollback').catch(() => {});
    throw error;
  } finally {
    await c.end();
  }
}

async function tambahKaryawan(page, nama, jabatan) {
  await buka(page, '/karyawan');
  await page.getByRole('button', { name: 'Tambah Data Karyawan' }).click();
  const form = page.locator('form[action$="/karyawan"]');
  await form.locator('#nama').fill(nama);
  await form.locator('#jabatan').fill(jabatan);
  await Promise.all([page.waitForNavigation(), form.getByRole('button', { name: 'Simpan Karyawan' }).click()]);
}

/** Pilih <option> yang teksnya memuat `teks`. */
async function pilihOpsi(select, teks) {
  const value = await select.evaluate(
    (el, t) => [...el.options].find((o) => o.textContent.includes(t))?.value ?? null,
    teks
  );
  if (value === null) throw new Error(`Opsi "${teks}" tidak ditemukan`);
  await select.selectOption(value);
}

async function inputOperasional(page) {
  // B1 — data master
  await buka(page, '/pemilik');
  await page.getByRole('button', { name: 'Tambah Pemilik Kendaraan' }).click();
  await page.locator('form[action$="/pemilik"] input[name="nama_pemilik"]').fill(UJI.pemilik);
  await Promise.all([page.waitForNavigation(), page.getByRole('button', { name: 'Simpan Pemilik Kendaraan' }).click()]);

  await buka(page, '/kendaraan');
  await page.getByRole('button', { name: 'Tambah Data Kendaraan' }).click();
  await page.locator('form[action$="/kendaraan"] input[name="nopol"]').fill(UJI.nopol);
  await page.locator('#pemilik_id').selectOption({ label: UJI.pemilik });
  await Promise.all([page.waitForNavigation(), page.getByRole('button', { name: 'Simpan Kendaraan' }).click()]);

  await tambahKaryawan(page, UJI.telly, 'Telly');
  await tambahKaryawan(page, UJI.admin, 'Admin');
  await buka(page, '/karyawan');
  const adaKaryawan = (await page.locator('tr', { hasText: UJI.telly }).count()) > 0 &&
    (await page.locator('tr', { hasText: UJI.admin }).count()) > 0;
  await foto(page, 'ops-b1-karyawan');
  catat('B1', adaKaryawan, `pemilik, kendaraan, dan dua karyawan uji ${adaKaryawan ? 'tersimpan' : 'TIDAK lengkap'}`);

  // B2 — kegiatan kapal, dengan petugas telly
  await buka(page, `/transaksi-operasional?bulan=${BULAN}&tahun=${TAHUN}`);
  await page.getByRole('button', { name: 'Tambah Data General' }).click();
  await page.getByPlaceholder('Ketik atau pilih nama kapal').fill(UJI.kapal);
  await page.fill('input[name="tanggal_kegiatan"]:visible', `${TAHUN}-12-10`);
  await page.fill('input[name="tanggal_selesai"]:visible', `${TAHUN}-12-12`);
  await Promise.all([page.waitForNavigation(), page.getByRole('button', { name: 'Simpan Data Kapal' }).click()]);

  await buka(page, `/operasional?bulan=${BULAN}&tahun=${TAHUN}`);
  await Promise.all([page.waitForNavigation(), page.locator('tr', { hasText: UJI.kapal }).getByText('Edit Data').click()]);
  await page.waitForLoadState('networkidle');
  await tutupPopup(page);
  await page.fill('input[name="rute_asal"]', UJI.asal);
  await page.fill('input[name="rute_tujuan"]', UJI.tujuan);
  await page.locator('input[placeholder="0"]:visible').first().fill(String(INPUT.biayaOps));
  await pilihOpsi(page.locator('#telly_id'), UJI.telly);
  await page.getByPlaceholder(/Ketik Nopol Truk/).fill(UJI.nopol.slice(0, 8));
  await page.getByRole('button', { name: new RegExp(`${UJI.nopol} .*Pilih Truk`) }).click();
  await foto(page, 'ops-b2-edit-kegiatan');
  await Promise.all([page.waitForNavigation(), page.getByRole('button', { name: /Simpan Perubahan Kegiatan/ }).click()]);
  await buka(page, `/operasional?bulan=${BULAN}&tahun=${TAHUN}`);
  const adaKegiatan = (await page.locator('tr', { hasText: UJI.kapal }).count()) > 0;
  catat('B2', adaKegiatan, `kegiatan ${UJI.kapal} ${adaKegiatan ? 'tampil' : 'TIDAK tampil'} di Detail Kegiatan Kapal`);

  // B3 — rincian truk, lalu pendapatan otomatis
  await Promise.all([
    page.waitForNavigation(),
    page.locator('tr', { hasText: UJI.kapal }).getByText('Lengkapi Data Kendaraan').click()
  ]);
  await page.waitForLoadState('networkidle');
  await tutupPopup(page);
  const kolom = page.locator('table tbody tr').first().locator('input:not([type="hidden"])');
  const nilai = [INPUT.ritase, INPUT.tonase, INPUT.ongkos, INPUT.saku, INPUT.terpal];
  for (let i = 0; i < nilai.length; i++) await kolom.nth(i).fill(String(nilai[i]));
  await Promise.all([page.waitForNavigation(), page.getByRole('button', { name: /Simpan Rincian Pembayaran/ }).click()]);

  await buka(page, `/laporan/pendapatan?bulan=${BULAN}&tahun=${TAHUN}`);
  await foto(page, 'ops-b3-pendapatan');
  const pendapatan = await page.evaluate((kapal) => {
    const tr = [...document.querySelectorAll('tr')].find((r) =>
      [r.innerText, ...[...r.querySelectorAll('input')].map((i) => i.value)].join(' ').includes(kapal)
    );
    return tr ? [tr.innerText, ...[...tr.querySelectorAll('input')].map((i) => i.value)].join(' ').replace(/\s+/g, ' ') : null;
  }, UJI.kapal);
  catat(
    'B3',
    !!pendapatan && pendapatan.includes('345.000') && pendapatan.includes('1.725'),
    pendapatan ? `baris pendapatan: ${pendapatan.slice(0, 140)}` : 'baris pendapatan kapal uji tidak muncul'
  );

  // B4 — honor telly
  await buka(page, `/laporan/telly?bulan=${BULAN}&tahun=${TAHUN}`);
  await Promise.all([page.waitForNavigation(), pilihOpsi(page.locator('#karyawan_id'), UJI.telly)]);
  await page.waitForLoadState('networkidle');
  await tutupPopup(page);
  // Sel kedua: sel pertama adalah label (colspan), sel terakhir kosong.
  const net = angka(await page.locator('tr', { hasText: 'NET GAJI BERSIH' }).first().locator('td').nth(1).innerText().catch(() => ''));
  await foto(page, 'ops-b4-honor-telly');
  catat('B4', net === 4_000, `NET GAJI BERSIH ${rp(net)} (harap 4.000)`);

  // B5 — gaji admin, disimpan pertama kali di Desember 2026
  await buka(page, `/laporan/telly?bulan=${BULAN}&tahun=${TAHUN}`);
  await Promise.all([page.waitForNavigation(), pilihOpsi(page.locator('#karyawan_id'), UJI.admin)]);
  await page.waitForLoadState('networkidle');
  await tutupPopup(page);
  // Form ini ada di dalam <tr>; parser HTML memindahkan <form>-nya keluar
  // tabel, jadi kolomnya dicari dari halaman, bukan dari dalam form.
  await page.locator('input[name="gaji_total"]').first().fill(String(INPUT.gajiAdmin));
  await page.locator('input[name="pph"]').first().fill('0');
  await Promise.all([page.waitForNavigation(), page.getByRole('button', { name: /Simpan Gaji/ }).first().click()]);
  await page.waitForLoadState('networkidle');
  await tutupPopup(page);
  // Nominal tampil di <input>, bukan di teks halaman.
  const teksAdmin = await page.evaluate(() =>
    [document.body.innerText, ...[...document.querySelectorAll('input')].map((i) => i.value)].join(' ')
  );
  await foto(page, 'ops-b5-gaji-admin');
  // Judulnya ditampilkan huruf kapital lewat CSS, jadi dibandingkan tanpa
  // memedulikan besar-kecil huruf.
  const b5 = /rincian gaji admin/i.test(teksAdmin) && teksAdmin.includes('Gaji berhasil diperbarui') && teksAdmin.includes('5.000.000');
  catat('B5', b5, 'gaji admin 5.000.000 disimpan untuk Desember 2026');

  // B6 — pengeluaran
  for (const [jenis, jumlah] of PENGELUARAN) await tambahPengeluaran(page, jenis, jumlah);
  await buka(page, `/pengeluaran?bulan=${BULAN}&tahun=${TAHUN}`);
  const jumlahBaris = await page.locator('tr', { hasText: 'UJI-INTEGRASI' }).count();
  await foto(page, 'ops-b6-pengeluaran');
  catat('B6', jumlahBaris === 4, `${jumlahBaris} pengeluaran uji tersimpan (harap 4)`);

  return net;
}

async function tambahPengeluaran(page, jenis, jumlah) {
  await buka(page, '/pengeluaran/create');
  const form = page.locator('form[action$="/pengeluaran"]');
  await form.locator('input[name="tanggal"]').fill(`${TAHUN}-12-15`);
  const select = form.locator('select[name="jenis"]');
  const sudahAda = await select.evaluate((el, j) => [...el.options].some((o) => o.value === j), jenis);
  if (sudahAda) {
    await select.selectOption(jenis);
  } else {
    await select.selectOption('NEW');
    await form.locator('input[name="jenis"]').fill(jenis);
  }
  await form.locator('input[name="nama_kegiatan"]').fill(`${jenis} pengeluaran`);
  await form.locator('input[type="text"]:not([name])').first().fill(String(jumlah));
  await Promise.all([page.waitForNavigation(), form.getByRole('button', { name: 'Simpan pengeluaran' }).click()]);
}

// ── Portal keuangan ───────────────────────────────────────────────────────

async function masukKeu(page, akun) {
  await page.goto(`${KEU}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', akun.email);
  await page.fill('input[name="password"]', akun.password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]')
  ]);
}

async function bukaInput(page, bulan = PERIODE) {
  const response = await page.goto(`${KEU}/entry/${bulan}?entitas=ILJ`, { waitUntil: 'networkidle' });
  if (response?.status() === 404) {
    await page.goto(`${KEU}/entry?entitas=ILJ`, { waitUntil: 'networkidle' });
    await page.fill('input[name="bulan"]', bulan);
    await Promise.all([
      page.waitForURL((u) => u.pathname === `/entry/${bulan}`),
      page.getByRole('button', { name: 'Buat Periode Baru' }).click()
    ]);
    await page.waitForLoadState('networkidle');
  }
}

/**
 * Kolom nominal memformat isinya saat diketik, jadi fill() bisa menyambung
 * angka baru ke angka lama. Kosongkan dulu, lalu ketik seperti orang.
 */
async function isiNominal(page, code, nilai) {
  const kolom = page.locator(`#amount-${code}`);
  await kolom.click();
  await kolom.press('Control+A');
  await kolom.press('Backspace');
  await kolom.pressSequentially(String(nilai));
  await kolom.blur();
}

async function bacaPos(page, kode = SEMUA) {
  const out = {};
  for (const code of kode) {
    const kolom = page.locator(`#amount-${code}`);
    out[code] = (await kolom.count()) ? angka(await kolom.inputValue()) : 0;
  }
  return out;
}

/**
 * Kali tombol tarik data tidak muncul pada periode draft. Dicatat, bukan
 * disembunyikan: layar input menyembunyikan tombol ketika membaca
 * operational_sync_config gagal, dan itu yang sedang diamati.
 */
const anomaliTombol = [];

/** Tekan Tarik data dan kembalikan pesan serta seluruh teks peringatan. */
async function tarik(page) {
  const tombol = page.getByRole('button', { name: /Tarik data operasional/ });
  if (!(await tombol.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false))) {
    anomaliTombol.push(new URL(page.url()).pathname);
    await foto(page, 'anomali-tombol-hilang');
    await page.reload({ waitUntil: 'networkidle' });
  }
  await tombol.click();
  const pesan = page.locator('[role="status"], [role="alert"]').filter({ hasText: /\S/ }).first();
  await pesan.waitFor({ state: 'visible', timeout: 45_000 });
  await page.waitForLoadState('networkidle');
  const alert = page.locator('[role="alert"]').filter({ hasText: /\S/ });
  const gagal = (await alert.count()) > 0;
  const status = (await page.locator('[role="status"]').allInnerTexts()).join(' | ').replace(/\s+/g, ' ');
  return { gagal, teks: gagal ? (await alert.last().innerText()).replace(/\s+/g, ' ') : status };
}

const NOL = Object.fromEntries(SEMUA.map((k) => [k, 0]));

async function bukaPemetaan(page) {
  await page.goto(`${KEU}/admin/pemetaan-biaya?entitas=ILJ`, { waitUntil: 'networkidle' });
}

/** { jenis: pilihan } -> pilih di dropdown, lalu Simpan. Mengembalikan pesan. */
async function simpanPemetaan(page, pilihan) {
  await bukaPemetaan(page);
  for (const [jenis, nilai] of Object.entries(pilihan)) {
    await page.locator(`select[aria-label="Pos laporan untuk ${jenis}"]`).selectOption(nilai);
  }
  await page.getByRole('button', { name: 'Simpan pemetaan' }).click();
  const pesan = page.locator('[role="status"], [role="alert"]').filter({ hasText: /pemetaan|perubahan|Gagal/i }).first();
  await pesan.waitFor({ state: 'visible', timeout: 30_000 });
  return (await pesan.innerText()).replace(/\s+/g, ' ');
}

async function pilihanSaatIni(page, jenis) {
  await bukaPemetaan(page);
  const select = page.locator(`select[aria-label="Pos laporan untuk ${jenis}"]`);
  return (await select.count()) ? await select.inputValue() : '';
}

// ── Skenario ──────────────────────────────────────────────────────────────

/** Penanda alur normal ketika akun direksi tidak ada: lompat ke bersih-bersih. */
class SelesaiTanpaDireksi extends Error {}

const browser = await chromium.launch();
const baru = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept().catch(() => {}));
  return page;
};
const ops = await baru();
const staf = await baru();
const dir = ADA_DIREKSI ? await baru() : null;

let gajiAdminAwal = '';
let pemetaanDibuat = false;

try {
  await masukOps(ops);
  await masukKeu(staf, AKUN.staf);
  if (dir) await masukKeu(dir, AKUN.direksi);

  // HANYA_BERSIH=1: langsung ke bersih-bersih (F1, F2) dan O1.
  if (process.env.HANYA_BERSIH) throw new SelesaiTanpaDireksi();

  console.log('sisa data uji dibersihkan dulu:', JSON.stringify(await bersihkanOps(ops)));

  // A1
  if (dir) {
    gajiAdminAwal = await pilihanSaatIni(dir, GAJI_ADMIN);
    console.log(`pilihan awal "${GAJI_ADMIN}": "${gajiAdminAwal || 'belum dipetakan'}"`);
    await bukaPemetaan(dir);
    const teksA1 = await dir.locator('body').innerText();
    await foto(dir, 'keu-a1-pemetaan');
    catat('A1', dir.url().includes('/admin/pemetaan-biaya') && !teksA1.includes('tidak dapat diambil'),
      teksA1.includes('tidak dapat diambil') ? 'daftar jenis gagal diambil dari sistem operasional' : 'halaman terbuka, daftar jenis terambil');
  } else {
    lewati('A1');
  }

  // A2
  await staf.goto(`${KEU}/admin/pemetaan-biaya`, { waitUntil: 'networkidle' });
  const menuAdmin = await staf.getByRole('link', { name: 'Administrasi' }).count();
  catat('A2', !staf.url().includes('/admin') && menuAdmin === 0, `staf dialihkan ke ${new URL(staf.url()).pathname}, menu Administrasi ${menuAdmin ? 'TAMPIL' : 'tidak tampil'}`);

  // A3
  await bukaInput(staf);
  const a3Pesan = await tarik(staf);
  const a3 = cocok(await bacaPos(staf), NOL);
  await foto(staf, 'keu-a3-awal');
  catat('A3', !a3Pesan.gagal && a3.lulus, `${a3Pesan.teks.slice(0, 120)}; ${a3.detail}`);
  if (!a3.lulus) throw new Error('Desember 2026 tidak kosong; uji dihentikan sebelum menulis apa pun');

  // B1–B6
  const netTelly = await inputOperasional(ops);

  // C1
  await bukaInput(staf);
  const c1 = cocok(await bacaPos(staf), NOL);
  catat('C1', c1.lulus, `tanpa menekan tarik: ${c1.detail}`);

  // C2 + C3
  const c2Pesan = await tarik(staf);
  const c2Pos = await bacaPos(staf);
  await foto(staf, 'keu-c2-tarik');
  const harapOps = { REV_TAGIHAN: 345_000, COGS_PAJAK: 1_725, COGS_REKANAN: 200_000, COGS_SAKU: 150_000, COGS_TERPAL: 50_000, COGS_OPS: 300_000, COGS_TELLY: netTelly, COGS_PAGUYUBAN: 0 };
  const c2 = cocok(c2Pos, harapOps);
  catat('C2', !c2Pesan.gagal && c2.lulus, c2.detail);
  const c3 = cocok(c2Pos, { OPEX_LAIN: 10_600_000, OPEX_SEWA: 0, OPEX_ATK: 0, OPEX_GAJI: 0 });
  const semuaDisebut = [...Object.values(JENIS), GAJI_ADMIN].every((j) => c2Pesan.teks.includes(j));
  catat('C3', c3.lulus && semuaDisebut && c2Pesan.teks.includes('belum dipetakan'), `${c3.detail}; kelima jenis disebut: ${semuaDisebut ? 'ya' : 'TIDAK'}`);

  if (!dir) {
    lewati('D1', 'D2', 'D3', 'D4', 'D5', 'D6');

    // E1 dan E2 tanpa pemetaan: seluruh pengeluaran uji ada di OPEX_LAIN.
    await isiNominal(staf, 'OPEX_LAIN', 1_000);
    await staf.getByRole('button', { name: 'Simpan Draft' }).click();
    await staf.locator('[role="status"]').filter({ hasText: 'Draft tersimpan' }).waitFor({ timeout: 30_000 });
    await bukaInput(staf);
    const e1Sebelum = (await bacaPos(staf, ['OPEX_LAIN'])).OPEX_LAIN;
    let dialogMuncul = false;
    staf.once('dialog', () => { dialogMuncul = true; });
    await tarik(staf);
    const e1Sesudah = (await bacaPos(staf, ['OPEX_LAIN'])).OPEX_LAIN;
    catat('E1', e1Sebelum === 1_000 && dialogMuncul && e1Sesudah === 10_600_000,
      `OPEX_LAIN sebelum ${rp(e1Sebelum)}, konfirmasi ${dialogMuncul ? 'muncul' : 'TIDAK muncul'}, sesudah ${rp(e1Sesudah)}`);

    await tambahPengeluaran(ops, JENIS.sewa, 250_000);
    await bukaInput(staf);
    const e2Sebelum = (await bacaPos(staf, ['OPEX_LAIN'])).OPEX_LAIN;
    await tarik(staf);
    const e2Sesudah = (await bacaPos(staf, ['OPEX_LAIN'])).OPEX_LAIN;
    catat('E2', e2Sebelum === 10_600_000 && e2Sesudah === 10_850_000, `OPEX_LAIN sebelum tarik ${rp(e2Sebelum)}, sesudah ${rp(e2Sesudah)}`);

    // Tanpa direksi, periode yang diajukan tidak bisa dikembalikan ke draft.
    lewati('E3');
    throw new SelesaiTanpaDireksi();
  }

  // D1
  await bukaPemetaan(dir);
  const d1Teks = await dir.locator('body').innerText();
  const d1Ada = [...Object.values(JENIS), GAJI_ADMIN].every((j) => d1Teks.includes(j));
  await foto(dir, 'keu-d1-jenis');
  catat('D1', d1Ada && d1Teks.includes('Honor Telly'), `kelima jenis tampil: ${d1Ada ? 'ya' : 'TIDAK'}; sumber Honor Telly tampil: ${d1Teks.includes('Honor Telly') ? 'ya' : 'TIDAK'}`);

  // D2
  pemetaanDibuat = true;
  const d2Pesan = await simpanPemetaan(dir, {
    [JENIS.sewa]: 'OPEX_SEWA', [JENIS.atk]: 'OPEX_ATK', [JENIS.atkLain]: 'OPEX_ATK', [JENIS.gaji]: 'OPEX_GAJI', [GAJI_ADMIN]: '-'
  });
  catat('D2', /\d+ pemetaan disimpan/.test(d2Pesan), d2Pesan.slice(0, 120));

  // D3
  await bukaInput(staf);
  const d3Pesan = await tarik(staf);
  const d3 = cocok(await bacaPos(staf), { ...harapOps, OPEX_SEWA: 1_500_000, OPEX_ATK: 100_000, OPEX_GAJI: 4_000_000, OPEX_LAIN: 0 });
  await foto(staf, 'keu-d3-dipetakan');
  catat('D3', d3.lulus && !d3Pesan.teks.includes('belum dipetakan') && d3Pesan.teks.includes(`Tidak ditarik sesuai pemetaan: ${GAJI_ADMIN}`), d3.detail);

  // D4
  const d4Pesan = await simpanPemetaan(dir, { [JENIS.gaji]: '-', [GAJI_ADMIN]: 'OPEX_GAJI' });
  await bukaInput(staf);
  const d4Tarik = await tarik(staf);
  const d4 = cocok(await bacaPos(staf, ['OPEX_GAJI']), { OPEX_GAJI: 5_000_000 });
  catat('D4', d4.lulus && d4Tarik.teks.includes(JENIS.gaji), `${d4Pesan.slice(0, 40)}; ${d4.detail}`);

  // D5
  await simpanPemetaan(dir, { [JENIS.gaji]: 'OPEX_GAJI' });
  await bukaInput(staf);
  await tarik(staf);
  const d5 = cocok(await bacaPos(staf, ['OPEX_GAJI']), { OPEX_GAJI: 9_000_000 });
  catat('D5', d5.lulus, `${d5.detail} (hitung ganda yang disengaja)`);

  // D6
  await simpanPemetaan(dir, { [JENIS.atkLain]: '' });
  await bukaInput(staf);
  const d6Tarik = await tarik(staf);
  const d6 = cocok(await bacaPos(staf, ['OPEX_ATK', 'OPEX_LAIN']), { OPEX_ATK: 80_000, OPEX_LAIN: 20_000 });
  await foto(staf, 'keu-d6');
  catat('D6', d6.lulus && d6Tarik.teks.includes(JENIS.atkLain), d6.detail);

  // E1
  await isiNominal(staf, 'OPEX_SEWA', 1_000);
  await Promise.all([staf.waitForLoadState('networkidle'), staf.getByRole('button', { name: 'Simpan Draft' }).click()]);
  await staf.locator('[role="status"]').filter({ hasText: 'Draft tersimpan' }).waitFor({ timeout: 30_000 });
  await bukaInput(staf);
  const e1Sebelum = (await bacaPos(staf, ['OPEX_SEWA'])).OPEX_SEWA;
  let dialogMuncul = false;
  staf.once('dialog', () => { dialogMuncul = true; });
  await tarik(staf);
  const e1Sesudah = (await bacaPos(staf, ['OPEX_SEWA'])).OPEX_SEWA;
  catat('E1', e1Sebelum === 1_000 && dialogMuncul && e1Sesudah === 1_500_000, `sebelum ${rp(e1Sebelum)}, konfirmasi ${dialogMuncul ? 'muncul' : 'TIDAK muncul'}, sesudah ${rp(e1Sesudah)}`);

  // E2 — pengeluaran tambahan berjenis sama; baru masuk setelah tarik ulang
  await tambahPengeluaran(ops, JENIS.sewa, 250_000);
  await bukaInput(staf);
  const e2Sebelum = (await bacaPos(staf, ['OPEX_SEWA'])).OPEX_SEWA;
  await tarik(staf);
  const e2Sesudah = (await bacaPos(staf, ['OPEX_SEWA'])).OPEX_SEWA;
  catat('E2', e2Sebelum === 1_500_000 && e2Sesudah === 1_750_000, `sebelum tarik ${rp(e2Sebelum)}, sesudah ${rp(e2Sesudah)}`);

  // E3 — ajukan, tombol hilang, direksi mengembalikan ke draft
  await Promise.all([
    staf.waitForURL((u) => u.pathname === '/entry', { timeout: 30_000 }),
    staf.getByRole('button', { name: 'Ajukan' }).click()
  ]);
  await bukaInput(staf);
  const tombolSaatDiajukan = await staf.getByRole('button', { name: /Tarik data operasional/ }).count();
  await foto(staf, 'keu-e3-diajukan');

  await dir.goto(`${KEU}/approval?periode=${PERIODE}`, { waitUntil: 'networkidle' });
  const barisIlj = dir.locator('tr', { hasText: /ILJ|Indo Moda Raya/ }).first();
  await Promise.all([dir.waitForLoadState('networkidle'), barisIlj.getByText('Tolak...').click()]);
  await dir.locator('textarea[name="note"]').first().fill('UJI-INTEGRASI selesai');
  await Promise.all([dir.waitForLoadState('networkidle'), dir.getByRole('button', { name: 'Tolak & kembalikan ke draft' }).click()]);
  await dir.waitForTimeout(1_500);

  await bukaInput(staf);
  const teksE3 = await staf.locator('body').innerText();
  const tombolSetelahDitolak = await staf.getByRole('button', { name: /Tarik data operasional/ }).count();
  catat('E3', tombolSaatDiajukan === 0 && tombolSetelahDitolak > 0 && teksE3.includes('UJI-INTEGRASI selesai'),
    `tombol saat diajukan: ${tombolSaatDiajukan ? 'TAMPIL' : 'hilang'}; setelah ditolak: ${tombolSetelahDitolak ? 'muncul' : 'TIDAK muncul'}`);
} catch (error) {
  if (!(error instanceof SelesaiTanpaDireksi)) {
    catat('ERROR', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
    await foto(ops, 'error-ops');
    await foto(staf, 'error-staf');
    if (dir) await foto(dir, 'error-direksi');
  }
} finally {
  // F1–F3, selalu. Urutan penting: tarik terakhir sebelum pemetaan dihapus.
  try {
    const n = await bersihkanOps(ops);
    catat('F1', true, `dihapus ${JSON.stringify(n)}`);
  } catch (error) {
    await foto(ops, 'f1-gagal');
    catat('F1', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
  }
  try {
    await bukaInput(staf);
    const f2Pesan = await tarik(staf);
    const f2 = cocok(await bacaPos(staf), NOL);
    await foto(staf, 'keu-f2-akhir');
    catat('F2', !f2Pesan.gagal && f2.lulus, f2.detail);
  } catch (error) {
    catat('F2', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
  }
  if (!dir) lewati('F3');
  else try {
    if (pemetaanDibuat) {
      await bukaPemetaan(dir);
      const ada = {};
      for (const jenis of Object.values(JENIS)) {
        if (await dir.locator(`select[aria-label="Pos laporan untuk ${jenis}"]`).count()) ada[jenis] = '';
      }
      if (await dir.locator(`select[aria-label="Pos laporan untuk ${GAJI_ADMIN}"]`).count()) ada[GAJI_ADMIN] = gajiAdminAwal;
      if (Object.keys(ada).length) await simpanPemetaan(dir, ada);
    }
    await bukaPemetaan(dir);
    const teks = await dir.locator('body').innerText();
    const masihAda = Object.values(JENIS).filter((j) => teks.includes(j));
    catat('F3', masihAda.length === 0, masihAda.length ? `masih ada: ${masihAda.join(', ')}` : `pemetaan uji dihapus; ${GAJI_ADMIN} dikembalikan ke "${gajiAdminAwal || 'belum dipetakan'}"`);
  } catch (error) {
    catat('F3', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
  }

  // O1 — data nyata Oktober 2026
  try {
    await bukaInput(staf, OKTOBER);
    const oPesan = await tarik(staf);
    const o = await bacaPos(staf, POS_OPS);
    await foto(staf, 'keu-o1-oktober');
    catat('O1', !oPesan.gagal && o.REV_TAGIHAN > 0, `Oktober 2026: ${Object.entries(o).map(([k, v]) => `${k}=${rp(v)}`).join(', ')}`);
  } catch (error) {
    catat('O1', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
  }

  catat(
    'ANOMALI',
    anomaliTombol.length === 0,
    anomaliTombol.length
      ? `tombol tarik data tidak muncul ${anomaliTombol.length}x pada periode draft (${anomaliTombol.join(', ')}); muncul setelah muat ulang`
      : 'tombol tarik data selalu muncul pada periode draft'
  );
  writeFileSync(join(OUT, 'hasil.json'), JSON.stringify(hasil, null, 2));
  await browser.close();
}

const gagal = hasil.filter((h) => h.lulus === false).length;
const lewat = hasil.filter((h) => h.lulus === null).length;
console.log(`\n${hasil.length - gagal - lewat} lulus, ${gagal} gagal, ${lewat} dilewati`);
process.exit(gagal === 0 ? 0 : 1);
