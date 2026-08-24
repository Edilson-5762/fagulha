"use client";

import { cn } from "../lib/cn.js";

export interface ProgressBarProps {
  value: number;
  label?: string;
  className?: string;
}

export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const rounded = Math.round(clamped);

  return (
    <div className={cn("w-full", className)}>
      {label ? (
        <div className="mb-1.5 flex justify-between text-xs text-text-muted">
          <span>{label}</span>
          <span>{rounded}%</span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated"
      >
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
