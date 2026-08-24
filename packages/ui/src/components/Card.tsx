"use client";

import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-bg-elevated/60 p-6 backdrop-blur-md",
        className
      )}
      {...props}
    />
  );
}
