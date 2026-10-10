<script lang="ts">
  import FileDown from 'lucide-svelte/icons/file-down';
  import FileUp from 'lucide-svelte/icons/file-up';
  import { onMount } from 'svelte';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';

  /**
   * Unduh template Excel dan unggah kembali. Komponen tersendiri supaya layar
   * input tidak bertambah panjang; ia hanya menempel di kepala layar.
   */
  let { month, entity, editable }: { month: string; entity: string; editable: boolean } = $props();

  const STORAGE_KEY = 'imr-impor-excel';
  let busy = $state(false);
  let error = $state<string | null>(null);
  let done = $state<string | null>(null);
  let input = $state<HTMLInputElement>();

  /**
   * Setelah impor, halaman dimuat ulang penuh: angka di form adalah state
   * lokal yang diisi sekali dari data, jadi memuat ulang adalah cara pasti
   * supaya yang tampil sama dengan yang tersimpan. Pesannya dititipkan ke
   * sessionStorage agar tetap terbaca sesudah reload.
   */
  onMount(() => {
    try {
      done = sessionStorage.getItem(STORAGE_KEY);
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* penyimpanan diblokir: pesan dilewati, angkanya tetap benar */
    }
  });

  const submit: SubmitFunction = ({ cancel }) => {
    error = null;
    done = null;
    if (!input?.files?.length) {
      cancel();
      return;
    }
    if (!confirm('Angka dari file Excel akan menggantikan angka pos yang terisi di file. Lanjutkan?')) {
      cancel();
      if (input) input.value = '';
      return;
    }
    busy = true;
    return async ({ result }) => {
      busy = false;
      if (input) input.value = '';
      if (result.type === 'success') {
        const d = result.data as { imported: number; unchanged: number; skipped: number; fileName: string };
        const pesan =
          (d.imported > 0
            ? `${d.imported} pos diisi dari ${d.fileName}.`
            : `Tidak ada angka yang berbeda di ${d.fileName}.`) +
          (d.unchanged > 0 ? ` ${d.unchanged} pos sama dengan yang tersimpan.` : '') +
          (d.skipped > 0 ? ` ${d.skipped} pos dengan Jumlah kosong tidak diubah.` : '') +
          ' Periksa angkanya, lalu ajukan seperti biasa.';
        try {
          sessionStorage.setItem(STORAGE_KEY, pesan);
        } catch {
          /* lihat onMount */
        }
        location.reload();
      } else if (result.type === 'failure') {
        error = String((result.data as { message?: string } | undefined)?.message ?? 'Impor gagal.');
      } else if (result.type === 'error') {
        error = 'Impor gagal. Coba lagi.';
      }
    };
  };
</script>

<div class="flex items-center gap-2 shrink-0">
  <a
    href="/entry/{month}/excel?entitas={encodeURIComponent(entity)}"
    download
    title="Unduh laporan periode ini sebagai Excel, untuk diisi atau diarsipkan"
    class="px-3 py-1.5 rounded-lg bg-card border border-border text-[12px] font-medium
           text-muted-foreground hover:text-foreground hover:bg-muted transition-colors
           flex items-center gap-1.5"
  >
    <FileDown size={12} />
    Unduh Excel
  </a>

  {#if editable}
    <form method="POST" action="?/importExcel" enctype="multipart/form-data" use:enhance={submit}>
      <input type="hidden" name="entitas" value={entity} />
      <label
        title="Isi laporan dari file Excel hasil Unduh Excel"
        class="px-3 py-1.5 rounded-lg bg-card border border-border text-[12px] font-medium
               text-muted-foreground hover:text-foreground hover:bg-muted transition-colors
               flex items-center gap-1.5 cursor-pointer {busy ? 'opacity-60 pointer-events-none' : ''}"
      >
        <FileUp size={12} />
        {busy ? 'Mengimpor…' : 'Unggah Excel'}
        <input
          bind:this={input}
          type="file"
          name="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          class="sr-only"
          onchange={(event) => event.currentTarget.form?.requestSubmit()}
        />
      </label>
    </form>
  {/if}
</div>

{#if error || done}
  <div
    class="fixed bottom-20 right-5 z-40 max-w-[420px] px-4 py-3 rounded-lg border shadow-lg text-[12px] leading-relaxed
           bg-card {error ? 'border-destructive/40 text-destructive' : 'border-positive/40 text-positive'}"
    role={error ? 'alert' : 'status'}
  >
    <div class="flex items-start gap-3">
      <p class="flex-1">{error ?? done}</p>
      <button
        type="button"
        class="text-[11px] underline opacity-80 hover:opacity-100"
        onclick={() => ((error = null), (done = null))}
      >
        Tutup
      </button>
    </div>
  </div>
{/if}
