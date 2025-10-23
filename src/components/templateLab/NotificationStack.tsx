import React from 'react';
import type { LabNotification } from './templateLabStore';

type NotificationStackProps = {
  notifications: LabNotification[];
  onDismiss: (id: string) => void;
};

const NotificationStack: React.FC<NotificationStackProps> = ({ notifications, onDismiss }) => {
  if (!notifications.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-6 z-50 space-y-2">
      {notifications.map(notification => (
        <div
          key={notification.id}
          className={getNotificationClass(notification.type)}
        >
          <span>{notification.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(notification.id)}
            className="pointer-events-auto text-xs uppercase tracking-wide"
          >
            Close
          </button>
        </div>
      ))}
    </div>
  );
};

function getNotificationClass(type: LabNotification['type']): string {
  const base = 'pointer-events-auto flex items-center gap-3 rounded-lg px-4 py-2 text-sm shadow-lg transition';
  switch (type) {
    case 'success':
      return `${base} bg-emerald-500/90 text-emerald-50`;
    case 'error':
      return `${base} bg-red-500/90 text-red-50`;
    default:
      return `${base} bg-slate-800/90 text-slate-100`;
  }
}

export default NotificationStack;
