import React, { useState, useRef } from 'react';
import { Upload, Image as ImageIcon, Camera } from 'lucide-react';

export default function ImageDropZone({ onImageSelected, isProcessing }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef(null);
  const cameraInputRef = useRef(null);

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
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`w-full rounded-2xl border-2 border-dashed p-8 flex flex-col items-center justify-center gap-4 transition-all duration-200 ${
        isDragOver
          ? 'border-gold-400 bg-gold-400/5 scale-[1.01]'
          : 'border-rift-500/30 bg-rift-800/40'
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
          {isDragOver ? 'Drop image here' : 'Add an image'}
        </p>
        <p className="text-xs text-rift-500 mt-1">
          Drag, take a photo, or upload
        </p>
      </div>

      <div className="flex gap-2 w-full max-w-xs">
        <button
          onClick={() => cameraInputRef.current?.click()}
          disabled={isProcessing}
          className="flex-1 rounded-xl bg-rift-700 border border-rift-600/40 py-2.5 px-4 flex items-center justify-center gap-2 text-sm font-medium text-rift-200 hover:bg-rift-600 hover:border-rift-500/60 transition-all disabled:opacity-50 disabled:pointer-events-none"
        >
          <Camera className="w-4 h-4" />
          Take Photo
        </button>

        <button
          onClick={() => inputRef.current?.click()}
          disabled={isProcessing}
          className="flex-1 rounded-xl bg-rift-700 border border-rift-600/40 py-2.5 px-4 flex items-center justify-center gap-2 text-sm font-medium text-rift-200 hover:bg-rift-600 hover:border-rift-500/60 transition-all disabled:opacity-50 disabled:pointer-events-none"
        >
          <Upload className="w-4 h-4" />
          Upload
        </button>
      </div>

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
