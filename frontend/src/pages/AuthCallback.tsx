import { Loading } from '@carbon/react';
import { useEffect, useRef, type FC } from 'react';

import { useAuth } from '@/context/auth/useAuth';

/**
 * Where Keycloak returns the browser after a successful sign-in
 * (`<origin><base path>/authCallback`). Ported from nr-rept.
 *
 * New with the move off Cognito: Amplify processed the `?code=…&state=…`
 * callback implicitly during `Amplify.configure()`. oidc-client-ts makes the
 * exchange explicit, which is why this page exists. It must be reachable while
 * signed OUT (the session doesn't exist until it runs), so App.tsx routes it
 * ahead of the Landing catch-all.
 *
 * After the exchange it sends the browser to the app root with a **real
 * navigation**, not `history.replaceState`: replaceState doesn't fire the event
 * React Router listens for, so the URL would change while this spinner stayed
 * mounted. The root then redirects to the user's role-based landing page. The
 * cost is one page load, once, at sign-in.
 */
const AuthCallback: FC = () => {
  const { completeLogin } = useAuth();

  // StrictMode mounts effects twice in development. The authorization code is
  // single-use and its state entry is consumed by the first exchange, so a
  // second call would fail on a perfectly good sign-in.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const run = async () => {
      try {
        await completeLogin();
      } catch (error) {
        // A spent or tampered callback isn't something the user can act on —
        // send them back to the sign-in screen rather than an error page.
        // eslint-disable-next-line no-console
        console.error('[AuthCallback] sign-in could not be completed:', error);
      }
      // `replace`, not `assign`: the callback URL carries a spent
      // authorization code, so it must not be left in history for Back.
      window.location.replace(import.meta.env.BASE_URL || '/');
    };

    void run();
  }, [completeLogin]);

  return <Loading data-testid="auth-callback-loading" withOverlay={true} />;
};

export default AuthCallback;
