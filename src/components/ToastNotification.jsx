import React from 'react';

export default function ToastNotification({ notification }) {
  if (!notification) return null;

  return (
    <div className={`fixed bottom-32 right-3 z-50 px-3 py-1.5 rounded-full text-xs font-medium shadow-lg fade-in ${
      notification.type === 'success'
        ? 'bg-green-500/90 text-white backdrop-blur-sm'
        : notification.type === 'error'
          ? 'bg-red-500/90 text-white backdrop-blur-sm'
          : 'bg-rift-700/90 text-rift-100 backdrop-blur-sm border border-rift-500/30'
    }`}>
      {notification.message}
    </div>
  );
}
