"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "border-border bg-bg-elevated text-text-muted",
        success: "border-success/30 bg-success/10 text-success",
        warning: "border-warning/30 bg-warning/10 text-warning",
        danger: "border-danger/30 bg-danger/10 text-danger",
        "security-normal": "border-security-normal/30 bg-security-normal/10 text-security-normal",
        "security-sensitive":
          "border-security-sensitive/30 bg-security-sensitive/10 text-security-sensitive",
        "security-confidential":
          "border-security-confidential/30 bg-security-confidential/10 text-security-confidential"
      }
    },
    defaultVariants: {
      tone: "neutral"
    }
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
