"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn.js";

const spinnerVariants = cva(
  "animate-spin rounded-full border-2 border-current border-t-transparent text-accent",
  {
    variants: {
      size: {
        sm: "size-4",
        md: "size-6",
        lg: "size-8"
      }
    },
    defaultVariants: {
      size: "md"
    }
  }
);

export interface SpinnerProps extends VariantProps<typeof spinnerVariants> {
  className?: string;
  label?: string;
}

export function Spinner({ size, className, label = "Carregando" }: SpinnerProps) {
  return (
    <div role="status" aria-label={label} className={cn(spinnerVariants({ size }), className)} />
  );
}
