import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Hook for managing camera access and video streaming
 */
export function useCamera() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState(null);
  const [facingMode, setFacingMode] = useState('environment'); // 'user' | 'environment'
  const [capabilities, setCapabilities] = useState(null);

  const startCamera = useCallback(async () => {
    try {
      setError(null);

      // Stop any existing stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }

      const constraints = {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Get track capabilities
      const track = stream.getVideoTracks()[0];
      if (track) {
        const caps = track.getCapabilities?.();
        setCapabilities(caps || null);
      }

      setIsActive(true);
    } catch (err) {
      console.error('[Camera] Error:', err);
      setError(getErrorMessage(err));
      setIsActive(false);
    }
  }, [facingMode]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsActive(false);
  }, []);

  const toggleFacing = useCallback(() => {
    const newMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(newMode);
  }, [facingMode]);

  // Restart camera when facing mode changes
  useEffect(() => {
    if (isActive) {
      startCamera();
    }
  }, [facingMode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  /**
   * Capture current frame as canvas
   */
  const captureFrame = useCallback(() => {
    if (!videoRef.current || !isActive) return null;

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    return canvas;
  }, [isActive]);

  return {
    videoRef,
    isActive,
    error,
    facingMode,
    capabilities,
    startCamera,
    stopCamera,
    toggleFacing,
    captureFrame,
  };
}

function getErrorMessage(err) {
  if (err.name === 'NotAllowedError') {
    return 'Permiso de cámara denegado. Por favor, permite el acceso a la cámara en la configuración de tu navegador.';
  }
  if (err.name === 'NotFoundError') {
    return 'No se encontró ninguna cámara en este dispositivo.';
  }
  if (err.name === 'NotReadableError') {
    return 'La cámara está siendo usada por otra aplicación.';
  }
  if (err.name === 'OverconstrainedError') {
    return 'La cámara no soporta la resolución solicitada.';
  }
  return `Error de cámara: ${err.message}`;
}
