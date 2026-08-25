<script lang="ts">
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import Plus from 'lucide-svelte/icons/plus';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import X from 'lucide-svelte/icons/x';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  /** Grouped by business line, because that is how a template is chosen: the
      entity's line decides which template its periods get. */
  const groups = $derived.by(() => {
    const map = new Map<string, PageData['templates']>();
    for (const template of data.templates) {
      const key = template.business_line ?? '(berlaku umum)';
      map.set(key, [...(map.get(key) ?? []), template]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  });
</script>

<svelte:head><title>Template · Administrasi · Portal Keuangan</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  {#if form?.message}
    <div class="px-4 py-2.5 bg-destructive/10 border border-destructive/25 rounded-lg" role="alert">
      <p class="text-[13px] text-destructive leading-relaxed">{form.message}</p>
    </div>
  {/if}

  {#if data.creating !== null}
    <form
      method="POST"
      action="?/createTemplate"
      class="bg-card border border-border rounded-lg p-4 space-y-3"
    >
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-[13px] font-semibold text-foreground">Template baru</h2>
        <a href="/admin/templates" class="text-muted-foreground hover:text-foreground" aria-label="Tutup">
          <X size={14} />
        </a>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <label class="block">
          <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">Kode</span>
          <input
            name="code"
            required
            placeholder="AMDK_V1"
            class="w-full h-[30px] px-3 bg-background border border-border rounded-lg text-[13px]
                   text-foreground uppercase focus:outline-none focus:border-primary"
          />
        </label>
        <label class="block sm:col-span-2">
          <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">Nama</span>
          <input
            name="name"
            required
            placeholder="Laporan Laba Rugi — AMDK"
            class="w-full h-[30px] px-3 bg-background border border-border rounded-lg text-[13px]
                   text-foreground focus:outline-none focus:border-primary"
          />
        </label>
        <label class="block">
          <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">Lini usaha</span>
          <input
            name="business_line"
            required
            list="template-lines"
            value={data.creating || ''}
            class="w-full h-[30px] px-3 bg-background border border-border rounded-lg text-[13px]
                   text-foreground focus:outline-none focus:border-primary"
          />
          <datalist id="template-lines">
            {#each data.businessLines as line (line)}<option value={line}></option>{/each}
          </datalist>
        </label>
      </div>

      <label class="block max-w-[420px]">
        <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">Mulai dari</span>
        <select
          name="copy_from"
          class="w-full h-[30px] px-2 bg-background border border-border rounded-lg text-[13px]
                 text-foreground focus:outline-none focus:border-primary"
        >
          <option value="">Kosong — tambahkan baris satu per satu</option>
          {#each data.copyable as option (option.id)}
            <option value={option.id}>Salin dari {option.label}</option>
          {/each}
        </select>
      </label>

      <p class="text-[11px] text-subtle leading-relaxed max-w-[70ch]">
        Jangan mengarang struktur beban pokok untuk lini yang belum divalidasi akuntan. Kalau ini
        template sementara untuk pengujian, tandai di namanya — misalnya
        <span class="text-muted-foreground">"AMDK — Sementara, belum divalidasi"</span>.
      </p>

      <button
        type="submit"
        class="h-[30px] px-4 rounded-lg bg-primary text-[13px] font-medium text-primary-foreground
               hover:bg-accent transition-colors"
      >
        Buat template
      </button>
    </form>
  {:else}
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <p class="text-[12px] text-muted-foreground">
        {data.templates.filter((t) => t.is_active).length} template aktif
      </p>
      <a
        href="?baru"
        class="h-[30px] px-4 rounded-lg bg-primary text-[13px] font-medium text-primary-foreground
               hover:bg-accent transition-colors flex items-center gap-1.5"
      >
        <Plus size={13} />
        Template Baru
      </a>
    </div>
  {/if}

  <!-- Lines that cannot report at all. Shown first: this is the thing that
       actually blocks people. -->
  {#each data.uncoveredLines as line (line)}
    <div
      class="flex items-center justify-between gap-3 flex-wrap px-4 py-3 bg-warning/10
             border border-warning/25 rounded-lg"
      role="status"
    >
      <p class="flex items-start gap-2 text-[13px] text-warning leading-relaxed">
        <TriangleAlert size={14} class="shrink-0 mt-px" />
        <span>
          Lini <span class="font-semibold">{line}</span> belum punya template aktif — entitas di
          lini ini tidak dapat membuat periode sama sekali.
        </span>
      </p>
      <a
        href="?baru={encodeURIComponent(line)}"
        class="h-[28px] px-3 rounded-lg bg-warning/20 text-[12px] font-medium text-warning
               hover:bg-warning/30 transition-colors flex items-center gap-1.5 shrink-0"
      >
        <Plus size={12} />
        Buat Template
      </a>
    </div>
  {/each}

  {#each groups as [line, templates] (line)}
    <div class="bg-card border border-border rounded-lg overflow-hidden">
      <div class="px-4 py-2.5 border-b border-border">
        <h2 class="text-[12px] font-semibold text-foreground uppercase tracking-wider">{line}</h2>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[640px] text-[12px]">
          <thead>
            <tr class="text-muted-foreground border-b border-border">
              <th class="text-left font-medium py-2.5 px-4">Template</th>
              <th class="text-right font-medium py-2.5 px-4 w-[80px]">Versi</th>
              <th class="text-right font-medium py-2.5 px-4 w-[90px]">Baris</th>
              <th class="text-right font-medium py-2.5 px-4 w-[100px]">Periode</th>
              <th class="text-left font-medium py-2.5 px-4 w-[100px]">Status</th>
              <th class="w-[40px]"></th>
            </tr>
          </thead>
          <tbody>
            {#each templates as template (template.id)}
              <tr class="border-b border-border/40 last:border-b-0 {template.is_active ? '' : 'opacity-55'}">
                <td class="py-2.5 px-4">
                  <a
                    href="/admin/templates/{template.id}"
                    class="text-foreground hover:text-primary transition-colors"
                  >
                    <span class="font-medium">{template.code}</span>
                    <span class="text-muted-foreground"> — {template.name}</span>
                  </a>
                </td>
                <td class="py-2.5 px-4 text-right tabular-nums text-muted-foreground">
                  v{template.version}
                </td>
                <td class="py-2.5 px-4 text-right tabular-nums text-muted-foreground">
                  {template.activeLines}
                </td>
                <td class="py-2.5 px-4 text-right tabular-nums text-muted-foreground">
                  {template.periods}
                </td>
                <td class="py-2.5 px-4">
                  <span
                    class="text-[10px] px-1.5 py-0.5 rounded {template.is_active
                      ? 'bg-positive/10 text-positive'
                      : 'bg-muted text-subtle'}"
                  >
                    {template.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                <td class="py-2.5 px-4 text-right">
                  <a
                    href="/admin/templates/{template.id}"
                    class="text-subtle hover:text-foreground inline-flex"
                    aria-label="Buka {template.code}"
                  >
                    <ChevronRight size={14} />
                  </a>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/each}
</div>
