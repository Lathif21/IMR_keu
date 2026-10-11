<script lang="ts">
  import ArrowDownRight from 'lucide-svelte/icons/arrow-down-right';
  import ArrowUpRight from 'lucide-svelte/icons/arrow-up-right';
  import Lock from 'lucide-svelte/icons/lock';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import {
    NO_DATA,
    currentPeriod,
    formatAmount,
    formatCompact,
    formatDelta,
    formatPct,
    formatPeriod,
    periodToMonth,
    shareOf,
    toAmount
  } from '$lib/format';
  import { REPORTING_BASIS_LABEL, PERIOD_STATUS_LABEL, type Numeric } from '$lib/domain';
  import { entityIcon } from '$lib/icons';
  import { comparisonTag, monthsBetween, sameCoverage, type RangeMode } from '$lib/period-range';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  /** One month, or several summed. Several changes how counts are worded. */
  const multiMonth = $derived((data.completeness?.months ?? 1) > 1);
  const tag = $derived(comparisonTag(data.range?.mode ?? 'bulanan'));

  /**
   * Change against the same-length range just before: MoM for a month, YoY
   * for a year, "vs. sebelumnya" for a custom range. The prototype labelled
   * MoM as YoY; each tag here says exactly what it compares.
   */
  function changePct(current: Numeric | null | undefined, prior: Numeric | null | undefined): number | null {
    const a = toAmount(current);
    const b = toAmount(prior);
    if (a === null || b === null || b === 0) return null;
    return ((a - b) / Math.abs(b)) * 100;
  }

  const revenueMom = $derived(
    data.scoped
      ? null
      : changePct(data.consolidated?.revenue_consolidated, data.previous?.revenue_consolidated)
  );
  const netProfitMom = $derived(
    data.scoped
      ? null
      : changePct(data.consolidated?.net_profit_consolidated, data.previous?.net_profit_consolidated)
  );

  /**
   * One row per active entity, whether or not it reported. An entity missing
   * from the total has to be visible as missing; the prototype dropped
   * non-reporting entities silently, which made a partial figure look final.
   *
   * Over several months an entity counts if at least one month is approved,
   * and the row says how many — "3/12 bln" is not the same contribution as a
   * full year, even when the bar looks alike.
   */
  const contributions = $derived.by(() => {
    if (data.scoped) return [];
    const base = toAmount(data.consolidated?.revenue_sum);
    const months = data.completeness?.months ?? 1;

    return data.entities
      .map((entity) => {
        const totals = data.totals[entity.id] ?? null;
        const counted = (totals?.countedMonths ?? 0) > 0;
        const revenue = counted ? toAmount(totals?.revenue) : null;
        return {
          entity,
          totals,
          counted,
          partial: counted && (totals?.countedMonths ?? 0) < months,
          revenue,
          share: shareOf(revenue, base)
        };
      })
      .sort((a, b) => (b.revenue ?? -1) - (a.revenue ?? -1));
  });

  type Alert = { kind: 'loss' | 'missing' | 'policy'; title: string; detail: string };

  /**
   * Every alert is derived from data that exists. There is no "margin below
   * 5%" rule here: no one has decided that threshold, and inventing one would
   * be inventing a policy (invariant 8). A negative result needs no threshold.
   */
  const alerts = $derived.by<Alert[]>(() => {
    if (data.scoped || !data.range) return [];
    const out: Alert[] = [];

    for (const item of contributions) {
      if (!item.counted || !item.totals) continue;
      const net = toAmount(item.totals.netProfit);
      if (net !== null && net < 0) {
        // Margin only for a single month: v_period_pnl computes it per
        // period, and a margin of summed months would be a new calculation.
        const row = multiMonth ? null : data.pnl.find((r) => r.entity_id === item.entity.id);
        out.push({
          kind: 'loss',
          title: item.entity.legal_name,
          detail: `Rugi bersih ${formatCompact(net)} pada ${data.rangeLabel}${
            row?.net_margin_pct ? ` · margin ${formatPct(row.net_margin_pct, 2)}` : ''
          }`
        });
      }
    }

    for (const { code, months } of data.completeness?.missing ?? []) {
      const entity = data.entities.find((e) => e.code === code);
      const status = entity ? data.totals[entity.id]?.latestStatus : null;
      out.push({
        kind: 'missing',
        title: entity?.legal_name ?? code,
        detail: multiMonth
          ? `Belum disetujui untuk ${months} dari ${data.completeness?.months} bulan — bulan itu tidak masuk konsolidasi`
          : status
            ? `Berstatus ${PERIOD_STATUS_LABEL[status]} — belum disetujui, jadi tidak masuk konsolidasi`
            : 'Belum ada laporan untuk periode ini'
      });
    }

    if (data.openPolicies.length > 0) {
      out.push({
        kind: 'policy',
        title: `${data.openPolicies.length} kebijakan akuntansi belum diputuskan`,
        detail: data.openPolicies.map((p) => p.policy_key).join(', ')
      });
    }

    return out;
  });

  const prevPeriodLabel = $derived(data.priorLabel);

  /**
   * A change is only a change in performance if both ranges cover the same
   * entity-months. When an entity appears or drops out, most of the "growth"
   * is that entity arriving — the seed's +37,2% is entirely TAMBANG showing up
   * in July. Comparing across different sets is the "3/4 looks like 4/4" trap
   * in a second dimension, so the delta is marked instead of coloured green.
   */
  const momSetDiffers = $derived.by(() => {
    if (data.scoped || !data.consolidated || !data.previous) return false;
    if (!data.completeness || !data.priorCompleteness) return false;
    return !sameCoverage(data.completeness, data.priorCompleteness);
  });

  // --- Filter waktu -------------------------------------------------------

  const MODES: { mode: RangeMode; label: string }[] = [
    { mode: 'bulanan', label: 'Bulanan' },
    { mode: 'tahunan', label: 'Tahunan' },
    { mode: 'custom', label: 'Custom' }
  ];

  /**
   * Every month from the first period ever created up to this month, newest
   * first. Not only months that have periods: a custom range may start in a
   * month nobody reported, and saying so is the point of the banner.
   */
  const monthOptions = $derived.by(() => {
    // The active range is always included, so a select never shows a month
    // other than the one actually in force (a full year reaches back to
    // January even when the first period is September).
    const known = [
      ...data.periods.map((p) => p.period),
      currentPeriod(),
      ...(data.range ? [data.range.from, data.range.to] : [])
    ].sort();
    return monthsBetween(known[0], known[known.length - 1]).reverse();
  });

  const yearOptions = $derived([...new Set(monthOptions.map((p) => p.slice(0, 4)))]);

  /** Switching mode keeps the user near where they were. */
  function modeHref(mode: RangeMode): string {
    const to = data.range?.to ?? monthOptions[0] ?? currentPeriod();
    const from = data.range?.from ?? to;
    if (mode === 'tahunan') return `?mode=tahunan&tahun=${to.slice(0, 4)}`;
    if (mode === 'custom') return `?mode=custom&dari=${periodToMonth(from)}&sampai=${periodToMonth(to)}`;
    return `?mode=bulanan&periode=${periodToMonth(to)}`;
  }

  const SELECT =
    'h-[30px] pl-3 pr-2 bg-card border border-border rounded-lg text-[13px] text-foreground ' +
    'tabular-nums hover:bg-muted transition-colors focus:outline-none focus:border-primary';

  const submitOnChange = (event: Event) =>
    (event.currentTarget as HTMLSelectElement).form?.requestSubmit();

  /**
   * CONTEXT.md: two entities on different bases are not comparable, and any
   * screen that puts them side by side must say so.
   */
  const basisWarning = $derived.by(() => {
    if (data.scoped) return null;
    const counted = contributions.filter((c) => c.counted);
    if (counted.length === 0) return null;

    const bases = new Set(counted.map((c) => c.entity.reporting_basis));
    if (bases.size === 1 && !bases.has('unknown')) return null;

    if (bases.has('unknown')) {
      return 'Basis pelaporan sebagian entitas belum ditetapkan, sehingga angka di bawah ini belum dapat dibandingkan antar entitas.';
    }
    return `Entitas melapor dengan basis berbeda (${[...bases]
      .map((b) => REPORTING_BASIS_LABEL[b])
      .join(' vs ')}), sehingga tidak sebanding.`;
  });
</script>

<svelte:head><title>Dasbor Eksekutif · Portal Keuangan</title></svelte:head>

{#if data.scoped}
  <div class="flex flex-col h-full">
    <div class="h-12 flex items-center px-4 sm:px-5 border-b border-border shrink-0">
      <h1 class="text-[13px] font-semibold text-foreground">Dasbor Eksekutif</h1>
    </div>
    <div class="flex-1 p-4 sm:p-5">
      <div class="max-w-[520px] bg-card border border-border rounded-lg p-5">
        <div class="flex items-center gap-2 mb-2">
          <Lock size={14} class="text-muted-foreground" />
          <h2 class="text-[13px] font-semibold text-foreground">Tidak tersedia untuk peran Anda</h2>
        </div>
        <p class="text-[12px] text-muted-foreground leading-relaxed">
          Dasbor ini menampilkan angka konsolidasi seluruh grup. Akses Anda terbatas pada entitas
          yang ditugaskan kepada Anda, dan total grup yang dihitung dari sebagian entitas bukan
          versi kecil dari angka sebenarnya — itu angka yang berbeda.
          {#if data.scopedNext}
            Layar yang Anda perlukan adalah
            <a href={data.scopedNext.href} class="text-primary hover:underline"
              >{data.scopedNext.label}</a
            >.
          {/if}
        </p>
      </div>
    </div>
  </div>
{:else if !data.period}
  <div class="flex flex-col h-full">
    <div class="h-12 flex items-center px-4 sm:px-5 border-b border-border shrink-0">
      <h1 class="text-[13px] font-semibold text-foreground">Dasbor Eksekutif</h1>
    </div>
    <div class="flex-1 p-4 sm:p-5">
      <div class="max-w-[520px] bg-card border border-border rounded-lg p-5">
        <h2 class="text-[13px] font-semibold text-foreground mb-2">Belum ada periode</h2>
        <p class="text-[12px] text-muted-foreground leading-relaxed">
          Belum ada satu pun periode pelaporan yang dibuat. Angka konsolidasi akan muncul setelah
          entitas mengisi dan laporannya disetujui.
        </p>
      </div>
    </div>
  </div>
{:else}
  <div class="flex flex-col h-full overflow-hidden">
    <!-- header · 48px -->
    <div class="h-12 flex items-center justify-between px-4 sm:px-5 border-b border-border shrink-0 gap-3">
      <div class="flex items-center gap-3 min-w-0">
        <h1 class="text-[13px] font-semibold text-foreground truncate">Dasbor Eksekutif</h1>
        <span class="text-[11px] text-muted-foreground truncate hidden sm:inline">
          Grup Holding · Konsolidasi · {data.rangeLabel}
        </span>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 sm:space-y-5">
      <!-- Time filter. It used to be a lone dropdown in the header's far
           corner, where people did not look for it; it now sits first in the
           content, above everything it changes. -->
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div
          class="inline-flex items-center p-0.5 bg-card border border-border rounded-lg"
          role="group"
          aria-label="Jenis periode"
        >
          {#each MODES as option (option.mode)}
            {@const active = data.range?.mode === option.mode}
            <a
              href={modeHref(option.mode)}
              aria-current={active ? 'true' : undefined}
              class="h-[26px] px-3 inline-flex items-center rounded-md text-[12px] transition-colors
                     {active
                ? 'bg-primary text-primary-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'}"
            >
              {option.label}
            </a>
          {/each}
        </div>

        <form method="GET" class="flex flex-wrap items-center gap-2">
          <input type="hidden" name="mode" value={data.range?.mode} />

          {#if data.range?.mode === 'tahunan'}
            <label for="tahun" class="sr-only">Tahun</label>
            <select id="tahun" name="tahun" class={SELECT} onchange={submitOnChange}>
              {#each yearOptions as year (year)}
                <option value={year} selected={year === data.range.from.slice(0, 4)}>{year}</option>
              {/each}
            </select>
          {:else if data.range?.mode === 'custom'}
            <label for="dari" class="text-[12px] text-muted-foreground">Dari</label>
            <select id="dari" name="dari" class={SELECT}>
              {#each monthOptions as month (month)}
                <option value={periodToMonth(month)} selected={month === data.range.from}>
                  {formatPeriod(month)}
                </option>
              {/each}
            </select>
            <label for="sampai" class="text-[12px] text-muted-foreground">sampai</label>
            <select id="sampai" name="sampai" class={SELECT}>
              {#each monthOptions as month (month)}
                <option value={periodToMonth(month)} selected={month === data.range.to}>
                  {formatPeriod(month)}
                </option>
              {/each}
            </select>
            <button
              type="submit"
              class="h-[30px] px-3 rounded-lg bg-primary text-[12px] font-medium text-primary-foreground
                     hover:bg-accent transition-colors"
            >
              Terapkan
            </button>
          {:else}
            <label for="periode" class="sr-only">Bulan</label>
            <select id="periode" name="periode" class={SELECT} onchange={submitOnChange}>
              {#each monthOptions as month (month)}
                <option value={periodToMonth(month)} selected={month === data.range?.from}>
                  {formatPeriod(month)}
                </option>
              {/each}
            </select>
          {/if}

          {#if data.range?.mode !== 'custom'}
            <noscript>
              <button type="submit" class={SELECT}>Tampilkan</button>
            </noscript>
          {/if}
        </form>

        <p class="text-[11px] text-subtle">
          Dibandingkan dengan {data.priorLabel} ({tag})
        </p>
      </div>

      <!-- Incompleteness is never silent. CLAUDE.md anti-pattern: showing
           consolidated totals without a banner when entities haven't reported. -->
      {#if data.completeness && !data.completeness.is_complete}
        <div
          class="flex items-start gap-3 px-4 py-2.5 bg-warning/10 border border-warning/25 rounded-lg"
          role="status"
        >
          <TriangleAlert size={14} class="text-warning shrink-0 mt-px" />
          <p class="text-[13px] text-warning flex-1 leading-relaxed">
            {#if multiMonth}
              Data belum lengkap — {data.completeness.reported} dari {data.completeness.expected}
              entitas-bulan sudah disetujui ({data.completeness.months} bulan × {data.entities.length}
              entitas). Angka di bawah ini bukan angka konsolidasi final.
            {:else}
              Data belum lengkap — {data.completeness.reported} dari {data.completeness.expected}
              entitas sudah disetujui. Angka di bawah ini bukan angka konsolidasi final.
            {/if}
            {#if data.completeness.missing.length}
              <span class="font-semibold">
                Belum masuk: {data.completeness.missing
                  .map((m) => (multiMonth ? `${m.code} (${m.months} bln)` : m.code))
                  .join(', ')}.
              </span>
            {/if}
          </p>
        </div>
      {/if}

      {#snippet momBadge(value: number | null)}
        {#if value === null}
          <p class="text-[11px] text-subtle">Tidak ada pembanding untuk {prevPeriodLabel}</p>
        {:else if momSetDiffers}
          <span
            class="inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded
                   tabular-nums bg-warning/10 text-warning"
          >
            <TriangleAlert size={10} />
            {formatDelta(value)} {tag}
          </span>
          <p class="text-[11px] text-warning">
            himpunan entitas berbeda dari {prevPeriodLabel} — bukan perubahan kinerja
          </p>
        {:else}
          <span
            class="inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded tabular-nums
                   {value >= 0 ? 'bg-positive/10 text-positive' : 'bg-destructive/10 text-destructive'}"
          >
            {#if value >= 0}<ArrowUpRight size={10} />{:else}<ArrowDownRight size={10} />{/if}
            {formatDelta(value)} {tag}
          </span>
          <p class="text-[11px] text-subtle">vs. {prevPeriodLabel}</p>
        {/if}
      {/snippet}

      <!-- KPI cards -->
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div class="bg-card border border-border rounded-lg p-4">
          <p class="text-[11px] font-medium text-muted-foreground mb-1.5">Pendapatan Konsolidasi</p>
          <p class="text-[22px] font-semibold text-foreground tabular-nums leading-none mb-2">
            {formatCompact(data.consolidated?.revenue_consolidated)}
          </p>
          <div class="flex items-center gap-1.5 flex-wrap">
            {@render momBadge(revenueMom)}
          </div>
        </div>

        <div class="bg-card border border-border rounded-lg p-4">
          <p class="text-[11px] font-medium text-muted-foreground mb-1.5">Laba Bersih Konsolidasi</p>
          <p class="text-[22px] font-semibold text-foreground tabular-nums leading-none mb-2">
            {formatCompact(data.consolidated?.net_profit_consolidated)}
          </p>
          <div class="flex items-center gap-1.5 flex-wrap">
            {@render momBadge(netProfitMom)}
          </div>
        </div>

        <!-- The prototype's fourth KPI was "Posisi Kas". There is no cash
             figure in this system: it stores a profit & loss statement and
             nothing else (ASSUMPTIONS.md A-8, no balance sheet). Elimination
             is shown instead — it is the one number the group computes that
             no single entity can. -->
        <div class="bg-card border border-border rounded-lg p-4">
          <p class="text-[11px] font-medium text-muted-foreground mb-1.5">Eliminasi Antar-Perusahaan</p>
          <p class="text-[22px] font-semibold text-foreground tabular-nums leading-none mb-2">
            {formatCompact(data.consolidated?.elimination)}
          </p>
          <p class="text-[11px] text-subtle">
            {toAmount(data.consolidated?.elimination)
              ? `Jumlah aritmetik ${formatCompact(data.consolidated?.revenue_sum)} sebelum eliminasi`
              : 'Belum ada transaksi antar-perusahaan tercatat'}
          </p>
        </div>

        <div class="bg-card border border-border rounded-lg p-4">
          <p class="text-[11px] font-medium text-muted-foreground mb-1.5">Kelengkapan</p>
          <p class="text-[22px] font-semibold text-foreground tabular-nums leading-none mb-2">
            {data.completeness?.reported ?? 0}/{data.completeness?.expected ?? 0}
          </p>
          <div class="flex items-center gap-1.5 flex-wrap">
            {#if data.completeness?.is_complete}
              <span
                class="inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded bg-positive/10 text-positive"
              >
                Lengkap
              </span>
            {:else}
              <span
                class="inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded bg-warning/10 text-warning"
              >
                <TriangleAlert size={10} />
                {(data.completeness?.expected ?? 0) - (data.completeness?.reported ?? 0)} belum lapor
              </span>
            {/if}
            <p class="text-[11px] text-subtle">
              {multiMonth ? 'entitas-bulan disetujui' : 'entitas disetujui'}
            </p>
          </div>
        </div>
      </div>

      <!-- contributions + alerts -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div class="lg:col-span-2 bg-card border border-border rounded-lg p-5">
          <h2 class="text-[13px] font-semibold text-foreground mb-1">Kontribusi per Lini Usaha</h2>
          <p class="text-[11px] text-subtle mb-4">
            Porsi dari jumlah aritmetik {formatCompact(data.consolidated?.revenue_sum)}, sebelum
            eliminasi.
          </p>

          {#if basisWarning}
            <p class="flex items-start gap-2 text-[11px] text-warning mb-4 leading-relaxed">
              <TriangleAlert size={12} class="shrink-0 mt-px" />
              {basisWarning}
            </p>
          {/if}

          <div class="space-y-4">
            {#each contributions as item (item.entity.id)}
              {@const Icon = entityIcon(item.entity.icon_key)}
              <div>
                <div class="flex items-center justify-between gap-3 mb-1.5">
                  <div class="flex items-center gap-2 min-w-0">
                    <Icon size={13} class={item.counted ? 'text-muted-foreground' : 'text-subtle'} />
                    <span
                      class="text-[13px] font-medium shrink-0 {item.counted
                        ? 'text-foreground'
                        : 'text-subtle'}"
                    >
                      {item.entity.code}
                    </span>
                    <span class="text-[11px] text-muted-foreground truncate hidden sm:inline">
                      {item.entity.legal_name}
                    </span>
                  </div>
                  <div class="flex items-center gap-4 shrink-0">
                    {#if item.counted}
                      {#if item.partial}
                        <span class="text-[11px] text-warning tabular-nums">
                          {item.totals?.countedMonths}/{data.completeness?.months} bln
                        </span>
                      {/if}
                      <span class="text-[11px] text-muted-foreground tabular-nums">
                        {formatCompact(item.revenue)}
                      </span>
                      <span class="text-[12px] font-semibold text-foreground tabular-nums w-12 text-right">
                        {formatPct(item.share)}
                      </span>
                    {:else}
                      <span class="text-[11px] text-subtle">
                        {item.totals?.latestStatus
                          ? PERIOD_STATUS_LABEL[item.totals.latestStatus]
                          : 'belum lapor'}
                      </span>
                      <span class="text-[12px] text-subtle tabular-nums w-12 text-right">{NO_DATA}</span>
                    {/if}
                  </div>
                </div>
                <div class="h-[5px] bg-muted rounded-full overflow-hidden">
                  <!-- Width comes from shareOf(), which clamps to 0–100. The
                       prototype interpolated an unbounded percentage. Colour is
                       entities.theme_color, a data value, so it is inline here
                       rather than a token. -->
                  <div
                    class="h-full rounded-full"
                    style:width="{item.share ?? 0}%"
                    style:background-color={item.counted ? item.entity.theme_color : 'transparent'}
                  ></div>
                </div>
              </div>
            {/each}
          </div>
        </div>

        <div class="bg-card border border-border rounded-lg p-5">
          <h2 class="text-[13px] font-semibold text-foreground mb-4">Perlu Perhatian</h2>
          {#if alerts.length === 0}
            <p class="text-[12px] text-subtle leading-relaxed">
              Tidak ada temuan untuk periode ini.
            </p>
          {:else}
            <div class="space-y-3">
              {#each alerts as alert, i (i)}
                <div
                  class="border-l-2 pl-3 py-2.5 rounded-r-lg {alert.kind === 'loss'
                    ? 'border-destructive bg-destructive/5'
                    : 'border-warning bg-warning/5'}"
                >
                  <p class="text-[12px] font-semibold text-foreground mb-0.5">{alert.title}</p>
                  <p class="text-[11px] text-muted-foreground leading-relaxed">{alert.detail}</p>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <!-- Three-column consolidation, per the schema's v_group_consolidated:
           arithmetic sum, elimination, consolidated result. "Sum of four
           entities" is not the group figure. -->
      <div class="bg-card border border-border rounded-lg p-5">
        <h2 class="text-[13px] font-semibold text-foreground mb-4">
          Konsolidasi {data.rangeLabel}
        </h2>
        <div class="overflow-x-auto">
          <table class="w-full text-[12px]">
            <thead>
              <tr class="text-muted-foreground">
                <th class="text-left font-medium pb-2">Pos</th>
                <th class="text-right font-medium pb-2">Jumlah aritmetik</th>
                <th class="text-right font-medium pb-2">Eliminasi</th>
                <th class="text-right font-medium pb-2">Konsolidasi</th>
              </tr>
            </thead>
            <tbody class="text-foreground">
              <tr class="border-t border-border">
                <td class="py-2">Pendapatan</td>
                <td class="py-2 text-right">{formatAmount(data.consolidated?.revenue_sum)}</td>
                <td class="py-2 text-right">{formatAmount(data.consolidated?.elimination)}</td>
                <td class="py-2 text-right font-medium">
                  {formatAmount(data.consolidated?.revenue_consolidated)}
                </td>
              </tr>
              <tr class="border-t border-border">
                <td class="py-2">Beban pokok</td>
                <td class="py-2 text-right">{formatAmount(data.consolidated?.cogs_sum)}</td>
                <td class="py-2 text-right text-subtle">{NO_DATA}</td>
                <td class="py-2 text-right text-subtle">{NO_DATA}</td>
              </tr>
              <tr class="border-t border-border">
                <td class="py-2">Beban usaha</td>
                <td class="py-2 text-right">{formatAmount(data.consolidated?.opex_sum)}</td>
                <td class="py-2 text-right text-subtle">{NO_DATA}</td>
                <td class="py-2 text-right text-subtle">{NO_DATA}</td>
              </tr>
              <tr class="border-t-2 border-border-strong">
                <td class="py-2 font-semibold">Laba bersih</td>
                <td class="py-2 text-right text-subtle">{NO_DATA}</td>
                <td class="py-2 text-right text-subtle">{NO_DATA}</td>
                <td class="py-2 text-right font-semibold">
                  {formatAmount(data.consolidated?.net_profit_consolidated)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-[11px] text-subtle mt-3 leading-relaxed">
          Eliminasi diterapkan pada pendapatan. Beban pokok dan beban usaha menunggu registrasi
          transaksi antar-perusahaan per pos (ASSUMPTIONS.md A-5). Laba bersih tidak disesuaikan
          karena satu transaksi antar-perusahaan adalah omset di satu buku dan beban di buku
          lawannya, sehingga eliminasi mengurangi keduanya dengan angka yang sama.
        </p>
      </div>
    </div>
  </div>
{/if}
