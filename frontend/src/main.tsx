import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.scss';
import App from './App';
import ThemeProvider from './context/theme/ThemeProvider';

const container = document.getElementById('root');
if (!container) throw new Error('Root container #root not found');

createRoot(container).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
