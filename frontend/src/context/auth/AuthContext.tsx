import { createContext, type ReactNode } from 'react';

import type { FamLoginUser, LoginProvider } from './types';

export type AuthContextType = {
  user: FamLoginUser | undefined;
  isLoggedIn: boolean;
  isLoading: boolean;
  /**
   * Trigger an OAuth2 redirect to Cognito's hosted UI, scoped to the
   * chosen identity provider (IDIR for ministry staff, BCeID Business
   * for industry users).
   */
  login: (provider: LoginProvider) => void;
  logout: () => void;
  userToken: () => string | undefined;
  /**
   * Checks the access token expiry and refreshes via the refresh token
   * if needed. Returns the current access token string, or undefined if
   * the session has expired (user is signed out automatically).
   */
  ensureFreshToken: () => Promise<string | undefined>;
};

export type AuthProviderProps = {
  children: ReactNode;
};

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
