import { env } from '@/env';

// SPA origin used as the base for Cognito redirect URLs. Computed from the
// runtime origin so the same image works across PR-preview / TEST / PROD
// without rebuild. VITE_BASE_PATH is supported for parity with nr-rept but
// FSP currently deploys at the route root, so it defaults to '/'.
const redirectUri = window.location.origin + (env.VITE_BASE_PATH || '/').replace(/\/$/, '');

// Full BC Gov logoff chain URL — must exactly match one of the Allowed
// sign-out URLs registered in the Cognito app client for the current
// environment. Set VITE_REDIRECT_SIGN_OUT via OpenShift deploy params
// (see frontend/openshift.deploy.yml). Empty fallback is intentional —
// a missing sign-out URL fails fast at logout rather than at boot.
export const redirectSignOut = env.VITE_REDIRECT_SIGN_OUT?.trim() ?? '';

const verificationMethods: 'code' | 'token' = 'code';

// AWS Amplify Auth configuration for Cognito (FAM integration). Tokens are
// stored in cookies — see main.tsx CookieStorage setup. The Cognito app
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
          domain: 'lza-prod-fam-user-pool-domain.auth.ca-central-1.amazoncognito.com',
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
