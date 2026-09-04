# TransferGo — Plano 8/9: Verificação de Integridade SHA-256 — Spec de Design

- **Status:** Em revisão pelo autor do produto
- **Data:** 2026-09-03
- **Escopo:** Passo "16 SHA-256" da ordem de implementação da spec do produto
  (`docs/superpowers/specs/2026-08-24-transfergo-design.md`, §12) — verificação de
  integridade §3.13. Plano de um passo só (o passo é autocontido e grande o
  suficiente).
- **Depende de:** Plano 6/9 (motor de transferência, merge `a57843b`) e Plano 7/9
  (progresso + cancelamento, merge `a3a8d5a`). O quadro `file-end` já fecha cada
  arquivo; o `fail()` do receptor já aborta o sink sem gravar; o hook já mapeia
  `TransferError.code` para mensagens pt-BR e tem telas de `completed`/`failed`.
- **Não inclui:**
  - Falha por-arquivo com sucesso parcial — qualquer divergência **aborta o lote
    inteiro** (decisão do brainstorming; mesmo comportamento do `size-mismatch`).
  - Hash único do lote — é **por arquivo** (decisão do brainstorming).
  - Qualquer pausa visível de "Verificando…" — a verificação é uma comparação
    síncrona no `file-end` e não tem duração observável (decisão do
    brainstorming: "sem pausa; muda só os rótulos").
  - Estado `verifying` no union de `phase`/`perFile.state` — ver §5.1.
  - Criptografia de conteúdo / chave externa (V3, §3.21 / §5).
  - TURN, bidirecional, retomada real (planos dedicados).

---

## 1. Objetivo

Provar que cada arquivo chegou **byte a byte idêntico** ao que saiu, usando
SHA-256 padrão calculado incrementalmente nas duas pontas enquanto os bytes
passam — sem nunca segurar o arquivo inteiro na memória (§3.10). Quando os
hashes de um arquivo divergem, a transferência para, o arquivo corrompido é
descartado sem tocar o disco, e os dois lados mostram um erro claro. Quando
tudo confere, o §3.13 é satisfeito: a UI diz "Integridade verificada".

**Prova de conclusão:** o teste de loopback em Node (`loopback.integration.test.ts`)
transfere um lote de 3 arquivos com bytes reais e afirma que (a) cada quadro
`file-end` recebido carrega o SHA-256 real do conteúdo lido pelo emissor, e
(b) um canal que corrompe 1 byte de um chunk em trânsito faz o receptor
terminar em `onError({ code: "integrity" })` sem gravar o arquivo corrompido no
sink. Verificação manual complementar: dois navegadores reais completam um lote
e as duas telas mostram "Integridade verificada (SHA-256)"; um `sha256sum` no
arquivo recebido bate com o do original.

---

## 2. Divisão em unidades

| Unidade         | Onde                                                        | Responsabilidade                                                                                                                                                                                                                                               | Muda                      |
| --------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **Dependência** | `packages/transfer-engine/package.json` + `pnpm-lock.yaml`  | `@noble/hashes` como `dependencies` (auditada, zero-dep). Se `apps/web` não resolver transitivamente, adicionar lá também (mesmo padrão da regra do Plano 6 para o próprio `@transfergo/transfer-engine`).                                                     | +1 dep                    |
| **Hasher**      | `packages/transfer-engine/src/hash.ts` (novo)               | `interface Hasher`, `type CreateHasher`, e `createSha256Hasher` — o wrapper default de `@noble/hashes`. Uma função pura, sem estado de módulo.                                                                                                                 | arquivo novo (~15 linhas) |
| **Protocolo**   | `packages/transfer-engine/src/protocol.ts`                  | `file-end` ganha `sha256: string`; `decodeControl` valida 64 chars `[0-9a-f]`.                                                                                                                                                                                 | ~6 linhas                 |
| **Contratos**   | `packages/transfer-engine/src/types.ts`                     | `TransferErrorCode` ganha `"integrity"`.                                                                                                                                                                                                                       | 1 linha                   |
| **Emissor**     | `packages/transfer-engine/src/sender.ts`                    | `createHasher?: CreateHasher` em `SenderOptions` (default `createSha256Hasher`); um `Hasher` por arquivo no `runBatch`; `sha256: hasher.digest()` no `file-end`.                                                                                               | ~8 linhas                 |
| **Receptor**    | `packages/transfer-engine/src/receiver.ts`                  | `createHasher?` em `ReceiverOptions`; `currentHash` por arquivo, alimentado em `handleBinary`; comparação no `file-end` **antes** do `close()`; `fail("integrity", …)` na divergência; `currentHash` limpo junto com `currentSink` nos 3 pontos onde ele já é. | ~14 linhas                |
| **Barrel**      | `packages/transfer-engine/src/index.ts`                     | re-exporta `Hasher`/`CreateHasher`/`createSha256Hasher` se o hook precisar; provavelmente não precisa (default embutido).                                                                                                                                      | 0–1 linha                 |
| **Loopback**    | `packages/transfer-engine/src/loopback.integration.test.ts` | afirma `sha256` real em cada `file-end`; + teste de corrupção → `integrity`.                                                                                                                                                                                   | ~40 linhas                |
| **Hook**        | `apps/web/src/lib/use-file-transfer.ts`                     | `ERROR_MESSAGES.integrity`; campo `integrityVerified: boolean` no resultado (`true` quando `phase === "completed"`).                                                                                                                                           | ~4 linhas                 |
| **UI emissor**  | `apps/web/src/components/transferir/SendPanel.tsx`          | linha "Integridade verificada (SHA-256)" na tela de `completed`.                                                                                                                                                                                               | ~4 linhas                 |
| **UI receptor** | `apps/web/src/components/s/ReceivePanel.tsx`                | rótulo `completed` → "Verificado" + `CheckCircle2`; linha de integridade na tela de `completed`.                                                                                                                                                               | ~8 linhas                 |

Um arquivo novo (`hash.ts`). Colocar `@noble/hashes` no pacote do motor deixa a
garantia autocontida: o loopback em Node puro exercita o hash real sem depender
do navegador.

---

## 3. `@noble/hashes` — import e versão

`pnpm add @noble/hashes` dentro de `packages/transfer-engine` e fixar a versão
que resolver (recente da linha 1.x). O caminho de import mudou entre versões:

- 1.7+: `import { sha256 } from "@noble/hashes/sha2"` + `import { bytesToHex } from "@noble/hashes/utils"`.
- 1.x anterior: `@noble/hashes/sha256`.

O implementador confirma o caminho correto para a versão instalada ao escrever
`hash.ts` e ajusta o import. A API usada é estável entre as versões:
`sha256.create()` → `.update(Uint8Array)` → `.digest()` (`Uint8Array`).

`hash.ts`:

```ts
import { sha256 } from "@noble/hashes/sha2"; // confirmar caminho p/ a versão instalada
import { bytesToHex } from "@noble/hashes/utils";

/** Hash incremental: alimente com `update`, feche com um único `digest`. */
export interface Hasher {
  update(bytes: Uint8Array): void;
  /** Hex minúsculo, 64 chars. Consome o hasher — chame uma vez só. */
  digest(): string;
}

export type CreateHasher = () => Hasher;

export const createSha256Hasher: CreateHasher = () => {
  const h = sha256.create();
  return {
    update: (bytes) => {
      h.update(bytes);
    },
    digest: () => bytesToHex(h.digest())
  };
};
```

Síncrono — nenhum `await` entra no laço quente do `runBatch`/`handleBinary`.

---

## 4. Protocolo

### 4.1 `file-end` com hash

```ts
| { t: "file-end"; id: string; bytesSent: number; sha256: string }
```

`sha256`: exatamente 64 caracteres `[0-9a-f]` (minúsculo). Campo **obrigatório** —
não há transferência sem verificação neste plano.

### 4.2 `decodeControl`

O ramo `case "file-end"` passa a exigir o campo:

```ts
case "file-end":
  return typeof f.id === "string" &&
    f.id.length > 0 &&
    typeof f.bytesSent === "number" &&
    f.bytesSent >= 0 &&
    typeof f.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(f.sha256)
    ? { t: "file-end", id: f.id, bytesSent: f.bytesSent, sha256: f.sha256 }
    : null;
```

`encodeControl` não muda (`JSON.stringify` já serializa o campo novo).

### 4.3 Erro

`TransferErrorCode` ganha `"integrity"`. Mensagem interna:
`sha256 mismatch for <id>: expected <hexDoQuadro>, got <hexCalculado>`.

---

## 5. Emissor e Receptor

### 5.1 Sem estado `verifying`

O §3.11 lista `verifying` entre os estados. No modelo de **hash streaming**, a
verificação é **uma comparação síncrona** dentro do handler de `file-end` — não
tem início e fim observáveis. Um estado `verifying` setado e limpo no mesmo tick
seria exatamente a "pausa encenada" recusada no brainstorming e a numeração
morta recusada no Plano 7. Portanto:

- **`phase`** (union do hook) **não** ganha `verifying`.
- **`perFile.state`** **não** ganha `verifying`.
- O `verifying` do §3.11 fica documentado como "não aplicável ao hash
  streaming; a verificação vive no handler de `file-end` do receptor". Se um
  plano futuro fizer verificação pós-gravação (reler do disco, hash lento em
  worker), esse plano adiciona o estado.

O ganho visível do §3.13 vem por **rótulo e cópia** (§7 do hook/UI), não por
um estado de máquina.

### 5.2 Emissor — `runBatch` (`sender.ts`)

`SenderOptions` ganha `createHasher?: CreateHasher`; o merge de defaults usa
`createSha256Hasher`. Dentro do loop por arquivo:

```ts
const { meta, source } = this.inputs[index]!;
const hasher = this.opts.createHasher();
this.send({ t: "file-begin", id: meta.id, offset: 0 });
let sent = 0;
while (sent < source.size) {
  if (this.cancelled || this.disposed) return;
  await this.waitForDrain();
  if (this.cancelled || this.disposed) return;
  const length = Math.min(this.opts.chunkSize, source.size - sent);
  const chunk = await source.read(sent, length);
  if (this.cancelled || this.disposed) return;
  if (chunk.byteLength === 0) {
    throw new TransferError(
      "channel-error",
      `source.read returned 0 bytes with ${source.size - sent} still to send`
    );
  }
  hasher.update(new Uint8Array(chunk)); // ← antes do send, depois dos checks de cancel
  this.channel.send(chunk);
  sent += chunk.byteLength;
  this.maybeEmitProgress({ meta, fileBytes: sent, filesDone: index }, false);
}
this.send({ t: "file-end", id: meta.id, bytesSent: sent, sha256: hasher.digest() });
this.cb.onFileComplete?.(meta.id);
this.filesDone += 1;
this.maybeEmitProgress({ meta, fileBytes: sent, filesDone: index + 1 }, true);
```

- `hasher` local à iteração — um por arquivo.
- Cancelamento no meio: o `hasher` daquele arquivo é descartado com o `return`;
  nenhum `file-end` é enviado.
- Arquivo de 0 byte: o `while` não roda, `hasher.digest()` = SHA-256 do vazio
  (`e3b0c442...`).

### 5.3 Receptor (`receiver.ts`)

`ReceiverOptions` ganha `createHasher?: CreateHasher` (default `createSha256Hasher`).
Novo campo: `private currentHash: Hasher | null = null;`

**`file-begin`** — logo depois de `this.currentSink = await this.openSink(...)`:

```ts
this.currentHash = this.opts.createHasher();
```

Se já havia sink aberto (peer malformado), o bloco que faz
`await this.currentSink.abort()` também zera `this.currentHash = null` antes de
recriar — mas como o `file-begin` recria logo em seguida, basta a atribuição
acima; o importante é não reaproveitar um hasher entre arquivos.

**`handleBinary`** — depois do `await this.currentSink.write(chunk)`:

```ts
await this.currentSink.write(chunk);
this.currentHash?.update(new Uint8Array(chunk));
this.currentBytes += chunk.byteLength;
this.emitProgress(false);
```

Usa `?.`, não `!`: o `cancel()` público roda fora da fila e pode zerar
`this.currentHash` enquanto um `write()` está pendente — com `!` a linha
retomada estouraria um `TypeError` (engolido pelo `.catch` da fila, receptor
já descartado, inofensivo, mas é uma quebra de invariante escondida). O desync
que importa — "nenhum arquivo aberto" — já é barrado no topo de `handleBinary`
pelo check de `!this.currentSink`.

**`file-end`** — ordem exata:

```ts
case "file-end": {
  if (!this.currentSink || !this.currentMeta || this.currentMeta.id !== frame.id) {
    return this.fail("bad-frame", "file-end without a matching open file");
  }
  if (this.currentBytes !== this.currentMeta.size) {
    return this.fail("size-mismatch", `expected ${this.currentMeta.size} bytes, got ${this.currentBytes}`);
  }
  const actual = this.currentHash!.digest();
  if (actual !== frame.sha256) {
    // Verifica ANTES do close(): fail() aborta o sink, o arquivo corrompido nunca é gravado.
    return this.fail("integrity", `sha256 mismatch for ${frame.id}: expected ${frame.sha256}, got ${actual}`);
  }
  await this.currentSink.close();
  this.filesDone += 1;
  this.cb.onFileComplete?.(this.currentMeta.id);
  this.emitProgress(true);
  this.currentSink = null;
  this.currentMeta = null;
  this.currentHash = null;
  return;
}
```

**`cancel` (local e remoto)** e o **caminho de `fail()`**: onde já há
`void this.currentSink?.abort()`, adicionar `this.currentHash = null;` junto —
higiene, o objeto já vai ser descartado pelo `dispose()` mas evita segurar
referência a bytes.

`fail("integrity", …)` reaproveita o caminho inteiro que o `size-mismatch` já
usa: `abort()` do sink, `send({t:"cancel",scope:"batch"})`, `onError`,
`dispose()`.

### 5.4 Alcance da garantia

- O SHA-256 aqui é **integridade, não autenticidade**: não há segredo
  compartilhado. Protege contra corrupção de canal, bugs de sink e bit-rot —
  não contra um adversário que reescreva os chunks _e_ o hash do `file-end`. O
  DTLS do WebRTC já cobre o fio contra adulteração ativa; esta camada cobre
  bugs.
- O `integrityVerified` só é verdadeiro no **receptor** (`role === "guest"`). O
  emissor não recebe nenhum ack de verificação — ele mesmo envia o
  `batch-complete` e se descarta —, então a tela de sucesso do `SendPanel`
  deliberadamente **não** afirma "Integridade verificada": mantém só
  "…transferidos com sucesso" e o rótulo "Concluído" por arquivo (§7.1).

---

## 6. Hook (`use-file-transfer.ts`)

- `ERROR_MESSAGES` ganha:
  `integrity: "Um arquivo chegou corrompido. A transferência foi interrompida."`
- `UseFileTransferResult` ganha `integrityVerified: boolean`.
  - Implementação: um valor derivado,
    `const integrityVerified = role === "guest" && phase === "completed";`
    retornado junto dos outros campos. Não precisa de estado próprio.
  - No **receptor** (`role === "guest"`) é literal: o `batch-complete` só chega
    depois de todo `file-end` ter passado pela comparação de hash.
  - No **emissor** é sempre `false`: o emissor **não recebe** nenhum sinal de
    verificação. É ele mesmo quem envia o `batch-complete` (e em seguida se
    descarta), sem nenhum ack do receptor; numa falha de integridade no último
    arquivo, o `cancel` do receptor chega a um emissor já descartado e
    `phase === "completed"` é grudento. Logo "verificado" é uma afirmação que o
    emissor não pode sustentar — a linha é exclusiva do receptor.
- Nada muda no fluxo de fases, no `applyProgress`, no `filesSaved`, nos resets.

---

## 7. UI

### 7.1 Rótulo por arquivo

- **`ReceivePanel.tsx`**: o rótulo do arquivo `completed` muda de "Concluído"
  para **"Verificado"**, precedido de um `<CheckCircle2 className="size-3 text-success" aria-hidden />`
  inline. Os outros rótulos (`receiving` → "Recebendo", `queued` → "Na fila",
  `failed` → "Falhou") não mudam.
- **`SendPanel.tsx`**: o rótulo `completed` continua **"Concluído"** — o emissor
  calculou e enviou o hash, não verificou nada.

### 7.2 Tela final de sucesso (os dois painéis)

Abaixo da `description` do `StateScreen` de `completed`, quando
`transfer.integrityVerified` é `true`, uma linha:

```tsx
<p className="mt-2 flex items-center justify-center gap-1 text-xs text-success">
  <CheckCircle2 className="size-3.5" aria-hidden="true" />
  Integridade verificada (SHA-256)
</p>
```

Como `StateScreen` provavelmente não aceita filhos arbitrários, isso vai como
um irmão logo abaixo do `<StateScreen>` num wrapper `div`, ou — se `StateScreen`
tiver um slot — nesse slot. O implementador verifica a API do `StateScreen` (do
Plano 2) e escolhe; o texto e a condição (`integrityVerified`) são fixos.

### 7.3 Tela de `failed`

Sem marcação nova: a `errorMessage` de integridade já vem do `ERROR_MESSAGES`,
renderizada pelo mesmo `StateScreen` com `icon={XCircle}` que o Plano 7 usa
para qualquer falha.

---

## 8. Casos de borda

| Situação                                                                       | Tratamento                                                                                                                                     |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Arquivo de 0 byte                                                              | Emissor e receptor calculam ambos o SHA-256 do vazio; batem.                                                                                   |
| `sha256` ausente / 63 ou 65 chars / maiúsculo / não-hex no `file-end`          | `decodeControl` → `null` → `fail("bad-frame")`. Não chega à comparação.                                                                        |
| Divergência de hash                                                            | `fail("integrity")` — sink abortado, `cancel` ao emissor, `onError` → `phase: "failed"` nos dois lados. Arquivo corrompido nunca é `close()`d. |
| Cancelamento no meio de um arquivo                                             | `Hasher` daquele arquivo descartado com o resto do estado; nenhum `file-end`.                                                                  |
| `file-begin` novo antes do `file-end` (peer malformado)                        | Sink abortado + `currentHash` recriado no novo `file-begin`.                                                                                   |
| Chunk entregue como typed-array view com `byteOffset` ≠ 0 (Firefox)            | `toArrayBuffer` já normaliza para um `ArrayBuffer` do tamanho exato antes do `handleBinary`; `new Uint8Array(chunk)` cobre os bytes certos.    |
| Emissor manda `file-end` com hash certo mas o sink de download acumulou errado | Fora de escopo — o sink é confiável por contrato; o hash cobre o **canal**, não bugs do sink local.                                            |
| `@noble/hashes` ausente num runtime de teste exótico                           | `createHasher` é injetável; o teste passa um `Hasher` próprio determinístico.                                                                  |

---

## 9. Testes

### 9.1 `packages/transfer-engine/src/protocol.test.ts`

- `file-end` com `sha256` de 64 hex minúsculos → decodifica com o campo.
- 63 chars, 65 chars, com `A-F` maiúsculo, com `g`/`z`, campo ausente, `sha256`
  numérico → `null`.
- `encodeControl` de um `file-end` com `sha256` → round-trip por `decodeControl`.

### 9.2 `packages/transfer-engine/src/hash.test.ts` (novo)

- `createSha256Hasher().update(bytes).digest()` de `"abc"` (UTF-8) → o vetor NIST
  canônico `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`.
- Digest da entrada vazia (sem nenhum `update`) → o valor conhecido do SHA-256 do
  vazio (`printf '' | sha256sum` → `e3b0c442...b855`); o implementador cola o hex
  exato de 64 chars de uma fonte autoritativa.
- `update` em N pedaços produz o mesmo digest que `update` de uma vez.
- O digest é hex minúsculo e tem exatamente 64 caracteres.

### 9.3 `packages/transfer-engine/src/sender.test.ts`

- Após `batch-accept`, o `file-end` capturado no fake channel tem
  `sha256 === createSha256Hasher().update(<payload>).digest()`.
- Lote de 2 arquivos com conteúdos diferentes → os dois `file-end` têm `sha256`
  diferentes (um `Hasher` por arquivo, não reaproveitado).

### 9.4 `packages/transfer-engine/src/receiver.test.ts`

- Bytes corretos + `file-end` com o `sha256` certo → `sink.closed === true`,
  `onFileComplete` chamado.
- Bytes corretos + `file-end` com `sha256` errado → `onError({code:"integrity"})`,
  `sink.aborted === true`, `sink.closed === false`, `cancel` enviado no channel.
- Bytes adulterados (feed de um chunk trocado) + `file-end` com o `sha256` do
  conteúdo **original** → mesma coisa: `integrity`.
- `file-end` com `sha256` malformado (ex.: `"xyz"`) → `onError({code:"bad-frame"})`.
- Injeta um `createHasher` fake determinístico e confirma que ele é chamado uma
  vez por arquivo.

### 9.5 `packages/transfer-engine/src/loopback.integration.test.ts` (prova principal)

- O lote de 3 arquivos existente: cada `file-end` observado tem `sha256` igual
  ao SHA-256 real do conteúdo lido; ao final, `onBatchComplete` nos dois lados.
- **Novo:** um `Endpoint` que corrompe 1 byte de **um** chunk de **um** arquivo
  em trânsito (ex.: XOR no primeiro byte do 2º chunk do 2º arquivo) →
  o receptor termina em `onError({code:"integrity"})`, `onBatchComplete`
  **não** é chamado, e o sink de memória do arquivo corrompido não tem conteúdo
  commitado (`closed === false`, `aborted === true`).

### 9.6 `apps/web/src/lib/use-file-transfer.test.ts`

- `onError({code:"integrity"})` (via frame de `file-end` com hash errado, ou
  callback direto no fake) → `phase === "failed"`,
  `errorMessage === "Um arquivo chegou corrompido. A transferência foi interrompida."`
- Lote levado a `batch-complete` → `result.current.integrityVerified === true`.
- Antes da conclusão → `integrityVerified === false`.

### 9.7 `apps/web/src/components/s/ReceivePanel.test.tsx`

- Arquivo com `state: "completed"` na fase ativa → renderiza "Verificado"
  (e não "Concluído").
- Tela final de `completed` com `integrityVerified: true` → mostra
  "Integridade verificada (SHA-256)".
- Tela `failed` com a `errorMessage` de corrompido → mostra o texto.

### 9.8 `apps/web/src/components/transferir/SendPanel.test.tsx`

- Arquivo `state: "completed"` na fase ativa → renderiza "Concluído"
  (não "Verificado").
- Tela final de `completed` com `integrityVerified: true` → mostra a linha de
  integridade.

### 9.9 Portão

`pnpm turbo run lint typecheck test build` verde (19/19).

---

## 10. Textos pt-BR (referência única)

| Contexto                                         | Texto                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| Rótulo de arquivo verificado (receptor)          | `Verificado`                                                      |
| Rótulo de arquivo concluído (emissor)            | `Concluído` (inalterado)                                          |
| Linha de integridade nas telas de sucesso        | `Integridade verificada (SHA-256)`                                |
| Erro de integridade (`ERROR_MESSAGES.integrity`) | `Um arquivo chegou corrompido. A transferência foi interrompida.` |

---

## 11. Sequência de implementação sugerida

1. `hash.ts` + `hash.test.ts` + `@noble/hashes` no `package.json` do motor
   (confirmar caminho de import). Puro, sem dependência de outra tarefa.
2. Protocolo — `sha256` no `file-end` + validação em `decodeControl` +
   `"integrity"` em `TransferErrorCode` + testes de `protocol.test.ts`.
3. Emissor — `createHasher` em `SenderOptions`, hash por arquivo, `sha256` no
   `file-end` + testes de `sender.test.ts`.
4. Receptor — `createHasher`, `currentHash`, comparação no `file-end`,
   `fail("integrity")` + testes de `receiver.test.ts`.
5. Loopback — asserção de `sha256` real + teste de corrupção.
6. Hook — `ERROR_MESSAGES.integrity` + `integrityVerified` + testes.
7. UI — `ReceivePanel` ("Verificado" + linha de integridade), `SendPanel`
   (linha de integridade) + testes.
8. Portão completo.
