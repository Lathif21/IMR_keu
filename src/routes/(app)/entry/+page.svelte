<script lang="ts">
  import CircleCheckBig from 'lucide-svelte/icons/circle-check-big';
  import Lock from 'lucide-svelte/icons/lock';
  import Plus from 'lucide-svelte/icons/plus';
  import { PERIOD_STATUS_LABEL, type PeriodStatus } from '$lib/domain';
  import { formatDateTime, formatPeriod, periodToMonth } from '$lib/format';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  /** Same palette rules as src/app.css: draft and submitted are in progress,
      approved is a good outcome, locked is final and neutral. */
  const STATUS_CLASS: Record<PeriodStatus, string> = {
    draft: 'bg-muted text-muted-foreground',
    submitted: 'bg-primary/10 text-primary',
    approved: 'bg-positive/10 text-positive',
    locked: 'bg-muted text-subtle'
  };
</script>

<svelte:head><title>Input Laporan · Portal Keuangan</title></svelte:head>

{#if data.wrongRole}
  <div class="flex flex-col h-full">
    <div class="h-12 flex items-center px-5 border-b border-border shrink-0">
      <h1 class="text-[13px] font-semibold text-foreground">Input Laporan</h1>
    </div>
    <div class="flex-1 p-5">
      <div class="max-w-[520px] bg-card border border-border rounded-lg p-5">
        <div class="flex items-center gap-2 mb-2">
          <Lock size={14} class="text-muted-foreground" />
          <h2 class="text-[13px] font-semibold text-foreground">Tidak tersedia untuk peran Anda</h2>
        </div>
        <p class="text-[12px] text-muted-foreground leading-relaxed">
          Laporan diisi oleh staf entitas. Peran Anda membaca dan menyetujui laporan yang sudah
          diajukan, bukan mengisinya.
        </p>
      </div>
    </div>
  </div>
{:else if !data.selected}
  <div class="flex flex-col h-full">
    <div class="h-12 flex items-center px-5 border-b border-border shrink-0">
      <h1 class="text-[13px] font-semibold text-foreground">Input Laporan</h1>
    </div>
    <div class="flex-1 p-5">
      <div class="max-w-[520px] bg-card border border-border rounded-lg p-5">
        <h2 class="text-[13px] font-semibold text-foreground mb-2">Belum ada entitas</h2>
        <p class="text-[12px] text-muted-foreground leading-relaxed">
          Akun Anda belum ditautkan ke entitas mana pun. Hubungi direksi.
        </p>
      </div>
    </div>
  </div>
{:else}
  <div class="flex flex-col h-full overflow-hidden">
    <!-- header · 48px -->
    <div class="h-12 flex items-center justify-between px-5 border-b border-border shrink-0 gap-4">
      <div class="flex items-center gap-3 min-w-0">
        <h1 class="text-[13px] font-semibold text-foreground shrink-0">Input Laporan</h1>
        <span class="text-[11px] text-muted-foreground truncate">{data.selected.legal_name}</span>
      </div>

      <!-- Entity picker only when there is a choice to make. The value is
           matched against the access list on the server; it selects, it does
           not grant. -->
      {#if data.entities.length > 1}
        <form method="GET" class="flex items-center gap-2 shrink-0">
          <label for="entitas" class="sr-only">Entitas</label>
          <select
            id="entitas"
            name="entitas"
            class="h-[30px] pl-3 pr-2 bg-card border border-border rounded-lg text-[13px] text-foreground
                   hover:bg-muted transition-colors focus:outline-none focus:border-primary"
            onchange={(event) => event.currentTarget.form?.requestSubmit()}
          >
            {#each data.entities as option (option.id)}
              <option value={option.code} selected={option.code === data.selected.code}>
                {option.code}
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

    <div class="flex-1 overflow-y-auto p-5 space-y-4">
      {#if data.submittedPeriod}
        <div
          class="flex items-start gap-3 px-4 py-2.5 bg-positive/10 border border-positive/25 rounded-lg"
          role="status"
        >
          <CircleCheckBig size={14} class="text-positive shrink-0 mt-px" />
          <p class="text-[13px] text-positive flex-1 leading-relaxed">
            Laporan {formatPeriod(data.submittedPeriod + '-01')} sudah diajukan dan menunggu
            persetujuan. Barisnya tidak dapat diubah lagi sampai dikembalikan ke draft.
          </p>
        </div>
      {/if}

      {#if form?.message}
        <div
          class="px-4 py-2.5 bg-destructive/10 border border-destructive/25 rounded-lg"
          role="alert"
        >
          <p class="text-[13px] text-destructive leading-relaxed">{form.message}</p>
        </div>
      {/if}

      <!-- New period. The month is a suggestion, not a constraint: an entity
           catching up on an older month picks it here. -->
      <form
        method="POST"
        action="?/createPeriod"
        class="flex flex-wrap items-end gap-3 bg-card border border-border rounded-lg p-4"
      >
        <input type="hidden" name="entitas" value={data.selected.code} />
        <div>
          <label for="bulan" class="block text-[11px] font-medium text-muted-foreground mb-1.5">
            Bulan laporan
          </label>
          <input
            id="bulan"
            name="bulan"
            type="month"
            required
            value={data.defaultMonth}
            class="h-[30px] px-3 bg-background border border-border rounded-lg text-[13px] text-foreground
                   tabular-nums focus:outline-none focus:border-primary"
          />
        </div>
        <button
          type="submit"
          class="h-[30px] px-4 rounded-lg bg-primary text-[13px] font-medium text-primary-foreground
                 hover:bg-accent transition-colors flex items-center gap-1.5"
        >
          <Plus size={13} />
          Buat Periode Baru
        </button>
        <p class="text-[11px] text-subtle flex-1 min-w-[220px] leading-relaxed">
          Periode baru selalu lahir sebagai draft. Template laporan diambil dari lini usaha
          {data.selected.business_line}.
        </p>
      </form>

      <div class="bg-card border border-border rounded-lg overflow-hidden">
        {#if data.periods.length === 0}
          <p class="text-[12px] text-muted-foreground leading-relaxed p-5">
            Belum ada periode untuk {data.selected.code}. Buat periode pertama di atas.
          </p>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full text-[12px]">
              <thead>
                <tr class="text-muted-foreground border-b border-border">
                  <th class="text-left font-medium py-2.5 px-4">Periode</th>
                  <th class="text-left font-medium py-2.5 px-4 w-[120px]">Status</th>
                  <th class="text-left font-medium py-2.5 px-4 w-[180px]">Terakhir diubah</th>
                  <th class="text-right font-medium py-2.5 px-4 w-[100px]">Aksi</th>
                </tr>
              </thead>
              <tbody class="text-foreground">
                {#each data.periods as row (row.id)}
                  <tr class="border-b border-border/40 last:border-b-0">
                    <td class="py-2.5 px-4 text-[13px]">{formatPeriod(row.period)}</td>
                    <td class="py-2.5 px-4">
                      <span
                        class="inline-flex items-center text-[11px] font-medium px-1.5 py-0.5 rounded
                               {STATUS_CLASS[row.status]}"
                      >
                        {PERIOD_STATUS_LABEL[row.status]}
                      </span>
                    </td>
                    <td class="py-2.5 px-4 text-muted-foreground">
                      {formatDateTime(row.updated_at)}
                    </td>
                    <td class="py-2.5 px-4 text-right">
                      <a
                        href="/entry/{periodToMonth(row.period)}?entitas={encodeURIComponent(
                          data.selected.code
                        )}"
                        class="text-[13px] font-medium text-primary hover:underline"
                      >
                        {row.status === 'draft' ? 'Isi' : 'Lihat'}
                      </a>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
