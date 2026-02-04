import React, { useState, useRef } from 'react';
import { Upload, Image as ImageIcon } from 'lucide-react';

export default function ImageDropZone({ onImageSelected, isProcessing }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      onImageSelected(file);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      onImageSelected(file);
    }
  };

  return (
    <button
      onClick={() => inputRef.current?.click()}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      disabled={isProcessing}
      className={`w-full rounded-2xl border-2 border-dashed p-8 flex flex-col items-center justify-center gap-3 transition-all duration-200 cursor-pointer ${
        isDragOver
          ? 'border-gold-400 bg-gold-400/5 scale-[1.01]'
          : 'border-rift-500/30 bg-rift-800/40 hover:border-rift-400/50 hover:bg-rift-800/60'
      } ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}
    >
      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors ${
        isDragOver ? 'bg-gold-400/10' : 'bg-rift-700/60'
      }`}>
        {isDragOver ? (
          <ImageIcon className="w-6 h-6 text-gold-400" />
        ) : (
          <Upload className="w-6 h-6 text-rift-400" />
        )}
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-rift-200">
          {isDragOver ? 'Suelta la imagen aqui' : 'Sube una imagen'}
        </p>
        <p className="text-xs text-rift-500 mt-1">
          Arrastra o toca para seleccionar
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />
    </button>
  );
}
