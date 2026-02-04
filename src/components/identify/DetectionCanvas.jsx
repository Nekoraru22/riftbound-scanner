import React, { useRef, useEffect } from 'react';

// Color palette for distinguishing detections
const DETECTION_COLORS = [
  { r: 78, g: 205, b: 196 },   // Teal
  { r: 255, g: 107, b: 107 },  // Red
  { r: 255, g: 209, b: 102 },  // Yellow
  { r: 107, g: 137, b: 255 },  // Blue
  { r: 199, g: 128, b: 232 },  // Purple
  { r: 255, g: 168, b: 80 },   // Orange
  { r: 129, g: 236, b: 146 },  // Green
  { r: 255, g: 145, b: 186 },  // Pink
];

export default function DetectionCanvas({ image, detections, selectedIndex, onSelectDetection, cards }) {
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

    // Draw detection boxes with colored fills
    if (detections && detections.length > 0) {
      detections.forEach((det, idx) => {
        const { cx, cy, w, h, angle, confidence } = det;
        const isSelected = idx === selectedIndex;
        const hasMatch = det.matchResult && det.matchResult.similarity > 0.55;
        const color = DETECTION_COLORS[idx % DETECTION_COLORS.length];

        // Resolve label from activeCardId or matchResult
        let labelName = null;
        let labelSim = 0;
        if (hasMatch) {
          const activeId = det.activeCardId || det.matchResult?.card?.id;
          const activeTop3 = det.matchResult?.top3?.find(m => m.id === activeId);
          if (activeTop3) {
            labelName = activeTop3.name;
            labelSim = activeTop3.similarity;
          } else if (cards && activeId) {
            const fullCard = cards.find(c => c.id === activeId);
            labelName = fullCard?.name || det.matchResult.card.name;
            labelSim = det.matchResult.similarity;
          } else {
            labelName = det.matchResult.card.name;
            labelSim = det.matchResult.similarity;
          }
        }

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);

        // Semi-transparent colored fill
        ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${isSelected ? 0.30 : 0.18})`;
        ctx.fillRect(-w / 2, -h / 2, w, h);

        // Box stroke
        if (isSelected) {
          ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 1)`;
          ctx.lineWidth = 4;
          ctx.shadowColor = `rgba(${color.r}, ${color.g}, ${color.b}, 0.6)`;
          ctx.shadowBlur = 14;
        } else {
          ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.85)`;
          ctx.lineWidth = 3;
        }
        ctx.strokeRect(-w / 2, -h / 2, w, h);

        // Reset shadow for label
        ctx.shadowBlur = 0;

        // Label
        const label = hasMatch
          ? `#${idx + 1} ${labelName} (${(labelSim * 100).toFixed(0)}%)`
          : `#${idx + 1} ${(confidence * 100).toFixed(1)}%`;

        ctx.font = `bold ${Math.max(14, Math.min(20, w * 0.06))}px monospace`;
        const textWidth = ctx.measureText(label).width + 12;
        const labelH = 24;

        // Label background with detection color
        ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.85)`;
        ctx.beginPath();
        const lx = -w / 2;
        const ly = -h / 2 - labelH - 4;
        const radius = 4;
        ctx.roundRect(lx, ly, textWidth, labelH, radius);
        ctx.fill();

        // Label text
        ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.fillText(label, lx + 6, ly + labelH - 7);

        ctx.restore();
      });
    }
  }, [image, detections, selectedIndex, cards]);

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
