<script lang="ts">
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const SUMBER_LABEL: Record<string, string> = {
    pengeluaran: 'Pengeluaran',
    honor_telly: 'Honor Telly'
  };

  const fallbackLabel = $derived(
    data.lines.find((line) => line.line_code === data.fallbackCode)?.line_label ??
      data.fallbackCode
  );

  const unmapped = $derived(data.rows.filter((row) => row.pilihan === '').length);
</script>

<svelte:head><title>Pemetaan Biaya · Administrasi · Portal Keuangan</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  {#if form?.message}
    <div class="px-4 py-2.5 bg-destructive/10 border border-destructive/25 rounded-lg" role="alert">
      <p class="text-[13px] text-destructive leading-relaxed">{form.message}</p>
    </div>
  {:else if form?.saved !== undefined}
    <div class="px-4 py-2.5 bg-positive/10 border border-positive/25 rounded-lg" role="status">
      <p class="text-[13px] text-positive leading-relaxed">
        {form.saved === 0 ? 'Tidak ada perubahan.' : `${form.saved} pemetaan disimpan.`} Berlaku untuk
        tarik data berikutnya; angka yang sudah ditarik tidak berubah sampai ditarik ulang.
      </p>
    </div>
  {/if}

  <p class="text-[12px] text-muted-foreground leading-relaxed max-w-[80ch]">
    Menentukan pos laporan untuk setiap jenis biaya dari sistem operasional. Jenis yang belum
    dipetakan masuk <span class="text-foreground">{fallbackLabel}</span> saat tarik data dan
    disebut di layar input. Pilih <span class="text-foreground">Tidak ditarik</span> untuk biaya
    yang sudah tercatat di tempat lain — misalnya gaji admin yang dicatat di Honor Telly
    <em>dan</em> sebagai pengeluaran: pilih salah satu saja, supaya tidak terhitung dua kali.
  </p>

  {#if data.entities.length > 1}
    <div class="flex gap-1 flex-wrap">
      {#each data.entities as entity (entity.id)}
        <a
          href="?entitas={entity.code}"
          class="px-2.5 py-1 rounded-md text-[12px] {entity.id === data.selected?.id
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-muted-foreground hover:bg-card hover:text-foreground'}"
        >
          {entity.code}
        </a>
      {/each}
    </div>
  {/if}

  {#if !data.selected}
    <p class="text-[13px] text-muted-foreground">
      Belum ada entitas yang ditautkan ke sistem operasional.
    </p>
  {:else}
    {#if data.fetchError}
      <div
        class="flex items-start gap-2 px-4 py-2.5 bg-warning/10 border border-warning/25 rounded-lg"
        role="status"
      >
        <TriangleAlert size={14} class="text-warning shrink-0 mt-0.5" />
        <p class="text-[12px] text-warning leading-relaxed">
          Daftar jenis dari sistem operasional tidak dapat diambil: {data.fetchError} Yang tampil hanya
          pemetaan yang sudah tersimpan.
        </p>
      </div>
    {/if}

    {#if data.lines.length === 0}
      <p class="text-[13px] text-warning">
        Lini usaha {data.selected.business_line} belum punya template aktif dengan pos beban
        operasional.
      </p>
    {/if}

    <form method="POST" action="?/save" use:enhance class="bg-card border border-border rounded-lg overflow-hidden">
      <input type="hidden" name="entity_id" value={data.selected.id} />

      <div class="px-4 py-2.5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <h2 class="text-[12px] font-semibold text-foreground uppercase tracking-wider">
          {data.selected.code} · {data.rows.length} jenis
        </h2>
        {#if unmapped > 0}
          <span class="text-[11px] px-1.5 py-0.5 rounded bg-warning/10 text-warning">
            {unmapped} belum dipetakan
          </span>
        {/if}
      </div>

      <div class="overflow-x-auto">
        <table class="w-full min-w-[640px] text-[12px]">
          <thead>
            <tr class="text-muted-foreground border-b border-border">
              <th class="text-left font-medium py-2.5 px-4">Jenis</th>
              <th class="text-left font-medium py-2.5 px-4 w-[110px]">Sumber</th>
              <th class="text-right font-medium py-2.5 px-4 w-[90px]">Baris</th>
              <th class="text-left font-medium py-2.5 px-4 w-[110px]">Terakhir</th>
              <th class="text-left font-medium py-2.5 px-4 w-[260px]">Pos laporan</th>
            </tr>
          </thead>
          <tbody>
            {#each data.rows as row (row.sumber + '\u0000' + row.jenis)}
              <tr class="border-b border-border/40 last:border-b-0">
                <td class="py-2 px-4 text-foreground">
                  {row.jenis}
                  <input type="hidden" name="sumber" value={row.sumber} />
                  <input type="hidden" name="jenis" value={row.jenis} />
                </td>
                <td class="py-2 px-4 text-muted-foreground">{SUMBER_LABEL[row.sumber] ?? row.sumber}</td>
                <td class="py-2 px-4 text-right tabular-nums text-muted-foreground">
                  {row.baris || '—'}
                </td>
                <td class="py-2 px-4 tabular-nums text-muted-foreground">{row.terakhir ?? '—'}</td>
                <td class="py-2 px-4">
                  <select
                    name="pilihan"
                    value={row.pilihan}
                    aria-label="Pos laporan untuk {row.jenis}"
                    class="w-full h-[28px] px-2 bg-background border rounded-lg text-[12px] text-foreground
                           focus:outline-none focus:border-primary
                           {row.pilihan === '' ? 'border-warning/50' : 'border-border'}"
                  >
                    <option value="">Belum dipetakan → {fallbackLabel}</option>
                    <option value="-">Tidak ditarik</option>
                    {#each data.lines as line (line.line_code)}
                      <option value={line.line_code}>{line.line_label}</option>
                    {/each}
                  </select>
                </td>
              </tr>
            {:else}
              <tr>
                <td colspan="5" class="py-6 px-4 text-center text-muted-foreground">
                  Belum ada jenis biaya.
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      {#if data.rows.length > 0}
        <div class="px-4 py-3 border-t border-border">
          <button
            type="submit"
            class="h-[30px] px-4 rounded-lg bg-primary text-[13px] font-medium text-primary-foreground
                   hover:bg-accent transition-colors"
          >
            Simpan pemetaan
          </button>
        </div>
      {/if}
    </form>
  {/if}
</div>
