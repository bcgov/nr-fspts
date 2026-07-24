import { env } from '@/env';

// SPA origin used as the base for Cognito redirect URLs. Computed from the
// runtime origin so the same image works across PR-preview / TEST / PROD
// without rebuild. VITE_BASE_PATH is supported for parity with nr-rept but
// FSP currently deploys at the route root, so it defaults to '/'.
const redirectUri = window.location.origin + (env.VITE_BASE_PATH || '/').replace(/\/$/, '');

// Amplify's OAuth config requires a sign-out URL. The PRIMARY logout is the
// federated chain (context/auth/logoutChain.ts — Siteminder → KC → Cognito →
// app, Cognito last); this value only backs the *fallback* Amplify hosted-UI
// sign-out used when the chain env vars aren't set. Derive it from the app
// origin — the exact URL the chain already registers as the Cognito sign-out
// URL (logout_uri) — so no dedicated env var is needed.
export const redirectSignOut = window.location.origin;

// Cognito hosted-UI domain. Exported so the federated logout builder can
// construct the Cognito /logout URL that Keycloak redirects back through.
export const COGNITO_HOSTED_UI_DOMAIN =
  'lza-prod-fam-user-pool-domain.auth.ca-central-1.amazoncognito.com';

const verificationMethods: 'code' | 'token' = 'code';

// AWS Amplify Auth configuration for Cognito (FAM integration). Tokens are
// stored in localStorage (Amplify default — see main.tsx). The Cognito app
// client has BOTH IDIR and BCEID identity providers registered; the login
// UX picks one via signInWithRedirect({ provider: { custom: '...' } }).
//
// redirectSignIn lands on /auth/callback because that's what the existing
// Cognito user pool's app client has pre-registered as a Callback URL.
// Amplify.configure() detects ?code=&state= in the URL and exchanges the
// code for tokens before AuthProvider mounts; App.tsx then routes
// authenticated users from /auth/callback to /search (post-login landing).
const amplifyconfig = {
  Auth: {
    Cognito: {
      userPoolId: env.VITE_USER_POOLS_ID,
      userPoolClientId: env.VITE_USER_POOLS_WEB_CLIENT_ID,
      signUpVerificationMethod: verificationMethods,
      loginWith: {
        oauth: {
          domain: COGNITO_HOSTED_UI_DOMAIN,
          scopes: ['openid', 'profile', 'email'],
          redirectSignIn: [`${redirectUri}/auth/callback`],
          redirectSignOut: [redirectSignOut],
          responseType: verificationMethods,
        },
      },
    },
  },
};

export default amplifyconfig;
