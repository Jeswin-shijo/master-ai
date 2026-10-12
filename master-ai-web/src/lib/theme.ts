import { useEffect, useState } from 'react';

/** Dark by default (n8n look); the choice is remembered per browser. */
export type ThemeChoice = 'dark' | 'light' | 'system';
const KEY = 'onehuman.theme';

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'dark' || v === 'light' || v === 'system') return v;
  } catch {
    // Storage unavailable: use the default.
  }
  return 'dark';
}

export function applyTheme(choice: ThemeChoice) {
  document.documentElement.dataset.theme = choice;
}

/** Reports print on white paper: switch to the light palette while printing, then back. */
export function installPrintTheme() {
  let before: string | undefined;
  window.addEventListener('beforeprint', () => {
    before = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = 'light';
  });
  window.addEventListener('afterprint', () => {
    if (before) document.documentElement.dataset.theme = before;
  });
}

export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // Non-fatal.
    }
  }, [theme]);
  return [theme, setTheme];
}
