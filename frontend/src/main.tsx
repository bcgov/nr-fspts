import { Amplify } from 'aws-amplify';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import { CookieStorage } from 'aws-amplify/utils';
import React from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import amplifyconfig from './config/fam/config';
import { AuthProvider } from './context/auth/AuthProvider';
import { NotificationProvider } from './context/notification/NotificationProvider';
import ThemeProvider from './context/theme/ThemeProvider';

import './index.scss';

// Storage MUST be set BEFORE Amplify.configure(): in v6, configure() can
// trigger immediate OAuth-callback processing when the URL contains
// ?code=...&state=..., and that processing reads the OAuth flow state
// (PKCE verifier, state, nonce) from whatever storage is active at that
// moment. If we configure first and swap storage afterward, the callback
// handler reads from the default (localStorage) while signInWithRedirect
// wrote to the swapped-in CookieStorage — silent miss, no token POST.
cognitoUserPoolsTokenProvider.setKeyValueStorage(
  new CookieStorage({
    domain: window.location.hostname,
    path: '/',
    // Match the page protocol. Forcing `secure: true` on http://localhost
    // makes the browser silently refuse to store the OAuth state/PKCE
    // cookies, so the code-exchange fails on redirect-back and the SPA
    // stays in the unauthenticated branch.
    secure: window.location.protocol === 'https:',
    sameSite: 'strict',
    expires: undefined, // session cookie — dies when browser closes
  }),
);
Amplify.configure(amplifyconfig);

const container = document.getElementById('root');
if (!container) throw new Error('Root container #root not found');

createRoot(container).render(
  <React.StrictMode>
    <AuthProvider>
      <ThemeProvider>
        <NotificationProvider>
          <App />
        </NotificationProvider>
      </ThemeProvider>
    </AuthProvider>
  </React.StrictMode>,
);
