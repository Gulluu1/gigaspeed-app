"use client";

import { useEffect, useRef, useCallback } from "react";

interface SpeedometerGaugeProps {
  speed: number;
  maxSpeed?: number;
  label: string;
  size?: number;
}

const MARKINGS = [0, 5, 10, 50, 100, 250, 500, 750, 1000];
const MAJOR_MARKINGS = [0, 100, 250, 500, 750, 1000];

export default function SpeedometerGauge({
  speed,
  maxSpeed = 1000,
  label,
  size = 360,
}: SpeedometerGaugeProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const needleRef = useRef<SVGPathElement>(null);

  // Clamp speed to maxSpeed
  const clampedSpeed = Math.min(Math.max(speed, 0), maxSpeed);

  // Convert speed to angle (-90 to +90 degrees, where -90 = 0, 0 = 500, +90 = 1000)
  const speedToAngle = useCallback((value: number): number => {
    // Map 0-1000 to -90 to +90 degrees
    return (value / maxSpeed) * 180 - 90;
  }, [maxSpeed]);

  // Draw markings on mount and when speed changes
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const centerX = size / 2;
    const centerY = size * 0.85;
    const radius = size * 0.38;

    // Clear existing dynamic markings
    const existingMarkings = svg.querySelectorAll(".dynamic-marking, .marking-label");
    existingMarkings.forEach((el) => el.remove());

    const defs = svg.querySelector("defs");
    if (!defs) return;

    MARKINGS.forEach((marking) => {
      if (marking > maxSpeed) return;

      const angle = speedToAngle(marking);
      const rad = (angle * Math.PI) / 180;

      // Major markings (longer) vs minor
      const isMajor = MAJOR_MARKINGS.includes(marking);
      const markLength = isMajor ? radius * 0.18 : radius * 0.1;
      const markWidth = isMajor ? 3 : 1.5;

      const innerRadius = radius - markLength;
      const x1 = centerX + innerRadius * Math.cos(rad);
      const y1 = centerY + innerRadius * Math.sin(rad);
      const x2 = centerX + radius * Math.cos(rad);
      const y2 = centerY + radius * Math.sin(rad);

      // Marking line
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("class", "dynamic-marking");
      line.setAttribute("x1", x1.toString());
      line.setAttribute("y1", y1.toString());
      line.setAttribute("x2", x2.toString());
      line.setAttribute("y2", y2.toString());
      line.setAttribute("stroke", "#64748b");
      line.setAttribute("stroke-width", markWidth.toString());
      line.setAttribute("stroke-linecap", "round");
      svg.appendChild(line);

      // Label for major markings
      if (isMajor) {
        // Give extra horizontal space for edge labels (0 and 1000)
        const isEdge = marking === 0 || marking === 1000;
        const labelRadius = radius + (isEdge ? 42 : 32);
        const labelX = centerX + labelRadius * Math.cos(rad);
        const labelY = centerY + labelRadius * Math.sin(rad);

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("class", "dynamic-marking marking-label");
        text.setAttribute("x", labelX.toString());
        text.setAttribute("y", (labelY + 5).toString());
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("font-size", isEdge ? "14" : "13");
        text.setAttribute("font-weight", "700");
        text.setAttribute("fill", "#334155");
        text.setAttribute("font-family", "system-ui, -apple-system, sans-serif");
        text.textContent = marking.toString();
        svg.appendChild(text);
      }
    });
  }, [size, maxSpeed, speedToAngle]);

  // Animate needle
  useEffect(() => {
    const needle = needleRef.current;
    if (!needle) return;

    const angle = speedToAngle(clampedSpeed);
    needle.style.transform = `rotate(${angle}deg)`;
    needle.style.transformOrigin = "bottom center";
  }, [clampedSpeed, speedToAngle]);

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-full h-auto">
        <svg
          ref={svgRef}
          viewBox={`-${size * 0.08} 0 ${size * 1.16} ${size}`}
          className="w-full h-auto"
          preserveAspectRatio="xMidYMid meet"
          style={{ maxWidth: `${size}px` }}
        >
          <defs>
            {/* Gauge background gradient arc */}
            <linearGradient id="gaugeArcGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#22d3ee" />
              <stop offset="20%" stopColor="#a855f7" />
              <stop offset="40%" stopColor="#ec4899" />
              <stop offset="60%" stopColor="#f97316" />
              <stop offset="80%" stopColor="#eab308" />
              <stop offset="100%" stopColor="#22c55e" />
            </linearGradient>
            {/* Needle gradient */}
            <linearGradient id="needleGradient" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="100%" stopColor="#fde047" />
            </linearGradient>
            {/* Center glow */}
            <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fde047" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#fde047" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Background arc track */}
          <path
            d={`M ${size * 0.1} ${size * 0.85} A ${size * 0.38} ${size * 0.38} 0 0 1 ${size * 0.9} ${size * 0.85}`}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={size * 0.025}
            strokeLinecap="round"
          />

          {/* Progress arc - colored by speed */}
          <path
            d={`M ${size * 0.1} ${size * 0.85} A ${size * 0.38} ${size * 0.38} 0 0 1 ${size * 0.9} ${size * 0.85}`}
            fill="none"
            stroke="url(#gaugeArcGradient)"
            strokeWidth={size * 0.025}
            strokeLinecap="round"
            strokeDasharray={`${(Math.PI * size * 0.38).toFixed(1)} ${(Math.PI * size * 0.38).toFixed(1)}`}
            strokeDashoffset={`${(Math.PI * size * 0.38 * (1 - clampedSpeed / maxSpeed)).toFixed(1)}`}
            style={{
              transition: "stroke-dashoffset 200ms ease-out",
              filter: "drop-shadow(0 2px 8px rgba(168, 85, 247, 0.3))",
            }}
          />

          {/* Center glow circle */}
          <circle
            cx={size / 2}
            cy={size * 0.85}
            r={size * 0.06}
            fill="url(#centerGlow)"
          />

          {/* Needle */}
          <g transform={`translate(${size / 2}, ${size * 0.85})`}>
            <path
              ref={needleRef}
              d={`M 0 0 L 0 ${-size * 0.35} L ${size * 0.012} ${-size * 0.37} L ${-size * 0.012} ${-size * 0.37} Z`}
              fill="url(#needleGradient)"
              stroke="#fbbf24"
              strokeWidth={1.5}
              style={{
                transform: `rotate(${speedToAngle(clampedSpeed)}deg)`,
                transformOrigin: "0 0",
                transition: "transform 200ms ease-out",
                filter: "drop-shadow(0 2px 4px rgba(251, 191, 36, 0.4))",
              }}
            />
            {/* Needle base */}
            <circle
              cx={0}
              cy={0}
              r={size * 0.018}
              fill="#fde047"
              stroke="#fbbf24"
              strokeWidth={2}
            />
          </g>

          {/* Center speed value */}
          <text
            x={size / 2}
            y={size * 0.85 + 12}
            textAnchor="middle"
            fontSize={size * 0.12}
            fontWeight="700"
            fill="#0f172a"
            fontFamily="system-ui, -apple-system, sans-serif"
            dominantBaseline="middle"
          >
            {clampedSpeed.toFixed(1)}
          </text>
        </svg>
      </div>

      {/* Label below gauge */}
      <div className="mt-4 text-center">
        <p className="text-sm font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider">
          {label}
        </p>
      </div>
    </div>
  );
}