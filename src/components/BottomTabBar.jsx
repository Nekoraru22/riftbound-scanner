import React from 'react';
import { ScanLine, Layers, Settings } from 'lucide-react';

const TABS = [
  { id: 'scan', label: 'Scan', icon: ScanLine },
  { id: 'collection', label: 'Collection', icon: Layers },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function BottomTabBar({ activeTab, onTabChange, scannedCount }) {
  return (
    <nav className="flex-shrink-0 z-40 bg-rift-800/95 backdrop-blur-xl border-t border-rift-600/30"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-stretch h-16">
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 transition-colors relative ${
                isActive ? 'text-gold-400' : 'text-rift-400 active:text-rift-200'
              }`}
            >
              {isActive && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-0.5 rounded-full bg-gold-400" />
              )}
              <div className="relative">
                <Icon className="w-5 h-5" strokeWidth={isActive ? 2.2 : 1.8} />
                {id === 'collection' && scannedCount > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 rounded-full bg-gold-500 text-rift-900 text-[9px] font-bold flex items-center justify-center px-1">
                    {scannedCount > 99 ? '99+' : scannedCount}
                  </span>
                )}
              </div>
              <span className={`text-[10px] font-medium ${isActive ? 'text-gold-400' : 'text-rift-500'}`}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
