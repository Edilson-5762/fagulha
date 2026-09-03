# TransferGo — Plano 9/9 (parte 1): Deploy + Demo Pública — Spec de Design

- **Status:** Em revisão pelo autor do produto
- **Data:** 2026-09-03
- **Escopo:** Passos "21 Deploy", "23 Documentação", "24 GitHub" e "25 Demo
  pública" da ordem de implementação da spec do produto
  (`docs/superpowers/specs/2026-08-24-transfergo-design.md`, §12). Fecha os
  critérios de conclusão da V1 **"demo pública funciona"** e **"documentação
  concluída"** (§9).
- **Nota de nomenclatura:** o roadmap chamava genericamente de "Plano 9/9" tudo
  que faltava da V1. Isso foi decomposto em peças independentes (cada uma com
  seu ciclo spec → plano → implementação): **deploy + demo pública** (esta),
  TURN fallback, transferência bidirecional, endurecimento de segurança,
  robustez de erros/reconexão na transferência, validação cross-browser/mobile.
  Esta spec cobre só a primeira.
- **Depende de:** Planos 1–8 concluídos e mesclados em `main` local (tip
  `7367fb7`). Nada dos Planos 1–8 foi publicado no GitHub ainda — `origin/main`
  está em `c5f9db9` (100 commits atrás, snapshot de 24/ago).
- **Não inclui:**
  - **TURN real** — provedor gerenciado, endpoint de credenciais temporárias,
    fiação do `iceServers`. Esta peça só deixa o *caminho* pronto (comentário
    `TODO(turn)` no `peer-connection.ts` e a limitação documentada no README).
  - **Domínio próprio** (Hostinger) e registros DNS — a demo sai nas URLs
    grátis `*.vercel.app` / `*.up.railway.app`. O domínio customizado é um
    adendo posterior.
  - Transferência bidirecional; rate limiting e hardening de segurança
    (§3.17–3.19, passo 22); validação formal cross-browser/mobile (passo 19);
    build compilado do signaling (`tsc → dist → node`); remote caching do
    Turborepo na Vercel; screenshots reais no README (placeholders agora).

---

## 1. Objetivo

Pôr a V1 no ar numa URL pública que qualquer pessoa consegue abrir, com o
frontend Next.js na **Vercel** e o servidor de sinalização Node+WebSocket na
**Railway**, ambos reimplantando automaticamente a cada push em `main` do
repositório GitHub. Deixar o `README` utilizável como cartão de visita do
projeto de portfólio: o que é, link da demo ao vivo, como funciona, limitações
honestas da V1.

A config do deploy fica **versionada** (`vercel.json`, `railway.json`,
`.env.example`) para que o dono — leigo em programação — consiga entender e
refazer o setup meses depois sem depender de lembrar cliques em painéis.

**Prova de conclusão:**

1. **Script Node headless** (`scripts/verify-signaling.mjs`): conecta dois
   clientes WebSocket ao `/ws` **de produção** (Railway), faz `create` → pega o
   token → `join` como guest → afirma que um quadro `signal` enviado por um lado
   chega ao outro. Prova o relay de sinalização publicado ponta a ponta.
2. `GET /health` na Railway devolve `{"status":"ok"}`; `GET /` na Vercel
   devolve HTTP 200 com o HTML da home. (Verificado por `fetch`/`curl` pelo
   agente.)
3. CI verde no GitHub em `main` (o workflow `.github/workflows/ci.yml` já roda
   em push; se quebrar nos runners do GitHub, consertar entra nesta peça).
4. **Checagem manual guiada** (autor, com dois navegadores/dispositivos reais):
   abrir a URL da Vercel nos dois, criar sessão, abrir o link no outro, enviar
   um arquivo pequeno, confirmar "Verificado" + "Integridade verificada
   (SHA-256)". É a única parte que exige WebRTC real; o restante o agente
   comprova sozinho.

---

## 2. Divisão em unidades

| Unidade | Onde | Responsabilidade | Muda |
| --- | --- | --- | --- |
| **Dependência do signaling** | `apps/signaling-server/package.json` + `pnpm-lock.yaml` | mover `tsx` de `devDependencies` → `dependencies` (o install de produção da Railway pula devDeps; sem `tsx` o `start` quebra). | -1 devDep / +1 dep |
| **Config Railway** | `railway.json` (novo, raiz) | `build.builder`: `NIXPACKS`; `deploy.startCommand`: `pnpm --filter @transfergo/signaling-server start`; `deploy.healthcheckPath`: `/health`; `deploy.restartPolicyType`: `ON_FAILURE`; `deploy.restartPolicyMaxRetries`: `3`. | arquivo novo (~12 linhas) |
| **Config Vercel** | `apps/web/vercel.json` (novo) | `$schema` + `framework: "nextjs"`. Fixa o preset; a raiz do projeto (`apps/web`) é definida no painel da Vercel (não há campo pra isso no `vercel.json`). | arquivo novo (~4 linhas) |
| **Exemplo de env** | `.env.example` (novo, raiz) | documenta `NEXT_PUBLIC_SIGNALING_URL` e `WEB_ORIGIN` com valores de dev e de produção e as regras (sem barra final, `https://` exato). | arquivo novo (~10 linhas) |
| **Marcador de TURN** | `apps/web/src/lib/peer-connection.ts` | comentário `// TODO(turn): a próxima peça adiciona um TURN gerenciado via env` sobre `ICE_SERVERS`. Sem mudança de comportamento. | 1 linha |
| **Script de verificação** | `scripts/verify-signaling.mjs` (novo) | Node puro (`ws`), 2 args (`<signaling-url> <web-origin>`): `create` → `join` guest → afirma round-trip de um `signal`. Sai 0/1. | arquivo novo (~60 linhas) |
| **README** | `README.md` | reescrita: o que é + link da demo, como funciona (diagrama P2P/signaling), stack, rodar localmente, **limitações conhecidas da V1**, roadmap, link da spec. Placeholders de screenshot. | reescrita (~80 linhas) |
| **CI (se quebrar)** | `.github/workflows/ci.yml` | só se o workflow falhar nos runners do GitHub — ajuste mínimo pra ficar verde. Não mexer proativamente. | 0 linhas esperado |

Nenhuma mudança no motor, no hook, nas páginas, no `signaling-socket.ts`
(o `https→wss` via `base.replace(/^http/,"ws")` já está certo) nem no
`server.ts` (o `/health` e a checagem de `Origin` já existem).

---

## 3. Estado atual relevante (levantado do código)

- **web** (`apps/web`): Next.js 15, `next.config.ts` já tem
  `outputFileTracingRoot` (fix padrão de monorepo). `signaling-socket.ts:27`:
  `process.env.NEXT_PUBLIC_SIGNALING_URL ?? "http://localhost:4000"`, e
  `getSignalingWsUrl()` faz `` `${base.replace(/^http/, "ws")}/ws` `` →
  `https://x` vira `wss://x/ws` corretamente.
- **signaling** (`apps/signaling-server`): `node:http` + `ws` puro. `index.ts`
  lê `process.env.PORT ?? 4000`. `server.ts:8` lê
  `process.env.WEB_ORIGIN ?? "http://localhost:3000"`. `GET /health` →
  `{"status":"ok"}`. Upgrade WS só em `/ws` e só se
  `req.headers.origin === WEB_ORIGIN` (comparação exata). `start` =
  `tsx src/index.ts` (roda TS direto; sem build). Deps de workspace:
  `@transfergo/shared`, `@transfergo/security` (ambos `main: ./src/index.ts`,
  sem build).
- **CI** (`.github/workflows/ci.yml`): roda em `push` e `pull_request` → `main`.
  `pnpm/action-setup@v4` v11.23.0, `actions/setup-node@v4` Node 24,
  `pnpm install --frozen-lockfile`, `pnpm format:check`,
  `pnpm turbo run lint typecheck test build build-storybook`.
- **GitHub**: remote `https://github.com/Edilson-5762/transfergo.git`.
  `origin/main` em `c5f9db9`; `main` local **ahead 100** (fast-forward — nada de
  force).

---

## 4. Mudanças no repositório

### 4.1 `apps/signaling-server/package.json`

Mover a linha `"tsx": "^4.19.0"` de `devDependencies` para `dependencies`.
Rodar `pnpm install` para atualizar `pnpm-lock.yaml`. Nada mais muda —
`start` continua `tsx src/index.ts`.

> Alternativa considerada e recusada para esta peça: build `tsc → dist/` +
> `node dist/index.js`. Puxa compilar `@transfergo/shared` e
> `@transfergo/security` antes, orquestração desproporcional para um servidor
> pequeno. Fica para a peça de hardening (passo 22).

### 4.2 `railway.json` (raiz)

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

- Sem `buildCommand` explícito: o Nixpacks detecta `pnpm` pelo `pnpm-lock.yaml`
  na raiz e roda `pnpm install --frozen-lockfile`, instalando o workspace
  inteiro. É mais install do que o necessário (traz `next`, `react`, etc.), mas
  funciona no primeiro deploy; otimizar (`--filter …^`) é hardening.
- `startCommand` roda a partir da raiz do repo (Root Directory vazio no painel).
- `healthcheckPath` `/health` já existe no servidor.

**Risco:** se o Nixpacks não detectar o pnpm workspace ou errar o Node,
adicionar ao `railway.json`:
`"build": { "builder": "NIXPACKS", "buildCommand": "pnpm install --frozen-lockfile" }`
e/ou um `.nvmrc`/`"engines"` fixando Node 22. O plano de implementação valida
o primeiro deploy e ajusta. Fly.io e Render são substitutos diretos (mesmo
Node+ws, mesmas envs `PORT`/`WEB_ORIGIN`, mesmo `/health`) se a franquia grátis
da Railway não couber — trocar a unidade "Config Railway" por `fly.toml` ou
`render.yaml` sem tocar em mais nada.

### 4.3 `apps/web/vercel.json`

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs"
}
```

O "Root Directory" = `apps/web` é definido no painel da Vercel na importação
(não há chave equivalente no `vercel.json`). Com a raiz em `apps/web`, a Vercel
detecta o workspace pnpm, instala a partir do topo e roda `next build`. O
`outputFileTracingRoot` no `next.config.ts` já cobre o empacotamento do
monorepo. Sem `installCommand`/`buildCommand` custom — os defaults do preset
Next.js servem.

### 4.4 `.env.example` (raiz)

```bash
# ── apps/web (Vercel) ────────────────────────────────────────────────
# URL pública do servidor de sinalização. Sem barra no final.
# Dev:  http://localhost:4000  (é o default no código, pode omitir)
# Prod: https://<seu-projeto>.up.railway.app
NEXT_PUBLIC_SIGNALING_URL=http://localhost:4000

# ── apps/signaling-server (Railway) ──────────────────────────────────
# Origin EXATO do frontend (comparado com o header Origin do upgrade WS).
# https://, sem barra final, sem www.
# Dev:  http://localhost:3000  (default no código)
# Prod: https://<seu-projeto>.vercel.app
WEB_ORIGIN=http://localhost:3000

# PORT é injetada automaticamente pela Railway — não definir à mão.
```

### 4.5 `apps/web/src/lib/peer-connection.ts`

Sobre a constante `ICE_SERVERS` (linha ~20), acrescentar:

```ts
// TODO(turn): a próxima peça da V1 adiciona um servidor TURN gerenciado
// (credenciais temporárias via endpoint no signaling). Até lá, só STUN —
// pares atrás de NAT simétrico / rede corporativa podem não conectar.
```

Nenhuma mudança de comportamento.

---

## 5. `scripts/verify-signaling.mjs`

Node puro, sem TypeScript, sem deps além de `ws` (já no lockfile via o
signaling-server). Uso:

```bash
node scripts/verify-signaling.mjs https://<railway-url> https://<vercel-url>
```

- Arg 1: base do signaling (`https://…`) — o script converte para `wss://…/ws`.
- Arg 2: valor a mandar no header `Origin` do handshake WS (senão o servidor
  recusa o upgrade). Deve ser o `WEB_ORIGIN` configurado na Railway.

Fluxo:

1. Abre WS "host" com o header `Origin`. Envia `{ "type": "create" }`.
2. Recebe `{ "type": "created", "token": … }` (ou o nome real do quadro —
   confirmar no `ws-handler.ts`/protocolo do signaling ao implementar).
3. Abre WS "guest" com o mesmo `Origin`. Envia
   `{ "type": "join", "token": <token>, "role": "guest" }`.
4. Espera os dois lados verem `peer online` (ou o quadro equivalente).
5. Host envia `{ "type": "signal", "payload": { "fake": "sdp" } }`.
6. Afirma que o guest recebe um `signal` com o mesmo payload dentro de ~5 s.
7. Fecha os dois sockets. `process.exit(0)` no sucesso, `exit(1)` + mensagem no
   erro/timeout.

O plano de implementação lê o protocolo real do signaling
(`apps/signaling-server/src/ws-handler.ts` e o pacote de protocolo do web) e
usa os nomes de quadro exatos — o esqueleto acima é a intenção, não os literais.

Este script também serve de regressão: roda contra `localhost` no dev
(`node scripts/verify-signaling.mjs http://localhost:4000 http://localhost:3000`
com o signaling local no ar).

---

## 6. Runbook (cliques do autor)

Vai no plano de implementação como a lista final; resumo aqui para revisão.

**A. GitHub.** O agente roda `git push origin main` (fast-forward). O autor
confere a aba *Actions* do repo: CI verde.

**B. Railway** (primeiro — o web depende da URL dela).
1. railway.app → *New Project* → *Deploy from GitHub repo* → `Edilson-5762/transfergo`.
2. A Railway lê o `railway.json`. *Settings → Root Directory*: vazio.
3. *Variables* → `WEB_ORIGIN` = `http://localhost:3000` (placeholder).
4. Aguardar o deploy. *Settings → Networking → Generate Domain* se não vier
   sozinha. Anotar a URL `*.up.railway.app`.
5. Abrir `<url>/health` → `{"status":"ok"}`.

**C. Vercel.**
1. vercel.com → *Add New → Project* → *Import* `Edilson-5762/transfergo`.
2. *Root Directory* → `apps/web`. Framework: *Next.js* (auto).
3. *Environment Variables* → `NEXT_PUBLIC_SIGNALING_URL` = URL da Railway (B4).
4. *Deploy*. Anotar a URL `*.vercel.app`.

**D. Fechar o laço.**
1. Railway → *Variables* → `WEB_ORIGIN` = URL da Vercel (C4). Redeploy automático.
2. Agente roda `scripts/verify-signaling.mjs` contra as URLs de produção e cola
   a saída. Agente faz `fetch` de `/health` e de `/`.
3. Autor faz a checagem manual de dois navegadores (§1, item 4).

Depois disso, todo push em `main` reimplanta os dois automaticamente.

---

## 7. README — estrutura da reescrita

Português. Seções, na ordem:

1. **Título + badge da demo** — `[▶ Demo ao vivo](https://…vercel.app)` no topo.
2. **O que é** — 2–3 frases. Reaproveita a abertura atual.
3. **Como funciona** — diagrama ASCII (peers ↔ WebRTC P2P; Vercel serve o app;
   Railway só faz sinalização). Frase explícita: **nenhum byte de arquivo passa
   pelo servidor** — o backend só troca SDP/ICE.
4. **Stack** — enxugar a lista atual.
5. **Rodar localmente** — manter o bloco atual (`pnpm install` / `pnpm dev` /
   `pnpm test` …) + uma linha sobre copiar `.env.example` (opcional em dev).
6. **Limitações conhecidas da V1** — lista honesta:
   - Sem TURN ⇒ pares atrás de NAT simétrico ou rede corporativa podem não
     conectar (a próxima peça adiciona TURN).
   - STUN público único (Google).
   - Sinalização numa região só.
   - Sessões efêmeras — somem ao fechar a aba; sem histórico.
   - Sem retomada real de transferência interrompida.
   - Transferência ainda unidirecional (host → convidado).
7. **Roadmap** — resto da V1 (bidirecional, TURN, hardening, cross-browser,
   domínio próprio) → V2 Remote Download → V3 Identity & Trust. Link para
   `docs/superpowers/specs/2026-08-24-transfergo-design.md`.
8. **Arquitetura / spec** — link para a spec do produto.

Screenshots: marcadores `<!-- screenshot: tela inicial -->`,
`<!-- screenshot: transferência em progresso -->`,
`<!-- screenshot: integridade verificada -->`. Capturas reais entram quando o
autor fizer a checagem manual, ou numa peça de polish — a conclusão desta peça
não trava nisso.

---

## 8. Casos de borda e riscos

| Situação | Tratamento |
| --- | --- |
| `origin/main` obsoleto (100 commits atrás) | `git push origin main` é fast-forward (`ahead 100`, sem `behind`). Nenhum force. |
| Ovo-e-galinha das URLs (web precisa da Railway, Railway precisa da Vercel) | Ordem B→C→D: Railway sobe com `WEB_ORIGIN` placeholder; ajusta no passo D1. |
| Nixpacks não detecta o pnpm workspace / erra o Node na Railway | `railway.json` ganha `buildCommand` explícito + `engines`/`.nvmrc` Node 22. Plano valida o 1º deploy. |
| Franquia grátis da Railway não cobre um processo sempre-ligado | Trocar a unidade "Config Railway" por `fly.toml` (Fly.io) ou `render.yaml` (Render) — mesmo Node+ws, mesmas envs, mesmo `/health`. Sem outra mudança. |
| `tsx` some no install de produção | Movido para `dependencies` (§4.1). |
| Deployments de *preview* da Vercel (PRs) não conectam no signaling | `Origin` diferente do `WEB_ORIGIN` ⇒ upgrade recusado. Aceitável — a demo é a URL de produção. Documentar no README de contribuição se um dia houver. |
| CI quebra nos runners do GitHub (Node 24, inclui `build-storybook` e `format:check`) | Consertar entra nesta peça (unidade "CI se quebrar"). O portão do Plano 8 (`lint typecheck test build`, sem `build-storybook`) passou 19/19 local; o plano roda o comando **completo** do CI (`+ build-storybook`, `+ format:check`) local antes do push. |
| `NEXT_PUBLIC_SIGNALING_URL` mudou mas o bundle não | É `NEXT_PUBLIC_` ⇒ embutida em build. Trocar exige redeploy da Vercel (o painel força isso). |
| Barra final / `www` em `WEB_ORIGIN` | Comparação exata em `server.ts:48`. `.env.example` e o runbook avisam. |
| Segredos no repo ao torná-lo público | Não há arquivos `.env` versionados; `.env.example` só tem placeholders. Confirmar com `git log -p -- '*.env*'` vazio no plano. |
| Cold start da Railway após ociosidade | Primeiro `create` pode demorar ~1–2 s. O `signaling-socket` já tem reconexão com backoff. Aceitável para demo. |

---

## 9. Sequência de implementação sugerida

1. `apps/signaling-server/package.json` — `tsx` para `dependencies` +
   `pnpm install`. Portão: `pnpm --filter @transfergo/signaling-server run typecheck test`
   verde; `pnpm --filter @transfergo/signaling-server start` sobe local e
   `curl localhost:4000/health` responde.
2. `railway.json` + `apps/web/vercel.json` + `.env.example` + comentário
   `TODO(turn)`. Portão: `pnpm turbo run lint typecheck test build` 19/19
   (arquivos de config não afetam, mas confirma que nada quebrou); JSON válido.
3. `scripts/verify-signaling.mjs` — lê o protocolo real do signaling, implementa
   o fluxo do §5. Portão: roda verde contra um signaling **local** no ar.
4. Rodar o comando **completo** do CI local
   (`pnpm format:check && pnpm turbo run lint typecheck test build build-storybook`)
   e só então `git push origin main`. Portão: CI verde no GitHub (consertar
   `ci.yml` ou o código apontado se quebrar só no runner).
5. Runbook B→C→D com o autor. Portão: `verify-signaling.mjs` verde contra
   produção; `fetch` de `/health` e `/` OK; checagem manual de dois navegadores.
6. Reescrita do `README.md`. Portão: links válidos, demo ao vivo abre, blocos de
   código corretos.

---

## 10. Textos pt-BR (referência única)

| Contexto | Texto |
| --- | --- |
| Badge do README | `▶ Demo ao vivo` |
| Frase de privacidade no README | `Nenhum byte de arquivo passa pelo servidor — o backend só troca SDP/ICE.` |
| Limitação TURN no README | `Sem TURN nesta versão: pares atrás de NAT simétrico ou rede corporativa podem não conectar.` |
