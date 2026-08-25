# Fase 3 · Tugas 6 — Migration Pendahulu

Tiga lubang di schema yang harus ditutup sebelum layar admin dibangun. Semuanya
kecil, tapi masing-masing punya alasan yang tidak boleh dilewati.

File baru di `supabase/migrations/`, timestamp setelah init. **Jangan sunting
migration yang sudah ter-apply.**

## 1. Trigger audit untuk `profiles` dan template

Saat ini teraudit: `entities`, `periods`, `report_lines`,
`intercompany_transactions`, `accounting_policies`, `user_entity_access`.

Tidak teraudit: `profiles`, `report_templates`, `report_template_lines`.

Fase 3 membangun UI untuk ketiganya. Tanpa trigger:

- Perubahan peran dari `staf_entitas` menjadi `direksi` tidak meninggalkan
  jejak apa pun
- Perubahan `section` sebuah baris template memindahkan nominal historis
  antar-pos laporan, juga tanpa jejak

```sql
create trigger audit_profiles after insert or update or delete on profiles
  for each row execute function audit_row();
create trigger audit_templates after insert or update or delete on report_templates
  for each row execute function audit_row();
create trigger audit_template_lines after insert or update or delete on report_template_lines
  for each row execute function audit_row();
```

`audit_row()` sudah generik — tidak ada perubahan pada fungsinya.

## 2. `sort_order` jadi deferrable

```sql
alter table report_template_lines
  drop constraint report_template_lines_template_id_sort_order_key;

alter table report_template_lines
  add constraint report_template_lines_template_id_sort_order_key
  unique (template_id, sort_order) deferrable initially deferred;
```

**Kenapa.** Menukar urutan dua baris berarti dua UPDATE. Setelah UPDATE
pertama, dua baris sementara memegang `sort_order` yang sama, dan constraint
non-deferrable menolak di titik itu — meski keadaan akhirnya sah.

Alternatifnya menulis ke nilai negatif sementara lalu menormalkan. Itu bekerja,
tapi menaruh kerumitan di kode aplikasi untuk menghindari satu baris SQL.

Verifikasi nama constraint aktual sebelum drop:

```sql
\d report_template_lines
```

## 3. `reporting_basis` hanya berubah dengan alasan tertulis

Keputusan: hanya direksi, dan wajib beralasan.

RLS sekarang mengizinkan direksi meng-update `entities` lewat jalur mana pun.
Menegakkan aturan ini di UI saja berarti siapa pun yang memanggil PostgREST
langsung bisa melewatinya — melanggar invarian 1.

### Flag transaksi + trigger

```sql
create or replace function guard_reporting_basis_change()
returns trigger
language plpgsql
as $$
begin
  if (new.reporting_basis is distinct from old.reporting_basis
      or new.revenue_presentation is distinct from old.revenue_presentation)
     and coalesce(current_setting('app.policy_change', true), '') <> 'on'
  then
    raise exception
      'Basis pelaporan hanya dapat diubah melalui pencatatan kebijakan beralasan';
  end if;
  return new;
end;
$$;

create trigger entities_basis_guard before update on entities
  for each row execute function guard_reporting_basis_change();
```

Flag `app.policy_change` bersifat transaction-local. Hanya RPC di bawah yang
menyalakannya, dan flag itu mati saat transaksi berakhir.

### RPC pencatatan

```sql
create or replace function set_entity_reporting_basis(
  p_entity_id      uuid,
  p_basis          reporting_basis,
  p_presentation   revenue_presentation,
  p_rationale      text,
  p_effective_from date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if current_user_role() <> 'direksi' then
    raise exception 'Hanya direksi yang dapat menetapkan basis pelaporan';
  end if;

  if coalesce(trim(p_rationale), '') = '' then
    raise exception 'Perubahan basis pelaporan wajib disertai alasan';
  end if;

  select full_name into v_name from profiles where id = auth.uid();

  insert into accounting_policies
    (policy_key, entity_id, chosen_value, rationale, decided_by, decided_at, effective_from)
  values
    ('reporting_basis', p_entity_id, p_basis::text,
     p_rationale, v_name, current_date, p_effective_from),
    ('revenue_presentation', p_entity_id, p_presentation::text,
     p_rationale, v_name, current_date, p_effective_from);

  perform set_config('app.policy_change', 'on', true);

  update entities
     set reporting_basis      = p_basis,
         revenue_presentation = p_presentation
   where id = p_entity_id;
end;
$$;

revoke all on function set_entity_reporting_basis from public;
grant execute on function set_entity_reporting_basis to authenticated;
```

Satu transaksi menulis dua tempat: `accounting_policies` menyimpan alasannya,
`entities` menyimpan nilai operasionalnya yang dibaca view. Keduanya tidak bisa
lepas sinkron karena hanya jalur ini yang bisa mengubah kolomnya.

`decided_by` diambil dari `profiles`, bukan dari parameter — pemanggil tidak
boleh mengaku sebagai orang lain.

## Yang tidak perlu ditambahkan

| | Alasan |
|---|---|
| Trigger "tidak boleh menonaktifkan diri sendiri" | Cek aplikasi cukup; kesalahannya reversibel dan pelakunya tercatat |
| Trigger "harus ada minimal satu direksi" | Sama. Kalau ternyata terjadi, tambahkan |
| Kolom `rationale` di `audit_log` | `accounting_policies` sudah menyimpannya, dan tabel itu sendiri teraudit |

## Selesai bila

- [ ] `npm run db:reset` bersih dari nol
- [ ] `npm test` hijau — rangkaian yang ada tidak boleh terpengaruh
- [ ] Update langsung `entities.reporting_basis` lewat PostgREST **ditolak**
- [ ] RPC berhasil dan menghasilkan dua baris `accounting_policies`
- [ ] RPC dipanggil oleh non-direksi ditolak
- [ ] RPC tanpa alasan ditolak
- [ ] Menukar `sort_order` dua baris dalam satu transaksi berhasil
- [ ] Mengubah peran di `profiles` menghasilkan baris `audit_log`
- [ ] Mengubah `section` sebuah baris template menghasilkan baris `audit_log`

Tambahkan pengujiannya ke `tests/guards.test.ts` — jangan buat file tes baru.
