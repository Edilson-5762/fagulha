"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn.js";
import { Button } from "./Button.js";
import type { LucideIcon } from "../icons/index.js";

const iconWrapperVariants = cva("mb-4 flex size-12 items-center justify-center rounded-full", {
  variants: {
    tone: {
      neutral: "bg-bg-elevated text-text-muted",
      success: "bg-success/10 text-success",
      warning: "bg-warning/10 text-warning",
      danger: "bg-danger/10 text-danger",
      "security-normal": "bg-security-normal/10 text-security-normal",
      "security-sensitive": "bg-security-sensitive/10 text-security-sensitive",
      "security-confidential": "bg-security-confidential/10 text-security-confidential"
    }
  },
  defaultVariants: {
    tone: "neutral"
  }
});

export interface StateScreenAction {
  label: string;
  onClick: () => void;
}

export interface StateScreenProps extends VariantProps<typeof iconWrapperVariants> {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: StateScreenAction;
  className?: string;
}

export function StateScreen({ icon: Icon, tone, title, description, action, className }: StateScreenProps) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <div className={cn(iconWrapperVariants({ tone }))}>
        <Icon className="size-6" aria-hidden="true" />
      </div>
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      <p className="mt-2 max-w-sm text-sm text-text-muted">{description}</p>
      {action ? (
        <Button className="mt-6" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
