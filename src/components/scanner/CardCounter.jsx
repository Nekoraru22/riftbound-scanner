import React from 'react';
import { Layers } from 'lucide-react';

export default function CardCounter({ count, uniqueCount, onTap }) {
  if (count === 0) return null;

  return (
    <button
      onClick={onTap}
      className="absolute bottom-4 right-4 z-20 flex items-center gap-2 px-3.5 py-2 rounded-xl bg-rift-800/90 backdrop-blur-md border border-rift-600/40 shadow-lg transition-transform active:scale-95 lg:hidden"
    >
      <Layers className="w-4 h-4 text-gold-400" />
      <div className="flex items-baseline gap-1">
        <span className="text-sm font-bold text-rift-100">{count}</span>
        <span className="text-[10px] text-rift-400">
          ({uniqueCount} unique)
        </span>
      </div>
    </button>
  );
}
