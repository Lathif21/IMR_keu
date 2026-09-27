<script lang="ts">
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import Check from 'lucide-svelte/icons/check';
  import Download from 'lucide-svelte/icons/download';
  import Lock from 'lucide-svelte/icons/lock';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import { enhance } from '$app/forms';
  import {
    LINE_SECTION_LABEL,
    LINE_SECTION_ORDER,
    LINE_SECTION_SIGN,
    PERIOD_STATUS_LABEL,
    type LineSection
  } from '$lib/domain';
  import { formatAmount, formatPeriod, parseAmountInput, toAmount } from '$lib/format';
  import type { ActionData, PageData, SubmitFunction } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const editable = $derived(data.period.status === 'draft');

  /**
   * On-screen values, keyed by line code. Seeded from `report_lines`; a
   * template line with no stored row starts at 0 (nothing is inserted on
   * load).
   */
  function seedAmounts(page: PageData): Record<string, number> {
    const stored = new Map(page.reportLines.map((line) => [line.line_code, line]));
    const out: Record<string, number> = {};
    for (const line of page.templateLines) {
      out[line.line_code] = toAmount(stored.get(line.line_code)?.amount) ?? 0;
    }
    return out;
  }

  function seedNotes(page: PageData): Record<string, string> {
    const stored = new Map(page.reportLines.map((line) => [line.line_code, line]));
    const out: Record<string, string> = {};
    for (const line of page.templateLines) {
      out[line.line_code] = stored.get(line.line_code)?.note ?? '';
    }
    return out;
  }

  // The initial value on purpose, not a tracked read: seeding has to happen
  // synchronously so the server-rendered table already carries the saved
  // figures. An effect would leave SSR — and every no-JS request — showing
  // zeros. Re-seeding is handled below.
  // svelte-ignore state_referenced_locally
  let amounts = $state(seedAmounts(data));
  // svelte-ignore state_referenced_locally
  let notes = $state(seedNotes(data));

  /**
   * Moving between two periods keeps this component mounted, so the seed has
   * to be redone when the period changes — and only then. Re-seeding on every
   * `data` change would throw away what the user typed each time a failed
   * action re-ran `load`, which is exactly when their input matters most.
   */
  let seededFor = '';
  $effect(() => {
    if (data.period.id === seededFor) return;
    const first = seededFor === '';
    seededFor = data.period.id;
    // On mount the synchronous seed above already ran; re-running it would
    // only replace the values with identical ones.
    if (first) return;
    amounts = seedAmounts(data);
    notes = seedNotes(data);
  });

  /**
   * While a field has focus it shows what was typed; on blur it shows
   * `formatAmount()`. Reformatting mid-keystroke moves the caret and fights
   * the typist.
   */
  let focusedCode = $state<string | null>(null);
  let typed = $state('');

  function onFocus(code: string, event: FocusEvent) {
    focusedCode = code;
    typed = String(amounts[code] ?? 0);
    (event.currentTarget as HTMLInputElement).select();
  }

  /**
   * Committed on every keystroke, not on blur: the subtotals and the footer
   * are the reason this screen exists, and a total that lags a digit behind
   * the field above it is worse than no total at all.
   */
  function onAmountInput(code: string, event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    typed = input.value;
    amounts[code] = parseAmountInput(input.value);
  }

  const rows = $derived.by(() => {
    type Row =
      | { kind: 'section'; key: string; section: LineSection }
      | { kind: 'subtotal'; key: string; section: LineSection }
      | {
          kind: 'line';
          key: string;
          section: LineSection;
          index: number;
          line: PageData['templateLines'][number];
        };

    const out: Row[] = [];
    let index = 0;

    // Fixed section order (domain.ts). A section with no active template line
    // is left out entirely rather than shown as an empty heading.
    for (const section of LINE_SECTION_ORDER) {
      const lines = data.templateLines.filter((line) => line.section === section);
      if (lines.length === 0) continue;

      out.push({ kind: 'section', key: `s:${section}`, section });
      for (const line of lines) {
        out.push({ kind: 'line', key: line.line_code, section, index: index++, line });
      }
      out.push({ kind: 'subtotal', key: `t:${section}`, section });
    }

    return out;
  });

  /**
   * Display only, computed from what is on screen. Subtotals are never stored
   * and never posted (invariant 2) — `v_period_pnl` recomputes them from the
   * input lines, so a stored copy could only ever be a second, disagreeing
   * answer.
   */
  const sectionTotal = $derived.by(() => {
    const out = {} as Record<LineSection, number>;
    for (const section of LINE_SECTION_ORDER) out[section] = 0;
    for (const line of data.templateLines) {
      out[line.section] += amounts[line.line_code] ?? 0;
    }
    return out;
  });

  /**
   * The footer buckets follow LINE_SECTION_SIGN, so "Total Pendapatan −
   * Total Beban" is the same arithmetic `v_period_pnl.net_profit` performs.
   * Pendapatan Lain-lain therefore counts as income and Pajak Penghasilan as
   * expense: the three figures have to reconcile on screen, or the staff
   * member is being shown a net profit that does not follow from the two
   * numbers beside it.
   */
  const incomeSections = LINE_SECTION_ORDER.filter((s) => LINE_SECTION_SIGN[s] === 1);
  const expenseSections = LINE_SECTION_ORDER.filter((s) => LINE_SECTION_SIGN[s] === -1);

  const totalIncome = $derived(incomeSections.reduce((sum, s) => sum + sectionTotal[s], 0));
  const totalExpense = $derived(expenseSections.reduce((sum, s) => sum + sectionTotal[s], 0));
  const netProfit = $derived(totalIncome - totalExpense);

  const incomeLabel = $derived(incomeSections.map((s) => LINE_SECTION_LABEL[s]).join(' + '));
  const expenseLabel = $derived(expenseSections.map((s) => LINE_SECTION_LABEL[s]).join(' + '));

  const allZero = $derived(Object.values(amounts).every((value) => value === 0));

  /**
   * Enter moves down the amount column, Excel's behaviour — and the staff
   * filling this in come from Excel. Tab is left alone, so it still moves
   * right into the note field and on to the next row. Neither key can land on
   * a subtotal row: those are plain cells with nothing focusable in them.
   *
   * preventDefault also stops Enter from implicitly submitting the form. On a
   * screen with a Simpan Draft button and an Ajukan button, an accidental
   * Enter must not pick one.
   */
  function onEnter(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();

    const from = event.currentTarget as HTMLInputElement;
    const inputs = Array.from(
      from.form?.querySelectorAll<HTMLInputElement>('input[data-amount]') ?? []
    );
    const row = Number(from.dataset.row ?? '-1');
    const at = inputs.findIndex((input) => Number(input.dataset.row) === row);
    if (at < 0) return;

    const target = inputs[at + (event.shiftKey ? -1 : 1)];
    if (!target) return;
    target.focus();
    target.select();
  }

  /**
   * Saving must not blank the form.
   *
   * `use:enhance` with no argument calls `HTMLFormElement.reset()` after a
   * successful action, which returns every control to its `value` *attribute*.
   * Svelte drives these fields through the value *property*, so the attribute
   * is empty and the entire amount column went blank the moment Simpan Draft
   * succeeded — while `amounts` still held the figures. Focusing a field
   * re-rendered its value expression and the number reappeared, which is what
   * the bug looked like from the outside: the data was never lost, only the
   * DOM and the state had stopped agreeing.
   *
   * Resetting is right for a form you submit and walk away from. This one is
   * an editing surface the user stays on, so it keeps its values and only the
   * saved-confirmation banner changes.
   */
  const keepValuesAfterSave: SubmitFunction = () => {
    return async ({ update }) => {
      await update({ reset: false });
    };
  };

  /**
   * A month of nothing but zeros is almost certainly a mistake, but it is not
   * impossible — an entity that did not operate has a real all-zero month. So
   * it asks, and takes yes for an answer (invariant 8: surface the doubt,
   * don't decide it).
   */
  function confirmIfEmpty(event: MouseEvent) {
    if (!allZero) return;
    const ok = confirm(
      'Seluruh baris masih bernilai 0. Ajukan laporan ini apa adanya?'
    );
    if (!ok) event.preventDefault();
  }

  /** Tombol tarik data hanya ada bila entitasnya memang ditautkan. */
  const canPull = $derived(editable && data.operationalSync);

  const SOURCE_LABEL: Record<string, string> = {
    invoice: 'invoice',
    transaksi: 'transaksi',
    rekap: 'rekap bulanan',
    pengeluaran: 'pengeluaran',
    gaji_telly: 'baris gaji telly'
  };

  /**
   * "26 invoice · 140 transaksi · 12 rekap bulanan".
   *
   * Bukan hiasan: angka yang ditarik dari nol invoice terlihat sama persis
   * dengan angka yang ditarik dari dua puluh enam invoice sampai ada yang
   * menghitungnya. Ini satu-satunya tempat penginput bisa melihat bedanya.
   */
  function describeSources(sources: Record<string, number> | undefined): string {
    if (!sources) return '';
    return Object.entries(sources)
      .map(([key, count]) => `${count} ${SOURCE_LABEL[key] ?? key}`)
      .join(' · ');
  }

  /**
   * Tarik data menimpa angka yang sudah ada — termasuk koreksi yang baru
   * diketik. Menimpa pekerjaan orang tanpa bertanya adalah cara tercepat
   * membuat tombol ini tidak dipercaya, jadi ia bertanya dulu. Formulir yang
   * masih kosong tidak ditanyakan: tidak ada yang bisa hilang.
   */
  function confirmOverwrite(event: MouseEvent) {
    if (allZero) return;
    const ok = confirm(
      'Sebagian baris sudah terisi. Tarik data akan mengganti angkanya dengan angka dari sistem operasional. Lanjutkan?'
    );
    if (!ok) event.preventDefault();
  }

  /**
   * Setelah tarik data berhasil, nilai di layar harus ikut berubah.
   *
   * Periodenya tidak berganti, jadi penjaga `seededFor` di atas tidak akan
   * menyemai ulang — dan layar akan menampilkan angka lama di atas data baru,
   * yang adalah kegagalan terburuk yang mungkin: terlihat berhasil, isinya
   * salah. `update()` sudah menjalankan `load` ulang, jadi `data` di sini
   * sudah berisi baris yang baru ditulis.
   */
  const reseedAfterPull: SubmitFunction = () => {
    return async ({ update, result }) => {
      await update({ reset: false });
      if (result.type !== 'success') return;
      amounts = seedAmounts(data);
      notes = seedNotes(data);
    };
  };
</script>

<svelte:head>
  <title>Input Laporan {formatPeriod(data.period.period)} · Portal Keuangan</title>
</svelte:head>

<div class="flex flex-col h-full overflow-hidden">
  <!-- header · 48px -->
  <div class="h-12 flex items-center justify-between px-5 border-b border-border shrink-0 gap-4">
    <div class="flex items-center gap-3 min-w-0">
      <a
        href="/entry?entitas={encodeURIComponent(data.selected.code)}"
        class="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        aria-label="Kembali ke daftar periode"
        title="Kembali ke daftar periode"
      >
        <ArrowLeft size={14} />
      </a>
      <div class="min-w-0">
        <h1 class="text-[13px] font-semibold text-foreground truncate">
          Input Laporan — {formatPeriod(data.period.period)}
        </h1>
        <p class="text-[11px] text-muted-foreground truncate">
          {data.selected.legal_name} · {PERIOD_STATUS_LABEL[data.period.status]}
        </p>
      </div>
    </div>

    <!-- Form tersendiri, di luar form input di bawah. Form tidak boleh
         bersarang, dan menumpangkannya sebagai formaction ketiga akan membuat
         Enter di kolom nominal punya satu kandidat tambahan untuk dipilih. -->
    {#if canPull}
      <form
        method="POST"
        action="?/tarikOperasional"
        use:enhance={reseedAfterPull}
        class="shrink-0"
      >
        <input type="hidden" name="entitas" value={data.selected.code} />
        <button
          type="submit"
          onclick={confirmOverwrite}
          title="Ambil angka bulan ini dari sistem operasional ILJ"
          class="px-3 py-1.5 rounded-lg bg-card border border-border text-[12px] font-medium
                 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors
                 flex items-center gap-1.5"
        >
          <Download size={12} />
          Tarik data operasional
        </button>
      </form>
    {/if}
  </div>

  {#if !editable}
    <div
      class="flex items-start gap-3 px-5 py-2.5 bg-muted/40 border-b border-border shrink-0"
      role="status"
    >
      <Lock size={13} class="text-muted-foreground shrink-0 mt-0.5" />
      <p class="text-[12px] text-muted-foreground flex-1 leading-relaxed">
        Periode ini berstatus {PERIOD_STATUS_LABEL[data.period.status]}, jadi barisnya hanya dapat
        dibaca. Perubahan hanya mungkin setelah periode dikembalikan ke draft, dan pengembalian itu
        wajib disertai catatan alasan.
      </p>
    </div>
  {/if}

  <!-- A draft carrying a rejection note is a period that came back. The
       person about to edit it is the one who needs to read why, so it is the
       first thing on the screen and it is red — this is not a hint, it is
       work that was refused. -->
  {#if editable && data.period.rejection_note}
    <div
      class="flex items-start gap-3 px-5 py-2.5 bg-destructive/10 border-b border-destructive/25 shrink-0"
      role="alert"
    >
      <TriangleAlert size={13} class="text-destructive shrink-0 mt-0.5" />
      <p class="text-[12px] text-destructive flex-1 leading-relaxed">
        <span class="font-semibold">Dikembalikan ke draft:</span>
        {data.period.rejection_note}
      </p>
    </div>
  {/if}

  {#if form?.message}
    <div class="px-5 py-2.5 bg-destructive/10 border-b border-destructive/25 shrink-0" role="alert">
      <p class="text-[12px] text-destructive leading-relaxed">{form.message}</p>
    </div>
  {:else if form?.saved}
    <div class="px-5 py-2.5 bg-positive/10 border-b border-positive/25 shrink-0" role="status">
      <p class="text-[12px] text-positive leading-relaxed">
        Draft tersimpan. Baris bernilai 0 tanpa catatan tidak disimpan.
      </p>
    </div>
  {:else if form?.pulled}
    <div class="px-5 py-2.5 bg-positive/10 border-b border-positive/25 shrink-0" role="status">
      <p class="text-[12px] text-positive leading-relaxed">
        {form.lineCount} baris ditarik dari sistem operasional
        <!-- Jam dipotong dari string ISO, bukan lewat toLocaleString(). Server
             dan browser bisa berada di zona waktu berbeda, dan angka jam yang
             berubah saat hidrasi adalah persis jenis ketidakcocokan yang
             membuat orang meragukan angka di sebelahnya. -->
        {#if form.computedAt}pukul {form.computedAt.slice(11, 16)}{/if}. Angka ini masih draft
        dan masih bisa dikoreksi sebelum diajukan.
      </p>
      {#if describeSources(form.sources)}
        <p class="text-[11px] text-muted-foreground mt-1">
          Dihitung dari {describeSources(form.sources)}.
        </p>
      {/if}
    </div>

    <!-- Peringatan, bukan kegagalan: barisnya sudah tertulis. Rute yang hanya
         punya rekap manual tetap menyumbang uang saku dan terpal, tetapi
         operasional_rekap tidak punya kolom pendapatan — jadi bagian rekanan
         untuk rute itu nol, dan iuran paguyubannya tidak ada sama sekali. -->
    {#if form.rekapOnlyRoutes && form.rekapOnlyRoutes.length > 0}
      <div
        class="px-5 py-2.5 bg-warning/10 border-b border-warning/25 shrink-0"
        role="status"
      >
        <p class="text-[12px] text-warning leading-relaxed">
          <span class="font-semibold">Periksa Bagian Rekanan dan Iuran Paguyuban.</span>
          {form.rekapOnlyRoutes.length} rute bulan ini hanya punya rekap bulanan tanpa transaksi,
          sehingga kedua pos itu tidak terisi untuk rute tersebut:
          {form.rekapOnlyRoutes.map((r) => `${r.kapal} (${r.rute})`).join(', ')}.
        </p>
      </div>
    {/if}
  {/if}

  <form
    method="POST"
    class="flex-1 flex flex-col overflow-hidden"
    use:enhance={keepValuesAfterSave}
  >
    <input type="hidden" name="entitas" value={data.selected.code} />

    <div class="flex-1 overflow-y-auto">
      <table class="w-full border-collapse">
        <thead class="sticky top-0 bg-background z-10">
          <tr class="border-b border-border">
            <!-- No "Kode Akun" column. The Figma export shows one (4-001,
                 5-001), but no chart of accounts has been agreed
                 (ASSUMPTIONS.md A-7) and report_template_lines.account_code
                 is empty. Showing codes that will change teaches people a
                 number that is going to be wrong. -->
            <th class="py-2.5 px-4 text-left text-[11px] font-medium text-muted-foreground">
              Nama Pos
            </th>
            <th class="py-2.5 px-4 text-right text-[11px] font-medium text-muted-foreground w-[200px]">
              Jumlah (Rp)
            </th>
            <th class="py-2.5 px-4 text-left text-[11px] font-medium text-muted-foreground w-[240px]">
              Catatan
            </th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.key)}
            {#if row.kind === 'section'}
              <tr class="border-t border-border">
                <td
                  colspan="3"
                  class="pt-4 pb-1 px-4 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider"
                >
                  {LINE_SECTION_LABEL[row.section]}
                </td>
              </tr>
            {:else if row.kind === 'subtotal'}
              <!-- Display only. Locked, unfocusable, never posted, never
                   stored: the server recomputes from the input lines. -->
              <tr class="bg-card border-t border-b border-border">
                <td class="py-2.5 px-4">
                  <span class="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
                    <Lock size={11} class="text-subtle shrink-0" />
                    Total {LINE_SECTION_LABEL[row.section]}
                  </span>
                </td>
                <td class="py-2.5 px-4 text-right text-[13px] font-semibold text-muted-foreground">
                  {formatAmount(sectionTotal[row.section])}
                </td>
                <td></td>
              </tr>
            {:else}
              <tr
                class="border-b border-border/40 {row.line.help_text
                  ? 'bg-warning/[0.03]'
                  : ''} hover:bg-card/40 transition-colors"
              >
                <td class="py-2 px-4">
                  <div class="flex items-start gap-2">
                    {#if row.line.help_text}
                      <TriangleAlert size={13} class="text-warning shrink-0 mt-0.5" />
                    {/if}
                    <div class="min-w-0">
                      <label
                        for="amount-{row.line.line_code}"
                        class="text-[13px] text-foreground block"
                      >
                        {row.line.line_label}
                      </label>
                      <!-- The gap is shown, not closed. COGS_SAKU carries
                           "isi 0 bila diperlakukan sebagai uang muka"
                           because A-2 is undecided; a warning here never
                           blocks a submit. -->
                      {#if row.line.help_text}
                        <p class="text-[11px] text-warning/70 mt-0.5 leading-relaxed">
                          {row.line.help_text}
                        </p>
                      {/if}
                    </div>
                  </div>
                </td>

                <td class="py-2 px-4 text-right">
                  {#if editable}
                    <input
                      id="amount-{row.line.line_code}"
                      name="amount__{row.line.line_code}"
                      type="text"
                      inputmode="numeric"
                      autocomplete="off"
                      data-amount
                      data-row={row.index}
                      class="w-full text-right text-[13px] tabular-nums bg-transparent text-foreground
                             border-b border-transparent hover:border-border focus:border-primary
                             focus:outline-none transition-colors py-0.5"
                      value={focusedCode === row.line.line_code
                        ? typed
                        : formatAmount(amounts[row.line.line_code] ?? 0)}
                      oninput={(event) => onAmountInput(row.line.line_code, event)}
                      onfocus={(event) => onFocus(row.line.line_code, event)}
                      onblur={() => (focusedCode = null)}
                      onkeydown={onEnter}
                    />
                  {:else}
                    <span class="text-[13px] text-foreground tabular-nums">
                      {formatAmount(amounts[row.line.line_code] ?? 0)}
                    </span>
                  {/if}
                </td>

                <td class="py-2 px-4">
                  {#if editable}
                    <input
                      name="note__{row.line.line_code}"
                      type="text"
                      autocomplete="off"
                      data-row={row.index}
                      placeholder="Tambah catatan..."
                      aria-label="Catatan {row.line.line_label}"
                      class="w-full text-[12px] bg-transparent text-muted-foreground
                             placeholder:text-subtle border-b border-transparent hover:border-border
                             focus:border-primary focus:outline-none transition-colors py-0.5"
                      bind:value={notes[row.line.line_code]}
                      onkeydown={onEnter}
                    />
                  {:else if notes[row.line.line_code]}
                    <span class="text-[12px] text-muted-foreground">
                      {notes[row.line.line_code]}
                    </span>
                  {/if}
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>

    <!-- sticky footer · always visible -->
    <div
      class="shrink-0 border-t border-border-strong bg-background px-5 py-3 flex items-center gap-5 flex-wrap"
    >
      <div class="flex items-center gap-5 flex-1 min-w-0">
        <div class="border-r border-border pr-5" title="{incomeLabel}">
          <p class="text-[10px] text-muted-foreground mb-0.5">Total Pendapatan</p>
          <p class="text-[13px] font-semibold text-positive tabular-nums">
            Rp {formatAmount(totalIncome)}
          </p>
        </div>
        <div class="border-r border-border pr-5" title="{expenseLabel}">
          <p class="text-[10px] text-muted-foreground mb-0.5">Total Beban</p>
          <p class="text-[13px] font-semibold text-foreground tabular-nums">
            Rp {formatAmount(totalExpense)}
          </p>
        </div>
        <div>
          <p class="text-[10px] text-muted-foreground mb-0.5">Laba Bersih</p>
          <!-- A loss renders in parentheses and in destructive, per app.css.
               formatAmount() already adds the parentheses. -->
          <p
            class="text-[13px] font-semibold tabular-nums {netProfit < 0
              ? 'text-destructive'
              : 'text-positive'}"
          >
            {netProfit < 0 ? formatAmount(netProfit) : `Rp ${formatAmount(netProfit)}`}
          </p>
        </div>
      </div>

      {#if editable}
        <div class="flex items-center gap-2 shrink-0">
          <button
            type="submit"
            formaction="?/saveDraft"
            class="px-4 py-2 rounded-lg bg-card border border-border text-[13px] font-medium
                   text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Simpan Draft
          </button>
          <button
            type="submit"
            formaction="?/submit"
            onclick={confirmIfEmpty}
            class="px-4 py-2 rounded-lg bg-primary text-[13px] font-medium text-primary-foreground
                   hover:bg-accent transition-colors flex items-center gap-1.5"
          >
            <Check size={13} />
            Ajukan
          </button>
        </div>
      {/if}
    </div>
  </form>
</div>
