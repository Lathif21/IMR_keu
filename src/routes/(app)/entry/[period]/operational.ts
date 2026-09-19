/**
 * Membaca rekap bulanan dari sistem operasional ILJ (Laravel).
 *
 * Satu arah: portal keuangan yang menarik, sistem operasional yang menjawab.
 * Laravel tidak tahu apa pun tentang Supabase, dan sistem operasional tetap
 * jalan penuh kalau portal ini mati.
 *
 * Seluruh nominal diperlakukan sebagai STRING dari ujung ke ujung. Tidak ada
 * `Number()` di berkas ini, dan tidak boleh ada: `Number("200445000.00")`
 * masih tepat hari ini, tetapi begitu ada yang menambahkan dua nominal di
 * jalur ini, pembulatan float mulai menghasilkan selisih satu sen yang harus
 * dijelaskan ke orang. Nilai string diteruskan apa adanya ke Postgres, yang
 * mengubahnya menjadi `numeric(18,2)` tanpa melewati float sama sekali.
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

export interface RekapOperasional {
  periode: string;
  dihitung_pada: string;
  /** line_code -> nominal sebagai string, misalnya "200445000.00". */
  baris: Record<string, string>;
  /** Jenis pengeluaran yang belum punya pemetaan. Tidak kosong = jangan tulis. */
  jenis_belum_dipetakan: string[];
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

  const jenisBelumDipetakan = Array.isArray(body.jenis_belum_dipetakan)
    ? body.jenis_belum_dipetakan.filter((item): item is string => typeof item === 'string')
    : [];

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
      jenis_belum_dipetakan: jenisBelumDipetakan,
      rute_rekap_saja: ruteRekapSaja,
      jumlah_sumber: jumlahSumber
    }
  };
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
  const url = `${baseUrl}/api/integrasi/rekap-bulanan?bulan=${Number(bulan)}&tahun=${Number(tahun)}`;

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

  return parseRekap(body);
}
