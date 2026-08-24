# TransferGo V1 — Plano 1/9: Fundação & Monorepo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the TransferGo monorepo (pnpm + Turborepo) with a working, testable, CI-verified skeleton: a Next.js web app, a Node.js signaling server with a health check, and four empty-but-wired workspace packages (`shared`, `transfer-engine`, `security`, `ui`).

**Architecture:** pnpm workspaces + Turborepo orchestrate two apps (`apps/web`, `apps/signaling-server`) and four packages (`packages/shared`, `packages/transfer-engine`, `packages/security`, `packages/ui`). Internal packages are consumed as raw TypeScript source (no build step) — Next.js via `transpilePackages`, the signaling server via `tsx`. Every workspace exposes the same script surface (`lint`, `typecheck`, `test`, and `dev`/`build` where relevant) so Turborepo can run them uniformly and in parallel.

**Tech Stack:** TypeScript 5 (strict), pnpm 11, Turborepo 2, Next.js 15 (App Router, React 19), Node.js `http` (no framework) for the signaling server, `tsx` for running TS in Node without a build step, Vitest 2 for all tests (+ Testing Library for the web app), ESLint 9 flat config + `typescript-eslint`, Prettier 3, GitHub Actions for CI.

**Spec:** `docs/superpowers/specs/2026-08-24-transfergo-design.md`

## Global Constraints

- Node.js `>=20.9.0`; package manager is `pnpm@11.23.0` pinned via `packageManager` in root `package.json` (spec §7.1, §0).
- Monorepo orchestration is pnpm workspaces + Turborepo — no other monorepo tool (spec §0, §7.1).
- All TypeScript is written in `strict` mode; no `any` introduced to work around type errors (spec §0 — "Security by Design" applies to tooling rigor, not just runtime code).
- Every workspace package/app that has a `test` script must be runnable via `pnpm --filter <name> run test` and via `pnpm turbo run test` from the root.
- Nomenclature interna dos estados de transferência é em inglês (`queued`, `preparing`, ...); a UI é localizada em pt-BR (spec §3.11). This plan only defines the type/constant; no UI copy is written yet.
- No file transfer, signaling protocol, or UI design work happens in this plan — those are later plans (2–9). This plan's only job is a green, wired monorepo.

---

## Task 1: Root monorepo tooling + `packages/shared`

**Files:**

- Create: `package.json` (root)
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `eslint.config.js`
- Create: `.prettierrc`
- Create: `.prettierignore`
- Modify: `.gitignore`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/vitest.config.ts`
- Create: `packages/shared/src/states.ts`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/src/states.test.ts`

**Interfaces:**

- Produces: `TransferState` (union type) and `TRANSFER_STATES` (readonly array of all 10 states) exported from `@transfergo/shared`. Every later task/plan that needs the transfer state enum imports it from here — never redefines it.

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "transfergo",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "packageManager": "pnpm@11.23.0",
  "engines": {
    "node": ">=20.9.0"
  },
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test"
  },
  "devDependencies": {
    "@eslint/js": "^9.15.0",
    "eslint": "^9.15.0",
    "eslint-config-prettier": "^9.1.0",
    "prettier": "^3.4.0",
    "turbo": "^2.3.0",
    "typescript": "^5.7.0",
    "typescript-eslint": "^8.15.0"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {},
    "typecheck": {},
    "test": {}
  }
}
```

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "moduleDetection": "force"
  },
  "exclude": ["node_modules", "dist", ".next", ".turbo"]
}
```

- [ ] **Step 5: Create root `eslint.config.js`**

```js
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/.next/**", "**/.turbo/**", "**/dist/**", "**/coverage/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier
);
```

- [ ] **Step 6: Create `.prettierrc` and `.prettierignore`**

`.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "none",
  "printWidth": 100
}
```

`.prettierignore`:

```
node_modules
.next
.turbo
dist
coverage
pnpm-lock.yaml
```

- [ ] **Step 7: Extend `.gitignore`**

Append to the existing `.gitignore` (it already has `node_modules/`, `.next/`, `.env*`, etc. from the spec commit):

```
.turbo/
coverage/
*.tsbuildinfo
```

- [ ] **Step 8: Create `packages/shared/package.json`**

```json
{
  "name": "@transfergo/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 9: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 10: Create `packages/shared/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node"
  }
});
```

- [ ] **Step 11: Write the failing test**

`packages/shared/src/states.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TRANSFER_STATES } from "./states.js";

describe("TRANSFER_STATES", () => {
  it("contains exactly the 10 states defined by the spec, with no duplicates", () => {
    expect(TRANSFER_STATES).toHaveLength(10);
    expect(new Set(TRANSFER_STATES).size).toBe(TRANSFER_STATES.length);
  });

  it("includes every state referenced by the product spec", () => {
    const expected = [
      "queued",
      "preparing",
      "connecting",
      "sending",
      "receiving",
      "verifying",
      "completed",
      "paused",
      "cancelled",
      "failed"
    ];
    expect([...TRANSFER_STATES].sort()).toEqual([...expected].sort());
  });
});
```

- [ ] **Step 12: Install dependencies**

Run: `pnpm install`
Expected: completes successfully, creates `pnpm-lock.yaml`, links `@transfergo/shared` into the workspace.

- [ ] **Step 13: Run the test to verify it fails**

Run: `pnpm --filter @transfergo/shared run test`
Expected: FAIL — `states.ts` does not exist yet (module resolution error).

- [ ] **Step 14: Implement the minimal code to make the test pass**

`packages/shared/src/states.ts`:

```ts
export type TransferState =
  | "queued"
  | "preparing"
  | "connecting"
  | "sending"
  | "receiving"
  | "verifying"
  | "completed"
  | "paused"
  | "cancelled"
  | "failed";

export const TRANSFER_STATES: readonly TransferState[] = [
  "queued",
  "preparing",
  "connecting",
  "sending",
  "receiving",
  "verifying",
  "completed",
  "paused",
  "cancelled",
  "failed"
];
```

`packages/shared/src/index.ts`:

```ts
export * from "./states.js";
```

- [ ] **Step 15: Run the test to verify it passes**

Run: `pnpm --filter @transfergo/shared run test`
Expected: PASS (2 tests).

- [ ] **Step 16: Verify lint and typecheck pass**

Run: `pnpm --filter @transfergo/shared run typecheck && pnpm --filter @transfergo/shared run lint`
Expected: both exit 0 with no errors.

- [ ] **Step 17: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json tsconfig.base.json eslint.config.js .prettierrc .prettierignore .gitignore packages/shared pnpm-lock.yaml
git commit -m "feat: bootstrap pnpm+turborepo monorepo with @transfergo/shared"
```

---

## Task 2: `apps/signaling-server` scaffold + health check

**Files:**

- Create: `apps/signaling-server/package.json`
- Create: `apps/signaling-server/tsconfig.json`
- Create: `apps/signaling-server/vitest.config.ts`
- Create: `apps/signaling-server/src/server.ts`
- Create: `apps/signaling-server/src/index.ts`
- Test: `apps/signaling-server/src/server.test.ts`

**Interfaces:**

- Consumes: nothing from Task 1 yet (no shared import in this task).
- Produces: `createServer(): http.Server` from `apps/signaling-server/src/server.ts`, an HTTP server with `GET /health` → `200 { status: "ok" }` and everything else → `404 { error: "not_found" }`. Later plans (WebSocket/signaling) extend this same `createServer` function rather than creating a second server.

- [ ] **Step 1: Create `apps/signaling-server/package.json`**

```json
{
  "name": "@transfergo/signaling-server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `apps/signaling-server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `apps/signaling-server/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node"
  }
});
```

- [ ] **Step 4: Write the failing test**

`apps/signaling-server/src/server.test.ts`:

```ts
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "./server.js";

describe("signaling-server health check", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;

  beforeEach(async () => {
    server = createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("responds 200 with status ok on GET /health", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("responds 404 for unknown routes", async () => {
    const response = await fetch(`${baseUrl}/unknown`);
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 5: Install dependencies**

Run: `pnpm install`
Expected: completes successfully, links `@transfergo/signaling-server` into the workspace.

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @transfergo/signaling-server run test`
Expected: FAIL — `server.ts` does not exist yet.

- [ ] **Step 7: Write minimal implementation**

`apps/signaling-server/src/server.ts`:

```ts
import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

function handleHealthCheck(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ status: "ok" }));
}

function handleNotFound(res: ServerResponse): void {
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
}

export function createServer() {
  return createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "GET" && req.url === "/health") {
      handleHealthCheck(res);
      return;
    }

    handleNotFound(res);
  });
}
```

`apps/signaling-server/src/index.ts`:

```ts
import { createServer } from "./server.js";

const port = Number(process.env.PORT ?? 4000);

createServer().listen(port, () => {
  console.log(`signaling-server listening on port ${port}`);
});
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @transfergo/signaling-server run test`
Expected: PASS (2 tests).

- [ ] **Step 9: Verify lint and typecheck pass**

Run: `pnpm --filter @transfergo/signaling-server run typecheck && pnpm --filter @transfergo/signaling-server run lint`
Expected: both exit 0.

- [ ] **Step 10: Manual boot verification**

Run in one terminal: `pnpm --filter @transfergo/signaling-server run dev`
In another terminal: `curl http://localhost:4000/health`
Expected: `{"status":"ok"}`. Stop the dev server (Ctrl+C) after confirming.

- [ ] **Step 11: Commit**

```bash
git add apps/signaling-server pnpm-lock.yaml
git commit -m "feat: add signaling-server scaffold with health check endpoint"
```

---

## Task 3: `apps/web` scaffold (Next.js) consuming `@transfergo/shared`

**Files:**

- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/next-env.d.ts`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/vitest.setup.ts`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Test: `apps/web/src/app/page.test.tsx`

**Interfaces:**

- Consumes: `TRANSFER_STATES` from `@transfergo/shared` (Task 1) — proves cross-package workspace resolution works through Next's `transpilePackages`.
- Produces: `HomePage` default export at `apps/web/src/app/page.tsx` — Plan 2 (Design System) replaces its contents but keeps the file path.

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@transfergo/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@transfergo/shared": "workspace:*",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.0.0",
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "noEmit": true,
    "allowJs": true,
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `apps/web/next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@transfergo/shared"]
};

export default nextConfig;
```

- [ ] **Step 4: Create `apps/web/next-env.d.ts`**

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

- [ ] **Step 5: Create `apps/web/vitest.config.ts` and `apps/web/vitest.setup.ts`**

`apps/web/vitest.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"]
  }
});
```

`apps/web/vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 6: Create `apps/web/src/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "TransferGo",
  description: "Transferência de arquivos segura, direta e sem instalação."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 7: Write the failing test**

`apps/web/src/app/page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("HomePage", () => {
  it("renders the TransferGo heading", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { name: "TransferGo" })).toBeInTheDocument();
  });

  it("lists every transfer state from the shared package", () => {
    render(<HomePage />);
    expect(screen.getByText("queued")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Install dependencies**

Run: `pnpm install`
Expected: completes successfully, links `@transfergo/web` (and its `workspace:*` dependency on `@transfergo/shared`) into the workspace.

- [ ] **Step 9: Run the test to verify it fails**

Run: `pnpm --filter @transfergo/web run test`
Expected: FAIL — `page.tsx` does not exist yet.

- [ ] **Step 10: Write minimal implementation**

`apps/web/src/app/page.tsx`:

```tsx
import { TRANSFER_STATES } from "@transfergo/shared";

export default function HomePage() {
  return (
    <main>
      <h1>TransferGo</h1>
      <p>Fundação do monorepo funcionando.</p>
      <ul>
        {TRANSFER_STATES.map((state) => (
          <li key={state}>{state}</li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 11: Run the test to verify it passes**

Run: `pnpm --filter @transfergo/web run test`
Expected: PASS (2 tests).

- [ ] **Step 12: Verify lint and typecheck pass**

Run: `pnpm --filter @transfergo/web run typecheck && pnpm --filter @transfergo/web run lint`
Expected: both exit 0.

- [ ] **Step 13: Verify production build succeeds**

Run: `pnpm --filter @transfergo/web run build`
Expected: exits 0, `.next/` output produced, no type or transpilation errors on the `@transfergo/shared` import.

- [ ] **Step 14: Manual boot verification**

Run in one terminal: `pnpm --filter @transfergo/web run dev`
In another terminal: `curl http://localhost:3000 | grep TransferGo`
Expected: match found. Stop the dev server (Ctrl+C) after confirming.

- [ ] **Step 15: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat: add Next.js web app scaffold consuming @transfergo/shared"
```

---

## Task 4: `packages/transfer-engine`, `packages/security`, `packages/ui` scaffolds

**Files:**

- Create: `packages/transfer-engine/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`
- Test: `packages/transfer-engine/src/index.test.ts`
- Create: `packages/security/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`
- Test: `packages/security/src/index.test.ts`
- Create: `packages/ui/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`
- Test: `packages/ui/src/index.test.ts`

**Interfaces:**

- Produces: three empty-but-wired workspace packages (`@transfergo/transfer-engine`, `@transfergo/security`, `@transfergo/ui`), each exporting a `PACKAGE_NAME` string constant as a build/lint/test sanity check. Plan 2 fills in `@transfergo/ui`; Plan 5 fills in `@transfergo/transfer-engine`; Plan 7 fills in `@transfergo/security`. No later plan should need to touch these packages' `package.json`/`tsconfig.json`/`vitest.config.ts` — only their `src/`.

This task repeats the same scaffold shape three times. Each package gets its own config below — none of them import from each other.

- [ ] **Step 1: Create `packages/transfer-engine/package.json`**

```json
{
  "name": "@transfergo/transfer-engine",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `packages/transfer-engine/tsconfig.json` and `vitest.config.ts`**

`packages/transfer-engine/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["src"]
}
```

`packages/transfer-engine/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node"
  }
});
```

- [ ] **Step 3: Write the failing test**

`packages/transfer-engine/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("transfer-engine package scaffold", () => {
  it("exposes its package name as a wiring sanity check", () => {
    expect(PACKAGE_NAME).toBe("@transfergo/transfer-engine");
  });
});
```

- [ ] **Step 4: Implement and verify**

`packages/transfer-engine/src/index.ts`:

```ts
export const PACKAGE_NAME = "@transfergo/transfer-engine";
```

Run: `pnpm install && pnpm --filter @transfergo/transfer-engine run test`
Expected: PASS (1 test).

- [ ] **Step 5: Create `packages/security/package.json`**

```json
{
  "name": "@transfergo/security",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 6: Create `packages/security/tsconfig.json` and `vitest.config.ts`**

`packages/security/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["src"]
}
```

`packages/security/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node"
  }
});
```

- [ ] **Step 7: Write the failing test**

`packages/security/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("security package scaffold", () => {
  it("exposes its package name as a wiring sanity check", () => {
    expect(PACKAGE_NAME).toBe("@transfergo/security");
  });
});
```

- [ ] **Step 8: Implement and verify**

`packages/security/src/index.ts`:

```ts
export const PACKAGE_NAME = "@transfergo/security";
```

Run: `pnpm install && pnpm --filter @transfergo/security run test`
Expected: PASS (1 test).

- [ ] **Step 9: Create `packages/ui/package.json`**

```json
{
  "name": "@transfergo/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 10: Create `packages/ui/tsconfig.json` and `vitest.config.ts`**

`packages/ui/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["src"]
}
```

`packages/ui/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node"
  }
});
```

- [ ] **Step 11: Write the failing test**

`packages/ui/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("ui package scaffold", () => {
  it("exposes its package name as a wiring sanity check", () => {
    expect(PACKAGE_NAME).toBe("@transfergo/ui");
  });
});
```

- [ ] **Step 12: Implement and verify**

`packages/ui/src/index.ts`:

```ts
export const PACKAGE_NAME = "@transfergo/ui";
```

Run: `pnpm install && pnpm --filter @transfergo/ui run test`
Expected: PASS (1 test).

- [ ] **Step 13: Verify the whole monorepo is green**

Run: `pnpm turbo run lint typecheck test build`
Expected: every task in every workspace (2 apps + 4 packages) succeeds; Turborepo prints a summary with all green checkmarks.

- [ ] **Step 14: Commit**

```bash
git add packages/transfer-engine packages/security packages/ui pnpm-lock.yaml
git commit -m "feat: scaffold transfer-engine, security and ui workspace packages"
```

---

## Task 5: Continuous Integration (GitHub Actions)

**Files:**

- Create: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: the `lint`, `typecheck`, `test`, `build` root scripts produced by Tasks 1–4.
- Produces: a GitHub Actions workflow named `CI` that later plans extend (e.g. adding a deploy job) rather than replace.

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 11.23.0

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm turbo run lint typecheck test build
```

- [ ] **Step 2: Commit and push**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run lint, typecheck, test and build on every push"
git push -u origin HEAD
```

- [ ] **Step 3: Verify the workflow passes**

Open `https://github.com/Edilson-5762/transfergo/actions` (or run `gh run watch` if the GitHub CLI is installed and authenticated) and confirm the `CI` run for this push (on the current branch — CI now triggers on push to any branch) completes successfully (all green).

---

## Task 6: Root README + final full-repo verification

**Files:**

- Create: `README.md`

**Interfaces:**

- Consumes: nothing new.
- Produces: nothing later tasks depend on programmatically — this is documentation + a final manual gate.

- [ ] **Step 1: Create `README.md`**

````markdown
# TransferGo

Plataforma web de transferência remota, bidirecional e segura de arquivos
entre dispositivos, baseada em WebRTC peer-to-peer com fallback TURN,
transferência incremental de arquivos grandes, verificação de integridade
(SHA-256), sessões temporárias por link seguro e arquitetura orientada à
privacidade (nenhum arquivo é armazenado permanentemente no backend).

**Status:** V1 (Core Transfer) em desenvolvimento.

**Spec completa:** [`docs/superpowers/specs/2026-08-24-transfergo-design.md`](docs/superpowers/specs/2026-08-24-transfergo-design.md)

## Stack

TypeScript · Next.js · Node.js · WebRTC (RTCDataChannel) · WebSocket ·
pnpm workspaces + Turborepo

## Desenvolvimento

```bash
pnpm install
pnpm dev      # roda apps/web e apps/signaling-server
pnpm test     # roda todos os testes do monorepo
pnpm lint
pnpm typecheck
pnpm build
```
````

> Um README completo (demo pública, arquitetura, screenshots, instalação
> detalhada, limitações, roadmap) será adicionado conforme a V1 avança.

````

- [ ] **Step 2: Run the full verification suite**

Run: `pnpm turbo run lint typecheck test build`
Expected: all green (same as Task 4 Step 13 — this re-confirms nothing regressed).

- [ ] **Step 3: Manual concurrent boot check**

Run: `pnpm dev`
Expected: both `apps/web` (port 3000) and `apps/signaling-server` (port 4000) start without errors. In another terminal: `curl http://localhost:3000 | grep TransferGo` and `curl http://localhost:4000/health`. Both succeed. Stop with Ctrl+C.

- [ ] **Step 4: Commit and push**

```bash
git add README.md
git commit -m "docs: add project README with setup instructions"
git push origin HEAD
````

---

## Definition of Done for this plan

- [ ] `pnpm turbo run lint typecheck test build` passes with zero errors across all 6 workspaces.
- [ ] `pnpm dev` boots both apps concurrently without errors.
- [ ] GitHub Actions `CI` workflow is green on `main`.
- [ ] All 6 tasks committed and pushed to `https://github.com/Edilson-5762/transfergo`.

Next plan: **Plano 2/9 — Design System & UI base** (replaces the placeholder `apps/web/src/app/page.tsx` with the real design system and premium home page required by spec §6).
