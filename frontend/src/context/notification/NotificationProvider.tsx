import { ToastNotification } from '@carbon/react';
import { useState, useEffect, type ReactNode, useCallback } from 'react';

import { NotificationContext, type NotificationContent } from './NotificationContext';

/**
 * Mirrors nr-rept's NotificationProvider verbatim. The toast slides
 * in from the top-right of the viewport (styled in src/styles/index.scss),
 * stays for `timeout` ms, then slides out. Callers fire it via
 * useNotification().display({ kind, title, subtitle, timeout }).
 */
export const NotificationProvider = ({ children }: { children: ReactNode }) => {
  const [notificationContent, setNotificationContent] = useState<NotificationContent | null>(null);
  const [notificationClass, setNotificationClass] = useState<string>('slide-in');

  const display = useCallback((content: NotificationContent) => {
    // Error / warning toasts stay until the user closes them. The
    // caller's timeout is ignored for those kinds so an information
    // error doesn't disappear before the user has read it. Success
    // and info toasts still auto-dismiss after their requested
    // timeout (typical 5-6 s).
    const sticky =
      content.kind === 'error'
      || content.kind === 'warning'
      || content.kind === 'warning-alt';
    setNotificationClass('slide-in');
    setNotificationContent(sticky ? { ...content, timeout: 0 } : content);
  }, []);

  const onClose = useCallback(() => {
    setNotificationClass('slide-out');
    notificationContent?.onClose?.();
    setNotificationContent(null);
  }, [notificationContent]);

  useEffect(() => {
    if (notificationContent && notificationContent.timeout > 0) {
      if (notificationClass === 'slide-in') {
        const timer = setTimeout(() => {
          setNotificationClass('slide-out');
        }, notificationContent.timeout - 300);
        return () => clearTimeout(timer);
      }
    }
  }, [notificationClass, notificationContent]);

  return (
    <NotificationContext.Provider value={{ display }}>
      {children}
      {notificationContent && (
        <ToastNotification
          className={notificationClass}
          lowContrast
          aria-label="closes notification"
          caption={notificationContent.caption}
          kind={notificationContent.kind}
          onClose={onClose}
          onCloseButtonClick={notificationContent.onCloseButtonClick}
          role="status"
          statusIconDescription="notification"
          subtitle={notificationContent.subtitle}
          timeout={notificationContent.timeout}
          title={notificationContent.title}
        >
          {notificationContent.children}
        </ToastNotification>
      )}
    </NotificationContext.Provider>
  );
};

export default NotificationProvider;
