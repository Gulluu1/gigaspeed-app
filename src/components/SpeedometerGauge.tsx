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
  size = 360,
  isTesting,
  onStartTest,
}: SpeedometerGaugeProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const needleRef = useRef<SVGPathElement>(null);
  const [centerScale, setCenterScale] = useState(1);

  // Clamp speed to maxSpeed
  const clampedSpeed = Math.min(Math.max(speed, 0), maxSpeed);

  // Convert speed to angle (-135 to +135 degrees for full circle, where -135 = 0, 0 = 500, +135 = 1000)
  const speedToAngle = useCallback((value: number): number => {
    // Map 0-1000 to -135 to +135 degrees
    return (value / maxSpeed) * 270 - 135;
  }, [maxSpeed]);

  // Draw markings on mount and when speed/maxSpeed changes
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const centerX = size / 2;
    const centerY = size / 2;
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
    needle.style.transformOrigin = "center center";
  }, [clampedSpeed, speedToAngle]);

  // Center button press animation
  useEffect(() => {
    if (isTesting) {
      // Use setTimeout to avoid synchronous setState in effect
      const timer = setTimeout(() => {
        setCenterScale(0.95);
        setTimeout(() => setCenterScale(1), 150);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isTesting]);

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-full h-auto">
        <svg
          ref={svgRef}
          viewBox={`-${size * 0.12} -${size * 0.12} ${size * 1.24} ${size * 1.24}`}
          className="w-full h-auto"
          preserveAspectRatio="xMidYMid meet"
          style={{ maxWidth: `${size}px` }}
        >
          <defs>
            {/* Gauge background gradient arc - premium multi-stop for full circle */}
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
              <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#ca8a04" flood-opacity="0.4"/>
            </filter>
            {/* Progress arc glow */}
            <filter id="arcGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur"/>
              <feMerge>
                <feMergeNode in="blur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
            {/* Button gradient */}
            <linearGradient id="buttonGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#7c3aed" />
              <stop offset="50%" stopColor="#a855f7" />
              <stop offset="100%" stopColor="#d946ef" />
            </linearGradient>
            <linearGradient id="buttonGradientActive" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#22c55e" />
              <stop offset="50%" stopColor="#16a34a" />
              <stop offset="100%" stopColor="#15803d" />
            </linearGradient>
          </defs>

          {/* Background full circle track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={size * 0.38}
            fill="none"
            stroke="url(#trackGradient)"
            strokeWidth={size * 0.022}
            strokeLinecap="round"
            opacity="0.4"
          />

          {/* Progress arc - premium gradient with glow (full circle, 270 degrees visible) */}
          <path
            d={`M ${size / 2} ${size * 0.12} A ${size * 0.38} ${size * 0.38} 0 1 1 ${size * 0.88} ${size / 2}`}
            fill="none"
            stroke="url(#gaugeArcGradient)"
            strokeWidth={size * 0.022}
            strokeLinecap="round"
            strokeDasharray={`${(Math.PI * 1.5 * size * 0.38).toFixed(1)} ${(Math.PI * 0.5 * size * 0.38).toFixed(1)}`}
            strokeDashoffset={`${(Math.PI * 1.5 * size * 0.38 * (1 - clampedSpeed / maxSpeed)).toFixed(1)}`}
            style={{
              transition: "stroke-dashoffset 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
              filter: "url(#arcGlow)",
            }}
          />

          {/* Center hub */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={size * 0.14}
            fill="url(#hubGradient)"
            filter="url(#hubShadow)"
            stroke="#eab308"
            strokeWidth={2}
          />

          {/* Inner hub highlight */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={size * 0.09}
            fill="#fef9c3"
            opacity="0.5"
          />

          {/* Needle */}
          <g transform={`translate(${size / 2}, ${size / 2})`}>
            <path
              ref={needleRef}
              d={`M 0 ${-size * 0.02} L 0 ${-size * 0.38} L ${size * 0.018} ${-size * 0.4} L ${-size * 0.018} ${-size * 0.4} Z`}
              fill="url(#needleGradient)"
              stroke="#ca8a04"
              strokeWidth={1.5}
              style={{
                transform: `rotate(${speedToAngle(clampedSpeed)}deg)`,
                transformOrigin: "0 0",
                transition: "transform 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
                filter: "drop-shadow(0 2px 8px rgba(202, 138, 4, 0.5))",
              }}
            />
            {/* Needle base cap */}
            <circle
              cx={0}
              cy={0}
              r={size * 0.025}
              fill="url(#hubGradient)"
              stroke="#ca8a04"
              strokeWidth={2}
            />
          </g>

          {/* Center button / Live speed value */}
          <g style={{ transform: `scale(${centerScale})`, transformOrigin: `${size / 2}px ${size / 2}px`, transition: "transform 100ms ease-out" }}>
            <foreignObject
              x={size * 0.22}
              y={size * 0.22}
              width={size * 0.56}
              height={size * 0.56}
              pointerEvents="none"
            >
              <div style={{
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
              }}>
                {!isTesting ? (
                  <button
                    onClick={onStartTest}
                    style={{
                      width: `${size * 0.56}px`,
                      height: `${size * 0.56}px`,
                      borderRadius: "50%",
                      border: "none",
                      background: "linear-gradient(135deg, #7c3aed 0%, #a855f7 50%, #d946ef 100%)",
                      color: "white",
                      fontSize: `${size * 0.09}px`,
                      fontWeight: "800",
                      fontFamily: "system-ui, -apple-system, sans-serif",
                      cursor: "pointer",
                      boxShadow: "0 8px 32px rgba(139, 92, 246, 0.5), inset 0 2px 4px rgba(255,255,255,0.2)",
                      transition: "all 200ms ease",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}
                  >
                    GO
                  </button>
                ) : (
                  <>
                    <div style={{
                      fontSize: `${size * 0.14}px`,
                      fontWeight: "800",
                      color: "#0f172a",
                      fontFamily: "system-ui, -apple-system, sans-serif",
                      textShadow: "0 2px 4px rgba(0,0,0,0.1)",
                      lineHeight: "1",
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
                      marginTop: "4px",
                    }}>
                      {label}
                    </div>
                  </>
                )}
              </div>
            </foreignObject>
          </g>
        </svg>
      </div>
    </div>
  );
}