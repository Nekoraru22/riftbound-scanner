import React from 'react';

export default function AppShell({ children }) {
  return (
    <div className="flex flex-col h-[100dvh] bg-rift-900 overflow-hidden relative">
      {children}
    </div>
  );
}
