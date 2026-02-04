import React, { useRef, useEffect } from 'react';

export default function DetectionCanvas({ image, detections, selectedIndex, onSelectDetection }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !image) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    // Draw the image
    ctx.drawImage(image, 0, 0);

    // Draw detection boxes
    if (detections && detections.length > 0) {
      detections.forEach((det, idx) => {
        const { cx, cy, w, h, angle, confidence } = det;
        const isSelected = idx === selectedIndex;
        const hasMatch = det.matchResult && det.matchResult.similarity > 0.55;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);

        // Box stroke
        const alpha = Math.min(1, confidence + 0.3);
        if (isSelected) {
          ctx.strokeStyle = `rgba(200, 168, 78, ${alpha})`;
          ctx.lineWidth = 4;
          ctx.shadowColor = 'rgba(200, 168, 78, 0.5)';
          ctx.shadowBlur = 12;
        } else if (hasMatch) {
          ctx.strokeStyle = `rgba(0, 255, 0, ${alpha})`;
          ctx.lineWidth = 3;
        } else {
          ctx.strokeStyle = `rgba(200, 168, 78, ${alpha * 0.6})`;
          ctx.lineWidth = 2;
        }
        ctx.strokeRect(-w / 2, -h / 2, w, h);

        // Reset shadow for label
        ctx.shadowBlur = 0;

        // Label
        const label = hasMatch
          ? `${det.matchResult.card.name} (${(det.matchResult.similarity * 100).toFixed(0)}%)`
          : `${(confidence * 100).toFixed(1)}%`;

        ctx.font = `${Math.max(14, Math.min(20, w * 0.06))}px monospace`;
        const textWidth = ctx.measureText(label).width + 10;
        const labelH = 22;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(-w / 2, -h / 2 - labelH - 4, textWidth, labelH);

        ctx.fillStyle = hasMatch ? 'rgba(0, 255, 0, 0.9)' : 'rgba(200, 168, 78, 0.9)';
        ctx.fillText(label, -w / 2 + 5, -h / 2 - 8);

        ctx.restore();
      });
    }
  }, [image, detections, selectedIndex]);

  const handleCanvasClick = (e) => {
    if (!detections || detections.length === 0 || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    // Find clicked detection
    for (let i = 0; i < detections.length; i++) {
      const det = detections[i];
      const halfW = det.w / 2;
      const halfH = det.h / 2;
      if (
        clickX >= det.cx - halfW && clickX <= det.cx + halfW &&
        clickY >= det.cy - halfH && clickY <= det.cy + halfH
      ) {
        onSelectDetection(i === selectedIndex ? null : i);
        return;
      }
    }
    onSelectDetection(null);
  };

  if (!image) return null;

  return (
    <div ref={containerRef} className="rounded-2xl overflow-hidden border border-rift-600/20 max-w-lg mx-auto">
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        className="w-full h-auto cursor-pointer"
      />
    </div>
  );
}
