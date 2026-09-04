# TransferGo — Plano 6/9: Motor de Transferência — Spec de Design

- **Status:** Em revisão pelo autor do produto
- **Data:** 2026-09-03
- **Escopo:** Passos "08 Transfer engine" + "09 Chunks/backpressure" da ordem de
  implementação da spec do produto
  (`docs/superpowers/specs/2026-08-24-transfergo-design.md`, §12), combinados num
  único plano — mesma cadência de 2 passos por plano usada nos Planos 4/9 e 5/9.
- **Depende de:** Plano 5/9 — WebRTC (concluído e mesclado em `main`, commit
  `14d37f4`). O `RTCDataChannel` já abre entre os dois peers via
  `usePeerConnection` assim que a sessão chega a `status: "accepted"`.
- **Não inclui:** verificação de integridade SHA-256 (§3.13 — plano dedicado),
  os dois peers enviando ao mesmo tempo ou em turnos na mesma sessão
  (§3.8 "12 Bidirecional" — plano dedicado), barra de progresso com
  porcentagem/velocidade/tempo restante (§3.11 "10 Progresso" — plano dedicado),
  classificação Normal/Sensível/Confidencial (§5 — V3), TURN/relay (§3.7 — plano
  dedicado), retomada real após queda de conexão (§3.14 — só a **preparação
  arquitetural** entra aqui, não o resume em si).

---

## 1. Objetivo

Fazer um ou vários arquivos viajarem de verdade do peer **host** para o peer
**guest** pelo `RTCDataChannel` que o Plano 5/9 abriu — cortados em pedaços,
com controle de fluxo (`bufferedAmount`) para nunca lotar a memória, recebidos e
remontados do outro lado, e salvos no dispositivo de quem recebe. Tudo
automático: o usuário não escolhe tamanho de pedaço, não carrega parte por
parte, não aprova arquivo por arquivo.

**Prova de conclusão:** um teste automatizado de loopback em Node (duas
instâncias do motor ligadas por um par de canais falsos) transfere um lote de
vários arquivos com bytes reais e o conteúdo gravado pelo receptor é idêntico,
byte a byte, ao conteúdo lido pelo emissor — incluindo um arquivo grande o
suficiente para exercitar pausa/retomada por backpressure. Verificação manual
complementar: dois navegadores reais completam o fluxo e os arquivos aparecem no
dispositivo de quem recebeu, com as mensagens "…com sucesso" nos dois lados.

---

## 2. Divisão em unidades

| Unidade                           | Onde                                               | Responsabilidade                                                                                                                                                                                      | Depende de                     |
| --------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **Protocolo de transferência**    | `packages/transfer-engine/src/protocol.ts`         | Formato das mensagens de controle (JSON) e dos quadros binários que trafegam pelo `RTCDataChannel`; funções puras de `encode`/`decode`/validação. Nenhum estado.                                      | nada                           |
| **Emissor** (`TransferSender`)    | `packages/transfer-engine/src/sender.ts`           | Máquina de estados que percorre a fila de arquivos, lê cada um em pedaços via um `ChunkSource`, respeita o backpressure do canal, emite eventos de progresso.                                         | protocolo, `types.ts`          |
| **Receptor** (`TransferReceiver`) | `packages/transfer-engine/src/receiver.ts`         | Máquina de estados que consome os quadros, valida limites e nomes, escreve cada arquivo num `FileSink`, confere o tamanho recebido, emite eventos de progresso.                                       | protocolo, `types.ts`          |
| **Contratos de I/O**              | `packages/transfer-engine/src/types.ts`            | `DataChannelLike`, `ChunkSource`, `FileSink`, tipos de evento de progresso, `TransferError`. São as costuras que deixam o motor rodar tanto no navegador quanto em Node puro.                         | nada                           |
| **Classificação de tamanho**      | `packages/shared/src/file-size.ts`                 | `classifyFileSize(bytes) → "small" \| "medium" \| "large"` + os limiares e os limites de lote (50 arquivos / 5 GiB). Fica em `shared` porque tanto a UI quanto a checagem de limite do receptor usam. | nada                           |
| **Adaptadores de navegador**      | `apps/web/src/lib/file-system-sink.ts`             | Implementações reais de `ChunkSource` (a partir de um `File`) e de `FileSink`: a preferencial via File System Access API e a de reserva via acúmulo em `Blob` + download. Detecção de qual usar.      | `transfer-engine`              |
| **Hook de transferência**         | `apps/web/src/lib/use-file-transfer.ts`            | Liga o motor ao `RTCDataChannel` real (vindo do `usePeerConnection`), aos `File` reais e aos adaptadores. Expõe estado e ações para a UI.                                                             | `transfer-engine`, adaptadores |
| **UI do emissor**                 | `apps/web/src/components/transferir/SendPanel.tsx` | Escolher arquivos, lista com nome/tamanho/tipo/etiqueta, checagem de limite, botão Enviar, status geral e por arquivo, tela final.                                                                    | hook                           |
| **UI do receptor**                | `apps/web/src/components/s/ReceivePanel.tsx`       | Resumo do lote que está chegando (quantidade + tipos + total), Recusar/Receber, lista por arquivo, tela final.                                                                                        | hook                           |

O `packages/transfer-engine` hoje só tem um placeholder (`PACKAGE_NAME`); este
plano é o primeiro conteúdo real dele.

---

## 3. Protocolo sobre o `RTCDataChannel`

O canal (`"transfergo"`, criado pelo host no Plano 5/9) é **confiável e
ordenado** por padrão (SCTP) — os bytes chegam completos e na ordem, ou o canal
falha. Isso é o que permite dizer "concluído com sucesso" neste plano sem
SHA-256 (o hash de conteúdo é uma camada extra, plano dedicado).

`dataChannel.binaryType` é setado para `"arraybuffer"` no adaptador.

### 3.1 Quadros de controle (strings JSON)

```ts
type ControlFrame =
  | { t: "batch-offer"; batch: { id: string; files: FileMeta[] } }
  | { t: "batch-accept" }
  | { t: "batch-reject"; reason: "declined" | "over-limit" | "busy" }
  | { t: "file-begin"; id: string; offset: number } // offset sempre 0 neste plano (ver §7)
  | { t: "file-end"; id: string; bytesSent: number }
  | { t: "batch-complete" }
  | { t: "cancel"; scope: "batch" };

interface FileMeta {
  id: string; // gerado pelo emissor, estável dentro do lote
  name: string; // nome original; o receptor sanitiza antes de usar (ver §6)
  size: number; // bytes, declarado pelo emissor
  type: string; // MIME informado pelo navegador; pode ser "" — apenas informativo
}
```

### 3.2 Quadros binários

`ArrayBuffer` cru com os bytes do pedaço do **arquivo atualmente aberto** — o
que teve o último `file-begin` sem `file-end` correspondente. Não há cabeçalho
por pedaço: como os arquivos são enviados estritamente um de cada vez e em
ordem, e o canal é ordenado, o receptor sempre sabe a qual arquivo o quadro
pertence. Menos overhead, menos superfície de bug.

### 3.3 Fluxo de mensagens

```
host (emissor)                                   guest (receptor)
──────────────                                   ────────────────
batch-offer  ───────────────────────────────────▶  valida limites/nomes
                                                   mostra resumo + Recusar/Receber
             ◀───────────────────────────────────  batch-accept  (ou batch-reject)
file-begin(f1,0) ──────────────────────────────▶   abre FileSink de f1
<binário> <binário> … (com pausa por backpressure)▶ escreve cada pedaço
file-end(f1,size) ─────────────────────────────▶   close(); confere bytes == size
file-begin(f2,0) ──────────────────────────────▶   …
             …
batch-complete ────────────────────────────────▶   estado geral: completed
```

Cancelamento: qualquer lado envia `{ t: "cancel", scope: "batch" }`. O emissor
para de ler/enviar; o receptor faz `abort()` no `FileSink` aberto (descarta o
arquivo parcial) e marca o lote como `cancelled`. Estado se propaga porque o
outro lado recebe o `cancel` (§3.12 da spec do produto).

### 3.4 Sem mudança no servidor de sinalização

Nada disso passa pelo `apps/signaling-server`. Ele já cumpriu o papel dele
(abrir o canal P2P) e continua cego a qualquer conteúdo — exatamente como a
spec §3.6 exige. `packages/shared/src/signaling.ts` **não muda**; o protocolo de
transferência vive só em `packages/transfer-engine`.

---

## 4. Emissor (`TransferSender`)

```ts
interface SenderEvents {
  progress: (p: {
    batchId: string;
    fileId: string;
    fileBytesSent: number;
    fileSize: number;
    filesDone: number;
    filesTotal: number;
  }) => void;
  fileComplete: (fileId: string) => void;
  batchComplete: () => void;
  error: (e: TransferError) => void;
  cancelled: () => void;
}

class TransferSender {
  constructor(params: {
    channel: DataChannelLike;
    files: { id: string; meta: FileMeta; source: ChunkSource }[];
    chunkSize?: number; // default 16 KiB
    highWaterMark?: number; // default 8 MiB
    lowWaterMark?: number; // default 1 MiB
  });
  start(): void; // envia batch-offer e espera batch-accept
  cancel(): void;
  on<K extends keyof SenderEvents>(event: K, cb: SenderEvents[K]): void;
}
```

Regras internas:

- **Só o host instancia o `TransferSender`.** O guest instancia só o
  `TransferReceiver`. (Bidirecional é plano dedicado — ver §9. O motor é escrito
  simétrico de propósito, então o plano futuro é quase só UI + uma trava de
  "quem está com o canal".)
- Após `start()`, envia `batch-offer` e aguarda `batch-accept`. Se vier
  `batch-reject`, emite `error`/`cancelled` conforme o `reason` e para.
- Para cada arquivo, em sequência: `file-begin` → laço de leitura
  (`source.read(offset, chunkSize)`) e `channel.send(arrayBuffer)` →
  `file-end`.
- **Backpressure:** antes de cada `send`, se
  `channel.bufferedAmount > highWaterMark`, pausa — registra um listener em
  `bufferedamountlow` (com `channel.bufferedAmountLowThreshold = lowWaterMark`)
  e só retoma quando o buffer drena. Nunca faz busy-wait; nunca empurra pedaço
  com o buffer cheio (spec §3.10).
- Tamanho de pedaço padrão **16 KiB** — valor seguro cross-browser para SCTP. É
  parâmetro do construtor; um benchmark durante a implementação pode elevá-lo
  (a spec §3.10 diz explicitamente "determinado por benchmark"), mas o default
  conservador é o que entra.
- `progress` é emitido no máximo a cada ~250 ms ou a cada troca de arquivo (o
  que vier primeiro) — evita floodar o React com re-render por pedaço de 16 KiB.
- Memória: só um pedaço por vez em RAM no emissor. O `File` do navegador não é
  lido inteiro — `ChunkSource` fatia sob demanda.
- Erro de leitura/envio → `abort` da transferência, envia `cancel`, emite
  `error`.

---

## 5. Receptor (`TransferReceiver`)

```ts
interface ReceiverEvents {
  batchOffered: (offer: { batchId: string; files: FileMeta[]; totalBytes: number }) => void;
  progress: (p: {/* mesma forma do progress do emissor */}) => void;
  fileComplete: (fileId: string) => void;
  batchComplete: () => void;
  error: (e: TransferError) => void;
  cancelled: () => void;
}

class TransferReceiver {
  constructor(params: {
    channel: DataChannelLike;
    openSink: (meta: FileMeta, offset: number) => Promise<FileSink>; // chamado em cada file-begin; offset é 0 neste plano (ver §7)
  });
  accept(): void; // envia batch-accept; a UI chama isso no clique "Receber"
  reject(reason?: "declined"): void;
  cancel(): void;
  on<K extends keyof ReceiverEvents>(event: K, cb: ReceiverEvents[K]): void;
}
```

Regras internas:

- Ao receber `batch-offer`, **valida antes de qualquer coisa**:
  - `files.length` entre 1 e **50**;
  - soma de `size` ≤ **5 GiB**;
  - cada `name` não vazio após sanitização (§6).
    Falhou → responde `batch-reject` com `reason: "over-limit"` e emite `error`.
    Já tem um lote ativo → `batch-reject` com `reason: "busy"`.
    Passou → emite `batchOffered` (a UI mostra o resumo e os botões).
- `accept()` envia `batch-accept`. A partir daí:
  - `file-begin` → `openSink(meta)` (a UI/adaptador decide onde gravar); zera o
    contador de bytes do arquivo.
  - quadro binário → `sink.write(chunk)`; soma no contador; emite `progress`
    (throttled igual ao emissor).
  - `file-end` → `sink.close()`; se `bytesRecebidos !== meta.size` → `error`
    naquele arquivo e `cancel` do lote; senão `fileComplete`.
  - `batch-complete` → `batchComplete`.
- `cancel` recebido → `sink.abort()` no arquivo aberto, `cancelled`.
- Memória: o receptor **não acumula o arquivo** quando o `FileSink` é o de
  gravação direta — cada pedaço vai pro disco na hora. No `FileSink` de reserva
  (Blob), aí sim acumula (limite conhecido — ver §8).

---

## 6. Segurança

- **Nenhum arquivo passa por servidor.** Host → guest direto pelo canal DTLS do
  WebRTC. O sinalizador continua fora do caminho dos dados (spec §3.6, §3.20).
- **Proteção de caminho (spec §3.18).** `name` do `FileMeta` é dado controlado
  pelo emissor. O receptor **sanitiza** antes de usar como nome de arquivo
  sugerido: remove `/`, `\`, sequências `..`, caracteres de controle e pontos
  iniciais; corta o comprimento (255). O nome sanitizado é usado **só** como
  nome do arquivo dentro da pasta que o usuário escolheu, ou como `download=` do
  link — **nunca** como caminho. Se sobrar vazio, cai para
  `arquivo-<n>`.
- **Limites de lote (50 / 5 GiB)** são checados nos **dois** lados: na UI do
  emissor (mensagem amigável, bloqueia o Enviar) e no receptor como defesa
  contra um emissor adulterado.
- **Tamanho por quadro.** O receptor rejeita (aborta o lote) quadro binário
  maior que `chunkSize` negociado + folga, e quadro de controle acima de 64 KiB.
  Evita que um peer com bug ou malicioso estoure memória do outro.
- **Arquivo potencialmente executável (spec §3.19).** Fora do escopo deste
  plano como alerta visual dedicado (é item da camada de UI de segurança). Mas
  o motor **nunca executa** nada — só grava bytes num arquivo escolhido pelo
  usuário. O aviso visual entra no plano de "Segurança" (§17 da ordem da spec).
- **Transporte.** DTLS nativo do `RTCDataChannel` já cobre confidencialidade e
  integridade em trânsito (spec §3.15); WSS de produção é assunto do plano de
  deploy, sem relação com este.
- **Privacidade.** Nenhum log de nome, conteúdo ou metadado de arquivo. Eventos
  de progresso são só em memória, para a UI (spec §8.5).

---

## 7. Preparação para retomada (spec §3.14 — só arquitetura, sem o resume)

O protocolo **não pode** ser desenhado de um jeito que impossibilite retomar
depois. Decisões que garantem isso, sem construir o resume agora:

- Cada arquivo tem `id` estável dentro do lote (não é a posição na fila).
- `file-begin` carrega `offset: number` — neste plano é sempre `0`, mas o
  formato do quadro já reserva o campo. O emissor lê a partir de `offset`
  (`source.read(offset, …)`); o `openSink(meta)` recebe o `offset` junto do
  `meta` e o `FileSink` grava a partir dessa posição. Com `offset: 0` isso é o
  comportamento normal de "grava desde o começo".
- `FileSink` é orientado a `write`/`close`/`abort` sequencial a partir de uma
  posição, não a "receba o arquivo inteiro e salve de uma vez".

Um plano futuro de resume só precisa: persistir quais `id` e quantos bytes já
chegaram, e mandar `file-begin` com `offset` real na reconexão. Nada no
protocolo deste plano impede isso.

---

## 8. Onde o arquivo é salvo (adaptadores de navegador)

Duas implementações de `FileSink`, escolhidas em tempo de execução:

|                   | Preferencial                                                                                       | Reserva                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **API**           | File System Access (`showSaveFilePicker` / `showDirectoryPicker` + `FileSystemWritableFileStream`) | acúmulo em `ArrayBuffer[]` → `Blob` → `URL.createObjectURL` + `<a download>` sintético |
| **Onde funciona** | Chrome/Edge no desktop                                                                             | todos os navegadores, incl. celular e Firefox                                          |
| **Memória**       | plana — cada pedaço vai direto pro disco                                                           | segura o arquivo inteiro em RAM até `file-end`                                         |
| **Rastro**        | grava direto no lugar final escolhido                                                              | passagem temporária no navegador, apagada depois                                       |

- **Detecção:** `typeof window.showSaveFilePicker === "function"` **e** contexto
  seguro. As APIs de File System Access exigem gesto do usuário — o clique em
  **"Receber"** é esse gesto: nesse clique, se disponível, o navegador pede uma
  **pasta** (um pedido só para o lote inteiro); cada arquivo do lote é criado
  dentro dela. Sem a API, vai para a reserva, um download por arquivo ao final
  de cada um.
- **Arquivo "grande" (> 500 MiB) + só a reserva disponível:** a UI mostra o
  aviso antes de começar — _"Este navegador vai precisar segurar o arquivo
  inteiro na memória. Para arquivos grandes, use o Chrome ou o Edge no
  computador."_ O usuário decide se continua. Limite conhecido e aceito para
  este plano (não dá pra fugir dele sem app instalado, e a V1 é "sem
  instalação").
- `ChunkSource` do navegador: envolve `File` — `read(offset, length)` faz
  `file.slice(offset, offset + length).arrayBuffer()`.

---

## 9. Fora de escopo deste plano

- **SHA-256 / verificação de integridade de conteúdo** (spec §3.13) — plano
  dedicado. Aqui a garantia é a do canal (confiável+ordenado) + conferência de
  tamanho declarado vs recebido.
- **Bidirecional** — os dois peers enviando ao mesmo tempo, ou em turnos, na
  mesma sessão (spec §3.8, passo "12"). Neste plano: host envia, guest recebe.
  O motor é simétrico de propósito para o plano futuro ser sobretudo UI +
  trava de posse do canal.
- **Barra de progresso rica** — porcentagem, velocidade, tempo restante (spec
  §3.11, passo "10"). Aqui: mensagens de estado ("Enviando 3 de 5…",
  "…com sucesso") e, no máximo, uma barra simples de "arquivos concluídos /
  total". Nada de KB/s nem ETA.
- **Classificação Normal/Sensível/Confidencial** (spec §5) — V3. A `classifyFileSize`
  deste plano é só pequeno/médio/grande por **tamanho**, para orientar
  expectativa e escolha de `FileSink`; não tem relação com nível de segurança.
- **TURN/relay** (spec §3.7) — plano dedicado. Se o P2P do Plano 5/9 não
  conectar, não há transferência; o motor não muda isso.
- **Retomada real** após queda (spec §3.14) — só a preparação arquitetural
  (§7), não o resume em si.
- **Pausar/retomar manual pelo usuário** — o estado `paused` do union
  `TransferState` fica para o plano de Progresso. O único "pause" aqui é o
  automático por backpressure, invisível.
- **Alerta visual de arquivo executável** (spec §3.19) — plano de Segurança.

---

## 10. Frontend — hook e telas

### 10.1 `use-file-transfer.ts`

```ts
function useFileTransfer(params: {
  role: ConnectionRole | undefined;
  dataChannel: RTCDataChannel | null; // do usePeerConnection
  channelState: PeerChannelState;
}): {
  // emissor (host)
  selectedFiles: SelectedFile[]; // { id, name, size, type, sizeClass, state }
  totalBytes: number;
  limitError: string | null; // mensagem pt-BR pronta, ou null
  addFiles: (files: FileList | File[]) => void;
  removeFile: (id: string) => void;
  startSend: () => void;
  // receptor (guest)
  incomingBatch: { files: FileMeta[]; totalBytes: number; summary: string } | null;
  acceptBatch: () => void; // dispara o pedido de pasta + receiver.accept()
  rejectBatch: () => void;
  // comum
  phase: "idle" | "offering" | "transferring" | "completed" | "cancelled" | "failed";
  perFile: Record<string, { bytes: number; size: number; state: TransferState }>;
  overall: { done: number; total: number };
  cancel: () => void;
};
```

- Instancia `TransferSender` (host) ou `TransferReceiver` (guest) quando
  `channelState === "open"`; fecha tudo no cleanup / quando o canal cai.
- `summary` do `incomingBatch` é montado em pt-BR a partir dos tipos:
  _"5 arquivos — 3 fotos, 2 PDFs — 320 MB"_. Agrupa por categoria simples
  derivada do MIME (`image/*` → "foto", `video/*` → "vídeo", `application/pdf`
  → "PDF", resto → "arquivo").
- Reusa `usePeerConnection` já existente (que passa a **também** expor o
  `dataChannel` no retorno — hoje ele já cria e guarda, só não estava sendo
  consumido por ninguém).

### 10.2 UI do emissor — `SendPanel.tsx` (em `/transferir`, estado `accepted`)

Substitui o `StateScreen` "Convite aceito" da página quando o canal abre.

- Botão **"Escolher arquivos"** (`<input type="file" multiple>`).
- Lista: cada item com nome, tamanho formatado, ícone/label do tipo, **badge**
  pequeno/médio/grande (`@transfergo/ui` `Badge`), botão remover. Rodapé com
  **total** e contagem.
- Se `limitError` → `Toast`/faixa de aviso com a mensagem
  (_"Você selecionou 6,2 GB. O limite por envio é 5 GB. Remova alguns arquivos
  para continuar."_), botão Enviar desabilitado.
- Botão **"Enviar"** → `phase: "offering"` → _"Aguardando o outro lado
  aceitar…"_.
- Durante: por item, label **Aguardando → Enviando → Concluído**; topo
  _"Enviando 3 de 5…"_; opcional `ProgressBar` simples de arquivos concluídos.
- Fim: `StateScreen` `tone="success"` — _"Arquivo transferido com sucesso"_ /
  _"5 arquivos transferidos com sucesso"_. Botão "Enviar mais arquivos" volta ao
  início (mesma sessão/canal).
- Cancelar disponível durante o envio.

### 10.3 UI do receptor — `ReceivePanel.tsx` (em `/s/[token]`, estado `accepted`)

Substitui o `StateScreen` "Convite aceito" quando o canal abre.

- Enquanto `incomingBatch === null`: _"Conectado. Aguardando os arquivos…"_.
- Ao chegar o lote: `StateScreen` com o **resumo** (`summary`) e ações
  **[ Recusar ] [ Receber ]**. "Receber" → (pedido de pasta, se
  File System Access) → `acceptBatch()`.
- Durante: lista por arquivo **Aguardando → Recebendo → Concluído**; topo
  _"Recebendo 3 de 5…"_.
- Fim: `StateScreen` `tone="success"` — _"Arquivo recebido com sucesso"_ /
  _"5 arquivos recebidos com sucesso"_. Na reserva (download), o navegador
  dispara o "Salvar como" de cada arquivo conforme completa.
- `batch-reject`/`over-limit`/`cancel` → telas dedicadas (`XCircle` /
  `AlertTriangle`) com texto claro.

### 10.4 Idioma

Todo texto novo visível ao usuário em **pt-BR** (memória do projeto). Nomes
internos (`phase`, `ControlFrame`, `TransferState`, `sizeClass`) em inglês,
seguindo o padrão dos Planos 3–5.

---

## 11. Testes

- **`packages/shared`** — `file-size.test.ts`: `classifyFileSize` nas fronteiras
  (10 MiB, 500 MiB) e os limites de lote.
- **`packages/transfer-engine`:**
  - `protocol.test.ts` — `encode`/`decode` de cada `ControlFrame`, rejeição de
    quadro malformado, de lote acima do limite, de nome com `../`.
  - `sender.test.ts` — canal falso com `bufferedAmount` controlado pelo teste:
    confirma que o emissor pausa acima do high-water e retoma no
    `bufferedamountlow`; ordem `file-begin`/binários/`file-end`; throttle de
    `progress`; `cancel` interrompe.
  - `receiver.test.ts` — remontagem correta; `bytesRecebidos !== size` →
    `error`; sanitização de nome; `batch-reject` por limite; `abort` do sink no
    `cancel`.
  - `loopback.integration.test.ts` — **a prova ponta a ponta**: um par de
    `DataChannelLike` falsos que encaminham `send()` de um para o `onmessage` do
    outro; um `TransferSender` e um `TransferReceiver` reais transferem um lote
    de 3 arquivos com bytes gerados (um deles > `highWaterMark` para exercitar
    o backpressure); o teste compara os buffers gravados no `FileSink` de
    memória com os originais, byte a byte.
- **`apps/web`:**
  - `use-file-transfer.test.ts` — `dataChannel` e adaptadores stubados;
    checagem de limite gera a mensagem certa; `summary` do lote em pt-BR;
    transições de `phase`.
  - `file-system-sink.test.ts` — detecção preferencial vs reserva com
    `window.showSaveFilePicker` stubado/ausente; a reserva monta o `Blob` certo.
  - Testes de `SendPanel`/`ReceivePanel` no padrão Testing Library já usado em
    `SessionLinkPanel.test.tsx`.
- **Verificação manual (não automatizada):** dois navegadores reais, fluxo
  criar → convidar → aceitar → escolher vários arquivos → Enviar → Receber;
  confirmar que os arquivos aparecem no dispositivo receptor e que as mensagens
  "…com sucesso" aparecem nos dois lados. O autor do produto **não** precisa
  executar isto — será feito via um roteiro Node que dirige os dois lados do
  motor com arquivos reais (mesmo espírito do script de teste do Plano 5/9).
- Lint/typecheck/build seguem via as configs existentes, sem mudança de regra.

---

## 12. Critérios de conclusão

- `pnpm turbo run lint typecheck test build` passa com zero erros em todos os
  pacotes, incluindo o novo conteúdo de `packages/transfer-engine`.
- O teste de loopback transfere um lote multi-arquivo com bytes reais e o
  conteúdo recebido é idêntico ao enviado, com o caminho de backpressure
  exercitado.
- Nenhum byte de arquivo trafega pelo `apps/signaling-server`;
  `packages/shared/src/signaling.ts` não foi tocado.
- Limite de 50 arquivos / 5 GiB aplicado nos dois lados, com mensagem pt-BR
  clara no emissor.
- Nomes de arquivo sanitizados no receptor antes de qualquer uso; nenhum uso
  como caminho.
- UI dos dois lados mostra estado por arquivo e as mensagens
  "Enviando/Recebendo…" → "…com sucesso"; textos novos em pt-BR.
- `usePeerConnection` passa a expor o `dataChannel`; nenhuma regressão nos
  testes do Plano 5/9.
