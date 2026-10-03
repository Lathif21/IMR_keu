/**
 * Membaca rekap bulanan dari sistem operasional ILJ (Laravel).
 *
 * Satu arah: portal keuangan yang menarik, sistem operasional yang menjawab.
 * Laravel tidak tahu apa pun tentang Supabase, dan sistem operasional tetap
 * jalan penuh kalau portal ini mati.
 *
 * Seluruh nominal diperlakukan sebagai STRING dari ujung ke ujung. Tidak ada
 * `Number()` atas nominal di berkas ini, dan tidak boleh ada: pembulatan
 * float menghasilkan selisih satu sen yang harus dijelaskan ke orang. Satu-
 * satunya penjumlahan — biaya per jenis yang dipetakan ke pos yang sama —
 * dikerjakan dalam sen sebagai `bigint`. Nilai string diteruskan apa adanya
 * ke Postgres, yang mengubahnya menjadi `numeric(18,2)` tanpa melewati float.
 */

/** Batas waktu satu panggilan. Sistem operasional ada di server lain. */
const TIMEOUT_MS = 20_000;

/**
 * Nominal yang sah: bilangan bulat, boleh diikuti satu atau dua desimal.
 *
 * Lebih dari dua desimal ditolak, dan itu bukan kerewelan. `"1.005"` hanya
 * bisa muncul kalau pengirim sempat memakai float — persis kegagalan yang
 * kontrak string ini ada untuk mencegahnya. Notasi eksponen (`1e8`) ditolak
 * karena alasan yang sama.
 */
const AMOUNT_PATTERN = /^-?\d{1,18}(\.\d{1,2})?$/;

/**
 * Asal biaya di sistem operasional. `pengeluaran` dikelompokkan per kolom
 * `jenis`; `honor_telly` adalah gaji admin bulanan yang dicatat di Honor
 * Telly.
 */
export type SumberBiaya = 'pengeluaran' | 'honor_telly';

/** Satu jenis biaya satu bulan, belum dipetakan ke pos mana pun. */
export interface BiayaJenis {
  sumber: SumberBiaya;
  jenis: string;
  jumlah: string;
  baris: number;
}

export interface RekapOperasional {
  periode: string;
  dihitung_pada: string;
  /** line_code -> nominal sebagai string, misalnya "200445000.00". */
  baris: Record<string, string>;
  /** Pengeluaran dan gaji admin, per jenis. Dipetakan di portal ini. */
  biaya_per_jenis: BiayaJenis[];
  /** Rute yang angkanya dari rekap manual karena tidak ada transaksinya. */
  rute_rekap_saja: { kapal: string; rute: string }[];
  jumlah_sumber: Record<string, number>;
}

export type RekapResult =
  | { ok: true; rekap: RekapOperasional }
  | { ok: false; status: number; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Memeriksa bentuk respons sebelum satu baris pun menyentuh database.
 *
 * Sistem operasional adalah sistem lain dengan siklus rilisnya sendiri.
 * Menganggap responsnya selalu berbentuk seperti yang disepakati berarti
 * kesalahan di sana muncul di sini sebagai baris laporan yang aneh, bukan
 * sebagai pesan kesalahan.
 */
export function parseRekap(body: unknown): RekapResult {
  if (!isRecord(body)) {
    return { ok: false, status: 502, message: 'Sistem operasional mengirim respons yang tidak dikenali.' };
  }

  if (!isRecord(body.baris)) {
    return { ok: false, status: 502, message: 'Respons sistem operasional tidak memuat daftar baris.' };
  }

  const baris: Record<string, string> = {};
  for (const [code, amount] of Object.entries(body.baris)) {
    if (typeof amount !== 'string') {
      // Termasuk `number`. Angka JSON sudah melewati float saat diurai, jadi
      // menerimanya berarti menerima nilai yang mungkin sudah bergeser.
      return {
        ok: false,
        status: 502,
        message: `Nominal ${code} dikirim bukan sebagai teks. Sistem operasional harus mengirim "0.00", bukan 0.`
      };
    }
    if (!AMOUNT_PATTERN.test(amount)) {
      return {
        ok: false,
        status: 502,
        message: `Nominal ${code} tidak berbentuk angka rupiah yang sah: ${amount}`
      };
    }
    baris[code] = amount;
  }

  /**
   * Wajib ada. Tanpa daftar ini, pengeluaran bulan itu hilang dari laporan
   * tanpa pesan apa pun — sistem operasional versi lama mengirim pos OPEX
   * yang sudah dipetakan di sana, dan pemetaan itu tidak lagi dipakai.
   */
  if (!Array.isArray(body.biaya_per_jenis)) {
    return {
      ok: false,
      status: 502,
      message:
        'Sistem operasional belum mengirim rincian biaya per jenis. Sistem operasional perlu diperbarui sebelum data bisa ditarik.'
    };
  }

  const biayaPerJenis: BiayaJenis[] = [];
  for (const item of body.biaya_per_jenis) {
    if (
      !isRecord(item) ||
      (item.sumber !== 'pengeluaran' && item.sumber !== 'honor_telly') ||
      typeof item.jenis !== 'string'
    ) {
      return { ok: false, status: 502, message: 'Rincian biaya per jenis tidak berbentuk yang disepakati.' };
    }
    if (typeof item.jumlah !== 'string' || !AMOUNT_PATTERN.test(item.jumlah)) {
      return {
        ok: false,
        status: 502,
        message: `Nominal biaya "${item.jenis}" tidak berbentuk angka rupiah yang sah.`
      };
    }
    biayaPerJenis.push({
      sumber: item.sumber,
      jenis: item.jenis,
      jumlah: item.jumlah,
      baris: typeof item.baris === 'number' && Number.isFinite(item.baris) ? item.baris : 0
    });
  }

  /**
   * Pos OPEX tidak boleh datang dari sistem operasional lagi. Kalau datang,
   * pengirimnya masih memetakan sendiri, dan menuliskannya di samping hasil
   * pemetaan portal akan menghitung pengeluaran yang sama dua kali.
   */
  const opexDariSana = Object.keys(baris).filter((code) => code.startsWith('OPEX_'));
  if (opexDariSana.length > 0) {
    return {
      ok: false,
      status: 502,
      message: `Sistem operasional masih mengirim pos pengeluaran yang sudah dipetakan (${opexDariSana.join(', ')}). Pemetaan sekarang dilakukan di portal; sistem operasional perlu diperbarui.`
    };
  }

  const ruteRekapSaja = Array.isArray(body.rute_rekap_saja)
    ? body.rute_rekap_saja
        .filter(isRecord)
        .map((item) => ({ kapal: String(item.kapal ?? '-'), rute: String(item.rute ?? '-') }))
    : [];

  const jumlahSumber: Record<string, number> = {};
  if (isRecord(body.jumlah_sumber)) {
    for (const [key, value] of Object.entries(body.jumlah_sumber)) {
      if (typeof value === 'number' && Number.isFinite(value)) jumlahSumber[key] = value;
    }
  }

  return {
    ok: true,
    rekap: {
      periode: typeof body.periode === 'string' ? body.periode : '',
      dihitung_pada: typeof body.dihitung_pada === 'string' ? body.dihitung_pada : '',
      baris,
      biaya_per_jenis: biayaPerJenis,
      rute_rekap_saja: ruteRekapSaja,
      jumlah_sumber: jumlahSumber
    }
  };
}

// ---------------------------------------------------------------------------
// Pemetaan biaya ke pos laporan
// ---------------------------------------------------------------------------

/** Pos penampung biaya yang belum dipetakan. */
export const POS_BELUM_DIPETAKAN = 'OPEX_LAIN';

/** Satu baris `operational_expense_mapping`. `line_code` null = tidak ditarik. */
export interface PemetaanBiaya {
  source: SumberBiaya;
  jenis: string;
  line_code: string | null;
}

export interface HasilPemetaan {
  /** Baris operasional ditambah pos hasil pemetaan, siap ditulis. */
  baris: Record<string, string>;
  /** Jenis tanpa pemetaan, yang masuk POS_BELUM_DIPETAKAN. */
  belumDipetakan: BiayaJenis[];
  /** Jenis yang sengaja tidak ditarik (line_code null). */
  tidakDitarik: BiayaJenis[];
}

/** "1500000.50" -> 150000050n. Masukan sudah lolos AMOUNT_PATTERN. */
function keSen(amount: string): bigint {
  const negatif = amount.startsWith('-');
  const [utuh, pecahan = ''] = amount.replace(/^-/, '').split('.');
  const sen = BigInt(utuh) * 100n + BigInt(pecahan.padEnd(2, '0'));
  return negatif ? -sen : sen;
}

/** Kebalikan keSen(): selalu dua desimal. */
function dariSen(sen: bigint): string {
  const negatif = sen < 0n;
  const mutlak = negatif ? -sen : sen;
  const pecahan = (mutlak % 100n).toString().padStart(2, '0');
  return `${negatif ? '-' : ''}${mutlak / 100n}.${pecahan}`;
}

/**
 * Memasukkan biaya per jenis ke pos laporan menurut pemetaan entitas.
 *
 *   - jenis yang dipetakan ke sebuah kode: dijumlahkan ke kode itu
 *   - jenis yang dipetakan ke null: tidak ditarik, dan dilaporkan
 *   - jenis tanpa pemetaan: masuk POS_BELUM_DIPETAKAN, dan dilaporkan
 *
 * Jenis tanpa pemetaan tidak menghentikan tarik data — dipilih pemilik sistem
 * pada 4 Oktober 2026. Yang tetap tidak boleh adalah fallback yang diam: daftar
 * `belumDipetakan` selalu ditampilkan di layar input.
 *
 * Setiap kode yang muncul di pemetaan, ditambah POS_BELUM_DIPETAKAN, selalu
 * ikut ditulis — bernilai nol kalau bulan ini tidak ada biayanya. Nol berarti
 * "sudah dihitung, hasilnya nol"; kode yang tidak ditulis membiarkan angka
 * tarik data sebelumnya tetap berdiri seolah masih berlaku.
 *
 * Biaya dijumlahkan ke nilai yang sudah ada, bukan menimpanya, supaya pemetaan
 * ke pos yang juga diisi sistem operasional tidak menghapus angka itu.
 */
export function petakanBiaya(
  baris: Record<string, string>,
  biaya: BiayaJenis[],
  pemetaan: PemetaanBiaya[]
): HasilPemetaan {
  const sen = new Map<string, bigint>();
  for (const [code, amount] of Object.entries(baris)) sen.set(code, keSen(amount));

  const pastikanAda = (code: string) => {
    if (!sen.has(code)) sen.set(code, 0n);
  };
  pastikanAda(POS_BELUM_DIPETAKAN);
  for (const aturan of pemetaan) if (aturan.line_code) pastikanAda(aturan.line_code);

  const kunci = (sumber: string, jenis: string) => JSON.stringify([sumber, jenis]);
  const aturanPer = new Map(pemetaan.map((aturan) => [kunci(aturan.source, aturan.jenis), aturan]));

  const belumDipetakan: BiayaJenis[] = [];
  const tidakDitarik: BiayaJenis[] = [];

  for (const item of biaya) {
    const aturan = aturanPer.get(kunci(item.sumber, item.jenis));
    if (aturan && aturan.line_code === null) {
      tidakDitarik.push(item);
      continue;
    }
    if (!aturan) belumDipetakan.push(item);

    const tujuan = aturan?.line_code ?? POS_BELUM_DIPETAKAN;
    sen.set(tujuan, (sen.get(tujuan) ?? 0n) + keSen(item.jumlah));
  }

  const hasil: Record<string, string> = {};
  for (const [code, nilai] of sen) hasil[code] = dariSen(nilai);

  return { baris: hasil, belumDipetakan, tidakDitarik };
}

/**
 * Mengambil rekap satu bulan.
 *
 * `month` berformat YYYY-MM, sama seperti di URL layar input.
 */
export async function fetchRekapOperasional(
  baseUrl: string,
  token: string,
  month: string
): Promise<RekapResult> {
  const [tahun, bulan] = month.split('-');
  const hasil = await getJson(
    `${baseUrl}/api/integrasi/rekap-bulanan?bulan=${Number(bulan)}&tahun=${Number(tahun)}`,
    token
  );
  return hasil.ok ? parseRekap(hasil.body) : hasil;
}

/** Satu jenis biaya yang pernah dicatat di sistem operasional. */
export interface JenisTercatat {
  sumber: SumberBiaya;
  jenis: string;
  baris: number;
  /** Tanggal terakhir dipakai, YYYY-MM-DD. */
  terakhir: string | null;
}

export type JenisResult =
  | { ok: true; jenis: JenisTercatat[] }
  | { ok: false; status: number; message: string };

/**
 * Seluruh jenis biaya yang pernah dicatat, untuk layar pemetaan. Tidak
 * dibatasi bulan: pemetaan sebaiknya sudah ada sebelum jenisnya dipakai lagi.
 */
export async function fetchJenisPengeluaran(baseUrl: string, token: string): Promise<JenisResult> {
  const hasil = await getJson(`${baseUrl}/api/integrasi/jenis-pengeluaran`, token);
  if (!hasil.ok) return hasil;

  const daftar = isRecord(hasil.body) && Array.isArray(hasil.body.jenis) ? hasil.body.jenis : null;
  if (!daftar) {
    return { ok: false, status: 502, message: 'Sistem operasional mengirim daftar jenis yang tidak dikenali.' };
  }

  return {
    ok: true,
    jenis: daftar
      .filter(isRecord)
      .filter(
        (item) =>
          (item.sumber === 'pengeluaran' || item.sumber === 'honor_telly') &&
          typeof item.jenis === 'string'
      )
      .map((item) => ({
        sumber: item.sumber as SumberBiaya,
        jenis: item.jenis as string,
        baris: typeof item.baris === 'number' ? item.baris : 0,
        terakhir: typeof item.terakhir === 'string' ? item.terakhir : null
      }))
  };
}

/**
 * Satu GET ke sistem operasional. Kegagalan apa pun menjadi kalimat untuk
 * layar; alamat, token, dan rincian teknis hanya ke log server.
 */
async function getJson(
  url: string,
  token: string
): Promise<{ ok: true; body: unknown } | { ok: false; status: number; message: string }> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (cause) {
    // Alamat dan token tidak ikut ke pesan pengguna; keduanya hanya ke log.
    console.error('[tarik operasional] gagal menghubungi sistem operasional:', cause);
    return {
      ok: false,
      status: 502,
      message: 'Sistem operasional tidak dapat dihubungi. Coba lagi, atau isi baris secara manual.'
    };
  }

  if (response.status === 401 || response.status === 403) {
    console.error('[tarik operasional] token ditolak:', response.status);
    return {
      ok: false,
      status: 502,
      message: 'Token integrasi ditolak sistem operasional. Hubungi direksi.'
    };
  }

  if (!response.ok) {
    console.error('[tarik operasional] status tidak terduga:', response.status);
    return {
      ok: false,
      status: 502,
      message: `Sistem operasional menjawab dengan status ${response.status}.`
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    console.error('[tarik operasional] respons bukan JSON:', cause);
    return { ok: false, status: 502, message: 'Respons sistem operasional tidak dapat dibaca.' };
  }

  return { ok: true, body };
}
