# Fagulha

Plataforma web de transferência remota, bidirecional e segura de arquivos
entre dispositivos, baseada em WebRTC peer-to-peer com fallback TURN,
transferência incremental de arquivos grandes, verificação de integridade
(SHA-256), sessões temporárias por link seguro e arquitetura orientada à
privacidade (nenhum arquivo é armazenado permanentemente no backend).

> **Nota:** o projeto se chamava **TransferGo** durante o desenvolvimento
> (Planos 1–9). Foi renomeado para **Fagulha** antes da publicação para
> evitar confusão com a fintech de mesmo nome. Os documentos datados em
> `docs/superpowers/` mantêm o nome antigo por serem registro histórico.

**Status:** V1 (Core Transfer) — demo pública em preparação.

**Spec completa:** [`docs/superpowers/specs/2026-08-24-transfergo-design.md`](docs/superpowers/specs/2026-08-24-transfergo-design.md)

## Como funciona

1. Você abre o app e cria uma sessão — ganha um link seguro e temporário.
2. Abre esse link no outro dispositivo (ou manda para outra pessoa).
3. Os dois navegadores estabelecem uma conexão **direta** (WebRTC) usando
   um servidor de sinalização só para o aperto de mão inicial.
4. Os arquivos trafegam **de um dispositivo para o outro**, cifrados em
   trânsito (DTLS), sem passar pelo nosso servidor. Ao final, o
   recebedor confere o hash SHA-256 de cada arquivo.

```
Dispositivo A  ──(link seguro)──►  Dispositivo B
      │                                  │
      └──── sinalização (WebSocket) ─────┘   ← só o aperto de mão
      └════════ arquivos (WebRTC P2P) ═══════┘   ← conteúdo, direto
```

## Stack

TypeScript · Next.js · Node.js · WebRTC (RTCDataChannel) · WebSocket ·
pnpm workspaces + Turborepo

- `apps/web` — frontend Next.js (deploy na Vercel)
- `apps/signaling-server` — servidor Node + WebSocket de sinalização
  (deploy na Render, plano gratuito — pode "dormir" após 15 min sem uso)
- `packages/*` — `shared`, `ui`, `transfer-engine`, `security`

## Desenvolvimento

```bash
pnpm install
pnpm dev        # roda apps/web (:3000) e apps/signaling-server (:4000)
pnpm test       # todos os testes do monorepo
pnpm lint
pnpm typecheck
pnpm build
```

## Limitações conhecidas da V1

- **Sem TURN real** — só STUN público. Redes muito restritivas (alguns
  NATs corporativos / carrier-grade) podem impedir a conexão direta. O
  caminho para adicionar um TURN gerenciado já está marcado no código.
- **Transferência unidirecional** por sessão (quem cria envia; o
  convidado recebe). Bidirecional simultânea fica para depois.
- **Sem domínio próprio** — a demo sai nas URLs gratuitas
  `*.vercel.app` / `*.onrender.com`.
- O servidor de sinalização (Render, plano gratuito) "dorme" após 15 min
  sem uso; o primeiro acesso depois disso demora ~30s pra acordar.
- Validação formal cross-browser/mobile ainda pendente.

## Roadmap

Planos 1–8 (fundação, design system, sessões, sinalização, WebRTC, motor
de transferência, progresso/cancelamento, integridade SHA-256) concluídos.
Plano 9 em andamento: deploy + demo pública, depois TURN, transferência
bidirecional e endurecimento de segurança.
