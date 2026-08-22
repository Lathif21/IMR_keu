<script lang="ts">
  import Check from 'lucide-svelte/icons/check';
  import ChevronDown from 'lucide-svelte/icons/chevron-down';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import Lock from 'lucide-svelte/icons/lock';
  import LockOpen from 'lucide-svelte/icons/lock-open';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import {
    PERIOD_STATUS_LABEL,
    REPORTING_BASIS_LABEL,
    REVENUE_PRESENTATION_LABEL,
    type Numeric,
    type PeriodStatus
  } from '$lib/domain';
  import {
    NO_DATA,
    formatAmount,
    formatDate,
    formatDelta,
    formatDeltaPoints,
    formatPct,
    formatPeriod,
    momPct,
    previousPeriod
  } from '$lib/format';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  /**
   * Badge colours follow `statusConfig` in the Figma export's ApprovalScreen,
   * expressed in tokens rather than the export's raw hex.
   */
  const STATUS_CLASS: Record<PeriodStatus, string> = {
    draft: 'bg-muted text-muted-foreground',
    submitted: 'bg-primary/15 text-primary',
    approved: 'bg-positive/15 text-positive',
    locked: 'bg-card border border-border text-subtle'
  };

  const monthLabel = $derived(data.month ? formatPeriod(`${data.month}-01`) : '');
  const previousLabel = $derived(
    data.month ? formatPeriod(previousPeriod(`${data.month}-01`)) : ''
  );

  /** Legal names for the completeness banner; the view returns codes. */
  const missingNames = $derived(
    (data.completeness?.missing_entities ?? []).map(
      (code) => data.rows.find((row) => row.entity.code === code)?.entity.legal_name ?? code
    )
  );

  /** Keeps ?periode= while toggling a panel, and vice versa. */
  function panelHref(periodId: string | null): string {
    const params = new URLSearchParams();
    if (data.month) params.set('periode', data.month);
    if (periodId && data.expandedId !== periodId) params.set('buka', periodId);
    return `?${params.toString()}`;
  }

  /**
   * "Tolak" and "Buka Kunci" in the action column are not disclosure toggles.
   * Both need a written note, so both open the panel — but a toggle made them
   * look broken twice over: the panel renders several hundred pixels below the
   * row (locked periods sort last, so the row is at the bottom of the table)
   * and nothing scrolled, so the first click did nothing visible; the second
   * click then closed the panel again. This href always opens, and the hash
   * says which control the reviewer actually pressed for.
   */
  function actionHref(periodId: string, field: 'note'): string {
    const params = new URLSearchParams();
    if (data.month) params.set('periode', data.month);
    params.set('buka', periodId);
    return `?${params.toString()}#${field}-${periodId}`;
  }

  /**
   * Bring the freshly opened panel into view. The page scrolls in an inner
   * container, not the window, so neither the browser's own hash handling nor
   * SvelteKit's scroll restoration lands on it.
   */
  $effect(() => {
    const id = data.expandedId;
    if (!id) return;
    const wantsNote = page.url.hash === `#note-${id}`;
    const note = wantsNote ? document.getElementById(`note-${id}`) : null;
    const target = note ?? document.getElementById(`panel-${id}`);
    target?.scrollIntoView({ block: note ? 'center' : 'nearest', behavior: 'smooth' });
    // Focus last: the caret belongs in the note, not wherever the link was.
    (note as HTMLTextAreaElement | null)?.focus({ preventScroll: true });
  });

  type CompareRow = {
    label: string;
    current: Numeric | null;
    prior: Numeric | null;
    /** A margin is a ratio; its change is in points, not in percent. */
    ratio?: boolean;
  };

  /**
   * Straight out of `v_period_pnl`. Gross profit, operating result and net
   * profit are not recomputed here (invariant 2) — the view is the one place
   * that arithmetic happens, so the reviewer and the consolidation can never
   * be looking at two different answers.
   */
  function compareRows(row: PageData['rows'][number]): CompareRow[] {
    const now = row.pnl;
    const before = row.previous;
    return [
      { label: 'Pendapatan', current: now?.revenue ?? null, prior: before?.revenue ?? null },
      { label: 'Beban Pokok', current: now?.cogs ?? null, prior: before?.cogs ?? null },
      { label: 'Laba Kotor', current: now?.gross_profit ?? null, prior: before?.gross_profit ?? null },
      { label: 'Beban Usaha', current: now?.opex ?? null, prior: before?.opex ?? null },
      { label: 'Laba Bersih', current: now?.net_profit ?? null, prior: before?.net_profit ?? null },
      {
        label: 'Margin Bersih',
        current: now?.net_margin_pct ?? null,
        prior: before?.net_margin_pct ?? null,
        ratio: true
      }
    ];
  }

  function confirmLock(event: MouseEvent) {
    const ok = confirm(
      'Kunci periode ini? Setelah terkunci hanya direksi yang dapat membukanya kembali.'
    );
    if (!ok) event.preventDefault();
  }

  function confirmUnlock(event: MouseEvent) {
    const ok = confirm(
      'Buka kunci periode ini? Periode kembali ke draft, keluar dari angka konsolidasi, dan tindakan ini tercatat di audit log.'
    );
    if (!ok) event.preventDefault();
  }
</script>

<svelte:head><title>Persetujuan Laporan · Portal Keuangan</title></svelte:head>

<div class="flex flex-col h-full overflow-hidden">
  <!-- header · 48px -->
  <div class="h-12 flex items-center justify-between px-5 border-b border-border shrink-0 gap-4">
    <div class="flex items-center gap-3 min-w-0">
      <h1 class="text-[13px] font-semibold text-foreground shrink-0">Persetujuan Laporan</h1>
      {#if !data.canApprove}
        <span class="text-[11px] text-muted-foreground truncate">
          Hanya baca — peran Anda tidak menyetujui laporan
        </span>
      {/if}
    </div>

    {#if data.months.length > 0}
      <form method="GET" class="flex items-center gap-2 shrink-0">
        <label for="periode" class="sr-only">Periode</label>
        <select
          id="periode"
          name="periode"
          class="h-[30px] pl-3 pr-2 bg-card border border-border rounded-lg text-[13px] text-foreground
                 tabular-nums hover:bg-muted transition-colors focus:outline-none focus:border-primary"
          onchange={(event) => event.currentTarget.form?.requestSubmit()}
        >
          {#each data.months as option (option.period)}
            <option value={option.month} selected={option.month === data.month}>
              {formatPeriod(option.period)}
            </option>
          {/each}
        </select>
        <noscript>
          <button
            type="submit"
            class="h-[30px] px-3 bg-card border border-border rounded-lg text-[13px] text-foreground"
          >
            Tampilkan
          </button>
        </noscript>
      </form>
    {/if}
  </div>

  {#if !data.month}
    <div class="flex-1 p-5">
      <div class="max-w-[520px] bg-card border border-border rounded-lg p-5">
        <h2 class="text-[13px] font-semibold text-foreground mb-2">Belum ada periode</h2>
        <p class="text-[12px] text-muted-foreground leading-relaxed">
          Belum ada satu pun periode pelaporan yang dibuat, jadi tidak ada yang menunggu
          persetujuan.
        </p>
      </div>
    </div>
  {:else}
    <div class="flex-1 overflow-y-auto">
      <div class="p-5 pb-0 space-y-3">
        <!-- Completeness, same rule as the dashboard: a group figure computed
             while entities are missing is a different number, never a smaller
             one. It is never shown without saying so. -->
        {#if data.completeness}
          {@const complete = data.completeness.is_complete}
          <div
            class="flex items-start gap-3 px-4 py-2.5 rounded-lg border {complete
              ? 'bg-positive/10 border-positive/25'
              : 'bg-warning/10 border-warning/25'}"
            role="status"
          >
            {#if complete}
              <Check size={14} class="text-positive shrink-0 mt-px" />
              <p class="text-[13px] text-positive flex-1 leading-relaxed">
                {data.completeness.reported_entities} dari {data.completeness.expected_entities}
                entitas sudah disetujui — {monthLabel} lengkap.
              </p>
            {:else}
              <TriangleAlert size={14} class="text-warning shrink-0 mt-px" />
              <p class="text-[13px] text-warning flex-1 leading-relaxed">
                {data.completeness.reported_entities} dari {data.completeness.expected_entities}
                entitas sudah disetujui
                {#if missingNames.length > 0}
                  — {missingNames.join(', ')} belum melapor
                {/if}
              </p>
            {/if}
          </div>
        {/if}

        {#if form?.message}
          <div
            class="px-4 py-2.5 bg-destructive/10 border border-destructive/25 rounded-lg"
            role="alert"
          >
            <p class="text-[13px] text-destructive leading-relaxed">{form.message}</p>
          </div>
        {:else if form?.done}
          <div class="px-4 py-2.5 bg-positive/10 border border-positive/25 rounded-lg" role="status">
            <p class="text-[13px] text-positive leading-relaxed">
              {#if form.done === 'approve'}
                Periode disetujui dan masuk ke angka konsolidasi.
              {:else if form.done === 'reject'}
                Periode dikembalikan ke draft. Catatan Anda tampil di layar input staf entitas.
              {:else if form.done === 'lock'}
                Periode dikunci. Hanya direksi yang dapat membukanya.
              {:else}
                Kunci dibuka. Periode kembali ke draft dan keluar dari angka konsolidasi.
              {/if}
            </p>
          </div>
        {/if}
      </div>

      <table class="w-full border-collapse mt-4">
        <thead>
          <tr class="border-b border-border">
            <th class="py-2.5 px-4 text-left text-[11px] font-medium text-muted-foreground">
              Entitas
            </th>
            <th class="py-2.5 px-4 text-left text-[11px] font-medium text-muted-foreground w-[130px]">
              Periode
            </th>
            <th class="py-2.5 px-4 text-left text-[11px] font-medium text-muted-foreground w-[130px]">
              Status
            </th>
            <th class="py-2.5 px-4 text-left text-[11px] font-medium text-muted-foreground w-[160px]">
              Diajukan Oleh
            </th>
            <th class="py-2.5 px-4 text-left text-[11px] font-medium text-muted-foreground w-[130px]">
              Tanggal
            </th>
            <th class="py-2.5 px-4 text-right text-[11px] font-medium text-muted-foreground w-[210px]">
              Aksi
            </th>
          </tr>
        </thead>
        <tbody>
          {#each data.rows as row (row.entity.id)}
            {@const open = row.period !== null && row.period.id === data.expandedId}
            {@const isSubmitter =
              row.period?.submitted_by !== null && row.period?.submitted_by === data.userId}
            <tr class="border-b border-border/50 {open ? 'bg-card' : 'hover:bg-card/40'} transition-colors">
              <td class="py-3 px-4">
                {#if row.period}
                  <!-- The panel toggle is a link, so it works with JavaScript
                       off and the open row survives an action and a reload. -->
                  <a
                    href={panelHref(row.period.id)}
                    class="flex items-center gap-2 text-[13px] font-medium text-foreground hover:text-primary transition-colors"
                    aria-expanded={open}
                  >
                    {#if open}
                      <ChevronDown size={13} class="text-muted-foreground shrink-0" />
                    {:else}
                      <ChevronRight size={13} class="text-muted-foreground shrink-0" />
                    {/if}
                    <span
                      class="w-1.5 h-1.5 rounded-full shrink-0"
                      style:background-color={row.entity.theme_color}
                    ></span>
                    {row.entity.legal_name}
                  </a>
                {:else}
                  <span class="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
                    <span class="w-[13px] shrink-0"></span>
                    <span
                      class="w-1.5 h-1.5 rounded-full shrink-0"
                      style:background-color={row.entity.theme_color}
                    ></span>
                    {row.entity.legal_name}
                  </span>
                {/if}
              </td>

              <td class="py-3 px-4 text-[13px] text-muted-foreground tabular-nums">{monthLabel}</td>

              <td class="py-3 px-4">
                {#if row.period}
                  <span
                    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium
                           {STATUS_CLASS[row.period.status]}"
                  >
                    {#if row.period.status === 'locked'}<Lock size={9} />{/if}
                    {#if row.period.status === 'approved'}<Check size={9} />{/if}
                    {PERIOD_STATUS_LABEL[row.period.status]}
                  </span>
                {:else}
                  <!-- An entity that has not started has to look like one. -->
                  <span
                    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium
                           bg-warning/10 text-warning"
                  >
                    <TriangleAlert size={9} />
                    Belum dibuat
                  </span>
                {/if}
              </td>

              <td class="py-3 px-4 text-[13px] text-muted-foreground truncate">
                {row.submitterName ?? NO_DATA}
              </td>

              <td class="py-3 px-4 text-[13px] text-muted-foreground tabular-nums">
                {formatDate(row.period?.submitted_at)}
              </td>

              <td class="py-3 px-4">
                <div class="flex items-center justify-end gap-2">
                  {#if row.period && data.canApprove && row.period.status === 'submitted'}
                    <!-- Hidden for the submitter, and refused by the trigger
                         regardless: a hidden button is not enforcement. -->
                    {#if !isSubmitter}
                      <form method="POST" action="?/approve" use:enhance>
                        <input type="hidden" name="periodId" value={row.period.id} />
                        <button
                          type="submit"
                          class="flex items-center gap-1 px-2.5 py-1 bg-positive/15 border border-positive/30
                                 text-positive text-[12px] font-medium rounded-md hover:bg-positive/25
                                 transition-colors"
                        >
                          <Check size={11} />
                          Setujui
                        </button>
                      </form>
                    {:else}
                      <span class="text-[11px] text-subtle">Anda pengajunya</span>
                    {/if}
                    <!-- Trailing ellipsis: this asks for a reason first, it
                         does not reject on the spot. -->
                    <a
                      href={actionHref(row.period.id, 'note')}
                      class="px-2.5 py-1 border border-border text-muted-foreground text-[12px] font-medium
                             rounded-md hover:bg-muted hover:text-foreground transition-colors"
                    >
                      Tolak...
                    </a>
                  {:else if row.period && data.canApprove && row.period.status === 'approved'}
                    <form method="POST" action="?/lock" use:enhance>
                      <input type="hidden" name="periodId" value={row.period.id} />
                      <button
                        type="submit"
                        onclick={confirmLock}
                        class="flex items-center gap-1 px-2.5 py-1 border border-border text-muted-foreground
                               text-[12px] font-medium rounded-md hover:bg-muted hover:text-foreground
                               transition-colors"
                      >
                        <Lock size={11} />
                        Kunci
                      </button>
                    </form>
                  {:else if row.period && data.canUnlock && row.period.status === 'locked'}
                    <a
                      href={actionHref(row.period.id, 'note')}
                      class="flex items-center gap-1 px-2.5 py-1 border border-border text-muted-foreground
                             text-[12px] font-medium rounded-md hover:bg-muted hover:text-foreground
                             transition-colors"
                    >
                      <LockOpen size={11} />
                      Buka Kunci...
                    </a>
                  {:else}
                    <span class="text-[12px] text-subtle">{NO_DATA}</span>
                  {/if}
                </div>
              </td>
            </tr>

            {#if open && row.period}
              <tr class="border-b border-border">
                <td colspan="6" class="p-0">
                  <div id="panel-{row.period.id}" class="bg-background px-5 py-4 border-t border-border">
                    <div class="flex items-center justify-between gap-4 flex-wrap mb-3">
                      <p class="text-[12px] font-semibold text-muted-foreground">
                        Perbandingan {monthLabel} vs. {previousLabel} — {row.entity.legal_name}
                      </p>

                      <!-- A reviewer approving figures whose basis nobody has
                           agreed on needs to know that before they sign, not
                           after (ASSUMPTIONS.md A-1, A-4). -->
                      <div class="flex items-center gap-2 flex-wrap">
                        <span
                          class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium
                                 {row.entity.reporting_basis === 'unknown'
                            ? 'bg-warning/10 text-warning'
                            : 'bg-muted text-muted-foreground'}"
                        >
                          {#if row.entity.reporting_basis === 'unknown'}
                            <TriangleAlert size={9} />
                          {/if}
                          {REPORTING_BASIS_LABEL[row.entity.reporting_basis]}
                        </span>
                        <span
                          class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium
                                 {row.entity.revenue_presentation === 'unknown'
                            ? 'bg-warning/10 text-warning'
                            : 'bg-muted text-muted-foreground'}"
                        >
                          {#if row.entity.revenue_presentation === 'unknown'}
                            <TriangleAlert size={9} />
                          {/if}
                          {REVENUE_PRESENTATION_LABEL[row.entity.revenue_presentation]}
                        </span>
                      </div>
                    </div>

                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
                      <div>
                        <div class="overflow-x-auto">
                          <table class="w-full text-[12px]">
                            <thead>
                              <tr class="border-b border-border">
                                <th class="pb-2 text-left text-[11px] font-medium text-subtle">Pos</th>
                                <th class="pb-2 px-3 text-right text-[11px] font-medium text-subtle">
                                  {monthLabel}
                                </th>
                                <th class="pb-2 px-3 text-right text-[11px] font-medium text-subtle">
                                  {previousLabel}
                                </th>
                                <th class="pb-2 text-right text-[11px] font-medium text-subtle">
                                  Δ MoM
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {#each compareRows(row) as line (line.label)}
                                {@const change = line.ratio ? null : momPct(line.current, line.prior)}
                                <tr class="border-b border-border/30">
                                  <td class="py-1.5 text-muted-foreground">{line.label}</td>
                                  <td class="py-1.5 px-3 text-right text-foreground">
                                    {line.ratio
                                      ? formatPct(line.current, 2)
                                      : formatAmount(line.current)}
                                  </td>
                                  <td class="py-1.5 px-3 text-right text-muted-foreground">
                                    {line.ratio
                                      ? formatPct(line.prior, 2)
                                      : formatAmount(line.prior)}
                                  </td>
                                  {#if line.ratio}
                                    <!-- Points, not percent. A margin going
                                         from 1,22% to 2,08% has moved 0,86
                                         points; calling that "+70,5%" is a
                                         percentage of a percentage. -->
                                    <td class="py-1.5 text-right font-medium text-muted-foreground">
                                      {formatDeltaPoints(line.current, line.prior)}
                                    </td>
                                  {:else if change === null}
                                    <td class="py-1.5 text-right text-subtle">{NO_DATA}</td>
                                  {:else}
                                    <td
                                      class="py-1.5 text-right font-medium {change >= 0
                                        ? 'text-positive'
                                        : 'text-destructive'}"
                                    >
                                      {formatDelta(change)}
                                    </td>
                                  {/if}
                                </tr>
                              {/each}
                            </tbody>
                          </table>
                        </div>

                        {#if !row.pnl || !row.previous}
                          <p class="mt-2 text-[11px] text-subtle leading-relaxed">
                            {row.previous
                              ? 'Belum ada baris laporan untuk bulan ini.'
                              : `Tidak ada data ${previousLabel} untuk dibandingkan.`}
                          </p>
                        {/if}
                      </div>

                      <div class="flex flex-col gap-2">
                        {#if data.canApprove && (row.period.status === 'submitted' || (data.canUnlock && row.period.status === 'locked'))}
                          <form method="POST" class="flex flex-col gap-2 h-full" use:enhance>
                            <input type="hidden" name="periodId" value={row.period.id} />
                            <label
                              for="note-{row.period.id}"
                              class="text-[11px] font-medium text-muted-foreground"
                            >
                              Catatan <span class="text-subtle">(wajib)</span>
                            </label>
                            <textarea
                              id="note-{row.period.id}"
                              name="note"
                              required
                              placeholder={row.period.status === 'locked'
                                ? 'Tulis alasan membuka kunci...'
                                : 'Tulis alasan penolakan...'}
                              class="flex-1 min-h-[110px] bg-card border border-border rounded-lg p-3 text-[13px]
                                     text-foreground placeholder:text-subtle resize-none focus:outline-none
                                     focus:border-primary transition-colors"
                            ></textarea>

                            {#if row.period.status === 'submitted'}
                              <p class="text-[11px] text-subtle leading-relaxed">
                                Penolakan mengembalikan periode ke draft, dan catatan ini tampil di
                                layar input staf entitas.
                              </p>
                              <button
                                type="submit"
                                formaction="?/reject"
                                class="self-start px-3 py-1.5 rounded-md border border-destructive/30
                                       bg-destructive/10 text-destructive text-[12px] font-medium
                                       hover:bg-destructive/20 transition-colors"
                              >
                                Tolak & kembalikan ke draft
                              </button>
                            {:else}
                              <p class="text-[11px] text-warning leading-relaxed">
                                Membuka kunci mengembalikan periode ke draft, mengeluarkannya dari
                                angka konsolidasi, dan tercatat di audit log.
                              </p>
                              <button
                                type="submit"
                                formaction="?/unlock"
                                onclick={confirmUnlock}
                                class="self-start flex items-center gap-1 px-3 py-1.5 rounded-md
                                       border border-warning/30 bg-warning/10 text-warning text-[12px]
                                       font-medium hover:bg-warning/20 transition-colors"
                              >
                                <LockOpen size={11} />
                                Buka kunci
                              </button>
                            {/if}
                          </form>
                        {:else}
                          <div class="text-[11px] text-subtle leading-relaxed space-y-1">
                            {#if row.period.status === 'draft'}
                              <p>Periode masih draft. Belum ada yang bisa disetujui.</p>
                            {:else if row.period.status === 'approved'}
                              <p>
                                Disetujui oleh {row.approverName ?? NO_DATA} pada {formatDate(
                                  row.period.approved_at
                                )}.
                              </p>
                            {:else if row.period.status === 'locked'}
                              <p>
                                Dikunci oleh {row.lockerName ?? NO_DATA} pada {formatDate(
                                  row.period.locked_at
                                )}. Hanya direksi yang dapat membukanya.
                              </p>
                            {/if}
                            {#if !data.canApprove}
                              <p>Peran Anda hanya membaca.</p>
                            {/if}
                          </div>
                        {/if}

                        {#if row.period.rejection_note}
                          <p class="text-[11px] text-muted-foreground leading-relaxed">
                            <span class="font-semibold">Catatan terakhir:</span>
                            {row.period.rejection_note}
                          </p>
                        {/if}
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
