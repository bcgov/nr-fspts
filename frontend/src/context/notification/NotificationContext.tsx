import { createContext, type ReactNode } from 'react';

export type NotificationContent = {
  caption?: string;
  kind: 'error' | 'info' | 'info-square' | 'success' | 'warning' | 'warning-alt' | undefined;
  onClose?: () => void;
  onCloseButtonClick?: () => void;
  subtitle?: string;
  timeout: number;
  title: string;
  children?: ReactNode;
};

export type NotificationContextData = {
  display: (content: NotificationContent) => void;
};

export const NotificationContext = createContext<NotificationContextData | undefined>(undefined);
