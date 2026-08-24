"use client";

import type { TextareaHTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export function Textarea({ className, error, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full rounded-md border bg-bg-elevated px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50",
        error ? "border-danger" : "border-border",
        className
      )}
      aria-invalid={error || undefined}
      {...props}
    />
  );
}
