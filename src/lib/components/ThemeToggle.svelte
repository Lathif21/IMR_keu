<script lang="ts">
  import Moon from 'lucide-svelte/icons/moon';
  import Sun from 'lucide-svelte/icons/sun';
  import { applyTheme, type Theme } from '$lib/theme';

  let {
    theme,
    /**
     * Rail mode hides the label, exactly as the nav items do — and like them
     * only from `md` up, since below that the sidebar is a drawer that always
     * shows labels.
     */
    collapsed = false,
    /**
     * `nav` matches the sidebar items it sits among. `icon` is for screens
     * with no sidebar — the login page — where a full-width row of chrome
     * would outweigh the form it sits above.
     */
    variant = 'nav'
  }: { theme: Theme; collapsed?: boolean; variant?: 'nav' | 'icon' } = $props();

  /**
   * Seeded from the cookie, then owned by the client — the same arrangement as
   * the sidebar rail. Re-deriving from `data` would snap the toggle back on
   * the next navigation that re-runs `load`.
   */
  // svelte-ignore state_referenced_locally
  let current = $state<Theme>(theme);

  function toggle() {
    current = current === 'dark' ? 'light' : 'dark';
    applyTheme(current);
  }

  const label = $derived(current === 'dark' ? 'Mode terang' : 'Mode gelap');
</script>

<button
  type="button"
  onclick={toggle}
  title={label}
  aria-label={label}
  class="flex items-center gap-2.5 rounded-md text-[13px]
         text-muted-foreground hover:bg-card hover:text-foreground transition-colors
         {variant === 'icon'
    ? 'h-8 w-8 justify-center shrink-0'
    : `w-full px-3 py-[7px] ${collapsed ? 'md:justify-center md:px-0' : ''}`}"
>
  {#if current === 'dark'}
    <Sun size={14} class="shrink-0" />
  {:else}
    <Moon size={14} class="shrink-0" />
  {/if}
  {#if variant === 'nav'}
    <span class="truncate {collapsed ? 'md:hidden' : ''}">{label}</span>
  {/if}
</button>
