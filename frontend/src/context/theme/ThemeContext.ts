import { createContext } from 'react';

export type CarbonTheme = 'white' | 'g10' | 'g90' | 'g100';

export type ThemeContextValue = {
  theme: CarbonTheme;
  setTheme: (theme: CarbonTheme) => void;
  toggleTheme: () => void;
};

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
