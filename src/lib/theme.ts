/**
 * Light/dark is a display preference, not a permission. It lives in a cookie
 * rather than localStorage for the same reason the sidebar width does: the
 * server has to know it to render the first paint in the right palette.
 * Read after hydration instead, every full page load would flash the wrong
 * theme before correcting itself.
 */
export type Theme = 'dark' | 'light';

/** The design started dark-only; dark stays the answer when nobody has chosen. */
export const DEFAULT_THEME: Theme = 'dark';

export const THEME_COOKIE = 'theme';

export function parseTheme(value: string | undefined): Theme {
  return value === 'light' || value === 'dark' ? value : DEFAULT_THEME;
}

/**
 * Applies the choice and remembers it. The attribute is set directly rather
 * than waiting for a reload — `app.css` keys the whole palette off it, so the
 * repaint is immediate and no navigation is needed.
 */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
}
