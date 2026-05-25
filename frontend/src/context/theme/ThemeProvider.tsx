import { Theme } from '@carbon/react';
import { useEffect, useState, type ReactNode } from 'react';
import { ThemeContext, type CarbonTheme } from './ThemeContext';

const STORAGE_KEY = 'fsp.theme';

function readStoredTheme(): CarbonTheme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'white' || v === 'g10' || v === 'g90' || v === 'g100') return v;
  } catch {
    // localStorage may be unavailable (private mode, SSR shim); fall through.
  }
  return 'white';
}

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<CarbonTheme>(readStoredTheme);

  useEffect(() => {
    document.documentElement.dataset.carbonTheme = theme;
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const setTheme = (next: CarbonTheme) => setThemeState(next);
  const toggleTheme = () => setThemeState((t) => (t === 'white' ? 'g100' : 'white'));

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      <Theme theme={theme}>{children}</Theme>
    </ThemeContext.Provider>
  );
};

export default ThemeProvider;
