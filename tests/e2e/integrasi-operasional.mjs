/**
 * Tes integrasi lewat layar: sistem operasional (Laravel) → portal keuangan.
 * Skenario dan alasannya ada di docs/TESTING-INTEGRASI.md.
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   OPS_EMAIL=... OPS_PASSWORD=... KEU_EMAIL=... KEU_PASSWORD=... \
 *     node tests/e2e/integrasi-operasional.mjs
 *
 * Tidak ada satu pun panggilan API langsung: setiap data diinput lewat form,
 * dan setiap angka dibaca dari layar.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const OPS = process.env.OPS_URL ?? 'https://imr-operasional.vercel.app';
const KEU = process.env.KEU_URL ?? 'https://imr-keu.vercel.app';
const BULAN = 12;
const TAHUN = 2026;
const PERIODE = `${TAHUN}-${String(BULAN).padStart(2, '0')}`;
const OUT = fileURLToPath(new URL('./hasil/', import.meta.url));

const UJI = {
  pemilik: 'UJI-INTEGRASI Pemilik',
  nopol: 'UJI 1234 IT',
  kapal: 'UJI-INTEGRASI KM Satu',
  asal: 'UJI Gudang',
  tujuan: 'UJI Pelabuhan',
  jenisBaru: 'UJI-INTEGRASI jenis belum dipetakan'
};

// Angka yang diinput, dan angka yang harus muncul di portal.
const INPUT = { biayaOps: 300_000, ritase: 2, tonase: 10, ongkos: 20_000, saku: 150_000, terpal: 50_000 };
const HARAP = {
  REV_TAGIHAN: 345_000, // tonase 10 MT × 1000 kg × harga default 34.500 / 1000
  COGS_PAJAK: 1_725, // 0,5% dari 345.000
  COGS_REKANAN: 200_000, // tonase 10 × ongkos angkut 20.000
  COGS_SAKU: 150_000,
  COGS_TERPAL: 50_000,
  COGS_OPS: 300_000
};
const SAKU_BARU = 175_000;
const POS = Object.keys(HARAP);
const NOL = Object.fromEntries(POS.map((code) => [code, 0]));

function need(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} belum diisi`);
  return value;
}

mkdirSync(OUT, { recursive: true });
const hasil = [];
let langkah = 0;

function catat(id, lulus, detail) {
  hasil.push({ id, lulus, detail });
  console.log(`${lulus ? 'LULUS' : 'GAGAL'}  ${id}  ${detail}`);
}

async function foto(page, nama) {
  langkah += 1;
  await page.screenshot({ path: join(OUT, `${String(langkah).padStart(2, '0')}-${nama}.png`), fullPage: true });
}

function samaDengan(dapat, harap) {
  const beda = POS.filter((code) => dapat[code] !== harap[code]);
  return {
    lulus: beda.length === 0,
    detail: beda.length === 0
      ? POS.map((code) => `${code}=${dapat[code].toLocaleString('id-ID')}`).join(', ')
      : beda.map((code) => `${code} dapat ${dapat[code]}, harap ${harap[code]}`).join('; ')
  };
}

// ── Sistem operasional ────────────────────────────────────────────────────

async function masukOps(page) {
  await page.goto(`${OPS}/login`);
  await page.fill('input[name="email"]', need('OPS_EMAIL'));
  await page.fill('input[name="password"]', need('OPS_PASSWORD'));
  await Promise.all([page.waitForNavigation(), page.click('button[type="submit"]')]);
}

/**
 * Buka halaman sistem operasional, lalu tutup popup "Berhasil!" SweetAlert
 * dari langkah sebelumnya — popup itu menutupi seluruh halaman.
 */
async function buka(page, path) {
  await page.goto(`${OPS}${path}`, { waitUntil: 'networkidle' });
  await tutupPopup(page);
}

/**
 * Pesan flash ikut ke halaman tujuan setelah redirect, jadi popup bisa muncul
 * di halaman mana pun — juga setelah navigasi lewat klik.
 */
async function tutupPopup(page) {
  // Popup muncul sesaat setelah halaman selesai dimuat, jadi ditunggu sebentar.
  const selesai = page.locator('.swal2-popup .swal2-confirm');
  const muncul = await selesai.waitFor({ state: 'visible', timeout: 2_500 }).then(() => true, () => false);
  if (muncul) {
    await selesai.click();
    await page.locator('.swal2-popup').waitFor({ state: 'hidden' }).catch(() => {});
  }
}

/** Konfirmasi SweetAlert yang dipakai semua tombol hapus. */
async function konfirmasiHapus(page) {
  const tombol = page.locator('.swal2-confirm');
  await tombol.waitFor({ state: 'visible', timeout: 10_000 });
  await Promise.all([page.waitForNavigation({ timeout: 30_000 }), tombol.click()]);
}

/** Hapus setiap baris yang memuat `penanda` di halaman `path`, satu per satu. */
async function hapusBaris(page, path, penanda, pemilihTombol) {
  console.log(`  bersihkan ${path}`);
  let terhapus = 0;
  for (let putaran = 0; putaran < 10; putaran++) {
    await buka(page, `${path}`);
    const baris = page.locator('tr', { hasText: penanda }).first();
    if ((await baris.count()) === 0) break;
    await baris.locator(pemilihTombol).first().click();
    await konfirmasiHapus(page);
    terhapus += 1;
  }
  return terhapus;
}

async function bersihkanOps(page) {
  const periode = `?bulan=${BULAN}&tahun=${TAHUN}`;
  const n = {
    pengeluaran: await hapusBaris(page, `/pengeluaran${periode}`, 'UJI-INTEGRASI', 'button:has-text("Hapus")'),
    kegiatan: await hapusBaris(page, `/transaksi-operasional${periode}`, UJI.kapal, 'button[title="Hapus data kapal ini"]'),
    kapal: await hapusBaris(page, '/kapal', UJI.kapal, 'button[title="Hapus"]'),
    kendaraan: await hapusBaris(page, '/kendaraan', UJI.nopol, 'button[\\@click^="confirmHapusKendaraan"]'),
    pemilik: await hapusBaris(page, '/pemilik', UJI.pemilik, 'button[\\@click^="confirmHapusPemilik"]')
  };
  // Membuka Laporan Pendapatan membuang baris yang kapalnya sudah tidak ada.
  await buka(page, `/laporan/pendapatan${periode}`);
  return n;
}

async function inputOperasional(page) {
  // 1. Data master: pemilik dan kendaraan.
  console.log('  tahap:1. Data master: pemilik dan kendaraan');
  await buka(page, `/pemilik`);
  await page.getByRole('button', { name: 'Tambah Pemilik Kendaraan' }).click();
  await page.locator(`form[action$="/pemilik"] input[name="nama_pemilik"]`).fill(UJI.pemilik);
  await Promise.all([page.waitForNavigation(), page.getByRole('button', { name: 'Simpan Pemilik Kendaraan' }).click()]);

  await buka(page, `/kendaraan`);
  await page.getByRole('button', { name: 'Tambah Data Kendaraan' }).click();
  await page.locator('form[action$="/kendaraan"] input[name="nopol"]').fill(UJI.nopol);
  await page.locator('#pemilik_id').selectOption({ label: UJI.pemilik });
  await Promise.all([page.waitForNavigation(), page.getByRole('button', { name: 'Simpan Kendaraan' }).click()]);

  // 2. Database General: kapal untuk Desember 2026.
  console.log('  tahap:2. Database General: kapal untuk Dese');
  await buka(page, `/transaksi-operasional?bulan=${BULAN}&tahun=${TAHUN}`);
  await page.getByRole('button', { name: 'Tambah Data General' }).click();
  await page.getByPlaceholder('Ketik atau pilih nama kapal').fill(UJI.kapal);
  await page.fill('input[name="tanggal_kegiatan"]:visible', `${TAHUN}-12-10`);
  await page.fill('input[name="tanggal_selesai"]:visible', `${TAHUN}-12-12`);
  await Promise.all([page.waitForNavigation(), page.getByRole('button', { name: 'Simpan Data Kapal' }).click()]);
  await foto(page, 'ops-database-general');

  // 3. Detail Kegiatan Kapal → Edit Data: rute, biaya operasional, truk.
  console.log('  tahap:3. Detail Kegiatan Kapal → Edit Data:');
  await buka(page, `/operasional?bulan=${BULAN}&tahun=${TAHUN}`);
  await Promise.all([
    page.waitForNavigation(),
    page.locator('tr', { hasText: UJI.kapal }).getByText('Edit Data').click()
  ]);
  await page.waitForLoadState('networkidle');
  await tutupPopup(page);
  await page.fill('input[name="rute_asal"]', UJI.asal);
  await page.fill('input[name="rute_tujuan"]', UJI.tujuan);
  await page.locator('input[placeholder="0"]:visible').first().fill(String(INPUT.biayaOps));
  await page.getByPlaceholder(/Ketik Nopol Truk/).fill(UJI.nopol.slice(0, 8));
  await page.getByRole('button', { name: new RegExp(`${UJI.nopol} .*Pilih Truk`) }).click();
  await foto(page, 'ops-edit-kegiatan');
  await Promise.all([page.waitForNavigation(), page.getByRole('button', { name: /Simpan Perubahan Kegiatan/ }).click()]);

  // 4. Lengkapi Data Kendaraan: trip, tonase, ongkos angkut, saku, terpal.
  console.log('  tahap:4. Lengkapi Data Kendaraan: trip, ton');
  await isiTruk(page, INPUT.saku);
}

async function isiTruk(page, saku) {
  await buka(page, `/operasional?bulan=${BULAN}&tahun=${TAHUN}`);
  await Promise.all([
    page.waitForNavigation(),
    page.locator('tr', { hasText: UJI.kapal }).getByText('Lengkapi Data Kendaraan').click()
  ]);
  await page.waitForLoadState('networkidle');
  await tutupPopup(page);
  const kolom = page.locator('table tbody tr').first().locator('input:not([type="hidden"])');
  const nilai = [INPUT.ritase, INPUT.tonase, INPUT.ongkos, saku, INPUT.terpal];
  for (let i = 0; i < nilai.length; i++) {
    await kolom.nth(i).fill(String(nilai[i]));
  }
  await foto(page, `ops-rincian-truk-saku-${saku}`);
  await Promise.all([page.waitForNavigation(), page.getByRole('button', { name: /Simpan Rincian Pembayaran/ }).click()]);
}

async function bacaPendapatan(page) {
  await buka(page, `/laporan/pendapatan?bulan=${BULAN}&tahun=${TAHUN}`);
  await foto(page, 'ops-laporan-pendapatan');
  // Tabel ini bisa diedit di tempat: sebagian nilainya ada di dalam <input>.
  return page.evaluate((kapal) => {
    const baris = [...document.querySelectorAll('tr')].find((tr) =>
      [tr.innerText, ...[...tr.querySelectorAll('input')].map((i) => i.value)].join(' ').includes(kapal)
    );
    if (!baris) return null;
    const isi = [baris.innerText, ...[...baris.querySelectorAll('input')].map((i) => i.value)];
    return isi.join(' ').replace(/\s+/g, ' ');
  }, UJI.kapal);
}

async function inputPengeluaranBaru(page) {
  await buka(page, `/pengeluaran/create`);
  const form = page.locator('form[action$="/pengeluaran"]');
  await form.locator('input[name="tanggal"]').fill(`${TAHUN}-12-15`);
  await form.locator('select[name="jenis"]').selectOption('NEW');
  await form.locator('input[name="jenis"]').fill(UJI.jenisBaru);
  await form.locator('input[name="nama_kegiatan"]').fill('UJI-INTEGRASI pengeluaran');
  // Nominal diketik di kolom berformat; kolom `jumlah` yang tersembunyi diisi dari situ.
  await form.locator('input[type="text"]:not([name])').first().fill('77777');
  await foto(page, 'ops-pengeluaran');
  await Promise.all([page.waitForNavigation(), form.getByRole('button', { name: 'Simpan pengeluaran' }).click()]);
}

// ── Portal keuangan ───────────────────────────────────────────────────────

async function masukKeu(page) {
  await page.goto(`${KEU}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', need('KEU_EMAIL'));
  await page.fill('input[name="password"]', need('KEU_PASSWORD'));
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]')
  ]);
}

async function bukaInput(page) {
  const url = `${KEU}/entry/${PERIODE}?entitas=ILJ`;
  const response = await page.goto(url, { waitUntil: 'networkidle' });
  if (response?.status() === 404) {
    await page.goto(`${KEU}/entry?entitas=ILJ`, { waitUntil: 'networkidle' });
    await page.fill('input[name="bulan"]', PERIODE);
    await Promise.all([
      page.waitForURL((u) => u.pathname === `/entry/${PERIODE}`),
      page.getByRole('button', { name: 'Buat Periode Baru' }).click()
    ]);
    await page.waitForLoadState('networkidle');
  }
}

async function bacaPos(page) {
  const angka = {};
  for (const code of POS) {
    const kolom = page.locator(`#amount-${code}`);
    const teks = (await kolom.count()) ? await kolom.inputValue() : '';
    angka[code] = Number(teks.replace(/[^0-9-]/g, '') || 0);
  }
  return angka;
}

/** Tekan Tarik data, setujui konfirmasi timpa bila muncul, kembalikan pesannya. */
async function tarik(page) {
  await page.getByRole('button', { name: /Tarik data operasional/ }).click();
  const pesan = page.locator('[role="status"], [role="alert"]').filter({ hasText: /\S/ }).last();
  await pesan.waitFor({ state: 'visible', timeout: 45_000 });
  await page.waitForLoadState('networkidle');
  const alert = page.locator('[role="alert"]').filter({ hasText: /\S/ });
  return {
    gagal: (await alert.count()) > 0,
    teks: ((await alert.count()) ? await alert.last().innerText() : await pesan.innerText()).replace(/\s+/g, ' ').trim()
  };
}

// ── Skenario ──────────────────────────────────────────────────────────────

const browser = await chromium.launch();
const ops = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const keu = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
// Konfirmasi "angka yang sudah ada akan ditimpa" saat tarik ulang: setujui.
keu.on('dialog', (dialog) => dialog.accept().catch(() => {}));

try {
  await masukOps(ops);
  await masukKeu(keu);

  const sisa = await bersihkanOps(ops);
  console.log('sisa data uji yang dibersihkan dulu:', JSON.stringify(sisa));

  // T1 — periode siap, dan angka awal nol.
  await bukaInput(keu);
  const awal = await tarik(keu);
  const t1 = samaDengan(await bacaPos(keu), NOL);
  await foto(keu, 'keu-t1-awal');
  catat('T1', !awal.gagal && t1.lulus, `periode ${PERIODE} draft, tarik awal: "${awal.teks}"; ${t1.detail}`);

  // T2 — input di sistem operasional.
  await inputOperasional(ops);
  const pendapatan = await bacaPendapatan(ops);
  catat(
    'T2',
    pendapatan !== null && pendapatan.includes('345.000') && pendapatan.includes('1.725'),
    pendapatan ? `baris pendapatan otomatis: ${pendapatan.slice(0, 160)}` : 'baris pendapatan kapal uji tidak muncul'
  );

  // T3 — tanpa menekan Tarik data, portal tidak berubah.
  await bukaInput(keu);
  const t3 = samaDengan(await bacaPos(keu), NOL);
  await foto(keu, 'keu-t3-tanpa-tarik');
  catat('T3', t3.lulus, `setelah input operasional, sebelum tarik: ${t3.detail}`);

  // T4 — tarik data.
  const t4Pesan = await tarik(keu);
  const t4 = samaDengan(await bacaPos(keu), HARAP);
  await foto(keu, 'keu-t4-setelah-tarik');
  catat('T4', !t4Pesan.gagal && t4.lulus, `"${t4Pesan.teks}"; ${t4.detail}`);

  // T5 — perubahan di operasional baru terlihat setelah tarik ulang.
  await isiTruk(ops, SAKU_BARU);
  await bukaInput(keu);
  const t5Sebelum = await bacaPos(keu);
  const t5Pesan = await tarik(keu);
  const t5Sesudah = await bacaPos(keu);
  await foto(keu, 'keu-t5-tarik-ulang');
  catat(
    'T5',
    t5Sebelum.COGS_SAKU === INPUT.saku && !t5Pesan.gagal && t5Sesudah.COGS_SAKU === SAKU_BARU,
    `COGS_SAKU sebelum tarik ${t5Sebelum.COGS_SAKU.toLocaleString('id-ID')}, sesudah ${t5Sesudah.COGS_SAKU.toLocaleString('id-ID')}`
  );

  // T6 — jenis pengeluaran yang belum dipetakan menghentikan tarik.
  await inputPengeluaranBaru(ops);
  await bukaInput(keu);
  const t6Pesan = await tarik(keu);
  const t6Angka = await bacaPos(keu);
  await foto(keu, 'keu-t6-jenis-belum-dipetakan');
  catat(
    'T6',
    t6Pesan.gagal && t6Pesan.teks.includes(UJI.jenisBaru) && t6Angka.COGS_SAKU === SAKU_BARU,
    `pesan: "${t6Pesan.teks}"; COGS_SAKU tetap ${t6Angka.COGS_SAKU.toLocaleString('id-ID')}`
  );
} catch (error) {
  catat('ERROR', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
  await foto(ops, 'error-ops').catch(() => {});
  await foto(keu, 'error-keu').catch(() => {});
} finally {
  // T7 — bersih-bersih, selalu.
  try {
    const n = await bersihkanOps(ops);
    await bukaInput(keu);
    const akhir = await tarik(keu);
    const t7 = samaDengan(await bacaPos(keu), NOL);
    await foto(keu, 'keu-t7-akhir');
    catat('T7', !akhir.gagal && t7.lulus, `dihapus ${JSON.stringify(n)}; tarik akhir: "${akhir.teks}"; ${t7.detail}`);
  } catch (error) {
    catat('T7', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
  }
  writeFileSync(join(OUT, 'hasil.json'), JSON.stringify(hasil, null, 2));
  await browser.close();
}

const gagal = hasil.filter((item) => !item.lulus).length;
console.log(`\n${hasil.length - gagal} lulus, ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
