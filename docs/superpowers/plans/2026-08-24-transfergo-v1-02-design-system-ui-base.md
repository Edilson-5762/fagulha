# TransferGo V1 — Plano 2/9: Design System & UI Base — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the TransferGo design system (`@transfergo/ui`) — tokens, the full component library required by the product spec, and a Storybook showcase — then rebuild `apps/web`'s home page as a real premium landing page on top of it, replacing the Plan 1 placeholder.

**Architecture:** `packages/ui` becomes a Tailwind CSS v4 component library consumed as raw TypeScript source (no build step, same pattern as `@transfergo/shared`). Interactive/overlay components (Dialog, Tooltip, Toast) wrap Radix UI Primitives for accessible behavior (focus, keyboard, ARIA); simple components (Button, Badge) use `class-variance-authority` for typed variants. Every component file is a Client Component (`"use client"`) so it can be safely rendered from Next.js Server Components without React Server Component boundary errors. `apps/web` imports `@transfergo/ui` the same way it already imports `@transfergo/shared`.

**Tech Stack:** Tailwind CSS v4 (`@theme`, CSS-first config), Radix UI Primitives (`@radix-ui/react-dialog`, `-tooltip`, `-toast`, `-slot`), `class-variance-authority`, `clsx` + `tailwind-merge`, `lucide-react`, `@fontsource/inter` (self-hosted, no Google Fonts network call), Storybook 8 (`@storybook/react-vite`), Vitest 2 + Testing Library (already wired in `packages/ui` from Plan 1's final review pass).

**Spec:** `docs/superpowers/specs/2026-08-24-transfergo-design-system-design.md` (this plan's design spec) and `docs/superpowers/specs/2026-08-24-transfergo-design.md` §6 (product-wide UI/UX requirements)

## Global Constraints

- Node.js `>=22.13.0`, pnpm `11.23.0` (unchanged from Plan 1).
- TypeScript strict mode; no `any` introduced.
- Tailwind CSS v4 is the only styling engine — no CSS-in-JS, no second CSS framework.
- Radix UI Primitives provide accessible behavior for Dialog, Tooltip and Toast — no component reimplements focus/keyboard/ARIA handling from scratch.
- Every component in `packages/ui/src/components/` starts with `"use client";` — these components (or components spreading `...props`) can receive event handlers, so they must be Client Components to avoid Next.js App Router RSC boundary errors regardless of where they're first used.
- Inter is self-hosted via `@fontsource/inter` (weights 400/500/600/700) — never loaded from `fonts.googleapis.com` (Privacy by Default, spec §0/§6). This plan's design spec named `next/font` as the loading mechanism; `@fontsource/inter` is used instead because it works identically in both `apps/web` (Next.js) and Storybook's plain Vite build, whereas `next/font` is Next.js-specific and has no equivalent inside Storybook — both remain equally self-hosted (no external font request), which was the actual requirement.
- Security color ladder is fixed: Normal = `--color-security-normal` (green), Sensível = `--color-security-sensitive` (amber), Confidencial = `--color-security-confidential` (violet) — always paired with an icon + text, never color alone (spec §6).
- No component in this plan is wired to real session/transfer data — all components receive props and are demonstrated with example data (in tests and in Storybook). Real data starts in Plan 4 ("Sessões").
- Every workspace package/app with a `test` script must run via `pnpm --filter <name> run test` and via `pnpm turbo run test` from the root (unchanged from Plan 1).
- UI copy is PT-BR; internal identifiers (props, variant names, CSS tokens) are in English — same split as `TransferState` (spec §3.11).

---

## Task 1: Design tokens + `cn` utility + `Button` (with `asChild`)

**Files:**
- Create: `packages/ui/src/tokens/theme.css`
- Create: `packages/ui/src/lib/cn.ts`
- Create: `packages/ui/src/components/Button.tsx`
- Test: `packages/ui/src/components/Button.test.tsx`
- Modify: `packages/ui/package.json` (add Tailwind v4, CVA, clsx, tailwind-merge, Radix Slot, lucide-react, `@testing-library/user-event`; add `./tokens.css` export)
- Modify: `packages/ui/src/index.ts` (replace the `PACKAGE_NAME` stub with real exports)
- Delete: `packages/ui/src/index.test.ts` (superseded by per-component tests)

**Interfaces:**
- Consumes: nothing from other packages.
- Produces: `cn(...)` from `packages/ui/src/lib/cn.ts` — used by every component in this plan. `Button` (with `variant: "primary"|"secondary"|"ghost"|"danger"`, `size: "sm"|"md"|"lg"`, `isLoading?: boolean`, `asChild?: boolean`) exported from `@transfergo/ui` — used directly by `StateScreen` (Task 6) and the home page `Hero` (Task 8). The Tailwind tokens defined in `theme.css` (`--color-*`, `--font-*`, `--radius-*`) are the only color/font/radius names any later task may reference in class names — never introduce a new ad-hoc color.

- [ ] **Step 1: Update `packages/ui/package.json`**

Replace the file with:

```json
{
  "name": "@transfergo/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./tokens.css": "./src/tokens/theme.css"
  },
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "dev": "storybook dev -p 6006",
    "build-storybook": "storybook build"
  },
  "dependencies": {
    "@radix-ui/react-dialog": "^1.1.0",
    "@radix-ui/react-slot": "^1.1.0",
    "@radix-ui/react-toast": "^1.2.0",
    "@radix-ui/react-tooltip": "^1.1.0",
    "@transfergo/shared": "workspace:*",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "lucide-react": "^0.460.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwind-merge": "^2.5.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

(`@transfergo/shared` was already a dependency of `packages/ui` from Plan 1 and is kept — not currently used by any component yet, but the transfer-state vocabulary belongs there and later plans in this package will need it for state-driven components.)

- [ ] **Step 2: Create the design tokens file**

`packages/ui/src/tokens/theme.css`:

```css
@theme {
  --color-bg: #0a0e17;
  --color-bg-elevated: #10141f;
  --color-text: #f4f6fb;
  --color-text-muted: #8b93a7;
  --color-border: rgba(255, 255, 255, 0.08);

  --color-accent: #4f8cff;
  --color-accent-foreground: #ffffff;

  --color-success: #5fd68a;
  --color-warning: #f5a623;
  --color-danger: #e85a5a;

  --color-security-normal: #5fd68a;
  --color-security-sensitive: #f5a623;
  --color-security-confidential: #a78bfa;

  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: ui-monospace, "SFMono-Regular", Consolas, monospace;

  --radius-sm: 0.375rem;
  --radius-md: 0.625rem;
  --radius-lg: 1rem;
}
```

This file has no `@import "tailwindcss";` of its own — it only defines tokens. Whoever imports it (`apps/web`, Storybook) is responsible for importing `tailwindcss` first, then this file.

- [ ] **Step 3: Create the `cn` utility**

`packages/ui/src/lib/cn.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Write the failing test for `Button`**

`packages/ui/src/components/Button.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button.js";

describe("Button", () => {
  it("renders children and applies the primary variant by default", () => {
    render(<Button>Nova transferência</Button>);
    const button = screen.getByRole("button", { name: "Nova transferência" });
    expect(button).toHaveClass("bg-accent");
  });

  it("applies the secondary variant class when variant is secondary", () => {
    render(<Button variant="secondary">Cancelar</Button>);
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveClass("bg-bg-elevated");
  });

  it("disables the button and marks it busy when isLoading is true", () => {
    render(<Button isLoading>Enviando</Button>);
    const button = screen.getByRole("button", { name: "Enviando" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Clique</Button>);
    await user.click(screen.getByRole("button", { name: "Clique" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders the child element instead of a button when asChild is set, keeping the button classes and the child's own attributes", () => {
    render(
      <Button asChild variant="secondary">
        <a href="/transferir">Nova transferência</a>
      </Button>
    );
    const link = screen.getByRole("link", { name: "Nova transferência" });
    expect(link).toHaveAttribute("href", "/transferir");
    expect(link).toHaveClass("bg-bg-elevated");
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @transfergo/ui run test`
Expected: FAIL — `Button.tsx` does not exist yet.

- [ ] **Step 6: Implement `Button`**

`packages/ui/src/components/Button.tsx`:

```tsx
"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md font-sans font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-foreground hover:bg-accent/90",
        secondary: "border border-border bg-bg-elevated text-text hover:bg-bg-elevated/80",
        ghost: "bg-transparent text-text hover:bg-bg-elevated",
        danger: "bg-danger text-accent-foreground hover:bg-danger/90"
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base"
      }
    },
    defaultVariants: {
      variant: "primary",
      size: "md"
    }
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  isLoading?: boolean;
}

export function Button({
  asChild = false,
  className,
  variant,
  size,
  isLoading = false,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={asChild ? undefined : disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...props}
    >
      {isLoading ? (
        <span
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      ) : null}
      {children}
    </Comp>
  );
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @transfergo/ui run test`
Expected: PASS (5 tests).

- [ ] **Step 8: Replace `packages/ui/src/index.ts` and delete the old scaffold test**

Delete `packages/ui/src/index.test.ts`.

`packages/ui/src/index.ts`:

```ts
export * from "./components/Button.js";
```

(Later tasks append one `export * from "./components/<Name>.js";` line per component and, in Task 6, `export * from "./icons/index.js";`.)

- [ ] **Step 9: Install dependencies, then verify test/typecheck/lint**

Run: `pnpm install`
Run: `pnpm --filter @transfergo/ui run test`
Expected: PASS (5 tests).
Run: `pnpm --filter @transfergo/ui run typecheck && pnpm --filter @transfergo/ui run lint`
Expected: both exit 0.

- [ ] **Step 10: Commit**

```bash
git add packages/ui pnpm-lock.yaml
git commit -m "feat(ui): add design tokens, cn utility and Button component"
```

---

## Task 2: `Input`, `Textarea`, `Card`, `Badge`

**Files:**
- Create: `packages/ui/src/components/Input.tsx`
- Test: `packages/ui/src/components/Input.test.tsx`
- Create: `packages/ui/src/components/Textarea.tsx`
- Test: `packages/ui/src/components/Textarea.test.tsx`
- Create: `packages/ui/src/components/Card.tsx`
- Test: `packages/ui/src/components/Card.test.tsx`
- Create: `packages/ui/src/components/Badge.tsx`
- Test: `packages/ui/src/components/Badge.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `cn` from Task 1.
- Produces: `Input`, `Textarea` (both with `error?: boolean`), `Card`, `Badge` (with `tone: "neutral"|"success"|"warning"|"danger"|"security-normal"|"security-sensitive"|"security-confidential"`) exported from `@transfergo/ui`. `Badge`'s `tone` values are the exact strings `SecurityLevelCard` (Task 6) maps its `level` prop to.

- [ ] **Step 1: Write the failing tests**

`packages/ui/src/components/Input.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "./Input.js";

describe("Input", () => {
  it("renders with the default border and no aria-invalid", () => {
    render(<Input placeholder="Cole o link aqui" />);
    const input = screen.getByPlaceholderText("Cole o link aqui");
    expect(input).toHaveClass("border-border");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("applies the error state when error is true", () => {
    render(<Input placeholder="Cole o link aqui" error />);
    const input = screen.getByPlaceholderText("Cole o link aqui");
    expect(input).toHaveClass("border-danger");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });
});
```

`packages/ui/src/components/Textarea.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Textarea } from "./Textarea.js";

describe("Textarea", () => {
  it("renders with the default border and no aria-invalid", () => {
    render(<Textarea placeholder="Mensagem" />);
    const textarea = screen.getByPlaceholderText("Mensagem");
    expect(textarea).toHaveClass("border-border");
    expect(textarea).not.toHaveAttribute("aria-invalid");
  });

  it("applies the error state when error is true", () => {
    render(<Textarea placeholder="Mensagem" error />);
    expect(screen.getByPlaceholderText("Mensagem")).toHaveClass("border-danger");
  });
});
```

`packages/ui/src/components/Card.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "./Card.js";

describe("Card", () => {
  it("renders children inside a bordered, elevated container", () => {
    render(<Card data-testid="card">Conteúdo</Card>);
    const card = screen.getByTestId("card");
    expect(card).toHaveTextContent("Conteúdo");
    expect(card).toHaveClass("border-border");
  });

  it("merges a custom className with the base classes", () => {
    render(
      <Card data-testid="card" className="mt-4">
        Conteúdo
      </Card>
    );
    expect(screen.getByTestId("card")).toHaveClass("mt-4");
  });
});
```

`packages/ui/src/components/Badge.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge.js";

describe("Badge", () => {
  it("applies the neutral tone by default", () => {
    render(<Badge>Normal</Badge>);
    expect(screen.getByText("Normal")).toHaveClass("text-text-muted");
  });

  it("applies each security tone correctly", () => {
    render(<Badge tone="security-sensitive">Sensível</Badge>);
    expect(screen.getByText("Sensível")).toHaveClass("text-security-sensitive");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @transfergo/ui run test`
Expected: FAIL — none of the four components exist yet.

- [ ] **Step 3: Implement `Input` and `Textarea`**

`packages/ui/src/components/Input.tsx`:

```tsx
"use client";

import type { InputHTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export function Input({ className, error, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-md border bg-bg-elevated px-3 text-sm text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50",
        error ? "border-danger" : "border-border",
        className
      )}
      aria-invalid={error || undefined}
      {...props}
    />
  );
}
```

`packages/ui/src/components/Textarea.tsx`:

```tsx
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
```

- [ ] **Step 4: Implement `Card`**

`packages/ui/src/components/Card.tsx`:

```tsx
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
```

- [ ] **Step 5: Implement `Badge`**

`packages/ui/src/components/Badge.tsx`:

```tsx
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

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @transfergo/ui run test`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 7: Export the new components**

Append to `packages/ui/src/index.ts`:

```ts
export * from "./components/Input.js";
export * from "./components/Textarea.js";
export * from "./components/Card.js";
export * from "./components/Badge.js";
```

- [ ] **Step 8: Verify typecheck and lint**

Run: `pnpm --filter @transfergo/ui run typecheck && pnpm --filter @transfergo/ui run lint`
Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): add Input, Textarea, Card and Badge components"
```

---

## Task 3: `ProgressBar`, `Spinner`

**Files:**
- Create: `packages/ui/src/components/ProgressBar.tsx`
- Test: `packages/ui/src/components/ProgressBar.test.tsx`
- Create: `packages/ui/src/components/Spinner.tsx`
- Test: `packages/ui/src/components/Spinner.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `cn` from Task 1.
- Produces: `ProgressBar` (`value: number`, `label?: string`) and `Spinner` (`size?: "sm"|"md"|"lg"`, `label?: string`) exported from `@transfergo/ui`. No later task in this plan consumes these directly, but they satisfy the spec §3.11/§6 "progress" requirement and are demonstrated in Storybook (Task 7).

- [ ] **Step 1: Write the failing tests**

`packages/ui/src/components/ProgressBar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "./ProgressBar.js";

describe("ProgressBar", () => {
  it("exposes the current value via ARIA progressbar attributes", () => {
    render(<ProgressBar value={74} label="video.mp4" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "74");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("clamps values outside the 0-100 range", () => {
    render(<ProgressBar value={150} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("renders the label and rounded percentage when a label is given", () => {
    render(<ProgressBar value={74.6} label="video.mp4" />);
    expect(screen.getByText("video.mp4")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
  });
});
```

`packages/ui/src/components/Spinner.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Spinner } from "./Spinner.js";

describe("Spinner", () => {
  it("renders a status role with a default label", () => {
    render(<Spinner />);
    expect(screen.getByRole("status", { name: "Carregando" })).toBeInTheDocument();
  });

  it("accepts a custom label", () => {
    render(<Spinner label="Conectando" />);
    expect(screen.getByRole("status", { name: "Conectando" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @transfergo/ui run test`
Expected: FAIL — neither component exists yet.

- [ ] **Step 3: Implement `ProgressBar`**

`packages/ui/src/components/ProgressBar.tsx`:

```tsx
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
```

- [ ] **Step 4: Implement `Spinner`**

`packages/ui/src/components/Spinner.tsx`:

```tsx
"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn.js";

const spinnerVariants = cva("animate-spin rounded-full border-2 border-current border-t-transparent text-accent", {
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
});

export interface SpinnerProps extends VariantProps<typeof spinnerVariants> {
  className?: string;
  label?: string;
}

export function Spinner({ size, className, label = "Carregando" }: SpinnerProps) {
  return <div role="status" aria-label={label} className={cn(spinnerVariants({ size }), className)} />;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @transfergo/ui run test`
Expected: PASS.

- [ ] **Step 6: Export the new components**

Append to `packages/ui/src/index.ts`:

```ts
export * from "./components/ProgressBar.js";
export * from "./components/Spinner.js";
```

- [ ] **Step 7: Verify typecheck and lint**

Run: `pnpm --filter @transfergo/ui run typecheck && pnpm --filter @transfergo/ui run lint`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): add ProgressBar and Spinner components"
```

---

## Task 4: `Dialog`, `Tooltip` (Radix)

**Files:**
- Create: `packages/ui/src/components/Dialog.tsx`
- Test: `packages/ui/src/components/Dialog.test.tsx`
- Create: `packages/ui/src/components/Tooltip.tsx`
- Test: `packages/ui/src/components/Tooltip.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `cn` from Task 1. `@radix-ui/react-dialog` and `@radix-ui/react-tooltip` (already added to `packages/ui/package.json` in Task 1).
- Produces: `Dialog`, `DialogTrigger`, `DialogContent`, `DialogTitle`, `DialogDescription`, `DialogClose`; `TooltipProvider`, `Tooltip`, `TooltipTrigger`, `TooltipContent` — all exported from `@transfergo/ui`.

- [ ] **Step 1: Write the failing test for `Dialog`**

`packages/ui/src/components/Dialog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./Dialog.js";

describe("Dialog", () => {
  it("opens on trigger click and closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Abrir</DialogTrigger>
        <DialogContent>
          <DialogTitle>Convite para transferência</DialogTitle>
          <DialogDescription>Um dispositivo deseja estabelecer uma sessão.</DialogDescription>
        </DialogContent>
      </Dialog>
    );

    expect(screen.queryByText("Convite para transferência")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Abrir" }));
    expect(await screen.findByText("Convite para transferência")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByText("Convite para transferência")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write the failing test for `Tooltip`**

`packages/ui/src/components/Tooltip.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./Tooltip.js";

describe("Tooltip", () => {
  it("shows the tooltip content when the trigger receives focus", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger>Ajuda</TooltipTrigger>
          <TooltipContent>Link expira em 24 horas</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    expect(screen.queryByText("Link expira em 24 horas")).not.toBeInTheDocument();
    await user.tab();
    expect(await screen.findByText("Link expira em 24 horas")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @transfergo/ui run test`
Expected: FAIL — neither component exists yet.

- [ ] **Step 4: Implement `Dialog`**

`packages/ui/src/components/Dialog.tsx`:

```tsx
"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../lib/cn.js";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-bg-elevated p-6 shadow-xl focus:outline-none",
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({ className, ...props }: ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-lg font-semibold text-text", className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("mt-2 text-sm text-text-muted", className)} {...props} />;
}
```

- [ ] **Step 5: Implement `Tooltip`**

`packages/ui/src/components/Tooltip.tsx`:

```tsx
"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../lib/cn.js";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 rounded-md border border-border bg-bg-elevated px-2.5 py-1.5 text-xs text-text shadow-md",
          className
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @transfergo/ui run test`
Expected: PASS.

- [ ] **Step 7: Export the new components**

Append to `packages/ui/src/index.ts`:

```ts
export * from "./components/Dialog.js";
export * from "./components/Tooltip.js";
```

- [ ] **Step 8: Verify typecheck and lint**

Run: `pnpm --filter @transfergo/ui run typecheck && pnpm --filter @transfergo/ui run lint`
Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): add Dialog and Tooltip components on Radix primitives"
```

---

## Task 5: `Toast` (Radix)

**Files:**
- Create: `packages/ui/src/components/Toast.tsx`
- Test: `packages/ui/src/components/Toast.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `cn` from Task 1, `@radix-ui/react-toast` (already in `packages/ui/package.json` from Task 1).
- Produces: `ToastProvider`, `ToastViewport`, `Toast` (props: `title: string`, `description?: string`, plus everything `@radix-ui/react-toast`'s `Root` accepts, e.g. `open`) exported from `@transfergo/ui`.

- [ ] **Step 1: Write the failing test**

`packages/ui/src/components/Toast.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Toast, ToastProvider, ToastViewport } from "./Toast.js";

describe("Toast", () => {
  it("renders the title and description inside the provider/viewport", () => {
    render(
      <ToastProvider>
        <Toast open title="Transferência concluída" description="Integridade verificada (SHA-256)." />
        <ToastViewport />
      </ToastProvider>
    );

    expect(screen.getByText("Transferência concluída")).toBeInTheDocument();
    expect(screen.getByText("Integridade verificada (SHA-256).")).toBeInTheDocument();
  });

  it("renders only the title when no description is given", () => {
    render(
      <ToastProvider>
        <Toast open title="Link copiado" />
        <ToastViewport />
      </ToastProvider>
    );

    expect(screen.getByText("Link copiado")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @transfergo/ui run test`
Expected: FAIL — `Toast.tsx` does not exist yet.

- [ ] **Step 3: Implement `Toast`**

`packages/ui/src/components/Toast.tsx`:

```tsx
"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../lib/cn.js";

export const ToastProvider = ToastPrimitive.Provider;

export function ToastViewport({ className, ...props }: ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>) {
  return (
    <ToastPrimitive.Viewport
      className={cn("fixed bottom-0 right-0 z-50 flex w-full max-w-sm flex-col gap-2 p-4", className)}
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
      <ToastPrimitive.Title className="text-sm font-semibold text-text">{title}</ToastPrimitive.Title>
      {description ? (
        <ToastPrimitive.Description className="mt-1 text-sm text-text-muted">
          {description}
        </ToastPrimitive.Description>
      ) : null}
    </ToastPrimitive.Root>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @transfergo/ui run test`
Expected: PASS.

- [ ] **Step 5: Export the new component**

Append to `packages/ui/src/index.ts`:

```ts
export * from "./components/Toast.js";
```

- [ ] **Step 6: Verify typecheck and lint**

Run: `pnpm --filter @transfergo/ui run typecheck && pnpm --filter @transfergo/ui run lint`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): add Toast component on Radix primitives"
```

---

## Task 6: Icons module, `StateScreen`, `SecurityLevelCard`

**Files:**
- Create: `packages/ui/src/icons/index.ts`
- Create: `packages/ui/src/components/StateScreen.tsx`
- Test: `packages/ui/src/components/StateScreen.test.tsx`
- Create: `packages/ui/src/components/SecurityLevelCard.tsx`
- Test: `packages/ui/src/components/SecurityLevelCard.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `Button` and `cn` from Task 1. `lucide-react` (already in `packages/ui/package.json` from Task 1).
- Produces: a curated set of icons re-exported from `@transfergo/ui` (used by later tasks — never import `lucide-react` directly outside `packages/ui`). `StateScreen` (`icon: LucideIcon`, `tone?: "neutral"|"success"|"warning"|"danger"|"security-normal"|"security-sensitive"|"security-confidential"`, `title: string`, `description: string`, `action?: { label: string; onClick: () => void }`) — the single component every one of the spec's 17 required UI states is built from. `SecurityLevelCard` (`level: "normal"|"sensitive"|"confidential"`, `action?: StateScreenAction`) wraps `StateScreen`. Both exported from `@transfergo/ui`. `apps/web`'s `/transferir` placeholder (Task 9) consumes `StateScreen` directly.

- [ ] **Step 1: Create the icons module**

`packages/ui/src/icons/index.ts`:

```ts
export {
  AlertTriangle,
  CheckCircle2,
  Construction,
  Github,
  Inbox,
  Lock,
  MousePointerClick,
  Share2,
  ShieldCheck,
  Wifi,
  WifiOff,
  type LucideIcon
} from "lucide-react";
```

This list only re-exports icons this plan actually uses (spec §6/item 69 — "só os ícones usados"). Later plans that need another state's icon (e.g. a clock for `expired`, an X for `cancelled`) add one more named export to this same file rather than importing `lucide-react` directly.

- [ ] **Step 2: Write the failing test for `StateScreen`**

`packages/ui/src/components/StateScreen.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CheckCircle2 } from "../icons/index.js";
import { StateScreen } from "./StateScreen.js";

describe("StateScreen", () => {
  it("renders the title and description", () => {
    render(
      <StateScreen
        icon={CheckCircle2}
        tone="success"
        title="Transferência concluída"
        description="Integridade verificada (SHA-256)."
      />
    );

    expect(screen.getByRole("heading", { name: "Transferência concluída" })).toBeInTheDocument();
    expect(screen.getByText("Integridade verificada (SHA-256).")).toBeInTheDocument();
  });

  it("renders no action button when action is omitted", () => {
    render(<StateScreen icon={CheckCircle2} title="Vazio" description="Nada por aqui ainda." />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("calls the action handler when the action button is clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <StateScreen
        icon={CheckCircle2}
        title="Sessão expirada"
        description="Peça um novo link ao remetente."
        action={{ label: "Voltar ao início", onClick }}
      />
    );

    await user.click(screen.getByRole("button", { name: "Voltar ao início" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: Write the failing test for `SecurityLevelCard`**

`packages/ui/src/components/SecurityLevelCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SecurityLevelCard } from "./SecurityLevelCard.js";

describe("SecurityLevelCard", () => {
  it("renders the normal level title", () => {
    render(<SecurityLevelCard level="normal" />);
    expect(screen.getByRole("heading", { name: "Transferência normal" })).toBeInTheDocument();
  });

  it("renders the sensitive level title", () => {
    render(<SecurityLevelCard level="sensitive" />);
    expect(screen.getByRole("heading", { name: "Conteúdo sensível" })).toBeInTheDocument();
  });

  it("renders the confidential level title", () => {
    render(<SecurityLevelCard level="confidential" />);
    expect(screen.getByRole("heading", { name: "Conteúdo confidencial" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm --filter @transfergo/ui run test`
Expected: FAIL — neither component exists yet.

- [ ] **Step 5: Implement `StateScreen`**

`packages/ui/src/components/StateScreen.tsx`:

```tsx
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
```

- [ ] **Step 6: Implement `SecurityLevelCard`**

`packages/ui/src/components/SecurityLevelCard.tsx`:

```tsx
"use client";

import { AlertTriangle, CheckCircle2, Lock } from "../icons/index.js";
import { StateScreen, type StateScreenAction } from "./StateScreen.js";

const LEVEL_CONFIG = {
  normal: {
    icon: CheckCircle2,
    tone: "security-normal" as const,
    title: "Transferência normal",
    description: "Confirme para receber este arquivo."
  },
  sensitive: {
    icon: AlertTriangle,
    tone: "security-sensitive" as const,
    title: "Conteúdo sensível",
    description: "Confirme que você estava esperando esta transferência."
  },
  confidential: {
    icon: Lock,
    tone: "security-confidential" as const,
    title: "Conteúdo confidencial",
    description: "Você precisará de uma chave obtida diretamente com o remetente."
  }
};

export interface SecurityLevelCardProps {
  level: keyof typeof LEVEL_CONFIG;
  action?: StateScreenAction;
}

export function SecurityLevelCard({ level, action }: SecurityLevelCardProps) {
  const config = LEVEL_CONFIG[level];
  return (
    <StateScreen icon={config.icon} tone={config.tone} title={config.title} description={config.description} action={action} />
  );
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @transfergo/ui run test`
Expected: PASS.

- [ ] **Step 8: Export the new modules**

Append to `packages/ui/src/index.ts`:

```ts
export * from "./icons/index.js";
export * from "./components/StateScreen.js";
export * from "./components/SecurityLevelCard.js";
```

- [ ] **Step 9: Verify typecheck and lint**

Run: `pnpm --filter @transfergo/ui run typecheck && pnpm --filter @transfergo/ui run lint`
Expected: both exit 0.

- [ ] **Step 10: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): add icons module, StateScreen and SecurityLevelCard"
```

---

## Task 7: Storybook showcase

**Files:**
- Create: `packages/ui/.storybook/main.ts`
- Create: `packages/ui/.storybook/preview.ts`
- Create: `packages/ui/.storybook/preview.css`
- Create: `packages/ui/src/components/Button.stories.tsx`
- Create: `packages/ui/src/components/Input.stories.tsx`
- Create: `packages/ui/src/components/Textarea.stories.tsx`
- Create: `packages/ui/src/components/Card.stories.tsx`
- Create: `packages/ui/src/components/Badge.stories.tsx`
- Create: `packages/ui/src/components/ProgressBar.stories.tsx`
- Create: `packages/ui/src/components/Spinner.stories.tsx`
- Create: `packages/ui/src/components/Dialog.stories.tsx`
- Create: `packages/ui/src/components/Tooltip.stories.tsx`
- Create: `packages/ui/src/components/Toast.stories.tsx`
- Create: `packages/ui/src/components/StateScreen.stories.tsx`
- Create: `packages/ui/src/components/SecurityLevelCard.stories.tsx`
- Modify: `packages/ui/package.json` (add Storybook + Vite devDependencies)
- Modify: `turbo.json` (add `build-storybook` task)
- Modify: `.github/workflows/ci.yml` (run `build-storybook`)
- Modify: `.gitignore`, `.prettierignore` (ignore `storybook-static`)

**Interfaces:**
- Consumes: every component exported from `packages/ui/src/index.ts` (Tasks 1–6).
- Produces: nothing later tasks import — this is a demonstration/verification surface, not a code dependency.

- [ ] **Step 1: Add Storybook and Vite devDependencies**

Edit `packages/ui/package.json`'s `devDependencies` to add:

```json
    "@storybook/addon-essentials": "^8.4.0",
    "@storybook/react-vite": "^8.4.0",
    "@tailwindcss/vite": "^4.0.0",
    "storybook": "^8.4.0",
    "vite": "^5.4.0",
```

(Keep the existing entries — this adds five new lines to the existing `devDependencies` object, alphabetically sorted alongside them.)

- [ ] **Step 2: Create the Storybook config**

`packages/ui/.storybook/main.ts`:

```ts
import { mergeConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-essentials"],
  framework: {
    name: "@storybook/react-vite",
    options: {}
  },
  async viteFinal(viteConfig) {
    return mergeConfig(viteConfig, {
      plugins: [tailwindcss()]
    });
  }
};

export default config;
```

`packages/ui/.storybook/preview.css`:

```css
@import "tailwindcss";
@import "../src/tokens/theme.css";
@source "../src";
```

`packages/ui/.storybook/preview.ts`:

```ts
import type { Preview } from "@storybook/react";
import "./preview.css";

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#0a0e17" }]
    }
  }
};

export default preview;
```

- [ ] **Step 3: Write stories for the foundational components (Button, Input, Textarea, Card, Badge)**

`packages/ui/src/components/Button.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button.js";

const meta: Meta<typeof Button> = {
  title: "Ações/Button",
  component: Button,
  args: { children: "Nova transferência" }
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = { args: { variant: "primary" } };
export const Secondary: Story = { args: { variant: "secondary" } };
export const Ghost: Story = { args: { variant: "ghost" } };
export const Danger: Story = { args: { variant: "danger", children: "Recusar" } };
export const Loading: Story = { args: { isLoading: true, children: "Enviando" } };
```

`packages/ui/src/components/Input.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "./Input.js";

const meta: Meta<typeof Input> = {
  title: "Entrada/Input",
  component: Input,
  args: { placeholder: "https://transfergo.app/s/..." }
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {};
export const Error: Story = { args: { error: true, defaultValue: "link-invalido" } };
export const Disabled: Story = { args: { disabled: true } };
```

`packages/ui/src/components/Textarea.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Textarea } from "./Textarea.js";

const meta: Meta<typeof Textarea> = {
  title: "Entrada/Textarea",
  component: Textarea,
  args: { placeholder: "Mensagem para o destinatário (opcional)" }
};

export default meta;
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {};
export const Error: Story = { args: { error: true } };
```

`packages/ui/src/components/Card.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Card } from "./Card.js";

const meta: Meta<typeof Card> = {
  title: "Conteúdo/Card",
  component: Card
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  args: {
    children: "Um card do design system, com o vidro fosco discreto da direção Dark Tech."
  }
};
```

`packages/ui/src/components/Badge.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "./Badge.js";

const meta: Meta<typeof Badge> = {
  title: "Conteúdo/Badge",
  component: Badge,
  args: { children: "Normal" }
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Neutral: Story = { args: { tone: "neutral" } };
export const Success: Story = { args: { tone: "success", children: "Concluído" } };
export const Warning: Story = { args: { tone: "warning", children: "Atenção" } };
export const Danger: Story = { args: { tone: "danger", children: "Falha" } };
export const SecurityNormal: Story = { args: { tone: "security-normal", children: "Normal" } };
export const SecuritySensitive: Story = { args: { tone: "security-sensitive", children: "Sensível" } };
export const SecurityConfidential: Story = {
  args: { tone: "security-confidential", children: "Confidencial" }
};
```

- [ ] **Step 4: Write stories for the progress and overlay components (ProgressBar, Spinner, Dialog, Tooltip)**

`packages/ui/src/components/ProgressBar.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { ProgressBar } from "./ProgressBar.js";

const meta: Meta<typeof ProgressBar> = {
  title: "Progresso/ProgressBar",
  component: ProgressBar
};

export default meta;
type Story = StoryObj<typeof ProgressBar>;

export const WithLabel: Story = { args: { value: 74, label: "video.mp4" } };
export const WithoutLabel: Story = { args: { value: 40 } };
export const Complete: Story = { args: { value: 100, label: "relatorio.pdf" } };
```

`packages/ui/src/components/Spinner.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Spinner } from "./Spinner.js";

const meta: Meta<typeof Spinner> = {
  title: "Progresso/Spinner",
  component: Spinner
};

export default meta;
type Story = StoryObj<typeof Spinner>;

export const Small: Story = { args: { size: "sm" } };
export const Medium: Story = { args: { size: "md" } };
export const Large: Story = { args: { size: "lg" } };
```

`packages/ui/src/components/Dialog.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./Dialog.js";

const meta: Meta<typeof Dialog> = {
  title: "Overlays/Dialog",
  component: Dialog
};

export default meta;
type Story = StoryObj<typeof Dialog>;

export const InviteConfirmation: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Abrir convite</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Convite para transferência</DialogTitle>
        <DialogDescription>Um dispositivo deseja estabelecer uma sessão de compartilhamento.</DialogDescription>
      </DialogContent>
    </Dialog>
  )
};
```

`packages/ui/src/components/Tooltip.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./Tooltip.js";

const meta: Meta<typeof Tooltip> = {
  title: "Overlays/Tooltip",
  component: Tooltip
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const OnButton: Story = {
  render: () => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost">Copiar link</Button>
        </TooltipTrigger>
        <TooltipContent>Link expira em 24 horas</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
};
```

- [ ] **Step 5: Write stories for the feedback components (Toast, StateScreen, SecurityLevelCard)**

`packages/ui/src/components/Toast.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Toast, ToastProvider, ToastViewport } from "./Toast.js";

const meta: Meta<typeof Toast> = {
  title: "Overlays/Toast",
  component: Toast
};

export default meta;
type Story = StoryObj<typeof Toast>;

export const Success: Story = {
  render: () => (
    <ToastProvider>
      <Toast open title="Transferência concluída" description="Integridade verificada (SHA-256)." />
      <ToastViewport />
    </ToastProvider>
  )
};

export const TitleOnly: Story = {
  render: () => (
    <ToastProvider>
      <Toast open title="Link copiado" />
      <ToastViewport />
    </ToastProvider>
  )
};
```

`packages/ui/src/components/StateScreen.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { AlertTriangle, CheckCircle2, Inbox, WifiOff } from "../icons/index.js";
import { StateScreen } from "./StateScreen.js";

const meta: Meta<typeof StateScreen> = {
  title: "Estados/StateScreen",
  component: StateScreen
};

export default meta;
type Story = StoryObj<typeof StateScreen>;

export const Success: Story = {
  args: {
    icon: CheckCircle2,
    tone: "success",
    title: "Transferência concluída",
    description: "Integridade verificada (SHA-256)."
  }
};

export const Empty: Story = {
  args: {
    icon: Inbox,
    title: "Nenhuma transferência ainda",
    description: "Quando você enviar ou receber um arquivo, ele aparece aqui."
  }
};

export const Offline: Story = {
  args: {
    icon: WifiOff,
    tone: "warning",
    title: "Conexão perdida",
    description: "Tentando reconectar automaticamente."
  }
};

export const Error: Story = {
  args: {
    icon: AlertTriangle,
    tone: "danger",
    title: "Sessão expirada",
    description: "Peça um novo link ao remetente.",
    action: { label: "Voltar ao início", onClick: () => {} }
  }
};
```

`packages/ui/src/components/SecurityLevelCard.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { SecurityLevelCard } from "./SecurityLevelCard.js";

const meta: Meta<typeof SecurityLevelCard> = {
  title: "Estados/SecurityLevelCard",
  component: SecurityLevelCard
};

export default meta;
type Story = StoryObj<typeof SecurityLevelCard>;

export const Normal: Story = { args: { level: "normal" } };
export const Sensitive: Story = { args: { level: "sensitive" } };
export const Confidential: Story = { args: { level: "confidential" } };
```

- [ ] **Step 6: Install dependencies and build Storybook**

Run: `pnpm install`
Run: `pnpm --filter @transfergo/ui run build-storybook`
Expected: exits 0, produces `packages/ui/storybook-static/`.

- [ ] **Step 7: Wire Storybook into Turborepo and CI**

Edit `turbo.json` — add a `build-storybook` entry to `tasks` (alongside the existing `build`, `dev`, `lint`, `typecheck`, `test`):

```json
    "build-storybook": {
      "outputs": ["storybook-static/**"]
    },
```

Edit `.github/workflows/ci.yml` — change the last step from:

```yaml
      - run: pnpm turbo run lint typecheck test build
```

to:

```yaml
      - run: pnpm turbo run lint typecheck test build build-storybook
```

- [ ] **Step 8: Ignore the Storybook build output**

Append `storybook-static` to `.gitignore` and `.prettierignore` (each on its own new line, alongside the existing entries).

- [ ] **Step 9: Verify the full monorepo build including Storybook**

Run: `pnpm turbo run lint typecheck test build build-storybook`
Expected: every task in every workspace succeeds, including the new `build-storybook` task for `@transfergo/ui`.

- [ ] **Step 10: Commit**

```bash
git add packages/ui turbo.json .github/workflows/ci.yml .gitignore .prettierignore pnpm-lock.yaml
git commit -m "feat(ui): add Storybook showcase for the full component library"
```

---

## Task 8: `apps/web` — Tailwind wiring, self-hosted Inter, premium home page

**Files:**
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/postcss.config.mjs`
- Modify: `apps/web/next.config.ts` (add `@transfergo/ui` to `transpilePackages`)
- Modify: `apps/web/package.json` (add `@transfergo/ui` dependency, Tailwind v4 + `@fontsource/inter` devDependencies)
- Modify: `apps/web/src/app/layout.tsx` (import `globals.css`, apply base typography classes)
- Create: `apps/web/src/components/home/Hero.tsx`
- Test: `apps/web/src/components/home/Hero.test.tsx`
- Create: `apps/web/src/components/home/HowItWorks.tsx`
- Create: `apps/web/src/components/home/TrustSection.tsx`
- Create: `apps/web/src/components/home/Footer.tsx`
- Modify: `apps/web/src/app/page.tsx` (replace the Plan 1 placeholder)
- Modify: `apps/web/src/app/page.test.tsx` (replace the Plan 1 assertions)

**Interfaces:**
- Consumes: `Button` and the icons re-exported from `@transfergo/ui` (Tasks 1 and 6).
- Produces: `Hero`, `HowItWorks`, `TrustSection`, `Footer` — consumed only by `apps/web/src/app/page.tsx` in this same task. `HomePage` default export at `apps/web/src/app/page.tsx` is consumed by Plan 4 when the real "Nova transferência" flow replaces the `/transferir` placeholder link.

- [ ] **Step 1: Add `@transfergo/ui` and Tailwind dependencies to `apps/web`**

Edit `apps/web/package.json`:
- In `dependencies`, add `"@transfergo/ui": "workspace:*",` (alphabetically before `"next"`).
- In `devDependencies`, add:

```json
    "@fontsource/inter": "^5.1.0",
    "@tailwindcss/postcss": "^4.0.0",
    "tailwindcss": "^4.0.0",
```

(alphabetically alongside the existing entries).

- [ ] **Step 2: Add `@transfergo/ui` to `transpilePackages`**

`apps/web/next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@transfergo/shared", "@transfergo/ui"],
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"]
    }
  }
};

export default nextConfig;
```

- [ ] **Step 3: Create the PostCSS config for Tailwind v4**

`apps/web/postcss.config.mjs`:

```js
export default {
  plugins: {
    "@tailwindcss/postcss": {}
  }
};
```

- [ ] **Step 4: Create `globals.css`**

`apps/web/src/app/globals.css`:

```css
@import "tailwindcss";
@import "@fontsource/inter/400.css";
@import "@fontsource/inter/500.css";
@import "@fontsource/inter/600.css";
@import "@fontsource/inter/700.css";
@import "@transfergo/ui/tokens.css";
@source "../../../../packages/ui/src";
```

The `@source` path is relative to this file (`apps/web/src/app/globals.css`): four levels up reaches the repo root (`app` → `src` → `web` → `apps`), then down into `packages/ui/src`. This tells Tailwind v4 to scan `@transfergo/ui`'s components for class names — its automatic content detection only scans within `apps/web`'s own directory tree, not sibling workspace packages.

- [ ] **Step 5: Update `layout.tsx` to import the stylesheet and apply base typography**

`apps/web/src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "TransferGo",
  description: "Transferência de arquivos segura, direta e sem instalação."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-bg font-sans text-text antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 6: Write the failing test for `Hero`**

`apps/web/src/components/home/Hero.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Hero } from "./Hero.js";

describe("Hero", () => {
  it("renders the headline and a primary CTA linking to /transferir", () => {
    render(<Hero />);
    expect(
      screen.getByRole("heading", { name: "Transfira arquivos com segurança entre seus dispositivos." })
    ).toBeInTheDocument();

    const cta = screen.getByRole("link", { name: "Nova transferência" });
    expect(cta).toHaveAttribute("href", "/transferir");
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm --filter @transfergo/web run test`
Expected: FAIL — `Hero.tsx` does not exist yet.

- [ ] **Step 8: Implement `Hero`**

`apps/web/src/components/home/Hero.tsx`:

```tsx
import Link from "next/link";
import { Button } from "@transfergo/ui";

export function Hero() {
  return (
    <section className="flex flex-col items-center px-6 py-24 text-center">
      <span className="mb-4 text-sm font-medium uppercase tracking-widest text-text-muted">TransferGo</span>
      <h1 className="max-w-2xl text-4xl font-bold leading-tight text-text sm:text-5xl">
        Transfira arquivos com segurança entre seus dispositivos.
      </h1>
      <p className="mt-4 max-w-xl text-text-muted">
        Conexão direta entre seus aparelhos, sem armazenar nada nos nossos servidores.
      </p>
      <Button asChild size="lg" className="mt-8">
        <Link href="/transferir">Nova transferência</Link>
      </Button>
      <p className="mt-4 text-xs uppercase tracking-widest text-text-muted">Rápido • Seguro • Direto</p>
    </section>
  );
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm --filter @transfergo/web run test`
Expected: PASS.

- [ ] **Step 10: Implement `HowItWorks`, `TrustSection` and `Footer`**

`apps/web/src/components/home/HowItWorks.tsx`:

```tsx
import { MousePointerClick, Share2, Wifi } from "@transfergo/ui";

const STEPS = [
  { icon: MousePointerClick, title: "Selecionar", description: "Escolha um ou mais arquivos no seu dispositivo." },
  { icon: Wifi, title: "Conectar", description: "Compartilhe o link seguro com o outro dispositivo." },
  { icon: Share2, title: "Transferir", description: "Os arquivos vão direto de um dispositivo para o outro." }
];

export function HowItWorks() {
  return (
    <section className="px-6 py-16">
      <h2 className="text-center text-2xl font-semibold text-text">Como funciona</h2>
      <div className="mx-auto mt-10 grid max-w-4xl gap-8 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <div key={step.title} className="flex flex-col items-center text-center">
            <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-bg-elevated text-accent">
              <step.icon className="size-6" aria-hidden="true" />
            </div>
            <h3 className="text-sm font-semibold text-text">
              {index + 1}. {step.title}
            </h3>
            <p className="mt-2 text-sm text-text-muted">{step.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
```

`apps/web/src/components/home/TrustSection.tsx`:

```tsx
import { Lock, ShieldCheck, Wifi } from "@transfergo/ui";

const POINTS = [
  {
    icon: Wifi,
    title: "P2P direto",
    description: "Os arquivos trafegam direto entre os dispositivos, sem passar pelo nosso servidor."
  },
  {
    icon: ShieldCheck,
    title: "Zero armazenamento",
    description: "Nenhum arquivo fica salvo nos servidores do TransferGo."
  },
  {
    icon: Lock,
    title: "Criptografado",
    description: "A conexão usa WebRTC com criptografia de transporte (DTLS)."
  }
];

export function TrustSection() {
  return (
    <section className="border-t border-border px-6 py-16">
      <div className="mx-auto grid max-w-4xl gap-8 sm:grid-cols-3">
        {POINTS.map((point) => (
          <div key={point.title} className="rounded-lg border border-border bg-bg-elevated/60 p-6">
            <point.icon className="size-5 text-accent" aria-hidden="true" />
            <h3 className="mt-3 text-sm font-semibold text-text">{point.title}</h3>
            <p className="mt-2 text-sm text-text-muted">{point.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
```

`apps/web/src/components/home/Footer.tsx`:

```tsx
import { Github } from "@transfergo/ui";

export function Footer() {
  return (
    <footer className="flex items-center justify-center gap-2 border-t border-border px-6 py-8 text-sm text-text-muted">
      <a
        href="https://github.com/Edilson-5762/transfergo"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 hover:text-text"
      >
        <Github className="size-4" aria-hidden="true" />
        GitHub
      </a>
    </footer>
  );
}
```

- [ ] **Step 11: Replace the home page and its test**

`apps/web/src/app/page.tsx`:

```tsx
import { Footer } from "../components/home/Footer.js";
import { Hero } from "../components/home/Hero.js";
import { HowItWorks } from "../components/home/HowItWorks.js";
import { TrustSection } from "../components/home/TrustSection.js";

export default function HomePage() {
  return (
    <main>
      <Hero />
      <HowItWorks />
      <TrustSection />
      <Footer />
    </main>
  );
}
```

`apps/web/src/app/page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page.js";

describe("HomePage", () => {
  it("renders the hero headline and primary call to action", () => {
    render(<HomePage />);
    expect(
      screen.getByRole("heading", { name: "Transfira arquivos com segurança entre seus dispositivos." })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nova transferência" })).toHaveAttribute("href", "/transferir");
  });

  it("renders the three how-it-works steps in order", () => {
    render(<HomePage />);
    expect(screen.getByText("1. Selecionar")).toBeInTheDocument();
    expect(screen.getByText("2. Conectar")).toBeInTheDocument();
    expect(screen.getByText("3. Transferir")).toBeInTheDocument();
  });

  it("renders a GitHub link in the footer", () => {
    render(<HomePage />);
    expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/Edilson-5762/transfergo"
    );
  });
});
```

- [ ] **Step 12: Install dependencies and run the full `apps/web` test suite**

Run: `pnpm install`
Run: `pnpm --filter @transfergo/web run test`
Expected: PASS (`Hero.test.tsx` + `page.test.tsx`, 4 tests total).

- [ ] **Step 13: Verify typecheck, lint and production build**

Run: `pnpm --filter @transfergo/web run typecheck && pnpm --filter @transfergo/web run lint`
Expected: both exit 0.

Run: `pnpm --filter @transfergo/web run build`
Expected: exits 0, `.next/` output produced, Tailwind classes from `@transfergo/ui` compile into the CSS output (no unstyled-looking build — if classes like `bg-accent` are missing from the compiled CSS, the `@source` path in Step 4 is wrong and must be fixed before continuing).

- [ ] **Step 14: Manual visual check**

Run in one terminal: `pnpm --filter @transfergo/web run dev`
Open `http://localhost:3000` in a browser.
Expected: dark background, Inter typeface, blue "Nova transferência" button, three how-it-works steps, trust section, GitHub footer link — matching the Dark Tech direction approved during brainstorming. Stop the dev server (Ctrl+C) after confirming.

- [ ] **Step 15: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): wire Tailwind v4 + Inter and rebuild the home page on @transfergo/ui"
```

---

## Task 9: `/transferir` placeholder route + final verification

**Files:**
- Create: `apps/web/src/app/transferir/page.tsx`
- Test: `apps/web/src/app/transferir/page.test.tsx`

**Interfaces:**
- Consumes: `StateScreen` and `Construction` from `@transfergo/ui` (Task 6). The `Hero` CTA (Task 8) already links to `/transferir`; this task makes that route exist.
- Produces: nothing later tasks in this plan depend on. Plan 4 ("Sessões") replaces this file's contents with the real session-creation flow but keeps the route path.

- [ ] **Step 1: Write the failing test**

`apps/web/src/app/transferir/page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TransferPlaceholderPage from "./page.js";

describe("TransferPlaceholderPage", () => {
  it("renders an under-construction message", () => {
    render(<TransferPlaceholderPage />);
    expect(screen.getByRole("heading", { name: "Em construção" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @transfergo/web run test`
Expected: FAIL — the route does not exist yet.

- [ ] **Step 3: Implement the placeholder route**

`apps/web/src/app/transferir/page.tsx`:

```tsx
import { Construction, StateScreen } from "@transfergo/ui";

export default function TransferPlaceholderPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <StateScreen
        icon={Construction}
        title="Em construção"
        description="A criação de sessões de transferência chega em um próximo passo do projeto."
      />
    </main>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @transfergo/web run test`
Expected: PASS.

- [ ] **Step 5: Verify typecheck, lint and build**

Run: `pnpm --filter @transfergo/web run typecheck && pnpm --filter @transfergo/web run lint && pnpm --filter @transfergo/web run build`
Expected: all exit 0.

- [ ] **Step 6: Verify the whole monorepo is green**

Run: `pnpm turbo run lint typecheck test build build-storybook`
Expected: every task in every workspace succeeds (2 apps + 4 packages, including `@transfergo/ui`'s new tests and Storybook build).

- [ ] **Step 7: Manual boot check**

Run: `pnpm dev`
Expected: `apps/web` (port 3000), `apps/signaling-server` (port 4000) and `@transfergo/ui`'s Storybook (port 6006) all start without errors.
In another terminal: `curl http://localhost:3000 | grep "Nova transferência"` and `curl http://localhost:3000/transferir | grep "Em constru"`.
Expected: both matches found. Stop with Ctrl+C.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): add /transferir placeholder route"
```

---

## Definition of Done for this plan

- [ ] `pnpm turbo run lint typecheck test build build-storybook` passes with zero errors across all workspaces.
- [ ] `pnpm dev` boots `apps/web`, `apps/signaling-server` and Storybook concurrently without errors.
- [ ] `packages/ui` exports the full component library from spec §6: Button, Input, Textarea, Card, Badge, ProgressBar, Spinner, Dialog, Tooltip, Toast, StateScreen, SecurityLevelCard — each demonstrated in Storybook with every variant/tone.
- [ ] `apps/web`'s home page is built entirely from `@transfergo/ui` components, in the approved Dark Tech visual direction, with a working `/transferir` link.
- [ ] Color contrast and keyboard navigation manually verified on Button, Input, Dialog and Toast.
- [ ] GitHub Actions `CI` workflow is green on `main` (including `build-storybook`).
- [ ] All 9 tasks committed and pushed to `https://github.com/Edilson-5762/transfergo`.

Next plan: **Plano 3/9 — Sessões** (implements session creation, secure link generation and the accept/reject flow referenced by spec §3.3–§3.5, wiring the `/transferir` route built in this plan to real state for the first time).
