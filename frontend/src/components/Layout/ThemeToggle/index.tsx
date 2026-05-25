import { AsleepFilled, LightFilled } from '@carbon/icons-react';
import type { FC, KeyboardEvent } from 'react';
import { useTheme } from '@/context/theme/useTheme';
import './ThemeToggle.css';

const ThemeToggle: FC = () => {
  const { theme, toggleTheme } = useTheme();

  const isDark = theme === 'g90' || theme === 'g100';

  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleTheme();
    }
  };

  return (
    <div
      className={`theme-toggle ${isDark ? 'on' : 'off'}`}
      onClick={toggleTheme}
      role="button"
      tabIndex={0}
      onKeyDown={handleKey}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      <div className="circle">
        {isDark ? <AsleepFilled className="icon" /> : <LightFilled className="icon" />}
      </div>
    </div>
  );
};

export default ThemeToggle;
