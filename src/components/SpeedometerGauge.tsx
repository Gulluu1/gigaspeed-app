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

  // Draw markings on mount and when speed/maxSpeed changes
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const centerX = size / 2;
    const centerY = size * 0.85;
    const radius = size * 0.38;

    // Clear existing dynamic markings
    const existingMarkings = svg.querySelectorAll(".dynamic-marking, .marking-label");
    existingMarkings.forEach((el) => el.remove());

    MARKINGS.forEach((marking) => {
      if (marking > maxSpeed) return;

      const angle = speedToAngle(marking);
      const rad = (angle * Math.PI) / 180;

      // Major markings (longer) vs minor
      const isMajor = MAJOR_MARKINGS.includes(marking);
      const markLength = isMajor ? radius * 0.2 : radius * 0.1;
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
      line.setAttribute("stroke", "#475569");
      line.setAttribute("stroke-width", markWidth.toString());
      line.setAttribute("stroke-linecap", "round");
      svg.appendChild(line);

      // Label for major markings
      if (isMajor) {
        // Give extra horizontal space for edge labels (0 and 1000)
        const isEdge = marking === 0 || marking === 1000;
        const labelRadius = radius + (isEdge ? 48 : 36);
        const labelX = centerX + labelRadius * Math.cos(rad);
        const labelY = centerY + labelRadius * Math.sin(rad);

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("class", "dynamic-marking marking-label");
        text.setAttribute("x", labelX.toString());
        text.setAttribute("y", (labelY + 5).toString());
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("font-size", isEdge ? "15" : "13");
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
          viewBox={`-${size * 0.12} 0 ${size * 1.24} ${size}`}
          className="w-full h-auto"
          preserveAspectRatio="xMidYMid meet"
          style={{ maxWidth: `${size}px` }}
        >
          <defs>
            {/* Gauge background gradient arc - premium multi-stop */}
            <linearGradient id="gaugeArcGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#06b6d4" />
              <stop offset="10%" stopColor="#0ea5e9" />
              <stop offset="25%" stopColor="#8b5cf6" />
              <stop offset="40%" stopColor="#a855f7" />
              <stop offset="55%" stopColor="#d946ef" />
              <stop offset="70%" stopColor="#ec4899" />
              <stop offset="85%" stopColor="#f97316" />
              <stop offset="95%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#22c55e" />
            </linearGradient>
            {/* Background track gradient */}
            <linearGradient id="trackGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#e2e8f0" />
              <stop offset="50%" stopColor="#cbd5e1" />
              <stop offset="100%" stopColor="#e2e8f0" />
            </linearGradient>
            {/* Needle gradient - gold metallic */}
            <linearGradient id="needleGradient" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#fef9c3" />
              <stop offset="30%" stopColor="#fde047" />
              <stop offset="60%" stopColor="#facc15" />
              <stop offset="100%" stopColor="#eab308" />
            </linearGradient>
            {/* Center hub gradient */}
            <radialGradient id="hubGradient" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fef9c3" />
              <stop offset="40%" stopColor="#fde047" />
              <stop offset="70%" stopColor="#facc15" />
              <stop offset="100%" stopColor="#ca8a04" />
            </radialGradient>
            {/* Center hub shadow */}
            <filter id="hubShadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#ca8a04" flood-opacity="0.4"/>
            </filter>
            {/* Progress arc glow */}
            <filter id="arcGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur"/>
              <feMerge>
                <feMergeNode in="blur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>

          {/* Background arc track - subtle */}
          <path
            d={`M ${size * 0.08} ${size * 0.85} A ${size * 0.4} ${size * 0.4} 0 0 1 ${size * 0.92} ${size * 0.85}`}
            fill="none"
            stroke="url(#trackGradient)"
            strokeWidth={size * 0.022}
            strokeLinecap="round"
            opacity="0.5"
          />

          {/* Progress arc - premium gradient with glow */}
          <path
            d={`M ${size * 0.08} ${size * 0.85} A ${size * 0.4} ${size * 0.4} 0 0 1 ${size * 0.92} ${size * 0.85}`}
            fill="none"
            stroke="url(#gaugeArcGradient)"
            strokeWidth={size * 0.022}
            strokeLinecap="round"
            strokeDasharray={`${(Math.PI * size * 0.4).toFixed(1)} ${(Math.PI * size * 0.4).toFixed(1)}`}
            strokeDashoffset={`${(Math.PI * size * 0.4 * (1 - clampedSpeed / maxSpeed)).toFixed(1)}`}
            style={{
              transition: "stroke-dashoffset 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
              filter: "url(#arcGlow)",
            }}
          />

          {/* Center hub */}
          <circle
            cx={size / 2}
            cy={size * 0.85}
            r={size * 0.055}
            fill="url(#hubGradient)"
            filter="url(#hubShadow)"
            stroke="#eab308"
            strokeWidth={1.5}
          />

          {/* Inner hub highlight */}
          <circle
            cx={size / 2}
            cy={size * 0.85}
            r={size * 0.03}
            fill="#fef9c3"
            opacity="0.6"
          />

          {/* Needle */}
          <g transform={`translate(${size / 2}, ${size * 0.85})`}>
            <path
              ref={needleRef}
              d={`M 0 0 L 0 ${-size * 0.38} L ${size * 0.015} ${-size * 0.4} L ${-size * 0.015} ${-size * 0.4} Z`}
              fill="url(#needleGradient)"
              stroke="#ca8a04"
              strokeWidth={1.5}
              style={{
                transform: `rotate(${speedToAngle(clampedSpeed)}deg)`,
                transformOrigin: "0 0",
                transition: "transform 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
                filter: "drop-shadow(0 2px 6px rgba(202, 138, 4, 0.5))",
              }}
            />
            {/* Needle base cap */}
            <circle
              cx={0}
              cy={0}
              r={size * 0.02}
              fill="url(#hubGradient)"
              stroke="#ca8a04"
              strokeWidth={2}
            />
          </g>

          {/* Center speed value */}
          <text
            x={size / 2}
            y={size * 0.85 + 14}
            textAnchor="middle"
            fontSize={size * 0.13}
            fontWeight="800"
            fill="#0f172a"
            fontFamily="system-ui, -apple-system, sans-serif"
            dominantBaseline="middle"
            paintOrder="stroke"
            stroke="white"
            strokeWidth="4"
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