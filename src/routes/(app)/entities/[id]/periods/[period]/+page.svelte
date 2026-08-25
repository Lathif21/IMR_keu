<script lang="ts">
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import { goto } from '$app/navigation';
  import {
    LINE_SECTION_LABEL,
    LINE_SECTION_SIGN,
    PERIOD_STATUS_LABEL,
    REPORTING_BASIS_LABEL,
    REVENUE_PRESENTATION_LABEL,
    type LineSection,
    type Numeric
  } from '$lib/domain';
  import {
    NO_DATA,
    clampPct,
    formatAmount,
    formatDelta,
    formatPct,
    formatPeriod,
    momPct,
    periodToMonth,
    toAmount
  } from '$lib/format';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const revenue = $derived(toAmount(data.pnl.revenue) ?? 0);

  /**
   * Subtotals are read from `v_period_pnl`, never recomputed here
   * (invariant 2). A second implementation of the same arithmetic is a second
   * answer waiting to disagree with the first.
   */
  type Row =
    | { kind: 'section'; key: string; section: LineSection; amount: Numeric; prior: Numeric | null }
    | {
        kind: 'line';
        key: string;
        section: LineSection;
        label: string;
        amount: number;
        prior: number | null;
        note: string | null;
      }
    | { kind: 'subtotal'; key: string; label: string; amount: Numeric; prior: Numeric | null };

  const rows = $derived.by<Row[]>(() => {
    const labels = new Map(data.templateLines.map((line) => [line.line_code, line]));
    const order = new Map(data.templateLines.map((line) => [line.line_code, line.sort_order]));
    const priorByCode = new Map(data.priorLines.map((line) => [line.line_code, line]));

    const out: Row[] = [];

    const sectionOf = (section: LineSection) =>
      data.reportLines
        .filter((line) => labels.get(line.line_code)?.section === section)
        .sort((a, b) => (order.get(a.line_code) ?? 0) - (order.get(b.line_code) ?? 0));

    const pushSection = (section: LineSection) => {
      const lines = sectionOf(section);
      /**
       * A section nobody reported is left out rather than shown as a row of
       * zeros. The statement stays the shape of what was actually filed.
       */
      if (lines.length === 0) return;

      out.push({
        kind: 'section',
        key: `s:${section}`,
        section,
        // `LineSection` and the view's section columns are the same names,
        // so the section is the column. A lookup table here would only be a
        // second place for them to disagree.
        amount: data.pnl[section],
        prior: data.priorPnl ? data.priorPnl[section] : null
      });

      for (const line of lines) {
        const priorLine = priorByCode.get(line.line_code);
        out.push({
          kind: 'line',
          key: line.line_code,
          section,
          label: labels.get(line.line_code)?.line_label ?? line.line_code,
          amount: toAmount(line.amount) ?? 0,
          /**
           * A line absent last month is genuinely absent, not zero — the delta
           * has nothing to compare against and renders as an em dash.
           */
          prior: priorLine ? toAmount(priorLine.amount) : null,
          note: line.note
        });
      }
    };

    pushSection('revenue');
    pushSection('cogs');
    out.push({
      kind: 'subtotal',
      key: 'gross',
      label: 'Laba Kotor',
      amount: data.pnl.gross_profit,
      prior: data.priorPnl?.gross_profit ?? null
    });

    pushSection('opex');
    out.push({
      kind: 'subtotal',
      key: 'operating',
      label: 'Laba Operasi',
      amount: data.pnl.operating_profit,
      prior: data.priorPnl?.operating_profit ?? null
    });

    pushSection('other_income');
    pushSection('other_expense');
    pushSection('tax');

    out.push({
      kind: 'subtotal',
      key: 'net',
      label: 'Laba Bersih',
      amount: data.pnl.net_profit,
      prior: data.priorPnl?.net_profit ?? null
    });

    return out;
  });

  /**
   * Green for up, red for down — except on an expense, where a rise is not
   * good news. `LINE_SECTION_SIGN` already knows which sections subtract, so
   * the inversion is derived from it rather than restated as a second list
   * that could drift.
   */
  function deltaClass(value: number | null, section: LineSection | null): string {
    if (value === null) return 'text-subtle';
    const favourable = section === null ? value >= 0 : value * LINE_SECTION_SIGN[section] >= 0;
    return favourable ? 'text-positive' : 'text-destructive';
  }

  /** Share of this period's revenue. Null when there is no revenue to divide by. */
  function contribution(amount: number | null): number | null {
    if (amount === null || revenue === 0) return null;
    return (amount / revenue) * 100;
  }

  const basisUnknown = $derived(
    data.entity.reporting_basis === 'unknown' || data.entity.revenue_presentation === 'unknown'
  );

  const revenueMom = $derived(toAmount(data.comparison?.revenue_mom_pct ?? null));
  /**
   * Empty until the entity has twelve months behind it. That is correct, not
   * a gap to fill with the month-over-month figure — the prototype labelled
   * one as the other.
   */
  const revenueYoy = $derived(toAmount(data.comparison?.revenue_yoy_pct ?? null));

  function onPeriodChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    goto(`/entities/${data.entity.id}/periods/${value}`);
  }
</script>

<svelte:head>
  <title>{data.entity.code} · {formatPeriod(data.period)} · Portal Keuangan</title>
</svelte:head>

<div class="flex flex-col h-full overflow-hidden">
  <!-- header · 48px -->
  <div class="h-12 flex items-center justify-between px-4 sm:px-5 border-b border-border shrink-0 gap-3">
    <div class="flex items-center gap-3 min-w-0">
      <a
        href="/entities"
        class="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        aria-label="Kembali ke daftar entitas"
      >
        <ArrowLeft size={14} />
      </a>
      <h1 class="text-[13px] font-semibold text-foreground shrink-0">{data.entity.code}</h1>
      <span class="text-[11px] text-muted-foreground truncate hidden lg:inline">
        {data.entity.legal_name}
      </span>
      <!-- The period is already in the picker on the right, so on a phone this
           copy of it gives way before the status badge does. The badge stays:
           whether these figures are approved changes how they should be read. -->
      <span class="text-[11px] text-muted-foreground shrink-0 tabular-nums hidden sm:inline">
        · {formatPeriod(data.period)}
      </span>
      <span class="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
        {PERIOD_STATUS_LABEL[data.status]}
      </span>
    </div>

    <div class="flex items-center gap-2 shrink-0">
      <label for="periode" class="sr-only">Periode</label>
      <select
        id="periode"
        class="h-[30px] pl-3 pr-2 bg-card border border-border rounded-lg text-[13px] text-foreground
               tabular-nums hover:bg-muted transition-colors focus:outline-none focus:border-primary"
        onchange={onPeriodChange}
      >
        {#each data.periods as option (option.id)}
          <option value={periodToMonth(option.period)} selected={option.period === data.period}>
            {formatPeriod(option.period)}
          </option>
        {/each}
      </select>
    </div>
  </div>

  <div class="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
    <noscript>
      <div class="bg-card border border-border rounded-lg p-3">
        <p class="text-[11px] text-muted-foreground mb-2">Periode lain:</p>
        <div class="flex flex-wrap gap-2">
          {#each data.periods as option (option.id)}
            <a
              href="/entities/{data.entity.id}/periods/{periodToMonth(option.period)}"
              class="text-[12px] px-2 py-1 rounded bg-muted text-foreground hover:bg-border-strong"
            >
              {formatPeriod(option.period)}
            </a>
          {/each}
        </div>
      </div>
    </noscript>

    <!-- The system shows the hole rather than filling it (invariant 8). -->
    {#if data.openPolicies.length > 0}
      <div
        class="flex items-start gap-3 px-4 py-2.5 bg-warning/10 border border-warning/25 rounded-lg"
        role="status"
      >
        <TriangleAlert size={14} class="text-warning shrink-0 mt-px" />
        <p class="text-[13px] text-warning flex-1 leading-relaxed">
          Sebagian kebijakan akuntansi belum ditetapkan — angka bersifat sementara.
          <!-- `revenue_presentation_trucking` is one unbreakable word; without
               this it runs straight off the side of a phone. -->
          <span class="font-semibold break-words">
            {data.openPolicies.map((policy) => policy.policy_key).join(', ')}
          </span>
        </p>
      </div>
    {/if}

    <!-- summary strip -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      <div class="bg-card border border-border rounded-lg p-4">
        <p class="text-[11px] font-medium text-muted-foreground mb-1.5">Laba Bersih</p>
        <p
          class="text-[20px] font-semibold tabular-nums leading-none {(toAmount(
            data.pnl.net_profit
          ) ?? 0) < 0
            ? 'text-destructive'
            : 'text-foreground'}"
        >
          {formatAmount(data.pnl.net_profit)}
        </p>
      </div>

      <div class="bg-card border border-border rounded-lg p-4">
        <p class="text-[11px] font-medium text-muted-foreground mb-1.5">Margin Bersih</p>
        <p class="text-[20px] font-semibold text-foreground tabular-nums leading-none">
          {formatPct(data.pnl.net_margin_pct, 2)}
        </p>
      </div>

      <div class="bg-card border border-border rounded-lg p-4">
        <p class="text-[11px] font-medium text-muted-foreground mb-1.5">Pendapatan MoM</p>
        <p class="text-[20px] font-semibold tabular-nums leading-none {deltaClass(revenueMom, null)}">
          {formatDelta(revenueMom)}
        </p>
        <p class="text-[11px] text-subtle mt-1">
          {data.priorPeriod ? `vs. ${formatPeriod(data.priorPeriod)}` : 'tidak ada bulan pembanding'}
        </p>
      </div>

      <div class="bg-card border border-border rounded-lg p-4">
        <p class="text-[11px] font-medium text-muted-foreground mb-1.5">Pendapatan YoY</p>
        <p class="text-[20px] font-semibold tabular-nums leading-none {deltaClass(revenueYoy, null)}">
          {formatDelta(revenueYoy)}
        </p>
        <p class="text-[11px] text-subtle mt-1">
          {revenueYoy === null ? 'belum ada data 12 bulan sebelumnya' : 'vs. periode tahun lalu'}
        </p>
      </div>
    </div>

    <!-- statement -->
    <div class="bg-card border border-border rounded-lg">
      <div class="px-4 sm:px-5 py-4 border-b border-border flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 class="text-[13px] font-semibold text-foreground">
            Laporan Laba Rugi · {formatPeriod(data.period)}
          </h2>
          <p class="text-[11px] text-subtle mt-0.5">
            Subtotal dihitung oleh <code class="text-muted-foreground">v_period_pnl</code>, bukan
            oleh layar ini.
          </p>
        </div>

        <!-- The reader has to know the basis is not agreed before they read
             the numbers, not after (CONTEXT.md, "Basis pelaporan"). -->
        <div class="flex flex-wrap items-center gap-1.5">
          <span
            class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded
                   {data.entity.reporting_basis === 'unknown'
              ? 'bg-warning/10 text-warning'
              : 'bg-muted text-muted-foreground'}"
          >
            {#if data.entity.reporting_basis === 'unknown'}<TriangleAlert size={9} />{/if}
            {REPORTING_BASIS_LABEL[data.entity.reporting_basis]}
          </span>
          <span
            class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded
                   {data.entity.revenue_presentation === 'unknown'
              ? 'bg-warning/10 text-warning'
              : 'bg-muted text-muted-foreground'}"
          >
            {#if data.entity.revenue_presentation === 'unknown'}<TriangleAlert size={9} />{/if}
            {REVENUE_PRESENTATION_LABEL[data.entity.revenue_presentation]}
          </span>
        </div>
      </div>

      {#if basisUnknown}
        <p
          class="flex items-start gap-2 text-[11px] text-warning px-4 sm:px-5 py-2.5 border-b border-border leading-relaxed"
        >
          <TriangleAlert size={12} class="shrink-0 mt-px" />
          Basis pelaporan entitas ini belum ditetapkan (ASSUMPTIONS.md A-1, A-4), sehingga angka di
          bawah belum dapat dibandingkan dengan entitas lain.
        </p>
      {/if}

      <div class="overflow-x-auto">
        <table class="w-full min-w-[560px] text-[12px]">
          <thead>
            <tr class="text-muted-foreground border-b border-border">
              <th class="text-left font-medium px-5 py-2.5">Pos</th>
              <th class="text-right font-medium px-3 py-2.5 whitespace-nowrap">
                {formatPeriod(data.period)}
              </th>
              <th class="text-right font-medium px-3 py-2.5 whitespace-nowrap">
                {data.priorPeriod ? formatPeriod(data.priorPeriod) : 'Periode lalu'}
              </th>
              <th class="text-right font-medium px-3 py-2.5 whitespace-nowrap">Δ MoM</th>
              <th class="text-right font-medium px-5 py-2.5 whitespace-nowrap">
                Kontribusi
              </th>
            </tr>
          </thead>
          <tbody>
            {#each rows as row (row.key)}
              {#if row.kind === 'section'}
                {@const amount = toAmount(row.amount)}
                {@const prior = toAmount(row.prior)}
                {@const delta = momPct(row.amount, row.prior)}
                <tr class="border-t border-border bg-muted/30">
                  <td class="px-5 py-2 font-semibold text-foreground">
                    {LINE_SECTION_LABEL[row.section]}
                  </td>
                  <td class="px-3 py-2 text-right font-semibold text-foreground">
                    {formatAmount(amount)}
                  </td>
                  <td class="px-3 py-2 text-right text-muted-foreground">
                    {data.priorPnl ? formatAmount(prior) : NO_DATA}
                  </td>
                  <td class="px-3 py-2 text-right {deltaClass(delta, row.section)}">
                    {formatDelta(delta)}
                  </td>
                  <td class="px-5 py-2 text-right text-muted-foreground">
                    {formatPct(contribution(amount))}
                  </td>
                </tr>
              {:else if row.kind === 'line'}
                {@const delta = momPct(row.amount, row.prior)}
                {@const share = contribution(row.amount)}
                <tr class="border-t border-border">
                  <td class="px-5 py-2 pl-9">
                    <span class="text-foreground">{row.label}</span>
                    <!-- Import notes are meant to be seen: the uang saku line
                         carries the Rp104jt that sits outside the statement. -->
                    {#if row.note}
                      <span class="block text-[11px] text-subtle leading-snug mt-0.5 max-w-[52ch]">
                        {row.note}
                      </span>
                    {/if}
                  </td>
                  <td class="px-3 py-2 text-right text-foreground align-top">
                    {formatAmount(row.amount)}
                  </td>
                  <td class="px-3 py-2 text-right text-muted-foreground align-top">
                    {formatAmount(row.prior)}
                  </td>
                  <td class="px-3 py-2 text-right align-top {deltaClass(delta, row.section)}">
                    {formatDelta(delta)}
                  </td>
                  <td class="px-5 py-2 text-right align-top">
                    <span class="text-muted-foreground">{formatPct(share)}</span>
                    <!-- The bar is clamped; the number above it is not. A
                         margin may exceed 100% or go negative, and the
                         prototype's unclamped `width: ${pct}%` overflowed its
                         track when it did. -->
                    <span class="block h-[3px] w-16 ml-auto mt-1 bg-muted rounded-full overflow-hidden">
                      <span
                        class="block h-full rounded-full bg-muted-foreground/50"
                        style:width="{clampPct(share)}%"
                      ></span>
                    </span>
                  </td>
                </tr>
              {:else}
                {@const amount = toAmount(row.amount)}
                {@const delta = momPct(row.amount, row.prior)}
                <tr class="border-t-2 border-border-strong">
                  <td class="px-5 py-2.5 font-semibold text-foreground">= {row.label}</td>
                  <td
                    class="px-3 py-2.5 text-right font-semibold {(amount ?? 0) < 0
                      ? 'text-destructive'
                      : 'text-foreground'}"
                  >
                    {formatAmount(amount)}
                  </td>
                  <td class="px-3 py-2.5 text-right font-medium text-muted-foreground">
                    {data.priorPnl ? formatAmount(row.prior) : NO_DATA}
                  </td>
                  <td class="px-3 py-2.5 text-right font-medium {deltaClass(delta, null)}">
                    {formatDelta(delta)}
                  </td>
                  <td class="px-5 py-2.5 text-right font-medium text-muted-foreground">
                    {formatPct(contribution(amount))}
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>

      <p class="text-[11px] text-subtle px-4 sm:px-5 py-3 leading-relaxed border-t border-border">
        Perbandingan pada tabel ini adalah bulan sebelumnya (MoM). Perbandingan tahunan (YoY) ada
        di kartu terpisah di atas dan kosong sampai entitas ini punya data 12 bulan.
      </p>
    </div>
  </div>
</div>
