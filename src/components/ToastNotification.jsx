import React from 'react';

export default function ToastNotification({ notification }) {
  if (!notification) return null;

  return (
    <div className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full text-sm font-medium shadow-lg fade-in ${
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
