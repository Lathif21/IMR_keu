<script lang="ts">
  import ArrowDownRight from 'lucide-svelte/icons/arrow-down-right';
  import ArrowUpRight from 'lucide-svelte/icons/arrow-up-right';
  import Lock from 'lucide-svelte/icons/lock';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import {
    NO_DATA,
    formatAmount,
    formatCompact,
    formatDelta,
    formatPct,
    formatPeriod,
    previousPeriod,
    shareOf,
    toAmount
  } from '$lib/format';
  import { REPORTING_BASIS_LABEL, PERIOD_STATUS_LABEL, type Numeric } from '$lib/domain';
  import { entityIcon } from '$lib/icons';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  /** Month-over-month change. Never labelled YoY — the prototype did that. */
  function momPct(current: Numeric | null | undefined, prior: Numeric | null | undefined): number | null {
    const a = toAmount(current);
    const b = toAmount(prior);
    if (a === null || b === null || b === 0) return null;
    return ((a - b) / Math.abs(b)) * 100;
  }

  const revenueMom = $derived(
    data.scoped
      ? null
      : momPct(data.consolidated?.revenue_consolidated, data.previous?.revenue_consolidated)
  );
  const netProfitMom = $derived(
    data.scoped
      ? null
      : momPct(data.consolidated?.net_profit_consolidated, data.previous?.net_profit_consolidated)
  );

  /**
   * One row per active entity, whether or not it reported. An entity missing
   * from the total has to be visible as missing; the prototype dropped
   * non-reporting entities silently, which made a partial figure look final.
   */
  const contributions = $derived.by(() => {
    if (data.scoped) return [];
    const byEntity = new Map(data.pnl.map((row) => [row.entity_id, row]));
    const base = toAmount(data.consolidated?.revenue_sum);

    return data.entities
      .map((entity) => {
        const row = byEntity.get(entity.id) ?? null;
        const counted = row !== null && (row.status === 'approved' || row.status === 'locked');
        const revenue = counted ? toAmount(row.revenue) : null;
        return {
          entity,
          row,
          counted,
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
    if (data.scoped || !data.period) return [];
    const period = data.period;
    const out: Alert[] = [];

    for (const item of contributions) {
      if (!item.counted || !item.row) continue;
      const net = toAmount(item.row.net_profit);
      if (net !== null && net < 0) {
        out.push({
          kind: 'loss',
          title: item.entity.legal_name,
          detail: `Rugi bersih ${formatCompact(net)} pada ${formatPeriod(period)}${
            item.row.net_margin_pct ? ` · margin ${formatPct(item.row.net_margin_pct, 2)}` : ''
          }`
        });
      }
    }

    for (const code of data.completeness?.missing_entities ?? []) {
      const entity = data.entities.find((e) => e.code === code);
      const row = data.pnl.find((r) => r.entity_code === code);
      out.push({
        kind: 'missing',
        title: entity?.legal_name ?? code,
        detail: row
          ? `Berstatus ${PERIOD_STATUS_LABEL[row.status]} — belum disetujui, jadi tidak masuk konsolidasi`
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

  const prevPeriodLabel = $derived(data.period ? formatPeriod(previousPeriod(data.period)) : '');

  /**
   * A MoM delta is only a change in performance if both months cover the same
   * entities. When an entity appears or drops out, most of the "growth" is
   * that entity arriving — the seed's +37,2% is entirely TAMBANG showing up in
   * July. Comparing across different sets is the "3/4 looks like 4/4" trap in
   * a second dimension, so the delta is marked instead of coloured green.
   */
  const momSetDiffers = $derived.by(() => {
    if (data.scoped || !data.consolidated || !data.previous) return false;
    const now = [...(data.completeness?.missing_entities ?? [])].sort().join(',');
    const then = [...(data.previous.missing_entities ?? [])].sort().join(',');
    return now !== then;
  });

  /**
   * CONTEXT.md: two entities on different bases are not comparable, and any
   * screen that puts them side by side must say so.
   */
  const basisWarning = $derived.by(() => {
    if (data.scoped) return null;
    const counted = contributions.filter((c) => c.counted && c.row);
    if (counted.length === 0) return null;

    const bases = new Set(counted.map((c) => c.row!.reporting_basis));
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
        <!-- The subtitle is the first thing to go: on a phone the period
             picker beside it is what people came for. -->
        <span class="text-[11px] text-muted-foreground truncate hidden sm:inline">
          Grup Holding · Konsolidasi
        </span>
      </div>

      <form method="GET" class="flex items-center gap-2 shrink-0">
        <label for="periode" class="sr-only">Periode</label>
        <select
          id="periode"
          name="periode"
          class="h-[30px] pl-3 pr-2 bg-card border border-border rounded-lg text-[13px] text-foreground
                 tabular-nums hover:bg-muted transition-colors focus:outline-none focus:border-primary"
          onchange={(event) => event.currentTarget.form?.requestSubmit()}
        >
          {#each data.periods as option (option.period)}
            <option value={option.period} selected={option.period === data.period}>
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
    </div>

    <div class="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 sm:space-y-5">
      <!-- Incompleteness is never silent. CLAUDE.md anti-pattern: showing
           consolidated totals without a banner when entities haven't reported. -->
      {#if data.completeness && !data.completeness.is_complete}
        <div
          class="flex items-start gap-3 px-4 py-2.5 bg-warning/10 border border-warning/25 rounded-lg"
          role="status"
        >
          <TriangleAlert size={14} class="text-warning shrink-0 mt-px" />
          <p class="text-[13px] text-warning flex-1 leading-relaxed">
            Data belum lengkap — {data.completeness.reported_entities} dari {data.completeness
              .expected_entities} entitas sudah disetujui. Angka di bawah ini bukan angka konsolidasi
            final.
            {#if data.completeness.missing_entities?.length}
              <span class="font-semibold">
                Belum masuk: {data.completeness.missing_entities.join(', ')}.
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
            {formatDelta(value)} MoM
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
            {formatDelta(value)} MoM
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
            {data.completeness?.reported_entities ?? 0}/{data.completeness?.expected_entities ?? 0}
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
                {(data.completeness?.expected_entities ?? 0) -
                  (data.completeness?.reported_entities ?? 0)} belum lapor
              </span>
            {/if}
            <p class="text-[11px] text-subtle">entitas disetujui</p>
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
                      <span class="text-[11px] text-muted-foreground tabular-nums">
                        {formatCompact(item.revenue)}
                      </span>
                      <span class="text-[12px] font-semibold text-foreground tabular-nums w-12 text-right">
                        {formatPct(item.share)}
                      </span>
                    {:else}
                      <span class="text-[11px] text-subtle">
                        {item.row ? PERIOD_STATUS_LABEL[item.row.status] : 'belum lapor'}
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
          Konsolidasi {formatPeriod(data.period)}
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
