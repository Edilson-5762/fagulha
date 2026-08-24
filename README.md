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

> Um README completo (demo pública, arquitetura, screenshots, instalação
> detalhada, limitações, roadmap) será adicionado conforme a V1 avança.
