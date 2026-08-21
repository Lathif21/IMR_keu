/**
 * Icon registry: string key -> component.
 *
 * `entities.icon_key` is a text column. The prototype stored the component
 * itself in its data (`icon: Truck`), which cannot survive a database round
 * trip or SSR serialisation. Data carries the key; only this file knows
 * which component the key means.
 *
 * Per-icon imports on purpose. Importing from the package root pulls in
 * every one of lucide's ~1600 icons as separate modules in dev.
 */

import Building2 from 'lucide-svelte/icons/building-2';
import Droplet from 'lucide-svelte/icons/droplet';
import Pickaxe from 'lucide-svelte/icons/pickaxe';
import Truck from 'lucide-svelte/icons/truck';
import Waves from 'lucide-svelte/icons/waves';

/** Falls back to the schema default, `building`, for an unrecognised key. */
const ENTITY_ICONS: Record<string, typeof Building2> = {
  building: Building2,
  truck: Truck,
  droplet: Droplet,
  pickaxe: Pickaxe,
  waves: Waves
};

export function entityIcon(key: string | null | undefined): typeof Building2 {
  return (key && ENTITY_ICONS[key]) || Building2;
}
