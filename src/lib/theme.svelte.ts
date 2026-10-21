/**
 * Light/dark theme.
 *
 * The palette itself lives in app.css as CSS variables keyed off
 * `html[data-theme]`; this store only owns the choice and its persistence.  The
 * first paint is already correct because index.html resolves and applies the
 * attribute inline, before any stylesheet is parsed.
 */

const STORAGE_KEY = 'python-maps-theme';

export type ThemeName = 'dark' | 'light';

function initial(): ThemeName {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // Storage can be unavailable (private mode); fall through to the media query.
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export const theme = $state<{ value: ThemeName }>({ value: initial() });

export function setTheme(next: ThemeName): void {
  theme.value = next;
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not fatal: the theme just will not be remembered.
  }
}

export function toggleTheme(): void {
  setTheme(theme.value === 'dark' ? 'light' : 'dark');
}
