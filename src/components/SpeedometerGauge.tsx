"use client";

import { useEffect, useRef, useCallback, useState } from "react";

interface SpeedometerGaugeProps {
  speed: number;
  maxSpeed?: number;
  label: string;
  size?: number;
  isTesting: boolean;
  onStartTest: () => void;
}

const MARKINGS = [0, 10, 25, 50, 100, 250, 500, 750, 1000];
const MAJOR_MARKINGS = [0, 100, 250, 500, 750, 1000];

export default function SpeedometerGauge({
  speed,
  maxSpeed = 1000,
  label,
  size = 380,
  isTesting,
  onStartTest,
}: SpeedometerGaugeProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const needleRef = useRef<SVGLineElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [centerScale, setCenterScale] = useState(1);

  // Clamp speed to maxSpeed
  const clampedSpeed = Math.min(Math.max(speed, 0), maxSpeed);

  // Single center point for everything
  const centerX = size / 2;
  const centerY = size / 2;
  // Dial radius - all measurements from this
  const dialRadius = size * 0.4;
  // Arc stroke width
  const arcStrokeWidth = size * 0.018;
  // Arc radius - accounts for stroke width so arc stays inside dial
  // arcRadius + arcStrokeWidth/2 <= dialRadius
  const arcRadius = dialRadius - arcStrokeWidth / 2 - 2;
  // Needle length - ends at arc
  const needleLength = arcRadius * 0.95;
  // Pivot radius - small, max 12px
  const pivotRadius = Math.min(size * 0.03, 12);

  // Convert speed to angle (-135 to +135 degrees, 0 at bottom)
  const speedToAngle = useCallback((value: number): number => {
    return (value / maxSpeed) * 270 - 135;
  }, [maxSpeed]);

  // Calculate arc sweep angle based on speed (0 to 270 degrees)
  const sweepAngle = (clampedSpeed / maxSpeed) * 270;
  const endAngle = -135 + sweepAngle; // Start at -135°, sweep clockwise

  // Calculate arc path - only draw the visible sweep portion
  const startAngleRad = (-135 * Math.PI) / 180;
  const endAngleRad = (endAngle * Math.PI) / 180;

  const startX = centerX + arcRadius * Math.cos(startAngleRad);
  const startY = centerY + arcRadius * Math.sin(startAngleRad);
  const endX = centerX + arcRadius * Math.cos(endAngleRad);
  const endY = centerY + arcRadius * Math.sin(endAngleRad);

  // Large arc flag: 1 if sweep > 180°, 0 otherwise
  const largeArcFlag = sweepAngle > 180 ? 1 : 0;

  // Arc path: only draw the visible sweep from -135° to endAngle
  const arcPath = sweepAngle > 0
    ? `M ${startX.toFixed(2)} ${startY.toFixed(2)} A ${arcRadius} ${arcRadius} 0 ${largeArcFlag} 1 ${endX.toFixed(2)} ${endY.toFixed(2)}`
    : "";

  // Draw markings on mount and when size/maxSpeed changes
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // Clear existing dynamic markings
    const existingMarkings = svg.querySelectorAll(".dynamic-marking, .marking-label");
    existingMarkings.forEach((el) => el.remove());

    MARKINGS.forEach((marking) => {
      if (marking > maxSpeed) return;

      const angle = speedToAngle(marking);
      const rad = (angle * Math.PI) / 180;

      const isMajor = MAJOR_MARKINGS.includes(marking);
      const markLength = isMajor ? dialRadius * 0.14 : dialRadius * 0.07;
      const markWidth = isMajor ? 3 : 1.5;

      const innerRadius = dialRadius - markLength;
      const x1 = centerX + innerRadius * Math.cos(rad);
      const y1 = centerY + innerRadius * Math.sin(rad);
      const x2 = centerX + dialRadius * Math.cos(rad);
      const y2 = centerY + dialRadius * Math.sin(rad);

      // Marking line
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("class", "dynamic-marking");
      line.setAttribute("x1", x1.toString());
      line.setAttribute("y1", y1.toString());
      line.setAttribute("x2", x2.toString());
      line.setAttribute("y2", y2.toString());
      line.setAttribute("stroke", "#475569");
      line.setAttribute("stroke-width", markWidth.toString());
      line.setAttribute("stroke-linecap", "round");
      svg.appendChild(line);

      // Label for major markings - outside dial
      if (isMajor) {
        const labelRadius = dialRadius + 28;
        const labelX = centerX + labelRadius * Math.cos(rad);
        const labelY = centerY + labelRadius * Math.sin(rad);

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("class", "dynamic-marking marking-label");
        text.setAttribute("x", labelX.toString());
        text.setAttribute("y", (labelY + 5).toString());
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("font-size", "13");
        text.setAttribute("font-weight", "700");
        text.setAttribute("fill", "#1e293b");
        text.setAttribute("font-family", "system-ui, -apple-system, sans-serif");
        text.setAttribute("paint-order", "stroke");
        text.setAttribute("stroke", "white");
        text.setAttribute("stroke-width", "3");
        text.textContent = marking.toString();
        svg.appendChild(text);
      }
    });
  }, [size, maxSpeed, centerX, centerY, dialRadius, speedToAngle]);

  // Animate needle
  useEffect(() => {
    const needle = needleRef.current;
    if (!needle) return;

    const angle = speedToAngle(clampedSpeed);
    const rad = (angle * Math.PI) / 180;
    const x2 = needleLength * Math.sin(rad);
    const y2 = -needleLength * Math.cos(rad);

    needle.setAttribute("x1", "0");
    needle.setAttribute("y1", "0");
    needle.setAttribute("x2", x2.toString());
    needle.setAttribute("y2", y2.toString());
  }, [clampedSpeed, speedToAngle, needleLength]);

  // Center button press animation
  useEffect(() => {
    if (isTesting) {
      const timer = setTimeout(() => {
        setCenterScale(0.95);
        setTimeout(() => setCenterScale(1), 150);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isTesting]);

  const handleButtonClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onStartTest();
  }, [onStartTest]);

  return (
    <div className="relative flex flex-col items-center" style={{ width: `${size}px` }}>
      {/* SVG Gauge - pointer-events: none so clicks pass to button */}
      <svg
        ref={svgRef}
        viewBox={`-${size * 0.02} -${size * 0.02} ${size * 1.04} ${size * 1.18}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
        style={{
          pointerEvents: "none",
          maxWidth: `${size}px`,
          overflow: "hidden",
        }}
      >
        <defs>
          {/* Clip path to contain arc within dial */}
          <clipPath id="arcClip">
            <circle cx={centerX} cy={centerY} r={dialRadius - 4} />
          </clipPath>

          {/* Arc gradient - premium multi-stop, follows the sweep */}
          <linearGradient id="gaugeArcGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="10%" stopColor="#0ea5e9" />
            <stop offset="20%" stopColor="#3b82f6" />
            <stop offset="30%" stopColor="#8b5cf6" />
            <stop offset="40%" stopColor="#a855f7" />
            <stop offset="50%" stopColor="#d946ef" />
            <stop offset="60%" stopColor="#ec4899" />
            <stop offset="70%" stopColor="#f97316" />
            <stop offset="80%" stopColor="#fbbf24" />
            <stop offset="90%" stopColor="#eab308" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
          {/* Background track */}
          <linearGradient id="trackGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#e2e8f0" />
            <stop offset="50%" stopColor="#cbd5e1" />
            <stop offset="100%" stopColor="#e2e8f0" />
          </linearGradient>
          {/* Needle gradient - thin gold */}
          <linearGradient id="needleGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#fde047" />
            <stop offset="50%" stopColor="#eab308" />
            <stop offset="100%" stopColor="#ca8a04" />
          </linearGradient>
          {/* Small pivot gradient */}
          <radialGradient id="pivotGradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fef9c3" />
            <stop offset="60%" stopColor="#eab308" />
            <stop offset="100%" stopColor="#ca8a04" />
          </radialGradient>
        </defs>

        {/* Background full circle track - at dialRadius */}
        <circle
          cx={centerX}
          cy={centerY}
          r={dialRadius}
          fill="none"
          stroke="url(#trackGradient)"
          strokeWidth={size * 0.018}
          strokeLinecap="round"
          opacity="0.35"
        />

        {/* Progress arc - only draws the visible sweep from -135° to endAngle */}
        {clampedSpeed > 0 && arcPath && (
          <path
            clipPath="url(#arcClip)"
            d={arcPath}
            fill="none"
            stroke="url(#gaugeArcGradient)"
            strokeWidth={arcStrokeWidth}
            strokeLinecap="butt"
            style={{
              transition: "stroke-dashoffset 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
            }}
          />
        )}

        {/* Needle - thin line from center to arcRadius */}
        <line
          ref={needleRef}
          x1="0"
          y1="0"
          x2="0"
          y2={(-needleLength).toString()}
          stroke="url(#needleGradient)"
          strokeWidth={2}
          strokeLinecap="round"
          style={{
            transform: `rotate(${speedToAngle(clampedSpeed)}deg)`,
            transformOrigin: `${centerX}px ${centerY}px`,
            transition: "transform 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
            filter: "drop-shadow(0 2px 4px rgba(202, 138, 4, 0.3))",
          }}
        />

        {/* Small center pivot - max 12px */}
        <circle
          cx={centerX}
          cy={centerY}
          r={pivotRadius}
          fill="url(#pivotGradient)"
          stroke="#eab308"
          strokeWidth={1.5}
        />

        {/* Inner pivot highlight */}
        <circle
          cx={centerX}
          cy={centerY}
          r={pivotRadius * 0.5}
          fill="#fef9c3"
          opacity="0.5"
        />
      </svg>

      {/* GO Button / Live Speed - separate from SVG, on top with pointer-events */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          pointerEvents: isTesting ? "none" : "auto",
          transform: `scale(${centerScale})`,
          transformOrigin: "center center",
          transition: "transform 100ms ease-out",
          zIndex: 10,
        }}
      >
        {!isTesting ? (
          <button
            ref={buttonRef}
            onClick={handleButtonClick}
            className="w-[56%] h-[56%] sm:w-[56%] sm:h-[56%] rounded-full border-0 text-white font-black"
            style={{
              fontSize: `${size * 0.09}px`,
              fontFamily: "system-ui, -apple-system, sans-serif",
              background: "linear-gradient(135deg, #7c3aed 0%, #a855f7 50%, #d946ef 100%)",
              color: "white",
              cursor: "pointer",
              boxShadow: "0 8px 32px rgba(139, 92, 246, 0.5), inset 0 2px 4px rgba(255,255,255,0.2)",
              transition: "all 200ms ease",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            GO
          </button>
        ) : (
          <div
            className="absolute flex flex-col items-center justify-center pointer-events-none"
            style={{
              zIndex: 20,
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
            }}
          >
            <div style={{
              fontSize: `${size * 0.15}px`,
              fontWeight: "800",
              color: "#0f172a",
              fontFamily: "system-ui, -apple-system, sans-serif",
              textShadow: "0 2px 4px rgba(0,0,0,0.1)",
              lineHeight: "1",
              zIndex: 25,
            }}>
              {clampedSpeed.toFixed(1)}
            </div>
            <div style={{
              fontSize: `${size * 0.035}px`,
              fontWeight: "600",
              color: "#64748b",
              fontFamily: "system-ui, -apple-system, sans-serif",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginTop: "6px",
              zIndex: 25,
            }}>
              {label}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}