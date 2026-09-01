<script lang="ts">
  import ChartColumn from 'lucide-svelte/icons/chart-column';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import { parseTheme } from '$lib/theme';
  import type { ActionData } from './$types';

  let { form }: { form: ActionData } = $props();
</script>

<svelte:head><title>Masuk · Portal Keuangan</title></svelte:head>

<main class="min-h-screen flex items-center justify-center bg-background px-4">
  <div class="w-full max-w-[360px]">
    <div class="flex items-center gap-2.5 mb-6">
      <div class="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
        <ChartColumn size={17} class="text-primary-foreground" />
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-[14px] font-semibold text-foreground leading-tight">Portal Keuangan</p>
        <p class="text-[11px] text-muted-foreground">Grup Holding</p>
      </div>
      <!-- The one screen every user meets before there is a sidebar to put
           this in; without it the preference is unreachable until you log in. -->
      <ThemeToggle theme={parseTheme(page.data.theme)} variant="icon" />
    </div>

    <form method="POST" use:enhance class="bg-card border border-border rounded-lg p-5 space-y-4">
      <div class="space-y-1.5">
        <label for="email" class="block text-[12px] font-medium text-muted-foreground">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autocomplete="username"
          required
          value={form?.email ?? ''}
          class="w-full h-9 px-3 rounded-md bg-background border border-border text-[13px] text-foreground
                 placeholder:text-subtle focus:outline-none focus:border-primary"
        />
      </div>

      <div class="space-y-1.5">
        <label for="password" class="block text-[12px] font-medium text-muted-foreground">Kata sandi</label>
        <input
          id="password"
          name="password"
          type="password"
          autocomplete="current-password"
          required
          class="w-full h-9 px-3 rounded-md bg-background border border-border text-[13px] text-foreground
                 focus:outline-none focus:border-primary"
        />
      </div>

      {#if form?.message}
        <p class="flex items-start gap-2 text-[12px] text-destructive" role="alert">
          <TriangleAlert size={13} class="shrink-0 mt-px" />
          {form.message}
        </p>
      {/if}

      <button
        type="submit"
        class="w-full h-9 rounded-md bg-primary text-primary-foreground text-[13px] font-medium
               hover:bg-accent transition-colors"
      >
        Masuk
      </button>
    </form>

    <p class="mt-4 text-[11px] text-subtle leading-relaxed">
      Akses diberikan oleh direksi. Hubungi administrator bila Anda belum memiliki akun.
    </p>
  </div>
</main>
