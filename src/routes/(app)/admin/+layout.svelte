<script lang="ts">
  import Building2 from 'lucide-svelte/icons/building-2';
  import FileSpreadsheet from 'lucide-svelte/icons/file-spreadsheet';
  import Users from 'lucide-svelte/icons/users';
  import { page } from '$app/state';

  let { children }: { children: import('svelte').Snippet } = $props();

  const tabs = [
    { href: '/admin/entities', label: 'Entitas', icon: Building2 },
    { href: '/admin/templates', label: 'Template', icon: FileSpreadsheet },
    { href: '/admin/users', label: 'Pengguna', icon: Users }
  ];
</script>

<div class="flex flex-col h-full overflow-hidden">
  <!-- Sub-navigation lives here rather than in the sidebar: three admin
       screens under one nav item keeps the sidebar the size it is, and the
       tabs say plainly that these three belong together. -->
  <div
    class="h-12 shrink-0 flex items-center gap-1 px-4 sm:px-5 border-b border-border overflow-x-auto"
  >
    <span class="text-[13px] font-semibold text-foreground mr-3 shrink-0">Administrasi</span>
    {#each tabs as tab (tab.href)}
      {@const active = page.url.pathname.startsWith(tab.href)}
      <a
        href={tab.href}
        aria-current={active ? 'page' : undefined}
        class="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] shrink-0 transition-colors
               {active
          ? 'bg-primary/10 text-primary font-medium'
          : 'text-muted-foreground hover:bg-card hover:text-foreground'}"
      >
        <tab.icon size={13} />
        {tab.label}
      </a>
    {/each}
  </div>

  <div class="flex-1 min-h-0 overflow-y-auto">
    {@render children()}
  </div>
</div>
