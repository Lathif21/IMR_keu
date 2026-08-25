<script lang="ts">
  import ChartColumn from 'lucide-svelte/icons/chart-column';
  import ChevronLeft from 'lucide-svelte/icons/chevron-left';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import CircleCheckBig from 'lucide-svelte/icons/circle-check-big';
  import ClipboardList from 'lucide-svelte/icons/clipboard-list';
  import FileText from 'lucide-svelte/icons/file-text';
  import LayoutDashboard from 'lucide-svelte/icons/layout-dashboard';
  import LogOut from 'lucide-svelte/icons/log-out';
  import X from 'lucide-svelte/icons/x';
  import { page } from '$app/state';
  import { ROLE_LABEL, type UserRole } from '$lib/domain';
  import { canApprove, canEnterReports, canReadAllEntities } from '$lib/roles';

  let {
    role,
    fullName,
    /**
     * Desktop only: 214px rail of labels, or 60px of icons. Below `md` the
     * sidebar is a drawer and this is ignored — a drawer you have opened on
     * purpose should never show you icons you cannot read.
     */
    collapsed = $bindable(false),
    /** Below `md` only. The drawer is closed until someone asks for it. */
    open = false,
    onclose
  }: {
    role: UserRole | null;
    fullName: string | null;
    collapsed?: boolean;
    open?: boolean;
    onclose?: () => void;
  } = $props();

  type NavItem = {
    label: string;
    icon: typeof LayoutDashboard;
    href: string;
    visible: boolean;
  };

  // Screens come from the table in CLAUDE.md. "Tampilan Mobile" is not here:
  // it was a device-frame preview in the prototype, not a route.
  //
  // `visible` is UX only. Hiding a nav item is not access control — RLS is.
  const items = $derived<NavItem[]>([
    {
      label: 'Dasbor Eksekutif',
      icon: LayoutDashboard,
      href: '/',
      visible: canReadAllEntities(role)
    },
    { label: 'Laporan P&L', icon: FileText, href: '/entities', visible: true },
    { label: 'Input Laporan', icon: ClipboardList, href: '/entry', visible: canEnterReports(role) },
    { label: 'Persetujuan', icon: CircleCheckBig, href: '/approval', visible: canApprove(role) }
  ]);

  const initials = $derived(
    (fullName ?? '?')
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? '')
      .join('')
      .toUpperCase()
  );

  /**
   * The collapsed choice outlives the tab. It is a cookie rather than
   * localStorage so the server renders the sidebar at the width the user last
   * chose — read from localStorage after hydration, the rail would visibly
   * jump on every full page load.
   */
  function toggleCollapsed() {
    collapsed = !collapsed;
    document.cookie = `sidebar=${collapsed ? 'rail' : 'full'}; path=/; max-age=31536000; samesite=lax`;
  }

</script>

<!-- Backdrop. Mobile only; the desktop sidebar never covers anything. -->
{#if open}
  <button
    type="button"
    class="md:hidden fixed inset-0 z-40 bg-black/60"
    aria-label="Tutup menu"
    onclick={() => onclose?.()}
  ></button>
{/if}

<!--
  `invisible` when the drawer is shut, not just translated off-screen: a
  sidebar parked at -100% is still in the tab order, so tabbing through a
  phone screen walks into links nobody can see. `visibility` also takes the
  responsive variant, which `inert` cannot — `inert` is an attribute, and on
  desktop `open` is always false, so an inert bound to it would disable the
  sidebar for every desktop user.
-->
<aside
  class="fixed inset-y-0 left-0 z-50 w-[260px] shrink-0 flex flex-col h-screen
         border-r border-border bg-background transition-[transform,width] duration-200
         md:relative md:z-auto md:translate-x-0 md:visible
         {open ? 'translate-x-0 visible' : '-translate-x-full invisible'}
         {collapsed ? 'md:w-[60px]' : 'md:w-[214px]'}"
>
  <div
    class="h-12 flex items-center gap-2.5 border-b border-border shrink-0
           {collapsed ? 'md:justify-center md:px-0 px-4' : 'px-4'}"
  >
    <div class="w-6 h-6 rounded-md bg-primary flex items-center justify-center shrink-0">
      <ChartColumn size={13} class="text-primary-foreground" />
    </div>
    <div class="min-w-0 flex-1 {collapsed ? 'md:hidden' : ''}">
      <p class="text-[12px] font-semibold text-foreground leading-tight truncate">
        Portal Keuangan
      </p>
      <p class="text-[10px] text-muted-foreground truncate">Grup Holding</p>
    </div>

    <!-- Mobile: close. Desktop: nothing — the rail toggle lives at the foot. -->
    <button
      type="button"
      class="md:hidden text-muted-foreground hover:text-foreground transition-colors p-1 shrink-0"
      aria-label="Tutup menu"
      onclick={() => onclose?.()}
    >
      <X size={16} />
    </button>
  </div>

  <nav class="flex-1 p-2 space-y-px overflow-y-auto">
    {#each items as item (item.label)}
      {#if item.visible}
        {@const active =
          page.url.pathname === item.href ||
          (item.href !== '/' && page.url.pathname.startsWith(item.href + '/'))}
        <a
          href={item.href}
          aria-current={active ? 'page' : undefined}
          title={collapsed ? item.label : undefined}
          onclick={() => onclose?.()}
          class="w-full flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] transition-colors
                 {collapsed ? 'md:justify-center md:px-0' : ''}
                 {active
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-muted-foreground hover:bg-card hover:text-foreground'}"
        >
          <item.icon size={14} class="shrink-0" />
          <span class="truncate {collapsed ? 'md:hidden' : ''}">{item.label}</span>
        </a>
      {/if}
    {/each}
  </nav>

  <!-- Rail toggle. Desktop only: on a phone the sidebar is a drawer, and a
       drawer that collapses into icons is two controls doing one job. -->
  <div class="hidden md:block px-2 pb-1 shrink-0">
    <button
      type="button"
      onclick={toggleCollapsed}
      aria-expanded={!collapsed}
      title={collapsed ? 'Lebarkan menu' : 'Ciutkan menu'}
      class="w-full flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px]
             text-muted-foreground hover:bg-card hover:text-foreground transition-colors
             {collapsed ? 'justify-center px-0' : ''}"
    >
      {#if collapsed}
        <ChevronRight size={14} class="shrink-0" />
      {:else}
        <ChevronLeft size={14} class="shrink-0" />
        <span class="truncate">Ciutkan</span>
      {/if}
    </button>
  </div>

  <div class="border-t border-border shrink-0 {collapsed ? 'md:px-2 px-4 py-3' : 'px-4 py-3'}">
    <div class="flex items-center gap-2 {collapsed ? 'md:justify-center' : ''}">
      <div
        class="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[11px]
               font-semibold text-foreground shrink-0"
        title={collapsed ? `${fullName ?? 'Tanpa nama'} · ${role ? ROLE_LABEL[role] : 'Tanpa peran'}` : undefined}
      >
        {initials}
      </div>
      <div class="min-w-0 flex-1 {collapsed ? 'md:hidden' : ''}">
        <p class="text-[12px] font-medium text-foreground truncate">{fullName ?? 'Tanpa nama'}</p>
        <p class="text-[11px] text-muted-foreground truncate">
          {role ? ROLE_LABEL[role] : 'Tanpa peran'}
        </p>
      </div>
      <form method="POST" action="/logout" class={collapsed ? 'md:hidden' : ''}>
        <button
          type="submit"
          class="text-muted-foreground hover:text-foreground transition-colors p-1"
          title="Keluar"
          aria-label="Keluar"
        >
          <LogOut size={14} />
        </button>
      </form>
    </div>
  </div>
</aside>
