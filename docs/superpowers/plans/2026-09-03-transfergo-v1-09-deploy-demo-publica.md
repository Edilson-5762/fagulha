# Plano 9 (parte 1) — Deploy + Demo Pública — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Human-in-the-loop tasks:** Task 4 (push to GitHub) and Task 5 (Vercel/Railway dashboard steps) are NOT subagent work — the controller runs them directly with the user. Every other task is a normal implement-and-commit task.

**Goal:** Pôr a V1 do TransferGo no ar numa URL pública — frontend Next.js na Vercel, servidor de sinalização na Railway, ambos com deploy automático a cada push em `main` — e deixar o `README` utilizável como cartão de visita do projeto.

**Architecture:** A config do deploy fica versionada (`railway.json`, `apps/web/vercel.json`, `.env.example`); os painéis Vercel/Railway só guardam a "Root Directory" e as duas variáveis de ambiente. Nenhuma mudança de código de aplicação — o web já converte `https→wss`, o signaling já tem `/health` e checagem de `Origin`. O único ajuste é `tsx` sair de `devDependencies` (senão o install de produção da Railway não o instala). Um script Node headless (`scripts/verify-signaling.mjs`) prova o relay de sinalização publicado ponta a ponta; o WebRTC real fica para uma checagem manual de dois navegadores.

**Tech Stack:** Next.js 15 (Vercel), Node `node:http` + `ws` (Railway), pnpm workspaces + Turborepo, `tsx`, GitHub Actions (CI já existente), `ws` (script de verificação).

**Spec:** `docs/superpowers/specs/2026-09-03-transfergo-v1-09-deploy-demo-publica-design.md`

## Global Constraints

- **Config versionada:** `railway.json` (raiz), `apps/web/vercel.json`, `.env.example` (raiz). O conteúdo exato de cada um está na spec §4.2–§4.4 e é repetido nas tarefas.
- **Ordem de deploy:** push → Railway (com `WEB_ORIGIN` placeholder) → Vercel (com a URL da Railway) → volta na Railway (com a URL da Vercel). Resolve o ovo-e-galinha das URLs.
- **`WEB_ORIGIN`:** comparação **exata** com o header `Origin` do upgrade WS (`apps/signaling-server/src/server.ts:48`). Valor de produção: `https://` + host, **sem barra final, sem `www`**.
- **`NEXT_PUBLIC_SIGNALING_URL`:** sem barra final. É `NEXT_PUBLIC_` ⇒ embutida no bundle em build; trocar exige redeploy da Vercel.
- **`PORT`:** a Railway injeta automaticamente. Nunca definir à mão — o servidor já lê `process.env.PORT ?? 4000`.
- **Zero mudança de código de aplicação:** nada no motor (`packages/transfer-engine`), no hook (`use-file-transfer.ts`), nas páginas, no `signaling-socket.ts` nem no `server.ts`. A única mudança fora de config/docs é o comentário `TODO(turn)` no `peer-connection.ts`.
- **Sem `git push --force`:** `main` local está `ahead 100` de `origin/main` (fast-forward puro).
- **Protocolo de sinalização** (o script de verificação usa estes literais exatos, lidos de `apps/signaling-server/src/ws-handler.ts` e `packages/shared/src/signaling.ts`):
  - Cliente → `{ "type": "create" }` ⇒ servidor → `{ "type": "session_state", "session": { "token", "status": "waiting", "createdAt", "expiresAt" } }`.
  - Cliente → `{ "type": "join", "token": <t>, "role": "guest" }` ⇒ servidor → `{ "type": "session_state", "session" }` **e** `{ "type": "peer_presence", "connected": <bool> }`; o peer (host) também recebe `{ "type": "peer_presence", "connected": true }`.
  - Cliente (só `role: "guest"`) → `{ "type": "accept" }` ⇒ servidor faz broadcast `{ "type": "session_state", "session": { "status": "accepted" } }` aos dois lados.
  - Cliente → `{ "type": "signal", "payload": <SignalPayload> }` só é repassado ao peer se `session.status === "accepted"`. `payload` precisa ser um `SignalPayload` válido: `{ "kind": "offer" | "answer", "sdp": <string não-vazia ≤ 64 KiB> }` ou `{ "kind": "candidate", "candidate": { "candidate", "sdpMid", "sdpMLineIndex" } }`. Um payload malformado é descartado em silêncio por `parseClientMessage`.
  - Upgrade WS só em `/ws` e só se `req.headers.origin === WEB_ORIGIN` exatamente; senão `socket.destroy()` (o cliente `ws` vê um erro de socket).
- **Comando de CI** (`.github/workflows/ci.yml`): `pnpm format:check` seguido de `pnpm turbo run lint typecheck test build build-storybook`. Node 24, pnpm 11.23.0. Rodar o comando **completo** local antes de qualquer push.
- **Gate por tarefa:** cada tarefa de código termina com o pacote afetado (ou o monorepo) verde. Nada de `pnpm --filter X run lint typecheck test` numa linha só — esse encadeamento é malformado neste repo; rodar cada script separado.
- **Commits:** um por tarefa no mínimo, `chore(...)` / `feat(...)` / `docs:` / `ci:` conforme o conteúdo, terminando com:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`

---

## Estrutura de arquivos

| Arquivo                                                 | Papel                                                                               | Tarefa     |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------- |
| `apps/signaling-server/package.json` + `pnpm-lock.yaml` | `tsx` de `devDependencies` → `dependencies`                                         | 1          |
| `railway.json` (raiz, **novo**)                         | builder Nixpacks, start com `--filter`, healthcheck `/health`, restart `ON_FAILURE` | 2          |
| `apps/web/vercel.json` (**novo**)                       | `framework: "nextjs"` + `$schema`                                                   | 2          |
| `.env.example` (raiz, **novo**)                         | doc das duas variáveis de ambiente                                                  | 2          |
| `apps/web/src/lib/peer-connection.ts`                   | comentário `TODO(turn)` sobre `ICE_SERVERS`                                         | 2          |
| `package.json` (raiz) + `pnpm-lock.yaml`                | `ws` em `devDependencies` (pro script rodar da raiz)                                | 3          |
| `scripts/verify-signaling.mjs` (**novo**)               | prova headless do relay de sinalização                                              | 3          |
| — (GitHub)                                              | `git push origin main` + CI verde                                                   | 4 (humano) |
| — (painéis Vercel + Railway)                            | runbook do humano + verificação de produção pelo agente                             | 5 (humano) |
| `README.md`                                             | reescrita pt-BR: demo ao vivo, arquitetura, limitações da V1                        | 6          |

---

## Task 1: `tsx` para `dependencies` do signaling-server

**Files:**

- Modify: `apps/signaling-server/package.json`
- Modify: `pnpm-lock.yaml` (via `pnpm install`)

**Interfaces:**

- Consumes: nada.
- Produces: `apps/signaling-server` instalável e executável (`pnpm start` → `tsx src/index.ts`) num ambiente que só instala `dependencies` (Railway com `NODE_ENV=production`).

- [ ] **Step 1: Mover a dependência**

Em `apps/signaling-server/package.json`, tirar `"tsx": "^4.19.0"` de `devDependencies` e pôr em `dependencies`, mantendo a ordem alfabética. Resultado:

```json
  "dependencies": {
    "@transfergo/security": "workspace:*",
    "@transfergo/shared": "workspace:*",
    "tsx": "^4.19.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/ws": "^8.5.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
```

- [ ] **Step 2: Atualizar o lockfile**

Run: `pnpm install`
Expected: `pnpm-lock.yaml` muda (a entrada de `tsx` migra de dev para prod no importer `apps/signaling-server`); nenhum download novo (`tsx` já estava resolvido).

- [ ] **Step 3: Confirmar que o servidor sobe**

Run (bash), servidor em background:

```bash
WEB_ORIGIN=http://localhost:3000 PORT=4000 pnpm --filter @transfergo/signaling-server start &
SRV=$!
sleep 2
curl -s http://localhost:4000/health
kill $SRV
```

Expected: imprime `{"status":"ok"}`.

- [ ] **Step 4: Gate do pacote**

Run, comandos separados:

```
pnpm --filter @transfergo/signaling-server run lint
pnpm --filter @transfergo/signaling-server run typecheck
pnpm --filter @transfergo/signaling-server run test
```

Expected: os três verdes.

- [ ] **Step 5: Commit**

```bash
git add apps/signaling-server/package.json pnpm-lock.yaml
git commit -m "chore(signaling): move tsx to dependencies so production installs include it

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Arquivos de config de deploy

**Files:**

- Create: `railway.json` (raiz)
- Create: `apps/web/vercel.json`
- Create: `.env.example` (raiz)
- Modify: `apps/web/src/lib/peer-connection.ts` (comentário sobre `ICE_SERVERS`)

**Interfaces:**

- Consumes: nada.
- Produces: config lida pela Railway (`railway.json`) e pela Vercel (`vercel.json`) na importação do repo; `.env.example` como referência das duas variáveis.

- [ ] **Step 1: Criar `railway.json` na raiz**

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "pnpm --filter @transfergo/signaling-server start",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

- [ ] **Step 2: Criar `apps/web/vercel.json`**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs"
}
```

- [ ] **Step 3: Criar `.env.example` na raiz**

```bash
# ── apps/web (Vercel) ────────────────────────────────────────────────
# URL publica do servidor de sinalizacao. Sem barra no final.
# Dev:  http://localhost:4000  (e o default no codigo, pode omitir)
# Prod: https://<seu-projeto>.up.railway.app
NEXT_PUBLIC_SIGNALING_URL=http://localhost:4000

# ── apps/signaling-server (Railway) ──────────────────────────────────
# Origin EXATO do frontend (comparado com o header Origin do upgrade WS).
# https://, sem barra final, sem www.
# Dev:  http://localhost:3000  (default no codigo)
# Prod: https://<seu-projeto>.vercel.app
WEB_ORIGIN=http://localhost:3000

# PORT e injetada automaticamente pela Railway — nao definir a mao.
```

- [ ] **Step 4: Comentário `TODO(turn)` no `peer-connection.ts`**

Em `apps/web/src/lib/peer-connection.ts`, imediatamente acima da linha `const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];`, inserir:

```ts
// TODO(turn): a proxima peca da V1 adiciona um servidor TURN gerenciado
// (credenciais temporarias via endpoint no signaling). Ate la, so STUN —
// pares atras de NAT simetrico / rede corporativa podem nao conectar.
```

- [ ] **Step 5: Formatar e checar**

Run:

```
pnpm format
pnpm format:check
```

Expected: `format:check` verde (prettier normalizou os JSON novos e não reclama).

- [ ] **Step 6: Validar o JSON**

Run:

```bash
node -e "JSON.parse(require('fs').readFileSync('railway.json','utf8')); JSON.parse(require('fs').readFileSync('apps/web/vercel.json','utf8')); console.log('json ok')"
```

Expected: imprime `json ok`.

- [ ] **Step 7: Gate do monorepo**

Run: `pnpm turbo run lint typecheck test build`
Expected: 19/19 verde (os arquivos de config são inertes; confirma que o comentário no `peer-connection.ts` não quebrou lint/typecheck/build do web).

- [ ] **Step 8: Commit**

```bash
git add railway.json apps/web/vercel.json .env.example apps/web/src/lib/peer-connection.ts
git commit -m "chore(deploy): add Railway + Vercel config, .env.example, TURN TODO marker

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Script de verificação da sinalização

**Files:**

- Modify: `package.json` (raiz — `ws` em `devDependencies`)
- Modify: `pnpm-lock.yaml` (via `pnpm install`)
- Create: `scripts/verify-signaling.mjs`

**Interfaces:**

- Consumes: o protocolo de sinalização descrito em Global Constraints.
- Produces: `node scripts/verify-signaling.mjs <base-url> <origin>` — sai `0` se um quadro `signal` mandado pelo cliente "host" chegou ao cliente "guest"; sai `1` com uma mensagem `FAIL: …` em qualquer outro caso (upgrade recusado, quadro inesperado, timeout).

- [ ] **Step 1: Adicionar `ws` como devDependency da raiz**

Em `package.json` (raiz), acrescentar a `devDependencies` (ordem alfabética):

```json
    "ws": "^8.18.0",
```

Run: `pnpm install`
Expected: lockfile ganha `ws` no importer raiz; sem download novo (já resolvido via `apps/signaling-server`).

- [ ] **Step 2: Escrever `scripts/verify-signaling.mjs`**

```js
// Verificacao headless de um relay de sinalizacao IMPLANTADO.
// Uso: node scripts/verify-signaling.mjs <signaling-base-url> <web-origin>
//   <signaling-base-url>  ex.: https://transfergo-signaling.up.railway.app
//   <web-origin>          valor EXATO configurado como WEB_ORIGIN no servidor,
//                         enviado como header Origin do handshake WS
// Exit 0 = um quadro `signal` do cliente "host" chegou ao cliente "guest".
// Exit 1 = qualquer outra coisa (upgrade recusado, quadro errado, timeout).

import WebSocket from "ws";

const [, , baseArg, originArg] = process.argv;
if (!baseArg || !originArg) {
  console.error("usage: node scripts/verify-signaling.mjs <signaling-base-url> <web-origin>");
  process.exit(1);
}

const WS_URL = `${baseArg.replace(/^http/, "ws")}/ws`;
const ORIGIN = originArg;
const SDP = "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n";
const TIMEOUT_MS = 8000;

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};

const timer = setTimeout(() => fail(`no relayed signal within ${TIMEOUT_MS}ms`), TIMEOUT_MS);

const open = (label) => {
  const ws = new WebSocket(WS_URL, { headers: { Origin: ORIGIN } });
  ws.on("error", (err) =>
    fail(
      `${label} socket error: ${err.message} — server down, or Origin does not match WEB_ORIGIN exactly?`
    )
  );
  ws.on("unexpected-response", (_req, res) =>
    fail(`${label} handshake rejected: HTTP ${res.statusCode} — wrong path or Origin mismatch`)
  );
  return ws;
};

const parse = (raw) => {
  try {
    return JSON.parse(raw.toString());
  } catch {
    return fail(`received a non-JSON frame: ${raw.toString().slice(0, 120)}`);
  }
};

const host = open("host");
let guest;
let token;

host.on("open", () => host.send(JSON.stringify({ type: "create" })));

host.on("message", (raw) => {
  const msg = parse(raw);
  if (msg.type === "error") return fail(`server error frame on host: ${msg.code}`);

  if (msg.type === "session_state" && msg.session?.status === "waiting" && !token) {
    token = msg.session.token;
    if (!token) return fail("create returned no token");

    guest = open("guest");
    guest.on("open", () => guest.send(JSON.stringify({ type: "join", token, role: "guest" })));
    guest.on("message", (graw) => {
      const gmsg = parse(graw);
      if (gmsg.type === "error") return fail(`server error frame on guest: ${gmsg.code}`);
      if (gmsg.type === "session_state" && gmsg.session?.status === "waiting") {
        guest.send(JSON.stringify({ type: "accept" }));
      }
      if (gmsg.type === "signal") {
        if (gmsg.payload?.kind === "offer" && gmsg.payload?.sdp === SDP) {
          clearTimeout(timer);
          console.log("OK: signal relayed host -> guest end to end");
          host.close();
          guest.close();
          process.exit(0);
        }
        return fail(`guest received an unexpected signal payload: ${JSON.stringify(gmsg.payload)}`);
      }
    });
  }

  if (msg.type === "session_state" && msg.session?.status === "accepted") {
    host.send(JSON.stringify({ type: "signal", payload: { kind: "offer", sdp: SDP } }));
  }
});
```

- [ ] **Step 3: Verificação positiva (contra signaling local)**

Run (bash):

```bash
WEB_ORIGIN=http://localhost:3000 PORT=4000 pnpm --filter @transfergo/signaling-server start &
SRV=$!
sleep 2
node scripts/verify-signaling.mjs http://localhost:4000 http://localhost:3000
echo "exit: $?"
kill $SRV
```

Expected: imprime `OK: signal relayed host -> guest end to end` e `exit: 0`.

- [ ] **Step 4: Verificação negativa (Origin errado)**

Run (bash):

```bash
WEB_ORIGIN=http://localhost:3000 PORT=4000 pnpm --filter @transfergo/signaling-server start &
SRV=$!
sleep 2
node scripts/verify-signaling.mjs http://localhost:4000 http://evil.example
echo "exit: $?"
kill $SRV
```

Expected: imprime uma linha `FAIL: host socket error: … Origin does not match …` e `exit: 1`.

- [ ] **Step 5: Excluir `scripts/**` do lint**

O `no-unused-vars` de `js.configs.recommended` reclamaria do parâmetro `_req` no handler `unexpected-response`, e `scripts/` é utilitário de operação, não código de produto. Em `eslint.config.js` (raiz), acrescentar `"scripts/**"` ao array `ignores` do primeiro bloco:

```js
ignores: [
  "**/node_modules/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/dist/**",
  "**/coverage/**",
  "**/storybook-static/**",
  "**/next-env.d.ts",
  "scripts/**"
];
```

- [ ] **Step 6: Lint / format**

Run:

```
pnpm run lint
pnpm format:check
```

Expected: os dois verdes.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml scripts/verify-signaling.mjs eslint.config.js
git commit -m "feat(scripts): add headless signaling-relay verification script

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Publicar em `origin/main` (HUMANO NO LOOP)

**Files:** nenhum, exceto `.github/workflows/ci.yml` **se e somente se** o CI quebrar nos runners do GitHub.

**Interfaces:**

- Consumes: os commits das Tasks 1–3.
- Produces: `origin/main` = `main` local; CI verde no GitHub; o repo passa a ser importável pela Vercel e pela Railway.

- [ ] **Step 1: Sanidade local**

Run:

```
git status -sb
git log --oneline origin/main..main | wc -l
```

Expected: árvore limpa, em `main`; a contagem de commits à frente bate com o esperado (100 herdados + spec + plano + Tasks 1–3 ≈ 104).

- [ ] **Step 2: Rodar o comando COMPLETO do CI local**

Run:

```
pnpm format:check
pnpm turbo run lint typecheck test build build-storybook
```

Expected: `format:check` limpo; todas as tarefas do turbo verdes (inclui `build-storybook` do `packages/ui`, que o gate do Plano 8 não rodava). Se `format:check` falhar, `pnpm format` e um commit `style: prettier` antes de seguir.

- [ ] **Step 3: Confirmar o push com o humano**

Este é o primeiro envio da história real (≈104 commits) para o GitHub e torna o repositório público/atualizado. **Parar e pedir "pode dar push?" ao usuário.** Só seguir com o "sim" explícito.

- [ ] **Step 4: Push (fast-forward, SEM `--force`)**

```bash
git push origin main
```

Expected: `origin/main` avança de `c5f9db9` até o `HEAD` local sem rejeição.

- [ ] **Step 5: Assistir o CI**

Run: `gh run watch` (ou acompanhar a aba _Actions_ do repo).
Expected: o workflow `CI` passa (verde).

- [ ] **Step 6: Se o CI quebrar só no runner**

Ler a falha. Consertar `.github/workflows/ci.yml` (ex.: versão de action, cache) ou o código apontado, num commit novo `ci: <o quê>` ou `fix: <o quê>`, `git push origin main`, e voltar ao Step 5. Se passou, a tarefa está concluída sem commit novo.

---

## Task 5: Runbook de deploy (HUMANO NO LOOP) + verificação de produção

**Files:** nenhum commitado pelo agente.

**Interfaces:**

- Consumes: `railway.json`, `apps/web/vercel.json` (Task 2), `scripts/verify-signaling.mjs` (Task 3), o repo publicado (Task 4).
- Produces: duas URLs públicas — `RAILWAY_URL` (`https://<...>.up.railway.app`) e `VERCEL_URL` (`https://<...>.vercel.app`) — anotadas para a Task 6; sinalização de produção comprovada.

- [ ] **Step 1: O agente entrega o runbook e os valores**

O agente imprime, para o usuário seguir, os passos B→C→D da spec §6 e lembra: `WEB_ORIGIN` começa como `http://localhost:3000` (placeholder) e só vira `VERCEL_URL` no passo D.

- [ ] **Step 2: Railway primeiro (usuário)**

Usuário: railway.app → _New Project_ → _Deploy from GitHub repo_ → `Edilson-5762/transfergo`. _Settings → Root Directory_: vazio. _Variables_ → `WEB_ORIGIN = http://localhost:3000`. Esperar o deploy; _Settings → Networking → Generate Domain_ se preciso. Usuário reporta a `RAILWAY_URL`.

- [ ] **Step 3: O agente confere o `/health`**

Run: `curl -s <RAILWAY_URL>/health`
Expected: `{"status":"ok"}`.

- [ ] **Step 4: Vercel (usuário)**

Usuário: vercel.com → _Add New → Project_ → _Import_ `Edilson-5762/transfergo`. _Root Directory_ → `apps/web`. Framework: _Next.js_ (auto). _Environment Variables_ → `NEXT_PUBLIC_SIGNALING_URL = <RAILWAY_URL>`. _Deploy_. Usuário reporta a `VERCEL_URL`.

- [ ] **Step 5: Fechar o laço na Railway (usuário)**

Usuário: Railway → _Variables_ → `WEB_ORIGIN = <VERCEL_URL>` (exato, `https://`, sem barra final). A Railway redeploy sozinha.

- [ ] **Step 6: O agente prova a sinalização de produção**

Run:

```
node scripts/verify-signaling.mjs <RAILWAY_URL> <VERCEL_URL>
curl -sI <VERCEL_URL>
```

Expected: o script imprime `OK: signal relayed host -> guest end to end` e sai `0`; o `curl -sI` da Vercel devolve `HTTP/2 200`.

- [ ] **Step 7: Checagem manual de dois navegadores (usuário)**

Usuário abre `<VERCEL_URL>` em dois navegadores/dispositivos, cria sessão num, abre o link no outro, envia um arquivo pequeno, confirma na tela do receptor: "Verificado" nos arquivos e "Integridade verificada (SHA-256)". (Única parte que exige WebRTC real.)

- [ ] **Step 8: Registrar as URLs**

O agente anota `RAILWAY_URL` e `VERCEL_URL` no ledger do SDD (ou entrega direto à Task 6). Sem commit nesta tarefa.

---

## Task 6: Reescrita do `README.md`

**Files:**

- Modify: `README.md` (reescrita completa)

**Interfaces:**

- Consumes: `VERCEL_URL` da Task 5.
- Produces: `README.md` final da V1 — demo ao vivo, arquitetura, limitações honestas.

- [ ] **Step 1: Reescrever `README.md`**

Substituir todo o conteúdo por (trocando `<VERCEL_URL>` pela URL real da Task 5):

```markdown
# TransferGo

**[▶ Demo ao vivo](VERCEL_URL)**

Plataforma web para transferir arquivos entre dois dispositivos direto de
navegador a navegador, sem nuvem no meio. A conexão é WebRTC peer-to-peer;
o servidor só apresenta os dois lados um ao outro e sai da frente.

> **Nenhum byte de arquivo passa pelo servidor** — o backend só troca SDP/ICE
> (os dados de "aperto de mão" do WebRTC). Os arquivos vão direto de um
> navegador ao outro.

**Status:** V1 (Core Transfer) — funcional, em polimento.

## Como funciona
```

Navegador A Navegador B
(envia) (recebe)
│ │
│ 1. cria sessão ┌───────────────┐ │
├──────────────────────►│ Signaling │ │
│ │ (Railway) │◄─────┤ 2. abre o link
│ 3. troca SDP/ICE │ Node + ws │ │
│◄─────────────────────►│ │◄────►│
│ └───────────────┘ │
│ │
│ 4. conexão P2P direta (WebRTC DataChannel) │
╞═════════════════════ arquivos ══════════════►╡
│ chunked · com backpressure · │
│ verificação SHA-256 por arquivo │

````

- **Frontend** (Next.js) na Vercel.
- **Signaling** (Node + WebSocket) na Railway — sem estado persistente, sessões
  de 15 minutos que somem sozinhas.
- **Transferência** direto entre os navegadores, em blocos, com controle de
  fluxo e verificação de integridade SHA-256 de ponta a ponta.

## Stack

TypeScript · Next.js 15 · Node.js (`ws`) · WebRTC (`RTCDataChannel`) ·
pnpm workspaces + Turborepo · Vitest

## Rodar localmente

```bash
pnpm install
cp .env.example .env        # opcional em dev (os defaults já servem)
pnpm dev                    # sobe apps/web (:3000) e apps/signaling-server (:4000)
pnpm test                   # todos os testes do monorepo
pnpm lint
pnpm typecheck
pnpm build
````

Prova rápida de que a sinalização está de pé (com `pnpm dev` rodando):

```bash
node scripts/verify-signaling.mjs http://localhost:4000 http://localhost:3000
```

## Limitações conhecidas da V1

- **Sem TURN nesta versão:** pares atrás de NAT simétrico ou rede corporativa
  podem não conectar. A próxima peça adiciona um TURN gerenciado.
- STUN público único (Google).
- Sinalização numa região só.
- Sessões efêmeras — somem ao fechar a aba; sem histórico.
- Sem retomada real de uma transferência interrompida.
- Transferência ainda unidirecional (quem cria a sessão envia; quem entra recebe).

## Roadmap

**Resto da V1:** TURN fallback · transferência bidirecional · endurecimento de
segurança (rate limiting, aviso de executável) · robustez de reconexão durante
a transferência · validação cross-browser/mobile · domínio próprio.

**Depois:** V2 — Remote Download (enviar uma URL para o outro dispositivo
baixar). **V3** — Identity & Trust (contas, dispositivos confiáveis, níveis de
proteção).

## Arquitetura e spec

Spec completa do produto:
[`docs/superpowers/specs/2026-08-24-transfergo-design.md`](docs/superpowers/specs/2026-08-24-transfergo-design.md).

<!-- screenshot: tela inicial (criar / receber sessão) -->
<!-- screenshot: transferência em progresso (barra, velocidade, ETA) -->
<!-- screenshot: tela de sucesso com "Integridade verificada (SHA-256)" -->

````

- [ ] **Step 2: Formatar e checar**

Run: `pnpm format` então `pnpm format:check`
Expected: `format:check` verde.

- [ ] **Step 3: Verificar os links e a demo**

Run:
```bash
curl -sI <VERCEL_URL> | head -1
test -f docs/superpowers/specs/2026-08-24-transfergo-design.md && echo "spec link ok"
test -f scripts/verify-signaling.mjs && echo "script link ok"
````

Expected: `HTTP/2 200`, `spec link ok`, `script link ok`.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README with live demo link, architecture, and V1 limitations

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Push (confirmar com o humano)**

Pedir "pode dar push do README?" ao usuário — este push dispara um redeploy (inócuo) dos dois serviços. Com o "sim":

```bash
git push origin main
```

Expected: push aceito; a Vercel e a Railway reimplantam; nada de funcional muda.

---

## Self-Review

**1. Cobertura da spec**

| Item da spec                          | Task                                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| §4.1 `tsx` → `dependencies`           | 1                                                                                                                                  |
| §4.2 `railway.json`                   | 2                                                                                                                                  |
| §4.3 `apps/web/vercel.json`           | 2                                                                                                                                  |
| §4.4 `.env.example`                   | 2                                                                                                                                  |
| §4.5 comentário `TODO(turn)`          | 2                                                                                                                                  |
| §5 `scripts/verify-signaling.mjs`     | 3                                                                                                                                  |
| §6 runbook B→C→D                      | 5                                                                                                                                  |
| §7 reescrita do README                | 6                                                                                                                                  |
| §1 prova 1 (script headless)          | 3 (local), 5 (produção)                                                                                                            |
| §1 prova 2 (`/health` + `/`)          | 5 Steps 3 e 6                                                                                                                      |
| §1 prova 3 (CI verde no GitHub)       | 4                                                                                                                                  |
| §1 prova 4 (dois navegadores)         | 5 Step 7                                                                                                                           |
| §3 push de `main` (100 commits atrás) | 4                                                                                                                                  |
| §8 ordem B→C→D (ovo-e-galinha)        | 5                                                                                                                                  |
| §8 risco Nixpacks / Fly.io-Render     | 5 (o `railway.json` já tem restart/health; contingência no runbook)                                                                |
| §8 checagem de segredos no repo       | 4 Step 1 (implícito no `git status` limpo; sem `.env` versionado — `.gitignore` cobre `.env*`, `.env.example` é exceção explícita) |

**2. Placeholders:** as Tasks 4 e 5 dependem de ação humana (push, cliques nos painéis) e de valores que só existem em runtime (`RAILWAY_URL`, `VERCEL_URL`) — isso é inerente a um plano de deploy, não um placeholder de código. Todo passo de código (Tasks 1–3, 6) tem conteúdo literal completo. O `scripts/verify-signaling.mjs` está escrito por inteiro no plano.

**3. Consistência de tipos / nomes:**

- `WEB_ORIGIN` e `NEXT_PUBLIC_SIGNALING_URL` — mesmos nomes em Global Constraints, `.env.example` (Task 2), runbook (Task 5), README (Task 6).
- `RAILWAY_URL` / `VERCEL_URL` — nomes consistentes nas Tasks 5 e 6.
- Quadros do protocolo (`create`, `session_state`, `join`, `peer_presence`, `accept`, `signal`, `error`) e o formato de `SignalPayload` (`{kind:"offer",sdp}`) — batem entre Global Constraints e o código do script na Task 3.
- `/health` (healthcheck) — mesmo path em `railway.json` (Task 2), Task 1 Step 3, Task 5 Step 3.
- Comando de start `pnpm --filter @transfergo/signaling-server start` — igual em `railway.json` (Task 2) e nos Steps de verificação local (Tasks 1 e 3).

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-03-transfergo-v1-09-deploy-demo-publica.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per code task (1, 2, 3, 6), review between tasks; **Tasks 4 and 5 the controller runs directly with the user** (push confirmation, dashboard clicks, production verification) — they are not subagent work.

**2. Inline Execution** — execute all tasks in this session with checkpoints.

**Which approach?**
