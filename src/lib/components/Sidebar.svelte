<script lang="ts">
  import ChartColumn from 'lucide-svelte/icons/chart-column';
  import CircleCheckBig from 'lucide-svelte/icons/circle-check-big';
  import ClipboardList from 'lucide-svelte/icons/clipboard-list';
  import FileText from 'lucide-svelte/icons/file-text';
  import LayoutDashboard from 'lucide-svelte/icons/layout-dashboard';
  import LogOut from 'lucide-svelte/icons/log-out';
  import { page } from '$app/state';
  import { ROLE_LABEL, type UserRole } from '$lib/domain';
  import { canApprove, canEnterReports, canReadAllEntities } from '$lib/roles';

  let { role, fullName }: { role: UserRole | null; fullName: string | null } = $props();

  type NavItem = {
    label: string;
    icon: typeof LayoutDashboard;
    /** null while the screen is not built yet — rendered disabled, not as a dead link. */
    href: string | null;
    visible: boolean;
  };

  // Screens come from the table in CLAUDE.md. "Tampilan Mobile" is not here:
  // it was a device-frame preview in the prototype, not a route. The real app
  // is responsive.
  //
  // `visible` is UX only. Hiding a nav item is not access control — RLS is.
  const items = $derived<NavItem[]>([
    {
      label: 'Dasbor Eksekutif',
      icon: LayoutDashboard,
      href: '/',
      visible: canReadAllEntities(role)
    },
    { label: 'Laporan P&L', icon: FileText, href: null, visible: true },
    { label: 'Input Laporan', icon: ClipboardList, href: null, visible: canEnterReports(role) },
    { label: 'Persetujuan', icon: CircleCheckBig, href: null, visible: canApprove(role) }
  ]);

  const initials = $derived(
    (fullName ?? '?')
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? '')
      .join('')
      .toUpperCase()
  );
</script>

<aside class="w-[214px] shrink-0 flex flex-col h-screen border-r border-border bg-background">
  <div class="h-12 flex items-center gap-2.5 px-4 border-b border-border">
    <div class="w-6 h-6 rounded-md bg-primary flex items-center justify-center shrink-0">
      <ChartColumn size={13} class="text-primary-foreground" />
    </div>
    <div>
      <p class="text-[12px] font-semibold text-foreground leading-tight">Portal Keuangan</p>
      <p class="text-[10px] text-muted-foreground">Grup Holding</p>
    </div>
  </div>

  <nav class="flex-1 p-2 space-y-px overflow-y-auto">
    {#each items as item (item.label)}
      {#if item.visible}
        {#if item.href}
          {@const active = page.url.pathname === item.href}
          <a
            href={item.href}
            aria-current={active ? 'page' : undefined}
            class="w-full flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] transition-colors
                   {active
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-muted-foreground hover:bg-card hover:text-foreground'}"
          >
            <item.icon size={14} />
            {item.label}
          </a>
        {:else}
          <span
            class="w-full flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] text-subtle cursor-not-allowed"
            title="Layar ini belum dibuat"
          >
            <item.icon size={14} />
            {item.label}
            <span class="ml-auto text-[9px] uppercase tracking-wide">segera</span>
          </span>
        {/if}
      {/if}
    {/each}
  </nav>

  <div class="px-4 py-3 border-t border-border">
    <div class="flex items-center gap-2">
      <div
        class="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[11px] font-semibold text-foreground shrink-0"
      >
        {initials}
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-[12px] font-medium text-foreground truncate">{fullName ?? 'Tanpa nama'}</p>
        <p class="text-[11px] text-muted-foreground truncate">
          {role ? ROLE_LABEL[role] : 'Tanpa peran'}
        </p>
      </div>
      <form method="POST" action="/logout">
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
