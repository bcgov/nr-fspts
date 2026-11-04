import { WarningFilled } from '@carbon/icons-react';
import { Button } from '@carbon/react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';

import { useAuth } from '@/context/auth/useAuth';
import { useNotification } from '@/context/notification/useNotification';

import './SessionTimeout.scss';

// ── Tuning constants ────────────────────────────────────────────────
// Timings, and why these numbers.
//
// BC Gov SSO gives this realm a five-minute access token and a THIRTY-minute
// refresh token. The refresh token is the real ceiling: once it has gone, no
// amount of clicking brings the session back, and "Stay logged in" would be a
// button that cannot keep its promise.
//
// So the idle timeout sits *under* that ceiling rather than on it. Logging out
// at exactly thirty minutes — which is what this app did against Cognito, whose
// refresh token lived 60 — would mean the moment the timer fires is the moment
// the refresh token dies, and the sign-out races its own credentials.
// Twenty-five minutes leaves five minutes of headroom, so the dialog is always
// backed by a refresh token that still works.
const IDLE_TIMEOUT_MS = 25 * 60 * 1000; // 25 minutes of inactivity
// How long before the idle deadline the warning modal appears (with its live
// countdown): warn at 20:00 idle (5:00 remaining), log out at 25:00.
const WARNING_BEFORE_MS = 5 * 60 * 1000;
// Below this the countdown turns red ($support-error) and the warning icon
// appears — see the mock "Countdown: from 30 seconds onward".
const DANGER_AT_MS = 30 * 1000;
// Throttles: resetting the idle clock on activity is cheap (once/sec is
// plenty); the token keepalive runs at most once/min (a no-op unless the
// access token is within a minute of its 5-min expiry).
//
// The keepalive matters more than it used to. FSP makes no request while
// somebody is reading a screen, and five minutes of reading is ordinary — so
// without it a person plainly still at their desk would return to a dead token.
const ACTIVITY_RESET_THROTTLE_MS = 1000;
const KEEPALIVE_THROTTLE_MS = 60 * 1000;
// User activity that counts as "still here" and resets the idle clock.
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'mousemove',
  'mousedown',
  'keydown',
  'scroll',
  'touchstart',
  'wheel',
];

/**
 * sessionStorage flag set right before a timeout logout so the Landing page
 * can render the "You've been logged out / session expired" notice after the
 * Keycloak sign-out redirect round-trips back. Survives the cross-origin round
 * trip because sessionStorage lives for the tab, not the document.
 */
export const SESSION_EXPIRED_FLAG = 'fspts.sessionExpired';

/** ms → "M:SS" (e.g. 289_000 → "4:49"). Never negative. */
const formatRemaining = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

/**
 * Inactivity guard for authenticated users. Logs the user out after
 * IDLE_TIMEOUT_MS with no interaction, warning WARNING_BEFORE_MS beforehand
 * with a live countdown. Any activity before the warning resets the clock;
 * once the warning is open it's frozen — the user must actively choose "Stay
 * logged in" or "Log out".
 *
 * Because the idle window (25 min) is shorter than the Keycloak refresh-token
 * TTL (30 min), inactivity is the effective policy. Activity also keeps the
 * token fresh (throttled ensureFreshToken), so an active-but-API-idle user's
 * token never dies out from under them — they're only logged out for genuine
 * inactivity.
 *
 * Mounted once, high in the tree, only while logged in (see App.tsx).
 *
 * The dialog is a true alertdialog: no close (X), ESC/backdrop can't dismiss
 * it, focus is trapped, and the per-second countdown updates ONLY its text
 * node — the dialog never re-renders while ticking (value/colour/icon are
 * written through refs).
 *
 * "Stay logged in" forces a silent token refresh (rotating the refresh token,
 * sliding the 30-min backstop) and resets the idle clock. "Log out" and the
 * 0:00 timeout both sign out (the timeout leaves the login-screen notice).
 */
export default function SessionTimeout() {
  const { logout, forceRefreshSession, ensureFreshToken } = useAuth();
  const { display } = useNotification();

  // `open` is the only React state — flipping it mounts/unmounts the dialog.
  // Everything the countdown touches is a ref so ticking causes no re-render.
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);

  const tickRef = useRef<number | null>(null);
  // Origin of the idle clock — the deadline is lastActivityRef + IDLE_TIMEOUT_MS.
  // Frozen while the warning is open so the countdown runs to 0.
  const lastActivityRef = useRef(Date.now());
  const busyRef = useRef(false); // guards the async "Stay logged in"

  const countdownRef = useRef<HTMLSpanElement | null>(null);
  const iconRef = useRef<HTMLSpanElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const logoutBtnRef = useRef<HTMLButtonElement | null>(null);
  const stayBtnRef = useRef<HTMLButtonElement | null>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  const clearTick = () => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  const paintCountdown = (remaining: number) => {
    if (!countdownRef.current) return;
    countdownRef.current.textContent = formatRemaining(remaining);
    if (remaining <= DANGER_AT_MS) {
      countdownRef.current.classList.add('session-timeout__count--danger');
      if (iconRef.current) iconRef.current.style.display = 'inline-flex';
    }
  };

  // Deadline reached — force the security logout. Stash the flag so the login
  // screen explains why, then sign out (redirects through Keycloak).
  const handleExpire = useCallback(() => {
    clearTick();
    openRef.current = false;
    setOpen(false);
    try {
      sessionStorage.setItem(SESSION_EXPIRED_FLAG, '1');
    } catch {
      /* storage disabled — logout still proceeds */
    }
    void logout();
  }, [logout]);

  // "Stay logged in": force a silent token refresh (slides the 30-min
  // backstop) and restart the idle clock, then close.
  const handleStay = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await forceRefreshSession();
      lastActivityRef.current = Date.now(); // restart the 25-min idle clock
      openRef.current = false;
      setOpen(false);
      display({
        kind: 'success',
        title: "You're still logged in",
        subtitle: 'Your session has been extended.',
        timeout: 6000,
      });
    } catch {
      // Refresh token already gone — treat as a real expiry.
      handleExpire();
    } finally {
      busyRef.current = false;
    }
  }, [forceRefreshSession, display, handleExpire]);

  // Explicit "Log out" — deliberate, so no session-expired flag.
  const handleLogout = useCallback(() => {
    clearTick();
    openRef.current = false;
    void logout();
  }, [logout]);

  // Activity listeners + the 1-second idle poll. Activity (throttled) resets
  // the idle clock and keeps the token fresh; the tick computes remaining idle
  // time (deadline = lastActivity + IDLE_TIMEOUT_MS) and drives the warning.
  // Recomputing from an absolute origin each tick makes it robust to laptop
  // sleep / tab-throttling. While the warning is open, activity is ignored so
  // the countdown runs and the user must choose.
  useEffect(() => {
    // Inert under automated browsers (Playwright/Selenium set navigator.webdriver).
    // The idle guard proactively refreshes tokens on activity, which rotates the
    // Keycloak refresh token — a problem for the e2e suite, where every spec shares
    // one refresh token via storageState (a rotation there poisons the shared
    // token for later specs). Real users never hit this branch.
    if (typeof navigator !== 'undefined' && navigator.webdriver) return;

    let lastReset = 0;
    let lastKeepalive = 0;

    const onActivity = () => {
      if (openRef.current) return; // frozen while the warning is shown
      const now = Date.now();
      if (now - lastReset >= ACTIVITY_RESET_THROTTLE_MS) {
        lastReset = now;
        lastActivityRef.current = now;
      }
      if (now - lastKeepalive >= KEEPALIVE_THROTTLE_MS) {
        lastKeepalive = now;
        // No-op unless the access token is near expiry; when it refreshes it
        // rotates the refresh token, sliding the 30-min backstop so an
        // active-but-API-idle user isn't cut off before the idle timeout.
        void ensureFreshToken();
      }
    };
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true }));

    const tick = () => {
      const remaining = lastActivityRef.current + IDLE_TIMEOUT_MS - Date.now();
      if (remaining <= 0) {
        handleExpire();
        return;
      }
      if (remaining <= WARNING_BEFORE_MS && !openRef.current) {
        prevFocusRef.current = document.activeElement as HTMLElement | null;
        openRef.current = true;
        setOpen(true);
      }
      if (openRef.current) paintCountdown(remaining);
    };

    lastActivityRef.current = Date.now(); // arm the clock from mount
    clearTick();
    tickRef.current = window.setInterval(tick, 1000);

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, onActivity));
      clearTick();
    };
  }, [handleExpire, ensureFreshToken]);

  // On open: paint the initial countdown before the browser shows the dialog
  // (no empty flash) and move focus into the dialog container.
  useLayoutEffect(() => {
    if (!open) return;
    paintCountdown(lastActivityRef.current + IDLE_TIMEOUT_MS - Date.now());
    dialogRef.current?.focus();
  }, [open]);

  // Focus trap + swallow ESC. Tab/Shift+Tab cycle only between the two buttons
  // (and the dialog container as the wrap point).
  const onDialogKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key !== 'Tab') return;
    const first = logoutBtnRef.current;
    const last = stayBtnRef.current;
    if (!first || !last) return;
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || active === dialogRef.current) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="session-timeout__overlay">
      <div
        ref={dialogRef}
        className="session-timeout__dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-timeout-title"
        aria-describedby="session-timeout-desc"
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
      >
        <h2 id="session-timeout-title" className="session-timeout__title">
          You&rsquo;re about to be logged out
        </h2>
        <div id="session-timeout-desc" className="session-timeout__body">
          <p>
            For your security, you&rsquo;ll be logged out in{' '}
            <span className="session-timeout__count-wrap" aria-live="polite">
              {/* Empty on purpose — the value is written imperatively so a
                  stray parent re-render can't clobber the live countdown. */}
              <span ref={countdownRef} className="session-timeout__count" />
              <span
                ref={iconRef}
                className="session-timeout__warn-icon"
                style={{ display: 'none' }}
                aria-hidden="true"
              >
                <WarningFilled />
              </span>
            </span>{' '}
            unless you choose to stay logged in.
          </p>
          <p>Any unsaved changes may be lost.</p>
        </div>
        <div className="session-timeout__actions">
          <Button ref={logoutBtnRef} kind="tertiary" size="md" onClick={handleLogout}>
            Log out
          </Button>
          <Button ref={stayBtnRef} kind="primary" size="md" onClick={() => void handleStay()}>
            Stay logged in
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
