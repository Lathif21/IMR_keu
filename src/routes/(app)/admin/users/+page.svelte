<script lang="ts">
  import KeyRound from 'lucide-svelte/icons/key-round';
  import Plus from 'lucide-svelte/icons/plus';
  import SquarePen from 'lucide-svelte/icons/square-pen';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import X from 'lucide-svelte/icons/x';
  import { ROLE_LABEL, type UserRole } from '$lib/domain';
  import { NO_DATA } from '$lib/format';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const ROLES: UserRole[] = ['direksi', 'manajer_keuangan', 'staf_entitas', 'auditor'];

  const editing = $derived(data.users.find((u) => u.id === data.editingId) ?? null);

  /** Only entity staff are scoped to entities; every other role reads all of
      them through `can_read_all_entities()`. */
  let newRole = $state<UserRole>('staf_entitas');
  let editRole = $state<UserRole>('staf_entitas');

  let seededFor = $state('');
  $effect(() => {
    if (!editing || editing.id === seededFor) return;
    seededFor = editing.id;
    editRole = editing.role;
  });

  /**
   * Generated in the browser and shown once, so the admin can copy it without
   * anyone inventing "password123". It reaches the server in the form post
   * like any other field, and is never echoed back afterwards.
   */
  function randomPassword(): string {
    const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint32Array(16));
    return [...bytes].map((n) => alphabet[n % alphabet.length]).join('');
  }

  function fillRandom(event: MouseEvent) {
    const button = event.currentTarget as HTMLButtonElement;
    const field = button.form?.querySelector<HTMLInputElement>('input[name="password"]');
    if (!field) return;
    field.value = randomPassword();
    field.type = 'text';
  }

  function confirmRoleChange(event: SubmitEvent) {
    if (!editing || editRole === editing.role) return;
    const consequence: Record<UserRole, string> = {
      staf_entitas:
        'Kehilangan akses ke entitas lain. Harus ditautkan ke entitas agar bisa mengisi laporan.',
      direksi:
        'Dapat membuka periode yang sudah dikunci dan mengelola seluruh administrasi — entitas, template, dan pengguna.',
      manajer_keuangan: 'Dapat menyetujui, mengunci, dan mengelola transaksi antar-perusahaan.',
      auditor: 'Membaca seluruh entitas, tidak dapat menulis apa pun.'
    };
    const ok = confirm(
      `Ubah peran ${editing.full_name} dari ${ROLE_LABEL[editing.role]} menjadi ` +
        `${ROLE_LABEL[editRole]}?\n\n${consequence[editRole]}`
    );
    if (!ok) event.preventDefault();
  }
</script>

<svelte:head><title>Pengguna · Administrasi · Portal Keuangan</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  {#if form?.message}
    <div class="px-4 py-2.5 bg-destructive/10 border border-destructive/25 rounded-lg" role="alert">
      <p class="text-[13px] text-destructive leading-relaxed">{form.message}</p>
    </div>
  {/if}

  {#if data.users.some((u) => u.role === 'staf_entitas' && u.is_active && u.entityIds.length === 0)}
    <div
      class="flex items-start gap-3 px-4 py-2.5 bg-warning/10 border border-warning/25 rounded-lg"
      role="status"
    >
      <TriangleAlert size={14} class="text-warning shrink-0 mt-px" />
      <p class="text-[13px] text-warning flex-1 leading-relaxed">
        Ada staf entitas yang belum ditautkan ke entitas mana pun. Mereka melihat layar input yang
        kosong sampai ditautkan di sini.
      </p>
    </div>
  {/if}

  <!-- ── create ─────────────────────────────────────────────────────── -->
  {#if data.creating}
    <form
      method="POST"
      action="?/createUser"
      class="bg-card border border-border rounded-lg p-4 space-y-3"
    >
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-[13px] font-semibold text-foreground">Pengguna baru</h2>
        <a href="/admin/users" class="text-muted-foreground hover:text-foreground" aria-label="Tutup">
          <X size={14} />
        </a>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <label class="block">
          <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">Nama lengkap</span>
          <input
            name="full_name"
            required
            class="w-full h-[30px] px-3 bg-background border border-border rounded-lg text-[13px]
                   text-foreground focus:outline-none focus:border-primary"
          />
        </label>
        <label class="block">
          <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">Email</span>
          <input
            name="email"
            type="email"
            required
            class="w-full h-[30px] px-3 bg-background border border-border rounded-lg text-[13px]
                   text-foreground focus:outline-none focus:border-primary"
          />
        </label>
        <label class="block">
          <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">Peran</span>
          <select
            name="role"
            bind:value={newRole}
            class="w-full h-[30px] px-2 bg-background border border-border rounded-lg text-[13px]
                   text-foreground focus:outline-none focus:border-primary"
          >
            {#each ROLES as role (role)}<option value={role}>{ROLE_LABEL[role]}</option>{/each}
          </select>
        </label>
        <label class="block">
          <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">
            Telepon <span class="text-subtle">(opsional)</span>
          </span>
          <input
            name="phone"
            placeholder="+6281100000001"
            class="w-full h-[30px] px-3 bg-background border border-border rounded-lg text-[13px]
                   text-foreground tabular-nums focus:outline-none focus:border-primary"
          />
        </label>
      </div>

      <div class="flex items-end gap-2 flex-wrap">
        <label class="block flex-1 min-w-[220px] max-w-[360px]">
          <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">
            Password awal
          </span>
          <input
            name="password"
            type="password"
            required
            minlength="8"
            class="w-full h-[30px] px-3 bg-background border border-border rounded-lg text-[13px]
                   text-foreground focus:outline-none focus:border-primary"
          />
        </label>
        <button
          type="button"
          onclick={fillRandom}
          class="h-[30px] px-3 rounded-lg border border-border text-[12px] text-muted-foreground
                 hover:text-foreground hover:bg-muted transition-colors"
        >
          Acak
        </button>
      </div>

      <p class="text-[11px] text-subtle leading-relaxed max-w-[70ch]">
        Tidak ada verifikasi email dan tidak ada reset mandiri, jadi admin yang menetapkan password
        awal dan menyampaikannya sendiri. Salin sekarang — password tidak pernah ditampilkan lagi
        setelah ini.
      </p>

      {#if newRole === 'staf_entitas'}
        <fieldset class="border border-border rounded-lg p-3">
          <legend class="text-[11px] font-medium text-muted-foreground px-1">Akses entitas</legend>
          <div class="flex flex-wrap gap-x-4 gap-y-2">
            {#each data.entities as entity (entity.id)}
              <label class="flex items-center gap-2 text-[12px] text-foreground">
                <input type="checkbox" name="entity_ids" value={entity.id} class="accent-primary" />
                {entity.code}
                <span class="text-subtle">{entity.legal_name}</span>
              </label>
            {/each}
          </div>
        </fieldset>
      {/if}

      <button
        type="submit"
        class="h-[30px] px-4 rounded-lg bg-primary text-[13px] font-medium text-primary-foreground
               hover:bg-accent transition-colors"
      >
        Buat pengguna
      </button>
    </form>
  {:else}
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <p class="text-[12px] text-muted-foreground">
        {data.users.filter((u) => u.is_active).length} pengguna aktif dari {data.users.length}
      </p>
      <a
        href="?baru"
        class="h-[30px] px-4 rounded-lg bg-primary text-[13px] font-medium text-primary-foreground
               hover:bg-accent transition-colors flex items-center gap-1.5"
      >
        <Plus size={13} />
        Tambah Pengguna
      </a>
    </div>
  {/if}

  <!-- ── list ───────────────────────────────────────────────────────── -->
  <div class="bg-card border border-border rounded-lg overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full min-w-[860px] text-[12px]">
        <thead>
          <tr class="text-muted-foreground border-b border-border">
            <th class="text-left font-medium py-2.5 px-4 min-w-[160px]">Nama</th>
            <th class="text-left font-medium py-2.5 px-4 w-[210px]">Email</th>
            <th class="text-left font-medium py-2.5 px-4 w-[140px]">Peran</th>
            <th class="text-left font-medium py-2.5 px-4 w-[160px]">Entitas</th>
            <th class="text-left font-medium py-2.5 px-4 w-[130px]">Telepon</th>
            <th class="text-right font-medium py-2.5 px-4 w-[160px]">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {#each data.users as user (user.id)}
            <tr class="border-b border-border/40 last:border-b-0 {user.is_active ? '' : 'opacity-50'}">
              <td class="py-2.5 px-4">
                <span class="text-foreground">{user.full_name}</span>
                {#if user.id === data.selfId}
                  <span class="text-[10px] text-subtle"> · Anda</span>
                {/if}
                {#if !user.is_active}
                  <span class="block text-[10px] text-subtle">Nonaktif</span>
                {/if}
              </td>
              <td class="py-2.5 px-4 text-muted-foreground truncate">{user.email ?? NO_DATA}</td>
              <td class="py-2.5 px-4">
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {ROLE_LABEL[user.role]}
                </span>
              </td>
              <td class="py-2.5 px-4">
                <!-- Meaningful only for entity staff; the rest read every
                     entity through can_read_all_entities(). -->
                {#if user.role !== 'staf_entitas'}
                  <span class="text-subtle">Semua</span>
                {:else if user.entityIds.length === 0}
                  <span class="text-warning">belum ditautkan</span>
                {:else}
                  <span class="text-muted-foreground">
                    {data.entities
                      .filter((e) => user.entityIds.includes(e.id))
                      .map((e) => e.code)
                      .join(', ')}
                  </span>
                {/if}
              </td>
              <td class="py-2.5 px-4 tabular-nums text-muted-foreground">
                {user.phone ?? NO_DATA}
              </td>
              <td class="py-2.5 px-4">
                <div class="flex items-center justify-end gap-1.5 flex-wrap">
                  <a
                    href="?ubah={user.id}"
                    class="px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:bg-muted
                           hover:text-foreground transition-colors flex items-center gap-1"
                  >
                    <SquarePen size={11} /> Ubah
                  </a>
                  <form method="POST" action="?/toggleActive">
                    <input type="hidden" name="id" value={user.id} />
                    <input type="hidden" name="is_active" value={(!user.is_active).toString()} />
                    <button
                      type="submit"
                      class="px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:bg-muted
                             hover:text-foreground transition-colors"
                    >
                      {user.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                    </button>
                  </form>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <!-- ── edit ───────────────────────────────────────────────────────── -->
  {#if editing}
    <div class="bg-card border border-border rounded-lg p-4 space-y-4">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-[13px] font-semibold text-foreground">Ubah {editing.full_name}</h2>
        <a href="/admin/users" class="text-muted-foreground hover:text-foreground" aria-label="Tutup">
          <X size={14} />
        </a>
      </div>

      <form method="POST" action="?/updateUser" onsubmit={confirmRoleChange} class="space-y-3">
        <input type="hidden" name="id" value={editing.id} />

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label class="block">
            <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">
              Nama lengkap
            </span>
            <input
              name="full_name"
              required
              value={editing.full_name}
              class="w-full h-[30px] px-3 bg-background border border-border rounded-lg text-[13px]
                     text-foreground focus:outline-none focus:border-primary"
            />
          </label>

          <div class="block">
            <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">Email</span>
            <p class="h-[30px] px-3 flex items-center bg-muted/40 border border-border rounded-lg
                      text-[13px] text-subtle truncate">
              {editing.email ?? NO_DATA}
            </p>
            <!-- Changing someone's email without verification is how an
                 account gets taken over. Deactivate and create a new one. -->
            <span class="block text-[10px] text-subtle mt-1">Email tidak dapat diubah.</span>
          </div>

          <label class="block">
            <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">Peran</span>
            <select
              name="role"
              bind:value={editRole}
              class="w-full h-[30px] px-2 bg-background border border-border rounded-lg text-[13px]
                     text-foreground focus:outline-none focus:border-primary"
            >
              {#each ROLES as role (role)}<option value={role}>{ROLE_LABEL[role]}</option>{/each}
            </select>
          </label>

          <label class="block">
            <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">Telepon</span>
            <input
              name="phone"
              value={editing.phone ?? ''}
              class="w-full h-[30px] px-3 bg-background border border-border rounded-lg text-[13px]
                     text-foreground tabular-nums focus:outline-none focus:border-primary"
            />
          </label>
        </div>

        {#if editRole === 'staf_entitas'}
          <fieldset class="border border-border rounded-lg p-3">
            <legend class="text-[11px] font-medium text-muted-foreground px-1">Akses entitas</legend>
            <div class="flex flex-wrap gap-x-4 gap-y-2">
              {#each data.entities as entity (entity.id)}
                <label class="flex items-center gap-2 text-[12px] text-foreground">
                  <input
                    type="checkbox"
                    name="entity_ids"
                    value={entity.id}
                    checked={editing.entityIds.includes(entity.id)}
                    class="accent-primary"
                  />
                  {entity.code}
                  <span class="text-subtle">{entity.legal_name}</span>
                </label>
              {/each}
            </div>
          </fieldset>
        {/if}

        <button
          type="submit"
          class="h-[30px] px-4 rounded-lg bg-primary text-[13px] font-medium text-primary-foreground
                 hover:bg-accent transition-colors"
        >
          Simpan perubahan
        </button>
      </form>

      <form method="POST" action="?/resetPassword" class="border-t border-border pt-3 space-y-2">
        <input type="hidden" name="id" value={editing.id} />
        <h3 class="text-[12px] font-semibold text-foreground flex items-center gap-1.5">
          <KeyRound size={12} /> Ganti password
        </h3>
        <div class="flex items-end gap-2 flex-wrap">
          <label class="block flex-1 min-w-[220px] max-w-[360px]">
            <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">
              Password baru
            </span>
            <input
              name="password"
              type="password"
              required
              minlength="8"
              class="w-full h-[30px] px-3 bg-background border border-border rounded-lg text-[13px]
                     text-foreground focus:outline-none focus:border-primary"
            />
          </label>
          <button
            type="button"
            onclick={fillRandom}
            class="h-[30px] px-3 rounded-lg border border-border text-[12px] text-muted-foreground
                   hover:text-foreground hover:bg-muted transition-colors"
          >
            Acak
          </button>
          <button
            type="submit"
            class="h-[30px] px-4 rounded-lg border border-destructive/30 bg-destructive/10
                   text-[12px] font-medium text-destructive hover:bg-destructive/20 transition-colors"
          >
            Ganti password
          </button>
        </div>
      </form>
    </div>
  {/if}
</div>
