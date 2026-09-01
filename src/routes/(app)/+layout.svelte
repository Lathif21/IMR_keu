<script lang="ts">
  import Menu from 'lucide-svelte/icons/menu';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

  /**
   * Seeded from the cookie, then owned by the client. Deliberately the initial
   * value and not a `$derived`: after the first render the toggle is the
   * source of truth, and re-deriving from `data` would snap the rail back open
   * on the next navigation that re-runs `load`.
   */
  // svelte-ignore state_referenced_locally
  let collapsed = $state(data.sidebarCollapsed);

  /** Below `md` only. Always starts shut; nobody wants a menu they didn't open. */
  let menuOpen = $state(false);

  /**
   * Escape closes the drawer. It is the one key everybody tries on an overlay,
   * and without it a keyboard user has to tab all the way to the close button.
   */
  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && menuOpen) menuOpen = false;
  }
</script>

<svelte:window {onkeydown} />

<div class="flex h-screen bg-background text-foreground">
  <Sidebar
    role={data.role}
    fullName={data.fullName}
    theme={data.theme}
    bind:collapsed
    open={menuOpen}
    onclose={() => (menuOpen = false)}
  />

  <div class="flex-1 min-w-0 flex flex-col">
    <!-- Mobile only. Every screen already carries its own 48px header, so on
         desktop a second bar would be a stripe of wasted vertical space; below
         `md` it is the only thing holding the way back to the menu. -->
    <div
      class="md:hidden h-12 shrink-0 flex items-center gap-2 px-3 border-b border-border bg-background"
    >
      <button
        type="button"
        onclick={() => (menuOpen = true)}
        aria-label="Buka menu"
        aria-expanded={menuOpen}
        class="p-1.5 -ml-1.5 rounded-md text-muted-foreground hover:text-foreground
               hover:bg-card transition-colors"
      >
        <Menu size={18} />
      </button>
      <p class="text-[12px] font-semibold text-foreground truncate">Portal Keuangan</p>
    </div>

    <!-- `min-h-0` matters: the pages inside are `h-full` with their own
         scrolling regions, and a flex child defaults to min-height:auto, which
         would let a long table push the page instead of scrolling inside it. -->
    <main class="flex-1 min-h-0 min-w-0">
      {@render children()}
    </main>
  </div>
</div>
