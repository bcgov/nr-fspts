import React from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { AuthProvider } from './context/auth/AuthProvider';
import { NotificationProvider } from './context/notification/NotificationProvider';
import OrgProvider from './context/org/OrgProvider';
import ThemeProvider from './context/theme/ThemeProvider';

import './index.scss';

// No auth bootstrapping here any more. Amplify needed its token storage wired
// up before `configure()`, because configure() itself processed the OAuth
// callback. oidc-client-ts makes the exchange an explicit call on the
// /authCallback route (pages/AuthCallback), so there is nothing to sequence at
// module scope — the UserManager is built lazily on first use in
// services/keycloak.ts.

const container = document.getElementById('root');
if (!container) throw new Error('Root container #root not found');

createRoot(container).render(
  <React.StrictMode>
    <AuthProvider>
      <OrgProvider>
        <ThemeProvider>
          <NotificationProvider>
            <App />
          </NotificationProvider>
        </ThemeProvider>
      </OrgProvider>
    </AuthProvider>
  </React.StrictMode>,
);
