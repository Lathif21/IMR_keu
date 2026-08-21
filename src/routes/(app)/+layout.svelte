<script lang="ts">
  import Sidebar from '$lib/components/Sidebar.svelte';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
</script>

<div class="flex h-screen bg-background text-foreground">
  <Sidebar role={data.role} fullName={data.fullName} />
  <main class="flex-1 min-w-0">
    {@render children()}
  </main>
</div>
