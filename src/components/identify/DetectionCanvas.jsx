import React, { useRef, useEffect, useState, useCallback } from 'react';
import { obbToCorners } from '../../lib/perspectiveCrop.js';

// Color palette for distinguishing detections (exported for use in CardDetailPanel)
export const DETECTION_COLORS = [
  { r: 78, g: 205, b: 196 },   // Teal
  { r: 255, g: 107, b: 107 },  // Red
  { r: 255, g: 209, b: 102 },  // Yellow
  { r: 107, g: 137, b: 255 },  // Blue
  { r: 199, g: 128, b: 232 },  // Purple
  { r: 255, g: 168, b: 80 },   // Orange
  { r: 129, g: 236, b: 146 },  // Green
  { r: 255, g: 145, b: 186 },  // Pink
];

// Visual radius of the corner handles in IMAGE pixels (scaled to display size at draw time).
const HANDLE_RADIUS = 14;
// Hit radius around a handle for picking up a drag (a bit looser than visual).
const HANDLE_HIT_RADIUS = 24;

/**
 * Returns the 4 corners of a detection in TL, TR, BR, BL image-space order.
 * If the detection has user-edited `corners`, those are used as-is.
 * Otherwise we derive them from the OBB params.
 */
function getDetectionCorners(det) {
  if (det.corners && det.corners.length === 4) return det.corners;
  return obbToCorners(det.cx, det.cy, det.w, det.h, det.angle);
}

export default function DetectionCanvas({ image, detections, selectedIndex, onSelectDetection, onCornersChange }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  // Local copy of the selected detection's corners while the user is dragging,
  // so we don't fire a re-warp/re-identify on every pointermove.
  const [draftCorners, setDraftCorners] = useState(null);
  // Ref mirror of draftCorners — always holds the latest value so handlePointerUp
  // can read it without capturing a stale closure or using a state updater side-effect.
  const draftCornersRef = useRef(null);
  // Index of the corner currently being dragged (0..3), or null.
  const dragRef = useRef({ active: false, cornerIdx: -1 });

  // Reset the draft when the user selects a different detection or detections change.
  useEffect(() => {
    draftCornersRef.current = null;
    setDraftCorners(null);
    dragRef.current = { active: false, cornerIdx: -1 };
  }, [selectedIndex, detections]);

  // Convert pointer event coordinates (clientX/Y) to image-space pixel coordinates.
  const eventToImage = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
      scale: scaleX, // assume uniform scale (object-fit handled by CSS)
    };
  }, []);

  useEffect(() => {
    if (!canvasRef.current || !image) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    ctx.drawImage(image, 0, 0);

    if (!detections || detections.length === 0) return;

    detections.forEach((det, idx) => {
      const { confidence } = det;
      const isSelected = idx === selectedIndex;
      const hasMatch = det.matchResult && det.matchResult.similarity > 0.55;
      const color = DETECTION_COLORS[idx % DETECTION_COLORS.length];

      let labelName = null;
      let labelSim = 0;
      if (hasMatch) {
        const activeId = det.activeCardId || det.matchResult?.card?.id;
        const activeTop3 = det.matchResult?.top3?.find(m => m.id === activeId);
        if (activeTop3) {
          labelName = activeTop3.name;
          labelSim = activeTop3.similarity;
        } else {
          labelName = det.matchResult.card.name;
          labelSim = det.matchResult.similarity;
        }
      }

      // If the user is dragging this selected detection, draw the editable quad
      // as a polygon instead of the rotated rectangle.
      const useDraft = isSelected && draftCorners;
      const corners = useDraft ? draftCorners : getDetectionCorners(det);

      // Filled polygon
      ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${isSelected ? 0.30 : 0.18})`;
      ctx.beginPath();
      ctx.moveTo(corners[0][0], corners[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(corners[i][0], corners[i][1]);
      ctx.closePath();
      ctx.fill();

      // Polygon outline
      if (isSelected) {
        ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 1)`;
        ctx.lineWidth = 4;
        ctx.shadowColor = `rgba(${color.r}, ${color.g}, ${color.b}, 0.6)`;
        ctx.shadowBlur = 14;
      } else {
        ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.85)`;
        ctx.lineWidth = 3;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Label — anchored to the visual TL of the polygon, oriented along the top edge,
      // so it follows the corners when the user drags them.
      const label = hasMatch
        ? `#${idx + 1} ${labelName} (${(labelSim * 100).toFixed(0)}%)`
        : `#${idx + 1} ${(confidence * 100).toFixed(1)}%`;

      const polyCx = (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4;
      const polyCy = (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4;
      const sortedForLabel = [...corners].sort(
        (a, b) => Math.atan2(a[1] - polyCy, a[0] - polyCx) - Math.atan2(b[1] - polyCy, b[0] - polyCx),
      );
      const [vtl, vtr] = sortedForLabel;
      const topEdgeLen = Math.hypot(vtr[0] - vtl[0], vtr[1] - vtl[1]);
      const topEdgeAngle = Math.atan2(vtr[1] - vtl[1], vtr[0] - vtl[0]);

      ctx.font = `bold ${Math.max(14, Math.min(20, topEdgeLen * 0.06))}px monospace`;
      const textWidth = ctx.measureText(label).width + 12;
      const labelH = 24;

      ctx.save();
      ctx.translate(vtl[0], vtl[1]);
      ctx.rotate(topEdgeAngle);
      ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.85)`;
      ctx.beginPath();
      ctx.roundRect(0, -labelH - 4, textWidth, labelH, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
      ctx.fillText(label, 6, -7);
      ctx.restore();

      // Draggable handles — only for the selected detection.
      if (isSelected) {
        corners.forEach((pt, cIdx) => {
          const isActive = dragRef.current.active && dragRef.current.cornerIdx === cIdx;
          ctx.beginPath();
          ctx.arc(pt[0], pt[1], HANDLE_RADIUS, 0, Math.PI * 2);
          ctx.fillStyle = isActive
            ? `rgba(${color.r}, ${color.g}, ${color.b}, 1)`
            : 'rgba(255, 255, 255, 0.95)';
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 1)`;
          ctx.stroke();
        });
      }
    });
  }, [image, detections, selectedIndex, draftCorners]);

  // Find the closest corner (within HIT radius) of the selected detection at point p.
  const pickHandle = useCallback((p) => {
    if (selectedIndex == null || !detections || !detections[selectedIndex]) return -1;
    const corners = draftCorners || getDetectionCorners(detections[selectedIndex]);
    let best = -1;
    let bestDist = HANDLE_HIT_RADIUS;
    for (let i = 0; i < 4; i++) {
      const d = Math.hypot(corners[i][0] - p.x, corners[i][1] - p.y);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }, [selectedIndex, detections, draftCorners]);

  const handlePointerDown = (e) => {
    if (!canvasRef.current) return;
    const p = eventToImage(e);
    if (!p) return;
    const handleIdx = pickHandle(p);
    if (handleIdx >= 0) {
      // Begin drag on a corner handle
      e.preventDefault();
      canvasRef.current.setPointerCapture(e.pointerId);
      const corners = draftCorners || getDetectionCorners(detections[selectedIndex]);
      // Clone so subsequent updates produce a new array reference
      const copy = corners.map(c => [c[0], c[1]]);
      draftCornersRef.current = copy;
      setDraftCorners(copy);
      dragRef.current = { active: true, cornerIdx: handleIdx };
      return;
    }
    // Otherwise treat as a selection click
    for (let i = 0; i < detections.length; i++) {
      const det = detections[i];
      const halfW = det.w / 2;
      const halfH = det.h / 2;
      if (
        p.x >= det.cx - halfW && p.x <= det.cx + halfW &&
        p.y >= det.cy - halfH && p.y <= det.cy + halfH
      ) {
        onSelectDetection(i === selectedIndex ? null : i);
        return;
      }
    }
    onSelectDetection(null);
  };

  const handlePointerMove = (e) => {
    if (!dragRef.current.active) return;
    const p = eventToImage(e);
    if (!p) return;
    e.preventDefault();
    setDraftCorners(prev => {
      if (!prev) return prev;
      const next = prev.map(c => [c[0], c[1]]);
      next[dragRef.current.cornerIdx] = [
        Math.max(0, Math.min(canvasRef.current.width, p.x)),
        Math.max(0, Math.min(canvasRef.current.height, p.y)),
      ];
      draftCornersRef.current = next;
      return next;
    });
  };

  const handlePointerUp = (e) => {
    if (!dragRef.current.active) return;
    try { canvasRef.current?.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    dragRef.current = { active: false, cornerIdx: -1 };
    // Read from the ref — always the latest value, no stale closure, no side-effects
    // inside a state updater.
    const finalCorners = draftCornersRef.current;
    draftCornersRef.current = null;
    setDraftCorners(null);
    if (finalCorners && selectedIndex != null && onCornersChange) {
      onCornersChange(selectedIndex, finalCorners);
    }
  };

  if (!image) return null;

  return (
    <div ref={containerRef} className="rounded-2xl overflow-hidden border border-rift-600/20 flex items-center justify-center">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="max-h-[calc(100vh-18rem)] w-auto max-w-full h-auto cursor-pointer touch-none"
      />
    </div>
  );
}
