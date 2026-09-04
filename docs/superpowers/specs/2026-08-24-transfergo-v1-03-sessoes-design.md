# TransferGo — Plano 3/9: Sessões — Spec de Design

- **Status:** Aprovada para planejamento de implementação
- **Data:** 2026-08-24
- **Escopo:** Passo "04 Sessões" da ordem de implementação da spec do produto
  (`docs/superpowers/specs/2026-08-24-transfergo-design.md`, §12) — criação de
  sessão, link seguro e fluxo de aceitar/recusar (§3.3–§3.5, §3.16)
- **Depende de:** Plano 2/9 — Design System & UI Base (concluído e mesclado em
  `main`, commit `1e9a70c`)
- **Não inclui:** WebSocket/signaling em tempo real, WebRTC, P2P, STUN/TURN,
  seleção de arquivos ou qualquer transfer engine — isso começa no Plano
  seguinte (Signaling/WebSocket) em diante

## 1. Objetivo

Substituir a rota placeholder `/transferir` ("em construção", do Plano 2/9)
pelo ciclo de vida real de uma sessão de transferência: criação, link seguro
compartilhável, e o fluxo de convite explícito de aceitar/recusar do lado do
destinatário (spec §3.3–§3.5), com token de sessão criptograficamente seguro
(§3.16) e expiração automática.

Este plano prova, entre dois clientes reais (duas abas/dispositivos apontando
para o mesmo `signaling-server`), que uma sessão pode ser criada, encontrada
por link e resolvida (aceita/recusada/expirada) — sem ainda envolver
WebSocket, WebRTC ou arquivos. Isso é decisão deliberada: a spec (§12) separa
"04 Sessões" de "05 Signaling/WebSocket" como passos distintos, e a UI base
completa (Dialog, Card, StateScreen, Toast etc.) já foi entregue no Plano 2/9
— este plano só precisa conectá-la a estado real pela primeira vez.

## 2. Modelo de dados

Tipos novos em `packages/shared` (ao lado de `TransferState`, já existente):

```ts
export type SessionStatus = "waiting" | "accepted" | "rejected" | "expired";

export interface Session {
  token: string;
  status: SessionStatus;
  createdAt: string; // ISO 8601
  expiresAt: string; // ISO 8601 — createdAt + TTL
}
```

- `SessionStatus` é nomenclatura interna em inglês (spec §3.11) — nunca
  aparece na UI, que é sempre em PT-BR (ver seção 5).
- TTL padrão: **15 minutos**, como constante exportada (`SESSION_TTL_MS`),
  fácil de ajustar em planos futuros sem mudar a forma dos dados.
- O `token` também é o identificador — não existe um ID sequencial separado
  (spec: "link seguro em vez de código numérico", nunca identificador
  previsível).

## 3. Backend — API de sessão no `signaling-server`

`apps/signaling-server` hoje só expõe `GET /health` (`server.ts`). Este plano
adiciona, no mesmo `createServer()` de Node `http` puro (sem framework novo):

| Rota                           | Efeito                                                                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /sessions`               | Cria sessão, responde `201` com `{ token, status: "waiting", expiresAt }`                                                                                                                                                                                                            |
| `GET /sessions/:token`         | Responde `200` com a sessão atual; se `now > expiresAt`, responde com `status: "expired"` calculado na hora (não depende só da faxina periódica); `404` genérico se o token não existe **ou** tem formato inválido — nunca diferencia as duas mensagens (evita enumeração de tokens) |
| `POST /sessions/:token/accept` | `waiting → accepted`. `404` se token inexistente/malformado, `410` se encontrado porém expirado, `409` se já resolvida (`accepted`/`rejected`)                                                                                                                                       |
| `POST /sessions/:token/reject` | `waiting → rejected`. Mesmas regras de erro do `accept`                                                                                                                                                                                                                              |

**Armazenamento:** `Map<string, Session>` em memória no processo do
signaling-server — sem banco, conforme spec §7.4 (V1 não usa banco). Um
`setInterval` remove periodicamente sessões expiradas do `Map` para não vazar
memória; isso é só limpeza — a leitura via `GET` sempre recalcula o status na
hora, nunca espera a faxina.

**CORS:** as respostas liberam explicitamente a origem do `apps/web` (dev:
`http://localhost:3000`), nunca `*`.

**Geração de token — `packages/security`:** hoje é só o stub
`PACKAGE_NAME = "@transfergo/security"` do Plano 1/9. Este plano adiciona
`generateSessionToken()`: `crypto.randomBytes(32)` (Node `crypto`) codificado
em base64url (~43 caracteres) — alta entropia, imprevisível, nunca
sequencial (spec §3.16).

## 4. Fora de escopo deste plano (dívida técnica documentada)

- **Rate limiting** nos endpoints de criar/entrar/validar sessão (spec
  §3.17) — fica para o plano de segurança/hardening dedicado, que trata isso
  de forma completa em todos os endpoints sensíveis de uma vez, em vez de
  duplicar esforço aqui.
- **HTTPS/WSS de produção** (spec §3.15) — fica para o plano de deploy.
- **WebSocket/signaling em tempo real** — a atualização de quem criou a
  sessão é via polling REST (seção 5), não push. Isso é decisão deliberada
  para não antecipar o próximo plano.
- **WebRTC, P2P, STUN/TURN.**
- **Seleção de arquivos e transfer engine** — a tela de criação de sessão não
  lista arquivos nesta etapa; isso entra quando o motor de transferência
  real existir.
- **Cancelamento de sessão pendente** — não pedido pela spec para este
  estágio (§3.12 trata de cancelamento de transferência ativa, que ainda não
  existe).

## 5. Frontend (`apps/web`)

### 5.1 Rotas

- **`apps/web/src/app/transferir/page.tsx`** — deixa de ser o `StateScreen`
  "em construção" do Plano 2/9 e vira a tela de **criação**: botão "Nova
  transferência" → `POST /sessions` → mostra o link
  `https://<domínio>/s/<token>` com botão "Copiar link", e entra em polling
  (`GET /sessions/:token` a cada 2s) enquanto `status === "waiting"`, parando
  assim que o status mudar.
- **`apps/web/src/app/s/[token]/page.tsx`** (nova) — tela de **entrada**:
  `GET /sessions/:token` ao montar, renderiza conforme o status:
  - `waiting` → convite explícito com **Aceitar** / **Recusar** (spec §3.5)
  - `accepted` → "Convite aceito" (conexão real chega no próximo plano)
  - `rejected` → "Convite recusado"
  - `expired` / `404` → "Link expirado"

Cliente HTTP: módulo `apps/web/src/lib/sessions-api.ts`, fetch wrapper
tipado com os tipos de `packages/shared`. URL base do signaling-server via
`NEXT_PUBLIC_SIGNALING_URL` (default `http://localhost:4000` em dev, alinhado
com a infra do Plano 1/9 — `ws.dominio.com` em produção).

Feedback do "Copiar link": troca de texto inline no próprio botão ("Copiado!"
por ~2s) — sem introduzir `ToastProvider`/`ToastViewport` (Radix) ainda, já
que nada em `apps/web` os monta hoje; fica para quando surgir uma necessidade
real de toasts em outro fluxo.

### 5.2 `StateScreen` ganha múltiplas ações

A spec (§6) exige que todo estado de interface tenha "tela dedicada, nunca
improvisada", sempre no mesmo vocabulário visual (ícone + título + descrição

- ação). O convite de aceitar/recusar é, conceitualmente, mais um desses
  estados — só que com duas ações em vez de uma. Em vez de criar um componente
  paralelo só para esse caso (fragmentando o vocabulário visual), o
  `StateScreen` existente é estendido:

```ts
export interface StateScreenAction {
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary"; // 2ª ação = botão secundário/ghost
}

export interface StateScreenProps extends VariantProps<typeof iconWrapperVariants> {
  icon: LucideIcon;
  title: string;
  description: string;
  actions?: StateScreenAction[]; // era `action?: StateScreenAction` (singular)
  className?: string;
}
```

Migração: hoje só existe um uso real da prop antiga (`/transferir/page.tsx`,
sem ação nenhuma) e um teste + uma story em `packages/ui` usando `action`
singular — ambos atualizados para `actions` como parte deste plano. Todas as
telas de sessão (waiting, convite, accepted, rejected, expired) passam a usar
o mesmo componente e o mesmo vocabulário visual da spec.

### 5.3 Idioma

Nomenclatura interna (`SessionStatus`, nomes de variável) sempre em inglês;
todo texto visível ao usuário sempre em PT-BR (spec §3.11), por exemplo:
"Nova transferência", "Copiar link" / "Copiado!", "Aceitar", "Recusar",
"Aguardando resposta", "Convite aceito", "Convite recusado", "Link expirado".

## 6. Segurança

- Token gerado com `crypto.randomBytes`, nunca sequencial nem previsível
  (§3.16).
- `GET /sessions/:token` responde `404` genérico tanto para token inexistente
  quanto para token malformado — nunca diferencia a mensagem, para não
  permitir enumeração.
- CORS restrito à origem do `apps/web`, nunca `*`, em dev e produção.
- Nenhum conteúdo de arquivo trafega neste plano — só metadados de sessão
  (token, status, timestamps), conforme §3.6 (o servidor de sinalização nunca
  recebe arquivos).

## 7. Testes

Mesmo padrão dos Planos 1–2 (Vitest + Testing Library, sem mocks onde dá para
usar o real):

- **`packages/security`** — geração de token: formato (base64url), tamanho,
  ausência de colisão em N gerações.
- **`apps/signaling-server`** — um teste por rota (criar, buscar, aceitar,
  rejeitar, 404 de token inexistente/malformado, 409 de sessão já resolvida,
  expiração calculada sob demanda), seguindo o padrão já existente de
  `server.test.ts` (`createServer()` + `fetch` real contra um servidor
  efêmero, sem mocks).
- **`packages/ui`** — `StateScreen` com `actions` (0, 1 e 2 botões,
  `variant` primary/secondary), substituindo o teste/story de `action`
  singular.
- **`apps/web`** — `/transferir` (cria sessão, mostra link, copia,
  entra em polling) e `/s/[token]` (cada `SessionStatus` renderiza a tela
  certa) com `fetch` mockado.
- **Integração ponta-a-ponta** — um teste que simula duas "abas" reais (dois
  clientes `fetch` contra a mesma instância de `createServer()`): um cria a
  sessão, o outro busca por token e aceita/recusa, confirmando que uma nova
  leitura do criador reflete a mudança de estado — prova o fluxo completo
  entre dois peers sem depender de WebSocket.
- Lint/typecheck seguem via `eslint.config.js`/`tsconfig.base.json`
  existentes, sem mudança de regra.

## 8. Critérios de conclusão

- `pnpm turbo run lint typecheck test build` passa com zero erros, incluindo
  `packages/security`, `apps/signaling-server` e `apps/web`.
- Duas abas/clientes apontando para a mesma instância do signaling-server
  completam o fluxo real: criar sessão → copiar link → abrir em outra aba →
  aceitar (ou recusar) → o criador reflete o novo status via polling.
- Sessão expira automaticamente após o TTL e `GET /sessions/:token` reflete
  isso mesmo sem reiniciar o processo.
- Todo texto visível ao usuário está em PT-BR; nomenclatura interna de status
  permanece em inglês.
