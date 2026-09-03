# TransferGo — Plano 5/9: WebRTC — Spec de Design

- **Status:** Aprovada para planejamento de implementação
- **Data:** 2026-08-25
- **Escopo:** Passos "06 WebRTC" + "07 P2P" da ordem de implementação da spec
  do produto (`docs/superpowers/specs/2026-08-24-transfergo-design.md`, §12),
  combinados num único plano (o próprio Plano 4/9 já os citou juntos como "o
  plano seguinte") — negociação `RTCPeerConnection` via SDP/ICE (§3.6) usando
  o canal de sinalização WebSocket do Plano 4/9, até um `RTCDataChannel`
  aberto entre os dois peers
- **Depende de:** Plano 4/9 — Signaling/WebSocket (concluído e mesclado em
  `main`, commit `50e2ed3`)
- **Não inclui:** TURN/relay, qualquer UI visual de status de conexão P2P,
  renegociação após reconexão do WebSocket, e qualquer transferência de
  arquivo em si (motor de transferência/chunking — planos seguintes)

## 1. Objetivo

Ligar a conexão P2P real que a spec do produto descreve (§3.6): assim que uma
sessão chega a `status: "accepted"` (evento que já existe desde o Plano 3/9,
entregue via `session_state` desde o Plano 4/9), os dois peers negociam um
`RTCPeerConnection` — trocando oferta/resposta SDP e candidatos ICE através
do canal de sinalização WebSocket já existente — até abrir um
`RTCDataChannel` entre eles. O servidor de sinalização continua sem nunca
entender ou guardar o conteúdo da negociação (§3.6: "só os dados necessários
para estabelecer a conexão P2P... nunca foto/vídeo/PDF/documento") — ele
apenas repassa o payload de sinalização para o par, do mesmo jeito que já
repassa `session_state`/`peer_presence`.

Prova de conclusão: dois clientes reais (host em `/transferir`, guest em
`/s/[token]`) completam o fluxo de convite existente e, após o aceite, o
`RTCDataChannel` de ambos os lados chega a `readyState: "open"` — verificado
manualmente via DevTools/console (não há UI nova nesta fase; ver §8) com uma
mensagem mínima de "ping" trocada pelo canal para confirmar dados fluindo
nos dois sentidos.

## 2. Protocolo de mensagens (extensão do Plano 4/9)

Um único par de mensagens novas, deliberadamente "burras" — o servidor
valida apenas o envelope, nunca o conteúdo SDP/ICE:

**Cliente → servidor (novo):**

| Mensagem | Payload                      | Efeito                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `signal` | `{ payload: SignalPayload }` | Repassado ao peer da sessão via `peerOf()` (já existe em `connection-registry.ts`, sem mudança nele). Só é repassado se a sessão estiver `status: "accepted"`; caso contrário, ignorado silenciosamente (mesma postura defensiva de `accept`/`reject` fora de papel no Plano 4/9). Se não houver peer conectado no momento (`peerOf` retorna `undefined`), a mensagem é descartada sem erro — ver §5 sobre o limite conhecido disso. |

**Servidor → cliente (novo):**

| Mensagem | Payload                      | Quando                                                                                              |
| -------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `signal` | `{ payload: SignalPayload }` | Repasse direto (não é broadcast — só para o par, via `peerOf()`) do `signal` recebido do outro lado |

`SignalPayload` (novo tipo em `packages/shared/src/signaling.ts`):

```ts
export interface IceCandidateData {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

export type SignalPayload =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "candidate"; candidate: IceCandidateData };
```

`IceCandidateData` é um tipo estrutural próprio, não o `RTCIceCandidateInit`
do DOM — `packages/shared` tem `"lib": ["ES2022"]` (sem `"DOM"`), já que
também é consumido pelo `apps/signaling-server` (Node puro). Os três campos
espelham as propriedades (não opcionais, só anuláveis) da instância real
`RTCIceCandidate` do navegador, então `apps/web` monta o payload sem
nenhum cast.

`parseClientMessage` ganha o case `"signal"`, validando só a forma do
envelope (`kind` é um dos três valores, `sdp`/`candidate` presentes e do
tipo certo) — sem validar semântica de SDP (o servidor não faz parsing de
SDP; isso é responsabilidade exclusiva do `RTCPeerConnection` do navegador,
que rejeita SDP inválido naturalmente ao dar `setRemoteDescription`).

## 3. Backend (`apps/signaling-server`)

### 3.1 `ws-handler.ts`

Um novo case `signal` na máquina de mensagens existente:

- Exige que a conexão já tenha sido `attach`ada (token/role conhecidos —
  mesma pré-condição implícita de `accept`/`reject`) e que
  `store.get(token)?.status === "accepted"`; fora isso, ignora a mensagem
  (sem `error`, para não vazar estado de sessão a uma conexão que ainda não
  devia estar mandando `signal`).
- Em caso válido: `registry.peerOf(token, role)?.send(JSON.stringify({
type: "signal", payload }))` — repasse direto, sem tocar
  `session-store.ts` nem `connection-registry.ts` (nenhum dos dois precisa
  saber que SDP/ICE existe).

### 3.2 `connection-registry.ts` e `session-store.ts`

Sem mudanças — `peerOf()` já existe exatamente para esse repasse ponto-a-
ponto (usado hoje só internamente pelo `broadcast`; passa a também ser
chamado direto pelo `ws-handler` para o `signal`).

## 4. Frontend (`apps/web`)

### 4.1 `lib/signaling-socket.ts` — extensão mínima

- Novo método exposto `sendSignal(payload: SignalPayload): void`
  (passthrough — mesma forma de `accept`/`reject`, só que com payload).
- Novo estado exposto `lastSignal: SignalPayload | null`, atualizado (nova
  referência de objeto) a cada `{ type: "signal" }` recebido do servidor —
  mesmo padrão já usado por `session`/`peerOnline`, sem precisar de callback
  passado na construção do hook. Mantém `useSignalingSocket` só responsável
  por transporte — quem interpreta o `SignalPayload` é o hook novo (§4.2),
  não este arquivo.
- Já expõe implicitamente o `role` local (`host`/`guest`) através do
  `rejoinRef` interno — precisa ser exposto no retorno do hook
  (`role: "host" | "guest" | undefined`) para o `usePeerConnection` decidir
  quem inicia a oferta (§4.2).

### 4.2 `lib/peer-connection.ts` (novo) — hook `usePeerConnection`

Hook isolado, testável sem depender de `useSignalingSocket` internamente —
recebe `sendSignal`/`role`/`accepted: boolean`/`lastSignal` do
`useSignalingSocket` (§4.1) como parâmetros, sem importar nada dele. Motivo
de manter separado: `signaling-socket.ts` já tem ~125 linhas cuidando só de
WS+reconexão; misturar o ciclo de vida do `RTCPeerConnection` ali dobraria o
arquivo e acoplaria dois problemas independentes.

```ts
interface UsePeerConnectionResult {
  dataChannel: RTCDataChannel | null;
  channelState: "idle" | "connecting" | "open" | "failed";
}

function usePeerConnection(params: {
  role: "host" | "guest" | undefined;
  accepted: boolean;
  sendSignal: (payload: SignalPayload) => void;
  lastSignal: SignalPayload | null; // do useSignalingSocket, §4.1
}): UsePeerConnectionResult;
```

Sem parâmetro de injeção de dependência para o `RTCPeerConnection` — a
implementação chama o construtor global (`new RTCPeerConnection(...)`)
direto, e os testes substituem esse global (`vi.stubGlobal("RTCPeerConnection",
FakePeerConnection)`), o mesmo padrão que `signaling-socket.test.ts` já usa
para `WebSocket`. Isso mantém a API pública do hook livre de parâmetros que
só existem para viabilizar teste (ver §9).

Responsabilidades internas:

- Só cria o `RTCPeerConnection` quando `accepted` vira `true` pela primeira
  vez (efeito disparado pela transição, não recriado em re-renders).
- Reage a mudanças em `lastSignal` via `useEffect` (nova referência de
  objeto a cada mensagem — dispara mesmo para `signal`s de conteúdo igual,
  ex.: dois `candidate` seguidos).
- `iceServers: [{ urls: "stun:stun.l.google.com:19302" }]` — único servidor
  STUN público, sem TURN (decisão already tomada; TURN fica para plano
  dedicado).
- **Regra determinística de quem oferta:** `role === "host"` sempre cria a
  oferta (`createOffer` → `setLocalDescription` → `sendSignal({kind:
"offer", sdp})`); `role === "guest"` sempre responde (recebe `offer` via
  `lastSignal` → `setRemoteDescription` → `createAnswer` →
  `setLocalDescription` → `sendSignal({kind:"answer", sdp})`). Evita
  qualquer corrida de "quem manda primeiro" sem precisar do padrão
  polite/impolite peer — o papel já existe no protocolo desde o Plano 4/9.
- **Buffer de candidatos ICE:** candidatos recebidos via `lastSignal` antes de
  `setRemoteDescription` completar são enfileirados num array local e
  aplicados (`addIceCandidate`) assim que a descrição remota é setada —
  problema clássico de WebRTC se não bufferizar (o navegador começa a gerar
  `icecandidate` local antes da negociação SDP terminar do outro lado).
- Canal de dados: só o `host` chama `createDataChannel("transfergo")` antes
  da oferta (convenção padrão WebRTC — o lado que cria o canal é o mesmo que
  oferta); o `guest` recebe via evento `ondatachannel`. `channelState`
  reflete `dataChannel.readyState`, mapeado para os 4 valores do tipo acima.
- Cleanup: fecha `RTCPeerConnection`/`RTCDataChannel` no unmount do
  componente (`useEffect` cleanup), sem tentar renegociar.

### 4.3 `/s/[token]/page.tsx` e `/transferir/page.tsx`

Compõem os dois hooks: passam `sendSignal`/`role`/`lastSignal`/`accepted:
session?.status === "accepted"` do `useSignalingSocket` direto para o novo
`usePeerConnection`. Nenhuma renderização nova — `channelState` fica
disponível para o próximo plano usar, sem UI neste (decisão já tomada).

### 4.4 Idioma

Sem texto novo visível ao usuário nesta fase (sem UI nova). Nomenclatura
interna (`role`, `kind`, `channelState`) em inglês, seguindo o padrão dos
Planos 3/9 e 4/9.

## 5. Erros e casos limite

- `signal` chegando ao servidor antes de `status: "accepted"` → ignorado
  (não deveria acontecer via UI normal, já que `usePeerConnection` só ativa
  depois do `accepted`).
- `signal` sem peer conectado no momento (`peerOf` retorna `undefined`,
  ex.: a aba do outro lado está no meio de uma reconexão de WebSocket) →
  mensagem é descartada, **sem retransmissão**. Limite conhecido e aceito
  para este plano: se a oferta/resposta ou um candidato ICE se perder nessa
  janela estreita, a negociação trava (`channelState` fica em
  `"connecting"` indefinidamente) — resolver isso é trabalho do plano de
  "Erros/reconexão" dedicado (§12 da spec do produto), não deste.
- Falha de conectividade P2P real (ex.: NAT simétrico dos dois lados, sem
  TURN disponível) → esperado neste plano; `channelState` permanece
  `"connecting"`/`"failed"` sem retry automático. TURN é o que resolve isso,
  e fica para plano dedicado (decisão já tomada).
- SDP malformado ou incompatível → `setRemoteDescription`/`setLocalDescription`
  rejeitam via `Promise` nativa; o hook captura o erro e marca
  `channelState: "failed"`, sem crash da página.

## 6. Segurança

- Nenhum arquivo trafega neste plano — só metadados de negociação (SDP,
  candidatos ICE), exatamente como a spec §3.6 exige do servidor de
  sinalização.
- SDP e candidatos ICE contêm IPs locais/públicos dos dois peers (inerente
  ao protocolo ICE) — trafegam apenas entre os dois clientes via o servidor
  de sinalização já autenticado por token de sessão (mesma superfície de
  exposição que `session_state` já tem hoje).
- Produção segue exigindo WSS (spec §3.15, já fora de escopo — plano de
  deploy dedicado, decisão repetida do Plano 4/9); `RTCPeerConnection` usa
  DTLS nativamente para o canal de dados, independente do WSS do
  sinalizador.
- `isSignalPayload` limita o tamanho de `sdp` (64 KB) e de
  `candidate.candidate` (4 KB), e rejeita strings vazias; o
  `WebSocketServer` tem `maxPayload: 128 KiB`. Adicionado na revisão final
  deste plano — sem os limites, um cliente malicioso ou com bug podia
  empurrar payloads de `signal` arbitrariamente grandes (o padrão do `ws` é
  100 MiB por mensagem) pelo relay, sem tocar em conteúdo de arquivo (ainda
  gated por token de sessão + `peerOf()`), mas abusando de memória/banda do
  servidor sem qualquer rate limit nesta camada. Os limites são só de
  tamanho/forma — nenhum parsing semântico de SDP foi introduzido.

## 7. Stack e decisões de tooling

| Camada                       | Escolha                                             | Motivo                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STUN                         | `stun:stun.l.google.com:19302` (público, sem custo) | Cobre NAT simples/doméstico para provar conectividade real sem decisão de provedor gerenciado (TURN fica para depois)                                             |
| WebRTC no cliente            | API nativa do navegador (`RTCPeerConnection`)       | Decisão já tomada na spec do produto §3.6 — sem biblioteca (`simple-peer` etc.)                                                                                   |
| WebRTC em teste automatizado | Não usado — ver §9                                  | `jsdom` não implementa `RTCPeerConnection`; adicionar uma stack WebRTC em Node (`wrtc`/`node-datachannel`) só para testes é desproporcional ao escopo deste plano |

Nenhuma dependência nova em `package.json` (STUN é só uma URL de
configuração, não uma lib).

## 8. Fora de escopo deste plano

- TURN/relay (spec §3.7) — plano dedicado, decisão já tomada.
- Qualquer UI visual de status de conexão P2P (ex.: "Conectado (P2P)") —
  decisão já tomada; fica para o plano de Progresso/Estados (spec §3.11),
  que trata status de conexão de forma completa junto com o resto dos 10
  estados de transferência.
- Renegociação de `RTCPeerConnection` após reconexão do WebSocket, ou
  retransmissão de `signal` perdido — plano de "Erros/reconexão" dedicado
  (§5 acima).
- Motor de transferência de arquivos, chunking, backpressure, múltiplos
  arquivos, bidirecionalidade, SHA-256 — planos seguintes (spec §3.8–§3.13).
- Teste automatizado de conectividade P2P real (dois `RTCPeerConnection` de
  verdade negociando) — ver §9; a prova real é manual.

## 9. Testes

- **`packages/shared`** — `signaling.test.ts` ganha casos para
  `parseClientMessage` com `signal` (válido para os 3 `kind`, e casos de
  forma inválida retornando `null`, mesmo padrão dos testes existentes de
  `join`).
- **`apps/signaling-server`** — `ws-handler.test.ts` ganha o caso `signal`,
  no mesmo padrão já usado por todo o resto do arquivo (`ws-handler.ts` do
  Plano 4/9): sockets fake em memória via o helper `fakeSocket()` já
  existente, sessão levada a `accepted`, um lado manda `signal` com um
  payload de exemplo e o teste verifica que o outro lado recebe o mesmo
  payload via `{type:"signal"}` — sem qualquer `RTCPeerConnection` real
  envolvido, só a plumbing de repasse. Mais um caso confirmando que `signal`
  antes de `accepted` não é repassado. (`signaling.integration.test.ts`, que
  usa sockets `ws` reais, cobre um nível diferente — origem/handshake e o
  fluxo completo create→join→accept — e não precisou de caso novo aqui.)
- **`apps/web`** — `usePeerConnection` é testado substituindo o construtor
  global `RTCPeerConnection` (`vi.stubGlobal("RTCPeerConnection",
FakePeerConnection)`, ver §4.2) por uma implementação fake mínima
  controlada pelo teste (métodos
  `createOffer`/`createAnswer`/`setLocalDescription`/`setRemoteDescription`/
  `addIceCandidate` como stubs previsíveis, disparando os eventos certos) —
  cobre a lógica determinística de quem oferta, o buffer de candidatos ICE
  antes da descrição remota, o mapeamento de `channelState` (incluindo os
  caminhos `catch → "failed"`) e a idempotência contra uma `offer` duplicada.
  Isso evita depender de `jsdom` ter `RTCPeerConnection` (não tem) sem
  introduzir uma stack WebRTC real em Node só para o teste.
- **Verificação manual (não automatizada, mesmo padrão do Step 7 opcional
  do Plano 4/9):** dois navegadores reais (ou duas abas), fluxo completo
  criar → convidar → aceitar, confirmando via DevTools que
  `RTCDataChannel.readyState` chega a `"open"` nos dois lados e uma
  mensagem de teste enviada por um chega no `onmessage` do outro.
- Lint/typecheck seguem via `eslint.config.js`/`tsconfig.base.json`
  existentes, sem mudança de regra.

## 10. Critérios de conclusão

- `pnpm turbo run lint typecheck test build` passa com zero erros, incluindo
  `apps/signaling-server`, `apps/web` e `packages/shared`.
- `signal` chega ao par correto via WebSocket, validado por teste automatizado
  de plumbing (ws real) — sem depender de `RTCPeerConnection` real no CI.
- Verificação manual entre dois navegadores reais confirma
  `RTCDataChannel.readyState === "open"` nos dois lados após o aceite, com
  uma mensagem de teste trafegando nos dois sentidos.
- Nenhum arquivo, chunk ou dado de usuário além de SDP/ICE trafega pelo
  servidor de sinalização neste plano.
- Nenhuma UI nova; nomenclatura interna em inglês, sem texto novo visível ao
  usuário.
