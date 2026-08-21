# Figma Make export — reference only

The untouched output of Figma Make "Financial Reporting Portal". Nothing here
is built, bundled, typechecked, or imported by the app. It is kept so each
screen can be ported against the original markup.

`app/App.tsx` is the useful file: all five prototype screens in one component,
with the exact spacing, type sizes and colour choices to port from.

## What not to take from it

- **`app/components/ui/`** — 48 shadcn components plus MUI, react-slick,
  react-dnd and canvas-confetti. The four real screens use none of them. Add a
  shadcn-svelte component when a screen actually needs it.
- **`bg-[#18181B]` and friends** — the export hardcodes hex on every element.
  That is an export artifact. The tokens live in `src/app.css`.
- **`styles/theme.css`** — superseded by `src/app.css`. It defines `:root` and
  `.dark` identically, because there is no light theme.
- **The "Tampilan Mobile" screen** — a device-frame preview, not a route.
- **`vite.config.ts.reference`** — renamed from `vite.config.ts` so Vite and
  svelte-check stop picking it up as this project's config.

## Bugs in the prototype that must not come back

Listed in full under "Anti-patterns" in [CLAUDE.md](../../CLAUDE.md). Of that
list, these are the ones actually present in this export:

- `width: ${item.pct}%` with no clamp to 0–100 (`App.tsx:181`)
- a component stored inside a data object — `Icon: LayoutDashboard`
  (`App.tsx:21`, `App.tsx:716`). Harmless for a nav array that never leaves
  the module; fatal for entity rows, which come from the database. Hence
  `entities.icon_key` being text and `src/lib/icons.ts` doing the lookup.
- every figure hardcoded, including a "3/4 entitas melapor" completeness tile
  sitting next to totals that silently omit the fourth entity
- the user's role printed as a bare string, `superadmin` (`App.tsx:76`), which
  is not one of the four roles the schema defines

The remaining items in CLAUDE.md's list — the "YoY" mislabel, the hardcoded
"AI Executive Advisor", credentials on the login screen — describe an earlier
version of the prototype. This export labels its comparison "MoM" correctly
and has no login screen at all.
