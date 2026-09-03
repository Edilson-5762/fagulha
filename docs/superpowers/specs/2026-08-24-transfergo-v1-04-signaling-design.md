# TransferGo — Plano 4/9: Signaling/WebSocket — Spec de Design

- **Status:** Aprovada para planejamento de implementação
- **Data:** 2026-08-24
- **Escopo:** Passo "05 Signaling/WebSocket" da ordem de implementação da spec
  do produto (`docs/superpowers/specs/2026-08-24-transfergo-design.md`, §12) —
  canal de sinalização em tempo real (§3.6), estado de sessão, presença e
  desconexão
- **Depende de:** Plano 3/9 — Sessões (concluído e mesclado em `main`, commit
  `6ef7eab`)
- **Não inclui:** SDP/ICE, `RTCPeerConnection`, WebRTC, P2P, STUN/TURN — isso
  começa no plano seguinte ("06 WebRTC"/"07 P2P") em diante

## 1. Objetivo

Substituir o transporte REST + polling do Plano 3/9 pelo canal de sinalização
real em tempo real que a spec do produto já descreve (§3.6): "servidor de
sinalização (Node.js + WebSocket)" responsável por criação/entrada de sessão,
estado da sessão, expiração e desconexão. Este plano entrega exatamente essa
fatia — o transporte WebSocket e o protocolo de mensagens — sem antecipar
SDP/ICE, que só existe quando houver de fato uma negociação WebRTC para
carregar (planos seguintes).

Prova de conclusão: as mesmas duas telas do Plano 3/9 (`/transferir` e
`/s/[token]`) continuam funcionando fim a fim entre dois clientes reais, mas
agora via push (WebSocket) em vez de `setInterval`/polling REST — incluindo
presença ("destinatário conectado", "peer offline") e reconexão automática do
próprio cliente quando a conexão com o servidor cai.

## 2. Protocolo de mensagens

Um único endpoint WS (`GET /ws`, upgrade do mesmo `http.Server` de
`server.ts` via `ws`) — sem porta nova, sem framework de protocolo (`ws` puro,
não `socket.io`; ver seção 7). Envelope JSON: `{ type: string, ...payload }`.

**Cliente → servidor:**

| Mensagem | Payload           | Efeito                                                                               |
| -------- | ----------------- | ------------------------------------------------------------------------------------ |
| `create` | —                 | Cria sessão nova; esta conexão vira `role: "host"` da sessão criada                  |
| `join`   | `{ token, role }` | `role: "host"` = reconexão do criador (refresh); `role: "guest"` = entrada pelo link |
| `accept` | —                 | `waiting → accepted`. Só válido em conexão com `role: "guest"`                       |
| `reject` | —                 | `waiting → rejected`. Só válido em conexão com `role: "guest"`                       |

**Servidor → cliente:**

| Mensagem        | Payload                  | Quando                                                                                          |
| --------------- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| `session_state` | `{ session }`            | Resposta a `create`/`join` e a cada transição de status (`accept`/`reject`/expiração detectada) |
| `peer_presence` | `{ connected: boolean }` | Sempre que o _outro_ papel (host↔guest) conecta ou desconecta                                   |
| `error`         | `{ code }`               | `not_found \| expired \| already_resolved \| invalid_role`                                      |

`session` no payload é o mesmo tipo `Session` de `packages/shared` (sem
mudança de forma — token, status, createdAt, expiresAt). Nenhum outro dado
trafega neste plano (nenhum arquivo, nenhum SDP/ICE — spec §3.6).

## 3. Backend (`apps/signaling-server`)

### 3.1 `connection-registry.ts` (novo)

Módulo isolado, sem se misturar ao `session-store.ts` existente:

```ts
interface ConnectionRegistry {
  attach(token: string, role: "host" | "guest", socket: WebSocket): void;
  detach(token: string, role: "host" | "guest", socket: WebSocket): void;
  peerOf(token: string, role: "host" | "guest"): WebSocket | undefined;
  broadcast(token: string, message: unknown): void;
}
```

- Mapa em memória `token → { host?: WebSocket; guest?: WebSocket }`.
- `attach`: se já existe um socket no mesmo papel, fecha o antigo (código de
  fechamento `4000`, "superseded") antes de registrar o novo — cobre refresh
  de página sem tratar como erro (decisão já validada).
- `detach` (chamado no evento `close` do socket): remove a referência e, se
  houver um peer conectado no outro papel, envia `peer_presence
{connected:false}` para ele. A sessão em si **não é removida nem alterada**
  aqui — só o `sweep()` por TTL do `session-store.ts` remove sessões,
  exatamente como hoje. Isso resolve o comentário deliberado já existente em
  `session-store.ts` sobre "sessão resolvida sobreviver para handshake": a
  vida da sessão nunca depende de conexão de socket.
- Puramente em memória, sem timers próprios — não introduz um segundo
  mecanismo de expiração paralelo ao do `session-store.ts`.

### 3.2 `ws-handler.ts` (novo)

Recebe o `WebSocket` recém-upgradado e a `SessionStore`/`ConnectionRegistry`,
implementa a máquina de mensagens da seção 2:

- `create`: `store.create()` → `registry.attach(token, "host", socket)` →
  responde `session_state`.
- `join {token, role}`: `store.get(token)`; se ausente → `error{not_found}`
  e fecha; se `expired` → `error{expired}` e fecha; senão
  `registry.attach(token, role, socket)`, responde a este socket
  `session_state` seguido de `peer_presence{connected}` refletindo se o
  outro papel já está conectado agora (`registry.peerOf(...)`) — cobre tanto
  o guest que entra depois quanto o host que reconecta e precisa saber se o
  guest segue online; e envia `peer_presence{connected:true}` ao peer já
  conectado (se houver), avisando da nova conexão.
- `accept`/`reject`: exige que a conexão tenha sido `attach`ada com
  `role: "guest"` (senão `error{invalid_role}`, mensagem ignorada); chama
  `store.accept`/`store.reject`; em sucesso, `registry.broadcast(token,
session_state)` para host e guest; em falha, `error{code}` só para quem
  mandou.
- No evento `close` do socket: `registry.detach(token, role, socket)`.

### 3.3 `server.ts`

- Remove as 4 rotas REST de sessão e `SESSION_*_PATTERN` (o `session-store.ts`
  em si não muda — seção 3.1).
- Mantém `GET /health`.
- Adiciona handler de `upgrade` no `http.Server`, delegando conexões em
  `/ws` para o `WebSocketServer` (`noServer: true`, seguindo o padrão
  recomendado da própria `ws` para reaproveitar o servidor HTTP existente).
- CORS deixa de ser relevante para sessão (não é mais HTTP); a verificação de
  origem passa a ser feita no handshake do `upgrade` (checar header `Origin`
  contra `WEB_ORIGIN`, rejeitando o upgrade se não bater — equivalente ao
  CORS restrito de antes, seção 6).

## 4. Frontend (`apps/web`)

### 4.1 `lib/signaling-socket.ts` (novo, substitui `lib/sessions-api.ts`)

Hook `useSignalingSocket()` que encapsula:

- Abertura do WS (`ws://<NEXT_PUBLIC_SIGNALING_URL>/ws`, mesma env var do
  Plano 3/9).
- Envio de `create` (quando chamado sem argumentos) ou `join {token, role}`
  (quando chamado com um token — usado por `/s/[token]`).
- Reconexão automática com backoff (1s, 2s, 4s, capado em ~10s) guardando
  `token`/`role` localmente (estado do hook) para reenviar `join` assim que a
  conexão reabrir — cobre queda da _própria_ conexão do cliente, distinta de
  `peer_presence` (queda do peer).
- Estado exposto: `session: Session | null`, `peerOnline: boolean`,
  `connectionState: "connecting" | "open" | "reconnecting"`.
- Ações expostas: `accept()`, `reject()` (enviam a mensagem e não retornam
  nada — o novo estado chega via `session_state` recebido).

### 4.2 `/transferir/page.tsx`

- Troca `createSession`/`fetchSession` + `setInterval` pelo hook: ao clicar
  "Nova transferência", chama a variante de criação do hook.
- `connectionState === "reconnecting"` renderiza um `StateScreen` de
  "offline"/"reconectando" (um dos 17 estados obrigatórios da spec §6, ainda
  não usado nas telas de sessão) por cima do conteúdo normal, sem perder o
  `session` já conhecido.
- Demais estados (`waiting`/`accepted`/`rejected`/`expired`) mantêm o mesmo
  `renderContent` do Plano 3/9 — só a fonte do estado muda (push em vez de
  poll).

### 4.3 `/s/[token]/page.tsx`

- Troca o `fetchSession` único + `acceptSession`/`rejectSession` REST pelo
  mesmo hook, chamado com `{ token, role: "guest" }`.
- Mesmo tratamento de `connectionState === "reconnecting"` do item 4.2.

### 4.4 `SessionLinkPanel`

- Ganha a prop `peerOnline: boolean` (vinda do hook via `/transferir`): texto
  passa de "Aguardando resposta" para algo como "Destinatário conectado,
  aguardando resposta" quando `peerOnline` for `true` — usa a presença que a
  seção 2 já entrega, sem inventar um novo estado de sessão.

### 4.5 Idioma

Mesmo padrão do Plano 3/9: nomenclatura interna (`role`, tipos de mensagem)
em inglês; todo texto visível ao usuário em PT-BR — incluindo os novos
textos de presença e de reconexão ("Destinatário conectado...", "Conexão
perdida, reconectando...").

## 5. Erros e expiração

- `join` com token inexistente/malformado → `error{code:"not_found"}` →
  mesma tela de "link expirado" já existente do Plano 3/9 (sem diferenciar a
  mensagem, mantendo a mitigação de enumeração de tokens do Plano 3/9).
- `join` com token existente porém expirado → `error{code:"expired"}` → mesma
  tela.
- `accept`/`reject` numa sessão já resolvida → `error{code:"already_resolved"}`
  → o cliente simplesmente re-renderiza a partir do último `session_state`
  recebido (não deveria ser alcançável pela UI normal, já que os botões somem
  assim que o status muda).
- `accept`/`reject` vindo de `role: "host"` → `error{code:"invalid_role"}` —
  também não alcançável pela UI normal (só `/s/[token]` chama essas ações).

## 6. Segurança

- Handshake do `upgrade` valida o header `Origin` contra `WEB_ORIGIN` (mesma
  restrição que o CORS fazia no Plano 3/9), rejeitando conexões de origem
  diferente.
- Token continua sendo o único identificador, gerado por
  `generateSessionToken()` do Plano 3/9 (sem mudança).
- Nenhum conteúdo de arquivo trafega neste plano — só metadados de sessão e
  presença (§3.6: o servidor de sinalização nunca recebe arquivos).

## 7. Stack e decisões de tooling

| Camada      | Escolha                         | Motivo                                                                                                                                                                                                                                             |
| ----------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Servidor WS | `ws`                            | Padrão de mercado para WebSocket em Node, leve, integra via `noServer: true` no `http.Server` existente sem porta separada — dispensado `socket.io` (protocolo próprio e reconexão automática que este plano já implementa manualmente no cliente) |
| Cliente WS  | `WebSocket` nativo do navegador | Sem biblioteca — a lógica de reconexão/backoff é simples o suficiente para não justificar uma dependência                                                                                                                                          |

`apps/signaling-server/package.json` ganha `ws` (+ `@types/ws` em dev).

## 8. Fora de escopo deste plano

- SDP/ICE, `RTCPeerConnection`, WebRTC, P2P, STUN/TURN (planos seguintes).
- HTTPS/WSS de produção (spec §3.15) — plano de deploy dedicado, como já
  documentado no Plano 3/9.
- **Rate limiting** de conexões/mensagens (spec §3.17) — mesma decisão do
  Plano 3/9: fica para o plano de segurança/hardening dedicado, que trata
  disso de forma completa (HTTP e WS) de uma vez, em vez de duplicar esforço
  aqui.
- Persistência de sessão além de memória — inalterado do Plano 3/9 (spec
  §7.4: V1 não usa banco).
- Múltiplos guests na mesma sessão — a spec (§3.3–§3.5) descreve sempre
  Peer A ⇄ Peer B; o protocolo desta seção 2 assume exatamente um `host` e
  um `guest` por token.
- Qualquer seleção de arquivo ou transfer engine.

## 9. Testes

Mesmo padrão dos Planos 1–3 (Vitest + Testing Library, sem mocks onde dá para
usar o real):

- **`apps/signaling-server`** — `connection-registry.ts` (attach substitui
  conexão antiga, detach dispara `peer_presence`), `ws-handler.ts` (cada
  mensagem do protocolo, incluindo os 4 códigos de erro), usando um servidor
  `ws` efêmero real + clientes `WebSocket` reais (mesmo padrão de
  `server.test.ts` do Plano 3/9 com `fetch` real — aqui com sockets reais em
  vez de mock).
- **`apps/web`** — `useSignalingSocket` (criação, join, reconexão com
  backoff simulando fechamento do socket), páginas `/transferir` e
  `/s/[token]` com o socket mockado.
- **Integração ponta-a-ponta** — mesmo teste de dois peers reais do Plano
  3/9 (navegador headless), agora validando que o criador recebe o novo
  status **via push** (sem `setInterval`) assim que o destinatário aceita ou
  recusa, e que a presença ("destinatário conectado"/"offline") aparece
  corretamente quando a aba do destinatário abre/fecha.
- Lint/typecheck seguem via `eslint.config.js`/`tsconfig.base.json`
  existentes, sem mudança de regra.

## 10. Critérios de conclusão

- `pnpm turbo run lint typecheck test build` passa com zero erros, incluindo
  `apps/signaling-server` e `apps/web`.
- Duas abas/clientes completam o fluxo real via WebSocket: criar sessão →
  copiar link → abrir em outra aba (`peer_presence` reflete a conexão) →
  aceitar (ou recusar) → o criador recebe o novo status por push, sem
  polling.
- Fechar a aba do destinatário faz o criador ver "offline" sem que a sessão
  seja cancelada; reabrir o link antes do TTL expirar volta a mostrar o
  convite normalmente.
- Derrubar a conexão do próprio cliente (ex.: reiniciar o servidor) faz a UI
  mostrar reconexão automática e voltar ao estado correto assim que a conexão
  reabre.
- Sessão expira automaticamente após o TTL exatamente como no Plano 3/9
  (mecanismo de expiração inalterado).
- Todo texto visível ao usuário está em PT-BR; nomenclatura interna
  permanece em inglês.
