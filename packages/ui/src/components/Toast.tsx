"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../lib/cn.js";

export const ToastProvider = ToastPrimitive.Provider;

export function ToastViewport({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>) {
  return (
    <ToastPrimitive.Viewport
      className={cn(
        "fixed bottom-0 right-0 z-50 flex w-full max-w-sm flex-col gap-2 p-4",
        className
      )}
      {...props}
    />
  );
}

export interface ToastProps extends ComponentPropsWithoutRef<typeof ToastPrimitive.Root> {
  title: string;
  description?: string;
}

export function Toast({ title, description, className, ...props }: ToastProps) {
  return (
    <ToastPrimitive.Root
      className={cn("rounded-lg border border-border bg-bg-elevated p-4 shadow-xl", className)}
      {...props}
    >
      <ToastPrimitive.Title className="text-sm font-semibold text-text">
        {title}
      </ToastPrimitive.Title>
      {description ? (
        <ToastPrimitive.Description className="mt-1 text-sm text-text-muted">
          {description}
        </ToastPrimitive.Description>
      ) : null}
    </ToastPrimitive.Root>
  );
}
