import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

/**
 * Which entity's report a staff member is filling in.
 *
 * The list comes from `user_entity_access`. It never comes from the URL: the
 * requested code is only ever used to *pick* from the list, so an unknown or
 * forged value falls through to the default instead of reaching a query. RLS
 * would refuse the other entity anyway, but a policy refusal surfaces as
 * "permission denied for table periods", which reads like a broken app rather
 * than a boundary working as designed.
 */
export interface EntryEntity {
  id: string;
  code: string;
  legal_name: string;
  business_line: string;
}

interface AccessRow {
  entities: EntryEntity | null;
}

export interface EntryAccess {
  /** Sorted by `code`. Empty means the account is linked to no entity. */
  entities: EntryEntity[];
  /** The chosen entity, or null when there is nothing to choose from. */
  selected: EntryEntity | null;
  error: PostgrestError | null;
}

export async function loadEntryAccess(
  supabase: SupabaseClient,
  requestedCode: string | null
): Promise<EntryAccess> {
  const { data, error } = await supabase
    .from('user_entity_access')
    .select('entities!inner(id, code, legal_name, business_line)')
    .returns<AccessRow[]>();

  if (error) return { entities: [], selected: null, error };

  const entities = (data ?? [])
    .map((row) => row.entities)
    .filter((entity): entity is EntryEntity => entity !== null)
    .sort((a, b) => a.code.localeCompare(b.code, 'id'));

  const selected = entities.find((entity) => entity.code === requestedCode) ?? entities[0] ?? null;

  return { entities, selected, error: null };
}
