<script lang="ts">
  import Plus from 'lucide-svelte/icons/plus';
  import Scale from 'lucide-svelte/icons/scale';
  import SquarePen from 'lucide-svelte/icons/square-pen';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import X from 'lucide-svelte/icons/x';
  import { REPORTING_BASIS_LABEL, REVENUE_PRESENTATION_LABEL } from '$lib/domain';
  import { NO_DATA, formatDate } from '$lib/format';
  import { entityIcon } from '$lib/icons';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  /** Matches `--color-line-1..4` in app.css. Stored on the row, never assigned
      by array index — adding an entity must not recolour an existing one. */
  const COLORS = [
    { value: '#3B82F6', label: 'Biru' },
    { value: '#8B5CF6', label: 'Ungu' },
    { value: '#F59E0B', label: 'Amber' },
    { value: '#22C55E', label: 'Hijau' },
    { value: '#64748b', label: 'Abu-abu' }
  ];

  const ICONS = ['building', 'truck', 'droplet', 'pickaxe', 'waves'];

  const editing = $derived(data.entities.find((e) => e.id === data.editingId) ?? null);
  const basisTarget = $derived(data.entities.find((e) => e.id === data.basisId) ?? null);

  /** Previous rulings for one entity, newest first. The next director needs
      to see the reasoning their predecessor used. */
  const basisHistory = $derived(
    data.decisions
      .filter((d) => d.entity_id === data.basisId)
      .sort((a, b) => (b.effective_from ?? '').localeCompare(a.effective_from ?? ''))
  );

  function unknownBasis(entity: { reporting_basis: string; revenue_presentation: string }) {
    return entity.reporting_basis === 'unknown' || entity.revenue_presentation === 'unknown';
  }
</script>

<svelte:head><title>Entitas · Administrasi · Portal Keuangan</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  {#if form?.message}
    <div class="px-4 py-2.5 bg-destructive/10 border border-destructive/25 rounded-lg" role="alert">
      <p class="text-[13px] text-destructive leading-relaxed">{form.message}</p>
    </div>
  {/if}

  <!-- ── create ─────────────────────────────────────────────────────── -->
  {#if data.creating}
    <form
      method="POST"
      action="?/createEntity"
      class="bg-card border border-border rounded-lg p-4 space-y-3"
    >
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-[13px] font-semibold text-foreground">Entitas baru</h2>
        <a href="/admin/entities" class="text-muted-foreground hover:text-foreground" aria-label="Tutup">
          <X size={14} />
        </a>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <label class="block">
          <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">Kode</span>
          <input
            name="code"
            required
            maxlength="10"
            placeholder="ILJ"
            class="w-full h-[30px] px-3 bg-background border border-border rounded-lg text-[13px]
                   text-foreground uppercase focus:outline-none focus:border-primary"
          />
        </label>

        <label class="block sm:col-span-2">
          <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">
            Nama badan hukum
          </span>
          <input
            name="legal_name"
            required
            placeholder="PT Indra Langgeng Jaya"
            class="w-full h-[30px] px-3 bg-background border border-border rounded-lg text-[13px]
                   text-foreground focus:outline-none focus:border-primary"
          />
        </label>

        <label class="block">
          <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">
            NPWP <span class="text-subtle">(opsional)</span>
          </span>
          <input
            name="npwp"
            class="w-full h-[30px] px-3 bg-background border border-border rounded-lg text-[13px]
                   text-foreground tabular-nums focus:outline-none focus:border-primary"
          />
        </label>

        <label class="block">
          <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">Lini usaha</span>
          <input
            name="business_line"
            required
            list="business-lines"
            placeholder="trucking"
            class="w-full h-[30px] px-3 bg-background border border-border rounded-lg text-[13px]
                   text-foreground focus:outline-none focus:border-primary"
          />
          <!-- Free text, but offer what exists: a typo here breaks the match
               to report templates and the entity cannot create a period. -->
          <datalist id="business-lines">
            {#each data.businessLines as line (line)}<option value={line}></option>{/each}
          </datalist>
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">Ikon</span>
            <select
              name="icon_key"
              class="w-full h-[30px] px-2 bg-background border border-border rounded-lg text-[13px]
                     text-foreground focus:outline-none focus:border-primary"
            >
              {#each ICONS as key (key)}<option value={key}>{key}</option>{/each}
            </select>
          </label>
          <label class="block">
            <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">Warna</span>
            <select
              name="theme_color"
              class="w-full h-[30px] px-2 bg-background border border-border rounded-lg text-[13px]
                     text-foreground focus:outline-none focus:border-primary"
            >
              {#each COLORS as color (color.value)}
                <option value={color.value}>{color.label}</option>
              {/each}
            </select>
          </label>
        </div>
      </div>

      <p class="text-[11px] text-subtle leading-relaxed">
        Basis pelaporan tidak diisi di sini. Entitas baru selalu lahir
        <span class="text-muted-foreground">belum ditetapkan</span> — menetapkannya adalah keputusan
        tersendiri yang wajib beralasan.
      </p>

      <button
        type="submit"
        class="h-[30px] px-4 rounded-lg bg-primary text-[13px] font-medium text-primary-foreground
               hover:bg-accent transition-colors"
      >
        Simpan entitas
      </button>
    </form>
  {:else}
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <p class="text-[12px] text-muted-foreground">
        {data.entities.filter((e) => e.is_active).length} entitas aktif dari {data.entities.length}
      </p>
      <a
        href="?baru"
        class="h-[30px] px-4 rounded-lg bg-primary text-[13px] font-medium text-primary-foreground
               hover:bg-accent transition-colors flex items-center gap-1.5"
      >
        <Plus size={13} />
        Tambah Entitas
      </a>
    </div>
  {/if}

  <!-- ── list ───────────────────────────────────────────────────────── -->
  <div class="bg-card border border-border rounded-lg overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full min-w-[820px] text-[12px]">
        <thead>
          <tr class="text-muted-foreground border-b border-border">
            <th class="text-left font-medium py-2.5 px-4 min-w-[190px]">Entitas</th>
            <th class="text-left font-medium py-2.5 px-4 w-[150px]">NPWP</th>
            <th class="text-left font-medium py-2.5 px-4 w-[110px]">Lini usaha</th>
            <th class="text-left font-medium py-2.5 px-4 w-[210px]">Basis</th>
            <th class="text-right font-medium py-2.5 px-4 w-[80px]">Periode</th>
            <th class="text-right font-medium py-2.5 px-4 w-[150px]">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {#each data.entities as entity (entity.id)}
            {@const Icon = entityIcon(entity.icon_key)}
            <tr
              class="border-b border-border/40 last:border-b-0 {entity.is_active
                ? ''
                : 'opacity-50'}"
            >
              <td class="py-2.5 px-4">
                <div class="flex items-center gap-2 min-w-0">
                  <span
                    class="w-2 h-2 rounded-full shrink-0"
                    style:background-color={entity.theme_color}
                  ></span>
                  <Icon size={13} class="text-muted-foreground shrink-0" />
                  <span class="text-[13px] font-medium text-foreground shrink-0">{entity.code}</span>
                  <span class="text-muted-foreground truncate">{entity.legal_name}</span>
                </div>
                {#if !entity.hasTemplate}
                  <!-- Creating a period needs an active template for the
                       entity's business line. Without one, /entry refuses. -->
                  <p class="flex items-start gap-1.5 text-[11px] text-warning mt-1 leading-relaxed">
                    <TriangleAlert size={11} class="shrink-0 mt-px" />
                    <span>
                      Lini usaha ini belum punya template — entitas tidak dapat membuat periode.
                      <a href="/admin/templates" class="underline hover:text-foreground">
                        Buat template
                      </a>
                    </span>
                  </p>
                {/if}
              </td>
              <td class="py-2.5 px-4 tabular-nums text-muted-foreground">
                {entity.npwp ?? NO_DATA}
              </td>
              <td class="py-2.5 px-4 text-muted-foreground">{entity.business_line}</td>
              <td class="py-2.5 px-4">
                <!-- Amber is the normal state today: A-1 and A-5 are open. It
                     marks an undecided policy, not an error. -->
                <span
                  class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded
                         {unknownBasis(entity)
                    ? 'bg-warning/10 text-warning'
                    : 'bg-muted text-muted-foreground'}"
                >
                  {#if unknownBasis(entity)}<TriangleAlert size={9} />{/if}
                  {REPORTING_BASIS_LABEL[entity.reporting_basis]}
                </span>
                <span class="block text-[10px] text-subtle mt-0.5">
                  {REVENUE_PRESENTATION_LABEL[entity.revenue_presentation]}
                </span>
              </td>
              <td class="py-2.5 px-4 text-right tabular-nums text-muted-foreground">
                {entity.approvedPeriods}
              </td>
              <td class="py-2.5 px-4">
                <div class="flex items-center justify-end gap-1.5 flex-wrap">
                  <a
                    href="?ubah={entity.id}"
                    class="px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:bg-muted
                           hover:text-foreground transition-colors flex items-center gap-1"
                  >
                    <SquarePen size={11} /> Ubah
                  </a>
                  <a
                    href="?basis={entity.id}"
                    class="px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:bg-muted
                           hover:text-foreground transition-colors flex items-center gap-1"
                  >
                    <Scale size={11} /> Basis
                  </a>
                  <form method="POST" action="?/toggleActive">
                    <input type="hidden" name="id" value={entity.id} />
                    <input type="hidden" name="is_active" value={(!entity.is_active).toString()} />
                    <button
                      type="submit"
                      onclick={(event) => {
                        if (entity.is_active) {
                          const ok = confirm(
                            `Nonaktifkan ${entity.code}?\n\n` +
                              'Entitas hilang dari layar input dan dari daftar entitas yang ' +
                              'diharapkan melapor. Laporan historisnya tetap utuh dan tetap ' +
                              'masuk konsolidasi periode lampau.'
                          );
                          if (!ok) event.preventDefault();
                        }
                      }}
                      class="px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:bg-muted
                             hover:text-foreground transition-colors"
                    >
                      {entity.is_active ? 'Nonaktifkan' : 'Aktifkan'}
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
    <form
      method="POST"
      action="?/updateEntity"
      class="bg-card border border-border rounded-lg p-4 space-y-3"
    >
      <input type="hidden" name="id" value={editing.id} />
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-[13px] font-semibold text-foreground">Ubah {editing.code}</h2>
        <a href="/admin/entities" class="text-muted-foreground hover:text-foreground" aria-label="Tutup">
          <X size={14} />
        </a>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <label class="block">
          <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">Kode</span>
          <input
            name="code"
            required
            maxlength="10"
            value={editing.code}
            class="w-full h-[30px] px-3 bg-background border border-border rounded-lg text-[13px]
                   text-foreground uppercase focus:outline-none focus:border-primary"
          />
          <span class="block text-[10px] text-warning mt-1">
            Kode muncul di laporan yang sudah diekspor.
          </span>
        </label>

        <label class="block sm:col-span-2">
          <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">
            Nama badan hukum
          </span>
          <input
            name="legal_name"
            required
            value={editing.legal_name}
            class="w-full h-[30px] px-3 bg-background border border-border rounded-lg text-[13px]
                   text-foreground focus:outline-none focus:border-primary"
          />
        </label>

        <label class="block">
          <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">NPWP</span>
          <input
            name="npwp"
            value={editing.npwp ?? ''}
            class="w-full h-[30px] px-3 bg-background border border-border rounded-lg text-[13px]
                   text-foreground tabular-nums focus:outline-none focus:border-primary"
          />
        </label>

        <label class="block">
          <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">Lini usaha</span>
          <input
            name="business_line"
            required
            list="business-lines-edit"
            value={editing.business_line}
            class="w-full h-[30px] px-3 bg-background border border-border rounded-lg text-[13px]
                   text-foreground focus:outline-none focus:border-primary"
          />
          <datalist id="business-lines-edit">
            {#each data.businessLines as line (line)}<option value={line}></option>{/each}
          </datalist>
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">Ikon</span>
            <select
              name="icon_key"
              class="w-full h-[30px] px-2 bg-background border border-border rounded-lg text-[13px]
                     text-foreground focus:outline-none focus:border-primary"
            >
              {#each ICONS as key (key)}
                <option value={key} selected={key === editing.icon_key}>{key}</option>
              {/each}
            </select>
          </label>
          <label class="block">
            <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">Warna</span>
            <select
              name="theme_color"
              class="w-full h-[30px] px-2 bg-background border border-border rounded-lg text-[13px]
                     text-foreground focus:outline-none focus:border-primary"
            >
              {#each COLORS as color (color.value)}
                <option value={color.value} selected={color.value === editing.theme_color}>
                  {color.label}
                </option>
              {/each}
            </select>
          </label>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">
              Kepemilikan (%)
            </span>
            <input
              name="ownership_pct"
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              value={editing.ownership_pct}
              class="w-full h-[30px] px-3 bg-background border border-border rounded-lg text-[13px]
                     text-foreground tabular-nums focus:outline-none focus:border-primary"
            />
          </label>
          <label class="block">
            <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">
              Awal tahun buku
            </span>
            <input
              name="fiscal_year_start_month"
              type="number"
              min="1"
              max="12"
              value={editing.fiscal_year_start_month}
              class="w-full h-[30px] px-3 bg-background border border-border rounded-lg text-[13px]
                     text-foreground tabular-nums focus:outline-none focus:border-primary"
            />
          </label>
        </div>
      </div>

      <button
        type="submit"
        class="h-[30px] px-4 rounded-lg bg-primary text-[13px] font-medium text-primary-foreground
               hover:bg-accent transition-colors"
      >
        Simpan perubahan
      </button>
    </form>
  {/if}

  <!-- ── reporting basis ────────────────────────────────────────────── -->
  {#if basisTarget}
    <div class="bg-card border border-border rounded-lg p-4 space-y-4">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-[13px] font-semibold text-foreground">
          Basis pelaporan — {basisTarget.code}
        </h2>
        <a href="/admin/entities" class="text-muted-foreground hover:text-foreground" aria-label="Tutup">
          <X size={14} />
        </a>
      </div>

      <p class="text-[12px] text-muted-foreground leading-relaxed max-w-[70ch]">
        Ini bukan field biasa. Basis pelaporan menentukan arti seluruh laporan entitas ini —
        kapan sebuah angka diakui, dan apakah omset disajikan penuh atau hanya marginnya. Dua
        entitas dengan basis berbeda <span class="text-foreground">tidak sebanding</span>, dan
        setiap layar yang menyandingkannya harus mengatakannya.
      </p>

      <form method="POST" action="?/setBasis" class="space-y-3">
        <input type="hidden" name="id" value={basisTarget.id} />

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label class="block">
            <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">
              Basis akuntansi
            </span>
            <select
              name="reporting_basis"
              class="w-full h-[30px] px-2 bg-background border border-border rounded-lg text-[13px]
                     text-foreground focus:outline-none focus:border-primary"
            >
              <option value="cash" selected={basisTarget.reporting_basis === 'cash'}>Kas</option>
              <option value="accrual" selected={basisTarget.reporting_basis === 'accrual'}>
                Akrual
              </option>
            </select>
          </label>

          <label class="block">
            <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">
              Penyajian omset
            </span>
            <select
              name="revenue_presentation"
              class="w-full h-[30px] px-2 bg-background border border-border rounded-lg text-[13px]
                     text-foreground focus:outline-none focus:border-primary"
            >
              <option value="gross" selected={basisTarget.revenue_presentation === 'gross'}>
                Bruto (prinsipal)
              </option>
              <option value="net" selected={basisTarget.revenue_presentation === 'net'}>
                Neto (agen)
              </option>
            </select>
          </label>

          <label class="block">
            <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">
              Mulai berlaku
            </span>
            <input
              name="effective_from"
              type="date"
              required
              class="w-full h-[30px] px-3 bg-background border border-border rounded-lg text-[13px]
                     text-foreground tabular-nums focus:outline-none focus:border-primary"
            />
          </label>
        </div>

        <label class="block">
          <span class="block text-[11px] font-medium text-muted-foreground mb-1.5">
            Alasan <span class="text-subtle">(wajib)</span>
          </span>
          <textarea
            name="rationale"
            required
            rows="3"
            placeholder="Mis. Konfirmasi akuntan 20 Agu 2026: ILJ mengakui pendapatan saat kas diterima."
            class="w-full bg-background border border-border rounded-lg p-3 text-[13px] text-foreground
                   placeholder:text-subtle resize-none focus:outline-none focus:border-primary"
          ></textarea>
        </label>

        <p class="text-[11px] text-subtle leading-relaxed">
          Tanggal mulai berlaku yang mundur melewati periode yang sudah dikunci tidak menyajikan
          ulang laporan tersebut. Angka yang sudah dikunci tetap seperti apa adanya.
        </p>

        <button
          type="submit"
          class="h-[30px] px-4 rounded-lg bg-primary text-[13px] font-medium text-primary-foreground
                 hover:bg-accent transition-colors"
        >
          Tetapkan basis
        </button>
      </form>

      <div class="border-t border-border pt-3">
        <h3 class="text-[12px] font-semibold text-foreground mb-2">Riwayat penetapan</h3>
        {#if basisHistory.length === 0}
          <p class="text-[11px] text-subtle">
            Belum pernah ditetapkan. Entitas ini masih berbasis belum ditetapkan.
          </p>
        {:else}
          <ul class="space-y-2">
            {#each basisHistory as decision, i (decision.policy_key + i)}
              <li class="text-[11px] leading-relaxed">
                <span class="text-foreground font-medium">{decision.policy_key}</span>
                <span class="text-muted-foreground"> = {decision.chosen_value ?? NO_DATA}</span>
                <span class="text-subtle">
                  · berlaku {formatDate(decision.effective_from)}
                  · diputuskan {decision.decided_by ?? NO_DATA}
                  {formatDate(decision.decided_at)}
                </span>
                {#if decision.rationale}
                  <span class="block text-muted-foreground mt-0.5">{decision.rationale}</span>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}
</div>
