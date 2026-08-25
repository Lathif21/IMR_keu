<script lang="ts">
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import ChevronDown from 'lucide-svelte/icons/chevron-down';
  import ChevronUp from 'lucide-svelte/icons/chevron-up';
  import Copy from 'lucide-svelte/icons/copy';
  import Lock from 'lucide-svelte/icons/lock';
  import Plus from 'lucide-svelte/icons/plus';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import { LINE_SECTION_LABEL, LINE_SECTION_ORDER, type LineSection } from '$lib/domain';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const frozen = $derived(data.frozenCount > 0);
  const used = $derived(new Set(data.usedLineCodes));

  /** Lines in the order the statement reads, section by section. */
  const bySection = $derived.by(() => {
    const out: { section: LineSection; lines: PageData['lines'] }[] = [];
    for (const section of LINE_SECTION_ORDER) {
      const lines = data.lines
        .filter((line) => line.section === section)
        .sort((a, b) => a.sort_order - b.sort_order);
      out.push({ section, lines });
    }
    return out;
  });

  /** Flat order, for the up/down buttons: moving is a swap with a neighbour. */
  const ordered = $derived([...data.lines].sort((a, b) => a.sort_order - b.sort_order));

  /**
   * Which subtotal follows which section on the input screen. Derived from
   * the section order rather than restated, so the preview cannot drift from
   * what `/entry` actually renders.
   */
  const SUBTOTAL_AFTER: Partial<Record<LineSection, string>> = {
    cogs: 'Laba Kotor',
    opex: 'Laba Operasi',
    tax: 'Laba Bersih'
  };
</script>

<svelte:head>
  <title>{data.template.code} · Template · Portal Keuangan</title>
</svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  <div class="flex items-start justify-between gap-3 flex-wrap">
    <div class="flex items-start gap-3 min-w-0">
      <a
        href="/admin/templates"
        class="text-muted-foreground hover:text-foreground mt-0.5 shrink-0"
        aria-label="Kembali ke daftar template"
      >
        <ArrowLeft size={14} />
      </a>
      <div class="min-w-0">
        <h1 class="text-[13px] font-semibold text-foreground">
          {data.template.code}
          <span class="text-muted-foreground font-normal">v{data.template.version}</span>
        </h1>
        <p class="text-[11px] text-muted-foreground truncate">
          {data.template.name} · lini {data.template.business_line ?? 'umum'}
        </p>
      </div>
    </div>

    <div class="flex items-center gap-2 shrink-0">
      <form method="POST" action="?/toggleTemplate">
        <input type="hidden" name="is_active" value={(!data.template.is_active).toString()} />
        <button
          type="submit"
          class="h-[28px] px-3 rounded-lg border border-border text-[12px] text-muted-foreground
                 hover:text-foreground hover:bg-muted transition-colors"
        >
          {data.template.is_active ? 'Nonaktifkan' : 'Aktifkan'}
        </button>
      </form>
      <form method="POST" action="?/duplicate">
        <button
          type="submit"
          class="h-[28px] px-3 rounded-lg bg-primary text-[12px] font-medium text-primary-foreground
                 hover:bg-accent transition-colors flex items-center gap-1.5"
        >
          <Copy size={12} />
          Duplikat ke v{data.template.version + 1}
        </button>
      </form>
    </div>
  </div>

  {#if form?.message}
    <div class="px-4 py-2.5 bg-destructive/10 border border-destructive/25 rounded-lg" role="alert">
      <p class="text-[13px] text-destructive leading-relaxed">{form.message}</p>
    </div>
  {/if}

  <!-- The single most important thing on this screen. -->
  {#if frozen}
    <div
      class="flex items-start gap-3 px-4 py-2.5 bg-warning/10 border border-warning/25 rounded-lg"
      role="status"
    >
      <Lock size={14} class="text-warning shrink-0 mt-px" />
      <p class="text-[13px] text-warning flex-1 leading-relaxed">
        Dipakai {data.frozenCount} periode yang sudah keluar dari draft — perubahan memerlukan versi
        baru. Mengubah bagian sebuah baris akan memindahkan nominal historis antar-pos di seluruh
        periode yang pernah memakai template ini, termasuk yang sudah dikunci, tanpa satu pun error.
      </p>
    </div>
  {:else}
    <p class="text-[12px] text-muted-foreground">
      Belum dipakai periode non-draft — dapat diubah langsung.
    </p>
  {/if}

  <div class="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-4">
    <!-- ── editor ─────────────────────────────────────────────────── -->
    <div class="bg-card border border-border rounded-lg overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[620px] text-[12px]">
          <thead>
            <tr class="text-muted-foreground border-b border-border">
              <th class="text-left font-medium py-2.5 px-4">Pos</th>
              <th class="text-left font-medium py-2.5 px-4 w-[150px]">Kode</th>
              <th class="text-right font-medium py-2.5 px-4 w-[150px]">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {#each bySection as group (group.section)}
              {#if group.lines.length > 0}
                <tr class="bg-muted/30 border-b border-border">
                  <td colspan="3" class="py-2 px-4 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {LINE_SECTION_LABEL[group.section]}
                  </td>
                </tr>
              {/if}
              {#each group.lines as line (line.id)}
                {@const at = ordered.findIndex((l) => l.id === line.id)}
                <tr class="border-b border-border/40 {line.is_active ? '' : 'opacity-50'}">
                  <td class="py-2 px-4">
                    <span class="text-foreground">{line.line_label}</span>
                    {#if line.help_text}
                      <span class="block text-[11px] text-warning/70 mt-0.5 leading-snug">
                        {line.help_text}
                      </span>
                    {/if}
                  </td>
                  <td class="py-2 px-4">
                    <span class="text-[11px] tabular-nums text-muted-foreground">
                      {line.line_code}
                    </span>
                    {#if used.has(line.line_code)}
                      <!-- Renaming this would strand the figures already filed
                           under it: they stay in report_lines but become
                           unreachable, and v_period_pnl loses their section. -->
                      <span class="block text-[10px] text-subtle">sudah dipakai · kode terkunci</span>
                    {/if}
                  </td>
                  <td class="py-2 px-4">
                    <div class="flex items-center justify-end gap-1">
                      {#if !frozen}
                        <form method="POST" action="?/moveLine">
                          <input type="hidden" name="line_id" value={line.id} />
                          <input type="hidden" name="swap_with" value={ordered[at - 1]?.id ?? ''} />
                          <button
                            type="submit"
                            disabled={at === 0}
                            aria-label="Naikkan {line.line_label}"
                            class="p-1 rounded text-muted-foreground hover:bg-muted hover:text-foreground
                                   disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                          >
                            <ChevronUp size={13} />
                          </button>
                        </form>
                        <form method="POST" action="?/moveLine">
                          <input type="hidden" name="line_id" value={line.id} />
                          <input type="hidden" name="swap_with" value={ordered[at + 1]?.id ?? ''} />
                          <button
                            type="submit"
                            disabled={at === ordered.length - 1}
                            aria-label="Turunkan {line.line_label}"
                            class="p-1 rounded text-muted-foreground hover:bg-muted hover:text-foreground
                                   disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                          >
                            <ChevronDown size={13} />
                          </button>
                        </form>
                        <form method="POST" action="?/toggleLine">
                          <input type="hidden" name="line_id" value={line.id} />
                          <input type="hidden" name="is_active" value={(!line.is_active).toString()} />
                          <button
                            type="submit"
                            class="px-2 py-1 rounded text-[11px] text-muted-foreground hover:bg-muted
                                   hover:text-foreground transition-colors"
                          >
                            {line.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                          </button>
                        </form>
                      {:else}
                        <span class="text-[11px] text-subtle">terkunci</span>
                      {/if}
                    </div>
                  </td>
                </tr>

                {#if !frozen}
                  <tr class="border-b border-border/40">
                    <td colspan="3" class="px-4 pb-2.5">
                      <form method="POST" action="?/updateLine" class="flex items-end gap-2 flex-wrap">
                        <input type="hidden" name="line_id" value={line.id} />
                        <label class="block flex-1 min-w-[160px]">
                          <span class="block text-[10px] text-subtle mb-1">Nama pos</span>
                          <input
                            name="line_label"
                            value={line.line_label}
                            required
                            class="w-full h-[26px] px-2 bg-background border border-border rounded text-[12px]
                                   text-foreground focus:outline-none focus:border-primary"
                          />
                        </label>
                        <label class="block w-[150px]">
                          <span class="block text-[10px] text-subtle mb-1">Bagian</span>
                          <select
                            name="section"
                            class="w-full h-[26px] px-1 bg-background border border-border rounded text-[12px]
                                   text-foreground focus:outline-none focus:border-primary"
                          >
                            {#each LINE_SECTION_ORDER as section (section)}
                              <option value={section} selected={section === line.section}>
                                {LINE_SECTION_LABEL[section]}
                              </option>
                            {/each}
                          </select>
                        </label>
                        <label class="block flex-1 min-w-[160px]">
                          <span class="block text-[10px] text-subtle mb-1">Panduan (opsional)</span>
                          <input
                            name="help_text"
                            value={line.help_text ?? ''}
                            class="w-full h-[26px] px-2 bg-background border border-border rounded text-[12px]
                                   text-foreground focus:outline-none focus:border-primary"
                          />
                        </label>
                        <button
                          type="submit"
                          class="h-[26px] px-3 rounded border border-border text-[11px] text-muted-foreground
                                 hover:text-foreground hover:bg-muted transition-colors"
                        >
                          Simpan
                        </button>
                      </form>
                    </td>
                  </tr>
                {/if}
              {/each}
            {/each}

            {#if data.lines.length === 0}
              <tr>
                <td colspan="3" class="py-5 px-4 text-[12px] text-muted-foreground">
                  Template ini belum punya baris. Tambahkan minimal satu baris pendapatan sebelum
                  mengaktifkannya.
                </td>
              </tr>
            {/if}
          </tbody>
        </table>
      </div>

      {#if !frozen}
        <form
          method="POST"
          action="?/addLine"
          class="border-t border-border p-4 flex items-end gap-2 flex-wrap"
        >
          <label class="block flex-1 min-w-[150px]">
            <span class="block text-[10px] text-subtle mb-1">Nama pos</span>
            <input
              name="line_label"
              required
              placeholder="Bagian Rekanan"
              class="w-full h-[28px] px-2 bg-background border border-border rounded text-[12px]
                     text-foreground focus:outline-none focus:border-primary"
            />
          </label>
          <label class="block w-[150px]">
            <span class="block text-[10px] text-subtle mb-1">Kode</span>
            <input
              name="line_code"
              required
              placeholder="COGS_REKANAN"
              class="w-full h-[28px] px-2 bg-background border border-border rounded text-[12px]
                     text-foreground uppercase tabular-nums focus:outline-none focus:border-primary"
            />
          </label>
          <label class="block w-[150px]">
            <span class="block text-[10px] text-subtle mb-1">Bagian</span>
            <select
              name="section"
              class="w-full h-[28px] px-1 bg-background border border-border rounded text-[12px]
                     text-foreground focus:outline-none focus:border-primary"
            >
              {#each LINE_SECTION_ORDER as section (section)}
                <option value={section}>{LINE_SECTION_LABEL[section]}</option>
              {/each}
            </select>
          </label>
          <button
            type="submit"
            class="h-[28px] px-3 rounded-lg bg-primary text-[12px] font-medium text-primary-foreground
                   hover:bg-accent transition-colors flex items-center gap-1.5"
          >
            <Plus size={12} />
            Tambah baris
          </button>
        </form>
      {/if}
    </div>

    <!-- ── preview ────────────────────────────────────────────────── -->
    <div class="bg-card border border-border rounded-lg overflow-hidden self-start">
      <div class="px-4 py-2.5 border-b border-border">
        <h2 class="text-[12px] font-semibold text-foreground">Pratinjau layar input</h2>
        <!-- Not decoration. The shape of a statement is hard to judge from a
             configuration table, and a section put in the wrong place is only
             felt months later when gross profit looks strange. -->
        <p class="text-[10px] text-subtle mt-0.5">
          Bentuk yang akan dilihat staf. Tidak ada angka di sini — subtotal diturunkan dari
          struktur, bukan dari nilai.
        </p>
      </div>

      <div class="p-4 space-y-1">
        {#each bySection as group (group.section)}
          {@const active = group.lines.filter((l) => l.is_active)}
          {#if active.length > 0}
            <p class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider pt-2">
              {LINE_SECTION_LABEL[group.section]}
            </p>
            {#each active as line (line.id)}
              <div class="flex items-center justify-between gap-3 pl-3 py-1">
                <span class="text-[12px] text-foreground truncate">{line.line_label}</span>
                <span class="h-[18px] w-[80px] rounded bg-muted shrink-0"></span>
              </div>
            {/each}
          {/if}
          {#if SUBTOTAL_AFTER[group.section]}
            <div
              class="flex items-center justify-between gap-3 py-1.5 border-t border-border-strong mt-1"
            >
              <span class="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
                <Lock size={10} class="text-subtle" />
                Total {SUBTOTAL_AFTER[group.section]}
              </span>
              <span class="h-[18px] w-[80px] rounded bg-muted/50 shrink-0"></span>
            </div>
          {/if}
        {/each}

        {#if data.lines.filter((l) => l.is_active && l.section === 'revenue').length === 0}
          <p class="flex items-start gap-1.5 text-[11px] text-warning pt-3 leading-relaxed">
            <TriangleAlert size={12} class="shrink-0 mt-px" />
            Belum ada baris pendapatan. Template tanpa pendapatan menghasilkan laporan yang seluruh
            marginnya kosong, dan tidak dapat diaktifkan.
          </p>
        {/if}
      </div>
    </div>
  </div>
</div>
