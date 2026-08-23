<script lang="ts">
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import {
    PERIOD_STATUS_LABEL,
    REPORTING_BASIS_LABEL,
    REVENUE_PRESENTATION_LABEL
  } from '$lib/domain';
  import { NO_DATA, formatCompact, formatPeriod, periodToMonth } from '$lib/format';
  import { entityIcon } from '$lib/icons';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Laporan P&L · Portal Keuangan</title></svelte:head>

<div class="flex flex-col h-full overflow-hidden">
  <div class="h-12 flex items-center justify-between px-5 border-b border-border shrink-0 gap-4">
    <div class="flex items-center gap-3 min-w-0">
      <h1 class="text-[13px] font-semibold text-foreground shrink-0">Laporan P&L</h1>
      <span class="text-[11px] text-muted-foreground truncate">Pilih entitas</span>
    </div>
  </div>

  <div class="flex-1 overflow-y-auto p-5">
    {#if data.cards.length === 0}
      <div class="max-w-[520px] bg-card border border-border rounded-lg p-5">
        <h2 class="text-[13px] font-semibold text-foreground mb-2">Tidak ada entitas</h2>
        <p class="text-[12px] text-muted-foreground leading-relaxed">
          Akun Anda belum ditautkan ke entitas mana pun. Hubungi direksi.
        </p>
      </div>
    {:else}
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {#each data.cards as card (card.entity.id)}
          {@const Icon = entityIcon(card.entity.icon_key)}
          {@const target = card.latest}
          {@const href = target
            ? `/entities/${card.entity.id}/periods/${periodToMonth(target.period)}`
            : null}
          {@const basisUnknown =
            card.entity.reporting_basis === 'unknown' ||
            card.entity.revenue_presentation === 'unknown'}

          <svelte:element
            this={href ? 'a' : 'div'}
            href={href ?? undefined}
            class="block bg-card border border-border rounded-lg p-4 transition-colors
                   {href ? 'hover:border-border-strong' : ''}"
          >
            <div class="flex items-start justify-between gap-3 mb-3">
              <div class="flex items-center gap-2.5 min-w-0">
                <div
                  class="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                  style:background-color="{card.entity.theme_color}1a"
                >
                  <Icon size={14} style="color: {card.entity.theme_color}" />
                </div>
                <div class="min-w-0">
                  <p class="text-[13px] font-semibold text-foreground truncate">
                    {card.entity.code}
                  </p>
                  <p class="text-[11px] text-muted-foreground truncate">
                    {card.entity.legal_name}
                  </p>
                </div>
              </div>
              {#if href}
                <ChevronRight size={14} class="text-subtle shrink-0 mt-1" />
              {/if}
            </div>

            <div class="flex flex-wrap items-center gap-1.5 mb-3">
              <span
                class="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wide"
              >
                {card.entity.business_line}
              </span>
              <!-- Reporting basis is on the card, not only inside the report.
                   Two entities on different bases are not comparable, and this
                   screen is the one that puts them side by side (CONTEXT.md). -->
              <span
                class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded
                       {basisUnknown
                  ? 'bg-warning/10 text-warning'
                  : 'bg-muted text-muted-foreground'}"
                title={REVENUE_PRESENTATION_LABEL[card.entity.revenue_presentation]}
              >
                {#if basisUnknown}<TriangleAlert size={9} />{/if}
                {REPORTING_BASIS_LABEL[card.entity.reporting_basis]}
              </span>
            </div>

            {#if card.lastApproved}
              <p class="text-[11px] text-muted-foreground mb-0.5">
                Laba bersih {formatPeriod(card.lastApproved.period)}
              </p>
              <p class="text-[18px] font-semibold text-foreground tabular-nums leading-none">
                {formatCompact(card.lastApproved.net_profit)}
              </p>
              <p class="text-[11px] text-subtle mt-1.5">
                {card.periodCount} periode tercatat
                {#if card.latest && card.latest.period !== card.lastApproved.period}
                  · terbaru {formatPeriod(card.latest.period)}
                  ({PERIOD_STATUS_LABEL[card.latest.status]})
                {/if}
              </p>
            {:else if card.latest}
              <p class="text-[11px] text-muted-foreground mb-0.5">
                Belum ada periode yang disetujui
              </p>
              <p class="text-[18px] font-semibold text-subtle tabular-nums leading-none">
                {NO_DATA}
              </p>
              <p class="text-[11px] text-subtle mt-1.5">
                Terbaru {formatPeriod(card.latest.period)}
                ({PERIOD_STATUS_LABEL[card.latest.status]})
              </p>
            {:else}
              <p class="text-[11px] text-muted-foreground mb-0.5">Belum ada laporan</p>
              <p class="text-[18px] font-semibold text-subtle tabular-nums leading-none">
                {NO_DATA}
              </p>
            {/if}
          </svelte:element>
        {/each}
      </div>
    {/if}
  </div>
</div>
