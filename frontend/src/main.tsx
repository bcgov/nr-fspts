import { Amplify } from 'aws-amplify';
import React from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import amplifyconfig from './config/fam/config';
import { AuthProvider } from './context/auth/AuthProvider';
import { NotificationProvider } from './context/notification/NotificationProvider';
import OrgProvider from './context/org/OrgProvider';
import ThemeProvider from './context/theme/ThemeProvider';

import './index.scss';

// Amplify persists Cognito tokens in its default store — window.localStorage
// (with an in-memory fallback). A previous CookieStorage override here was a
// silent no-op: aws-amplify's configure() re-seeds the token-provider storage
// to the default on its first call (see initSingleton.mjs — the
// `!Amplify.libraryOptions.Auth` branch calls setKeyValueStorage(defaultStorage)),
// clobbering any storage set beforehand. So tokens have always lived in
// localStorage, and the PKCE/OAuth-callback state along with them —
// consistently, which is why login worked. Token reads go through
// fetchAuthSession (storage-agnostic), so localStorage is fine; the cookie
// override and cookie-only readers were removed to match reality. To actually
// force cookies you'd pass `{ Auth: { tokenProvider, credentialsProvider } }`
// as configure()'s 2nd arg (the early-return path that doesn't reset storage).
Amplify.configure(amplifyconfig);

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
