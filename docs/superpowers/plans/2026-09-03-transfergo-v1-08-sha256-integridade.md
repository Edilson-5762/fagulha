# Plano 8/9 — Verificação de Integridade SHA-256 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calcular SHA-256 padrão de cada arquivo incrementalmente nas duas pontas enquanto os bytes passam, carregar o digest no quadro `file-end`, e fazer o receptor comparar antes de fechar o arquivo — divergência aborta o lote inteiro sem gravar o arquivo corrompido, e a UI passa a dizer "Integridade verificada".

**Architecture:** Um wrapper síncrono e injetável de `@noble/hashes` (`hash.ts`) fornece um `Hasher` incremental. O emissor mantém um `Hasher` por arquivo no `runBatch`, alimentado com o mesmo buffer que vai pro canal, e envia `sha256: hasher.digest()` no `file-end`. O receptor mantém um `currentHash` por arquivo, alimentado em `handleBinary`, e compara com o hash do quadro no handler de `file-end` **antes** do `close()`; na divergência chama `fail("integrity", …)`, que reaproveita todo o caminho do `size-mismatch` (aborta o sink, manda `cancel` ao emissor, `onError`, `dispose`). Não há estado `verifying` — a verificação é uma comparação síncrona sem duração observável; o ganho do §3.13 vem por rótulo ("Verificado") e por uma linha de texto nas telas de sucesso.

**Tech Stack:** TypeScript, `@noble/hashes` (zero-dep, auditada), Vitest 2, React 19, Next.js 15, `@testing-library/react`, pnpm workspaces + Turborepo, `@transfergo/transfer-engine` (pacote só-fonte), `@transfergo/ui`.

**Spec:** `docs/superpowers/specs/2026-09-03-transfergo-v1-08-sha256-integridade-design.md`

## Global Constraints

- **Idioma:** todo texto de UI em português do Brasil. Nomes internos de estado/código em inglês.
- **`sha256` no `file-end`:** exatamente 64 caracteres `[0-9a-f]` minúsculos. Campo **obrigatório** — não há transferência sem verificação neste plano.
- **Hash por arquivo, não por lote.** Um `Hasher` novo por arquivo em cada ponta; nunca reaproveitado entre arquivos.
- **Hash streaming e síncrono:** nenhum `await` entra no laço quente do `runBatch`/`handleBinary`. Sem segurar o arquivo inteiro na memória.
- **Sem estado `verifying`** no union de `phase` nem em `perFile.state`. A verificação vive no handler de `file-end` do receptor.
- **Divergência aborta o lote inteiro** pelo mesmo caminho do `size-mismatch` (`fail("integrity", …)`). Nunca há sucesso parcial por-arquivo.
- **`@noble/hashes` como `dependencies` do pacote do motor**, versão exata fixada da linha 1.x.
- **`createHasher` injetável** nos dois lados (`SenderOptions`/`ReceiverOptions`), default `createSha256Hasher`.
- **Verificação ANTES do `close()`** no receptor: `fail()` aborta o sink, o arquivo corrompido nunca é `close()`d.
- **Textos pt-BR (fonte única):**
  | Contexto                                  | Texto                                                             |
  | ----------------------------------------- | ----------------------------------------------------------------- |
  | Rótulo de arquivo verificado (receptor)   | `Verificado`                                                      |
  | Rótulo de arquivo concluído (emissor)     | `Concluído` (inalterado)                                          |
  | Linha de integridade nas telas de sucesso | `Integridade verificada (SHA-256)`                                |
  | `ERROR_MESSAGES.integrity`                | `Um arquivo chegou corrompido. A transferência foi interrompida.` |
- **Portão por tarefa:** cada tarefa termina com os testes do pacote afetado verdes. A última tarefa roda `pnpm turbo run lint typecheck test build` inteiro.
- **Commits frequentes**, um por tarefa no mínimo, mensagem `feat(...)` / `fix(...)` / `test(...)` conforme o conteúdo, terminando com:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`

---

## Estrutura de arquivos

| Arquivo                                                     | Papel                                                                                      | Tarefa |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------ |
| `packages/transfer-engine/package.json` + `pnpm-lock.yaml`  | `@noble/hashes` como `dependencies`                                                        | 1      |
| `packages/transfer-engine/src/hash.ts`                      | **novo** — `interface Hasher`, `type CreateHasher`, `createSha256Hasher`                   | 1      |
| `packages/transfer-engine/src/hash.test.ts`                 | **novo** — vetores NIST, incremental = de uma vez, formato do digest                       | 1      |
| `packages/transfer-engine/src/protocol.ts`                  | `sha256` no `file-end`; `decodeControl` valida 64 hex                                      | 2      |
| `packages/transfer-engine/src/protocol.test.ts`             | round-trip com `sha256`; casos malformados                                                 | 2      |
| `packages/transfer-engine/src/types.ts`                     | `TransferErrorCode` ganha `"integrity"`                                                    | 2      |
| `packages/transfer-engine/src/sender.ts`                    | `createHasher?` em `SenderOptions` + default; `Hasher` por arquivo; `sha256` no `file-end` | 3      |
| `packages/transfer-engine/src/sender.test.ts`               | ajusta asserção de `file-end`; testa `sha256` real e hash por arquivo                      | 3      |
| `packages/transfer-engine/src/receiver.ts`                  | `createHasher?` + default; `currentHash`; comparação no `file-end`; `fail("integrity")`    | 4      |
| `packages/transfer-engine/src/receiver.test.ts`             | helper `fileEnd()`; ajusta call sites; testa `integrity`                                   | 4      |
| `packages/transfer-engine/src/loopback.integration.test.ts` | asserção de `sha256` real; `Endpoint` que corrompe 1 byte → `integrity`                    | 5      |
| `apps/web/src/lib/use-file-transfer.ts`                     | `ERROR_MESSAGES.integrity`; `integrityVerified: boolean` no resultado                      | 6      |
| `apps/web/src/lib/use-file-transfer.test.ts`                | testa mensagem de erro e `integrityVerified`                                               | 6      |
| `apps/web/src/app/transferir/page.test.tsx`                 | stub do mock ganha `integrityVerified: false`                                              | 6      |
| `apps/web/src/app/s/[token]/page.test.tsx`                  | idem                                                                                       | 6      |
| `apps/web/src/components/s/ReceivePanel.tsx`                | rótulo `completed` → "Verificado" + `CheckCircle2`; linha de integridade na tela final     | 7      |
| `apps/web/src/components/s/ReceivePanel.test.tsx`           | fixture `base` ganha `integrityVerified`; testes novos                                     | 7      |
| `apps/web/src/components/transferir/SendPanel.tsx`          | linha de integridade na tela final (rótulo por arquivo inalterado)                         | 7      |
| `apps/web/src/components/transferir/SendPanel.test.tsx`     | fixture `base` ganha `integrityVerified`; testes novos                                     | 7      |

Um arquivo de produção novo (`hash.ts`) + um de teste novo (`hash.test.ts`). Sem mudança no barrel `index.ts` (o default embutido cobre o hook; os testes importam `./hash.js` direto).

---

## Task 1: `hash.ts` — wrapper SHA-256 incremental + dependência `@noble/hashes`

**Files:**

- Modify: `packages/transfer-engine/package.json`, `pnpm-lock.yaml` (via `pnpm add`)
- Create: `packages/transfer-engine/src/hash.ts`
- Test: `packages/transfer-engine/src/hash.test.ts`

**Interfaces:**

- Consumes: `@noble/hashes` — `sha256.create()` → `.update(Uint8Array)` → `.digest()` (`Uint8Array`); `bytesToHex`.
- Produces:
  - `export interface Hasher { update(bytes: Uint8Array): void; digest(): string }` — `digest()` devolve hex minúsculo de 64 chars e consome o hasher (chamar uma vez só).
  - `export type CreateHasher = () => Hasher`
  - `export const createSha256Hasher: CreateHasher` — o wrapper default de `@noble/hashes`, síncrono, sem estado de módulo.

- [ ] **Step 1: Instalar a dependência e confirmar o caminho de import**

Run: `pnpm add @noble/hashes --filter @transfergo/transfer-engine`

Depois confira a versão que resolveu em `packages/transfer-engine/package.json` (algo como `"@noble/hashes": "^1.8.0"`) e verifique o caminho de import da API SHA-256:

- **1.7 ou maior** (o caso esperado): `import { sha256 } from "@noble/hashes/sha2"`
- **1.x anterior a 1.7**: `import { sha256 } from "@noble/hashes/sha256"`

`bytesToHex` está em `@noble/hashes/utils` em toda a linha 1.x. Use o caminho certo para a versão instalada nos Steps 2 e 4.

- [ ] **Step 2: Escrever os testes que falham**

Crie `packages/transfer-engine/src/hash.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createSha256Hasher } from "./hash.js";

// Vetores canônicos NIST para SHA-256.
const SHA256_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const SHA256_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const utf8 = (s: string) => new TextEncoder().encode(s);

describe("createSha256Hasher", () => {
  it('matches the NIST vector for "abc"', () => {
    const h = createSha256Hasher();
    h.update(utf8("abc"));
    expect(h.digest()).toBe(SHA256_ABC);
  });

  it("returns the known digest of the empty input when never updated", () => {
    expect(createSha256Hasher().digest()).toBe(SHA256_EMPTY);
  });

  it("gives the same digest whether fed in one call or in pieces", () => {
    const whole = createSha256Hasher();
    whole.update(utf8("the quick brown fox"));

    const pieces = createSha256Hasher();
    pieces.update(utf8("the quick "));
    pieces.update(utf8("brown fox"));

    expect(pieces.digest()).toBe(whole.digest());
  });

  it("produces a 64-char lowercase hex string", () => {
    const h = createSha256Hasher();
    h.update(new Uint8Array([1, 2, 3]));
    const digest = h.digest();
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 3: Rodar os testes e ver falhar**

Run: `pnpm --filter @transfergo/transfer-engine test -- hash`
Expected: FAIL — `Cannot find module './hash.js'` / `createSha256Hasher is not a function`.

- [ ] **Step 4: Escrever a implementação mínima**

Crie `packages/transfer-engine/src/hash.ts` (ajuste o caminho de `sha256` conforme o Step 1):

```ts
import { sha256 } from "@noble/hashes/sha2";
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

- [ ] **Step 5: Rodar os testes e ver passar**

Run: `pnpm --filter @transfergo/transfer-engine test -- hash`
Expected: PASS (4/4).

- [ ] **Step 6: Portão do pacote**

Run: `pnpm --filter @transfergo/transfer-engine run lint typecheck test`
Expected: tudo verde.

- [ ] **Step 7: Commit**

```bash
git add packages/transfer-engine/package.json pnpm-lock.yaml packages/transfer-engine/src/hash.ts packages/transfer-engine/src/hash.test.ts
git commit -m "feat(engine): add incremental SHA-256 hasher wrapper over @noble/hashes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Protocolo — `sha256` no `file-end`, validação, código de erro `integrity`

**Files:**

- Modify: `packages/transfer-engine/src/protocol.ts:9` (tipo `ControlFrame`), `:79-82` (`case "file-end"` em `decodeControl`)
- Modify: `packages/transfer-engine/src/types.ts:50-57` (`TransferErrorCode`)
- Test: `packages/transfer-engine/src/protocol.test.ts`

**Interfaces:**

- Consumes: nada novo.
- Produces:
  - `ControlFrame` membro `file-end` passa a ser `{ t: "file-end"; id: string; bytesSent: number; sha256: string }`.
  - `decodeControl` só devolve um `file-end` quando `sha256` é `string` e casa `/^[0-9a-f]{64}$/`; caso contrário `null`.
  - `TransferErrorCode` ganha o membro `"integrity"`.

- [ ] **Step 1: Escrever/ajustar os testes que falham**

Em `packages/transfer-engine/src/protocol.test.ts`, no teste `"round-trips every control frame kind"`, troque a linha do `file-end` para incluir um hash de 64 hex:

```ts
      { t: "file-end", id: "f1", bytesSent: 1024, sha256: "a".repeat(64) },
```

No teste `"rejects malformed JSON, unknown kinds, and bad payload shapes"`, acrescente estas asserções:

```ts
expect(decodeControl(JSON.stringify({ t: "file-end", id: "f1", bytesSent: 1 }))).toBeNull();
expect(
  decodeControl(JSON.stringify({ t: "file-end", id: "f1", bytesSent: 1, sha256: "a".repeat(63) }))
).toBeNull();
expect(
  decodeControl(JSON.stringify({ t: "file-end", id: "f1", bytesSent: 1, sha256: "a".repeat(65) }))
).toBeNull();
expect(
  decodeControl(JSON.stringify({ t: "file-end", id: "f1", bytesSent: 1, sha256: "A".repeat(64) }))
).toBeNull();
expect(
  decodeControl(
    JSON.stringify({ t: "file-end", id: "f1", bytesSent: 1, sha256: `${"a".repeat(63)}z` })
  )
).toBeNull();
expect(
  decodeControl(JSON.stringify({ t: "file-end", id: "f1", bytesSent: 1, sha256: 12345 }))
).toBeNull();
```

E um teste novo logo depois do bloco `describe("encodeControl / decodeControl", …)` fecha — dentro do mesmo `describe`:

```ts
it("round-trips a file-end carrying a sha256 digest", () => {
  const frame = {
    t: "file-end",
    id: "f1",
    bytesSent: 2048,
    sha256: "0123456789abcdef".repeat(4)
  } as const;
  expect(decodeControl(encodeControl(frame))).toEqual(frame);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @transfergo/transfer-engine test -- protocol`
Expected: FAIL — o `file-end` sem `sha256` ainda decodifica; os novos `toBeNull()` falham.

- [ ] **Step 3: Implementar — tipo `ControlFrame`**

Em `packages/transfer-engine/src/protocol.ts`, troque a linha do union:

```ts
  | { t: "file-end"; id: string; bytesSent: number; sha256: string }
```

- [ ] **Step 4: Implementar — `case "file-end"` em `decodeControl`**

Substitua o `case "file-end":` inteiro (linhas ~79-82) por:

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

`encodeControl` não muda — `JSON.stringify` já serializa o campo novo.

- [ ] **Step 5: Implementar — `TransferErrorCode`**

Em `packages/transfer-engine/src/types.ts`, acrescente `"integrity"` ao union:

```ts
export type TransferErrorCode =
  | "rejected"
  | "over-limit"
  | "busy"
  | "size-mismatch"
  | "integrity"
  | "bad-frame"
  | "channel-error"
  | "cancelled";
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @transfergo/transfer-engine test -- protocol`
Expected: PASS.

> O `typecheck` e outros testes do pacote (sender/receiver/loopback) vão quebrar agora porque `send({ t: "file-end", … })` não passa mais sem `sha256`. Isso é esperado e resolvido nas Tasks 3–5. **Não** rode o portão completo do pacote nesta tarefa.

- [ ] **Step 7: Commit**

```bash
git add packages/transfer-engine/src/protocol.ts packages/transfer-engine/src/protocol.test.ts packages/transfer-engine/src/types.ts
git commit -m "feat(engine): require a sha256 digest on the file-end frame

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Emissor — hash por arquivo, `sha256` no `file-end`

**Files:**

- Modify: `packages/transfer-engine/src/sender.ts` — `import`, `SenderOptions`, `DEFAULTS`, `runBatch`
- Test: `packages/transfer-engine/src/sender.test.ts`

**Interfaces:**

- Consumes: `createSha256Hasher`, `type CreateHasher` de `./hash.js`.
- Produces:
  - `SenderOptions` ganha `createHasher?: CreateHasher` (default `createSha256Hasher`).
  - Todo quadro `file-end` que o emissor manda carrega `sha256` = SHA-256 do conteúdo lido daquele arquivo.

- [ ] **Step 1: Ajustar/escrever os testes que falham**

Em `packages/transfer-engine/src/sender.test.ts`:

No topo, acrescente o import e um helper:

```ts
import { createSha256Hasher } from "./hash.js";

const sha = (bytes: Uint8Array): string => {
  const h = createSha256Hasher();
  h.update(bytes);
  return h.digest();
};
```

No teste `"after batch-accept: file-begin, ordered chunks that reassemble, file-end, batch-complete"`, troque a asserção do array de `controlFrames` para incluir o hash:

```ts
expect(ch.controlFrames).toEqual([
  { t: "batch-offer", batch: { id: "b1", files: [meta({ id: "f1", size: 50 })] } },
  { t: "file-begin", id: "f1", offset: 0 },
  { t: "file-end", id: "f1", bytesSent: 50, sha256: sha(data) },
  { t: "batch-complete" }
]);
```

Acrescente dois testes novos ao final do `describe("TransferSender", …)`:

```ts
it("puts the real SHA-256 of the file content on the file-end frame", async () => {
  const ch = new FakeChannel();
  const data = new Uint8Array(40).map((_, i) => (i * 3) % 256);
  const sender = new TransferSender(
    ch,
    "b1",
    [{ meta: meta({ id: "f1", size: 40 }), source: bytesSource(data) }],
    {},
    { chunkSize: 16 }
  );
  sender.start();
  ch.emitMessage(JSON.stringify({ t: "batch-accept" }));
  await flush();

  const end = ch.controlFrames.find((f) => f?.t === "file-end");
  expect(end).toEqual({ t: "file-end", id: "f1", bytesSent: 40, sha256: sha(data) });
});

it("hashes each file independently — no digest bleed between files", async () => {
  const ch = new FakeChannel();
  const a = new Uint8Array([1, 1, 1, 1]);
  const b = new Uint8Array([2, 2, 2, 2]);
  const sender = new TransferSender(
    ch,
    "b1",
    [
      { meta: meta({ id: "f1", size: 4 }), source: bytesSource(a) },
      { meta: meta({ id: "f2", size: 4 }), source: bytesSource(b) }
    ],
    {},
    { chunkSize: 4 }
  );
  sender.start();
  ch.emitMessage(JSON.stringify({ t: "batch-accept" }));
  await flush();

  const ends = ch.controlFrames.filter((f) => f?.t === "file-end");
  expect(ends).toEqual([
    { t: "file-end", id: "f1", bytesSent: 4, sha256: sha(a) },
    { t: "file-end", id: "f2", bytesSent: 4, sha256: sha(b) }
  ]);
  expect(ends[0]).not.toEqual(ends[1]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @transfergo/transfer-engine test -- sender`
Expected: FAIL — `file-end` sai sem `sha256`; typecheck do teste também reclama.

- [ ] **Step 3: Implementar — `import`, `SenderOptions`, `DEFAULTS`**

Em `packages/transfer-engine/src/sender.ts`, acrescente ao import de `./hash.js`:

```ts
import { createSha256Hasher, type CreateHasher } from "./hash.js";
```

Adicione o campo à interface:

```ts
export interface SenderOptions {
  chunkSize?: number;
  highWaterMark?: number;
  lowWaterMark?: number;
  progressIntervalMs?: number;
  createHasher?: CreateHasher;
}
```

E ao objeto `DEFAULTS`:

```ts
const DEFAULTS = {
  chunkSize: 16 * 1024,
  highWaterMark: 8 * 1024 * 1024,
  lowWaterMark: 1 * 1024 * 1024,
  progressIntervalMs: 250,
  createHasher: createSha256Hasher
};
```

- [ ] **Step 4: Implementar — hash no `runBatch`**

No `runBatch`, dentro do `for` por arquivo, logo depois de `const { meta, source } = this.inputs[index]!;` crie o hasher:

```ts
const { meta, source } = this.inputs[index]!;
const hasher = this.opts.createHasher();
this.send({ t: "file-begin", id: meta.id, offset: 0 });
```

Dentro do `while`, depois dos checks de cancel e antes do `this.channel.send(chunk);`, alimente o hasher com o mesmo buffer:

```ts
if (chunk.byteLength === 0) {
  throw new TransferError(
    "channel-error",
    `source.read returned 0 bytes with ${source.size - sent} still to send`
  );
}
hasher.update(new Uint8Array(chunk));
this.channel.send(chunk);
```

E troque o `file-end`:

```ts
this.send({ t: "file-end", id: meta.id, bytesSent: sent, sha256: hasher.digest() });
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @transfergo/transfer-engine test -- sender`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/transfer-engine/src/sender.ts packages/transfer-engine/src/sender.test.ts
git commit -m "feat(engine): sender computes a per-file SHA-256 and sends it on file-end

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Receptor — verificação de integridade no `file-end`

**Files:**

- Modify: `packages/transfer-engine/src/receiver.ts` — `import`, `ReceiverOptions`, `DEFAULTS`, campo `currentHash`, `file-begin`, `handleBinary`, `file-end`, `cancel`, `fail`
- Test: `packages/transfer-engine/src/receiver.test.ts`

**Interfaces:**

- Consumes: `createSha256Hasher`, `type CreateHasher`, `type Hasher` de `./hash.js`.
- Produces:
  - `ReceiverOptions` ganha `createHasher?: CreateHasher` (default `createSha256Hasher`).
  - Um `file-end` cujo `sha256` não bate com o hash dos bytes recebidos → `onError({ code: "integrity" })`, sink abortado (não `close()`d), `cancel` enviado ao emissor.
  - Um `file-end` cujo `sha256` bate → comportamento atual (`close()`, `onFileComplete`, `emitProgress`).

- [ ] **Step 1: Ajustar os call sites e escrever os testes que falham**

Em `packages/transfer-engine/src/receiver.test.ts`:

No topo, acrescente o import e dois helpers, e ajuste a assinatura de `fileEnd`:

```ts
import { createSha256Hasher } from "./hash.js";

const sha = (bytes: Uint8Array): string => {
  const h = createSha256Hasher();
  h.update(bytes);
  return h.digest();
};
// Um file-end bem-formado: hash de verdade dos bytes que o teste alimentou.
const fileEnd = (id: string, bytes: Uint8Array) =>
  encodeControl({ t: "file-end", id, bytesSent: bytes.byteLength, sha256: sha(bytes) });
// Um file-end com hash deliberadamente errado (mas sintaticamente válido).
const fileEndBadHash = (id: string, bytesSent: number) =>
  encodeControl({ t: "file-end", id, bytesSent, sha256: "f".repeat(64) });
```

Agora troque cada `ch.feed(encodeControl({ t: "file-end", … }))` existente:

1. No teste `"accept() sends batch-accept, reassembles bytes in order, and completes"` (bytes `[10,20,30]` + `[40,50]`):
   ```ts
   ch.feed(fileEnd("f1", new Uint8Array([10, 20, 30, 40, 50])));
   ```
2. No teste `"errors size-mismatch when bytes received differ from the declared size"` (recebeu `[1,2]`, `size` 4):
   ```ts
   ch.feed(fileEndBadHash("f1", 2));
   ```
   (a checagem de tamanho vem antes do hash — o valor não importa, só a forma.)
3. No teste `"never close()s a truncated file — aborts it so no partial file lands on disk"` (recebeu `[1,2]`, `size` 4):
   ```ts
   ch.feed(fileEndBadHash("f1", 2));
   ```
4. No teste `"reports the count of fully-received files when cancelled mid-batch"` (f1 recebeu `[1,2]`, `size` 2):
   ```ts
   ch.feed(fileEnd("f1", new Uint8Array([1, 2])));
   ```

Acrescente três testes novos ao final do `describe("TransferReceiver", …)`:

```ts
it("fails 'integrity' when the file-end digest does not match the received bytes", async () => {
  const ch = new FakeChannel();
  const sink = new MemorySink();
  const onError = vi.fn();
  const receiver = new TransferReceiver(ch, () => Promise.resolve(sink), { onError });
  ch.feed(offer([meta({ id: "f1", size: 3 })]));
  receiver.accept();
  ch.feed(encodeControl({ t: "file-begin", id: "f1", offset: 0 }));
  await flush();
  ch.feed(new Uint8Array([1, 2, 3]).buffer);
  ch.feed(fileEndBadHash("f1", 3));
  await flush();

  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "integrity" }));
  expect(sink.aborted).toBe(true);
  expect(sink.closed).toBe(false);
  expect(ch.sentStrings).toContain(encodeControl({ t: "cancel", scope: "batch" }));
});

it("fails 'integrity' when a chunk was tampered with in transit", async () => {
  const ch = new FakeChannel();
  const sink = new MemorySink();
  const onError = vi.fn();
  const original = new Uint8Array([9, 9, 9, 9]);
  const tampered = new Uint8Array([9, 8, 9, 9]);
  const receiver = new TransferReceiver(ch, () => Promise.resolve(sink), { onError });
  ch.feed(offer([meta({ id: "f1", size: 4 })]));
  receiver.accept();
  ch.feed(encodeControl({ t: "file-begin", id: "f1", offset: 0 }));
  await flush();
  ch.feed(tampered.buffer);
  // O emissor honesto mandaria o hash do conteúdo ORIGINAL.
  ch.feed(encodeControl({ t: "file-end", id: "f1", bytesSent: 4, sha256: sha(original) }));
  await flush();

  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "integrity" }));
  expect(sink.closed).toBe(false);
});

it("passes a matching digest through to a normal close()", async () => {
  const ch = new FakeChannel();
  const sink = new MemorySink();
  const onFileComplete = vi.fn();
  const receiver = new TransferReceiver(ch, () => Promise.resolve(sink), { onFileComplete });
  ch.feed(offer([meta({ id: "f1", size: 4 })]));
  receiver.accept();
  ch.feed(encodeControl({ t: "file-begin", id: "f1", offset: 0 }));
  await flush();
  ch.feed(new Uint8Array([5, 6, 7, 8]).buffer);
  ch.feed(fileEnd("f1", new Uint8Array([5, 6, 7, 8])));
  await flush();

  expect(sink.closed).toBe(true);
  expect(sink.aborted).toBe(false);
  expect(onFileComplete).toHaveBeenCalledWith("f1");
});

it("uses a fresh hasher per file", async () => {
  const ch = new FakeChannel();
  let created = 0;
  const receiver = new TransferReceiver(
    ch,
    () => Promise.resolve(new MemorySink()),
    { onError: vi.fn() },
    {
      createHasher: () => {
        created += 1;
        return createSha256Hasher();
      }
    }
  );
  ch.feed(offer([meta({ id: "f1", size: 2 }), meta({ id: "f2", size: 2 })]));
  receiver.accept();
  ch.feed(encodeControl({ t: "file-begin", id: "f1", offset: 0 }));
  await flush();
  ch.feed(new Uint8Array([1, 2]).buffer);
  ch.feed(fileEnd("f1", new Uint8Array([1, 2])));
  await flush();
  ch.feed(encodeControl({ t: "file-begin", id: "f2", offset: 0 }));
  await flush();
  ch.feed(new Uint8Array([3, 4]).buffer);
  ch.feed(fileEnd("f2", new Uint8Array([3, 4])));
  await flush();

  expect(created).toBe(2);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @transfergo/transfer-engine test -- receiver`
Expected: FAIL — sem `createHasher` nas opções o typecheck do último teste quebra; os testes de `integrity` não veem `onError`.

- [ ] **Step 3: Implementar — `import`, `ReceiverOptions`, `DEFAULTS`, campo**

Em `packages/transfer-engine/src/receiver.ts`, acrescente o import:

```ts
import { createSha256Hasher, type CreateHasher, type Hasher } from "./hash.js";
```

Campo à interface:

```ts
export interface ReceiverOptions {
  progressIntervalMs?: number;
  maxBinaryFrameBytes?: number;
  createHasher?: CreateHasher;
}
```

`DEFAULTS`:

```ts
const DEFAULTS = {
  progressIntervalMs: 250,
  maxBinaryFrameBytes: MAX_BINARY_FRAME_BYTES,
  createHasher: createSha256Hasher
};
```

Novo campo de instância, junto de `currentSink`/`currentMeta`/`currentBytes`:

```ts
  private currentHash: Hasher | null = null;
```

- [ ] **Step 4: Implementar — `file-begin`, `handleBinary`, `file-end`**

No `case "file-begin":`, logo depois de `this.currentSink = await this.openSink(meta, frame.offset);`:

```ts
this.currentSink = await this.openSink(meta, frame.offset);
this.currentHash = this.opts.createHasher();
return;
```

Em `handleBinary`, depois de `await this.currentSink.write(chunk);`:

```ts
await this.currentSink.write(chunk);
this.currentHash!.update(new Uint8Array(chunk));
this.currentBytes += chunk.byteLength;
this.emitProgress(false);
```

(Usar `!`, não `?.`: `currentHash` e `currentSink` são setados juntos no `file-begin` e `handleBinary` já checa `!this.currentSink` no topo; se um bug futuro os dessincronizar, queremos o estouro, não o silêncio.)

No `case "file-end":`, insira a comparação **entre** a checagem de tamanho e o `close()`, e limpe `currentHash` junto com o resto:

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

- [ ] **Step 5: Implementar — higiene em `cancel` e `fail`**

No `cancel()` público e no método `fail()`, onde já há `void this.currentSink?.abort()…`, acrescente `this.currentHash = null;` na linha seguinte. Em `cancel()`:

```ts
void this.currentSink?.abort().catch(() => undefined);
this.currentHash = null;
```

Em `fail()`:

```ts
  private fail(code: TransferError["code"], message: string): void {
    void this.currentSink?.abort().catch(() => undefined);
    this.currentHash = null;
    this.send({ t: "cancel", scope: "batch" });
    this.cb.onError?.(new TransferError(code, message));
    this.dispose();
  }
```

(O `case "cancel"` dentro de `handleControl` também chama `this.currentSink?.abort()`; acrescente `this.currentHash = null;` lá do mesmo jeito.)

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @transfergo/transfer-engine test -- receiver`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/transfer-engine/src/receiver.ts packages/transfer-engine/src/receiver.test.ts
git commit -m "feat(engine): receiver verifies the per-file SHA-256 before committing the file

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Loopback — prova de ponta a ponta + teste de corrupção

**Files:**

- Modify: `packages/transfer-engine/src/loopback.integration.test.ts`

**Interfaces:**

- Consumes: `TransferSender`, `TransferReceiver`, `createSha256Hasher`.
- Produces: nada (só provas).

- [ ] **Step 1: Escrever os testes que falham**

Em `packages/transfer-engine/src/loopback.integration.test.ts`:

Acrescente o import:

```ts
import { createSha256Hasher } from "./hash.js";
```

Dê à `MemorySink` os flags que o teste de corrupção precisa:

```ts
class MemorySink implements FileSink {
  chunks: Uint8Array[] = [];
  closed = false;
  aborted = false;
  async write(chunk: ArrayBuffer): Promise<void> {
    this.chunks.push(new Uint8Array(chunk));
  }
  async close(): Promise<void> {
    this.closed = true;
  }
  async abort(): Promise<void> {
    this.aborted = true;
  }
  get bytes(): Uint8Array {
    return new Uint8Array(this.chunks.flatMap((c) => [...c]));
  }
}
```

Estenda `makeLoopbackPair` com um transform opcional de bytes em trânsito — na assinatura e no `pump`:

```ts
function makeLoopbackPair(
  drainRate: number,
  corrupt?: (frame: ArrayBuffer, binaryIndex: number) => void
): [DataChannelLike, DataChannelLike] {
```

Dentro do IIFE, antes de `const timer = setInterval(…)`, um contador por endpoint e a aplicação do transform no `pump`:

```ts
let binarySeen = 0;
const pump = (ep: Endpoint) => {
  let budget = drainRate;
  while (ep._outbox.length > 0 && budget > 0) {
    const frame = ep._outbox.shift()!;
    const size = typeof frame === "string" ? frame.length : frame.byteLength;
    budget -= size;
    if (typeof frame !== "string") {
      corrupt?.(frame, binarySeen);
      binarySeen += 1;
    }
    const wasOver = ep.bufferedAmount > ep.bufferedAmountLowThreshold;
    ep.bufferedAmount = Math.max(0, ep.bufferedAmount - size);
    for (const l of ep._peer._messageListeners) l({ data: frame });
    if (wasOver && ep.bufferedAmount <= ep.bufferedAmountLowThreshold) {
      for (const l of ep._lowListeners) l();
    }
  }
};
```

No teste existente `"delivers a multi-file batch byte-for-byte, exercising backpressure"`, acrescente a captura e a asserção dos hashes. Antes do `const receiver = …`, guarde os `file-end` observados:

```ts
const observedEnds: { id: string; sha256: string }[] = [];
guestCh.addEventListener("message", (event) => {
  if (typeof event.data === "string" && event.data.includes('"file-end"')) {
    const f = JSON.parse(event.data) as { t: string; id: string; sha256: string };
    if (f.t === "file-end") observedEnds.push({ id: f.id, sha256: f.sha256 });
  }
});
```

Depois do `await finished;`, além da comparação de bytes já existente:

```ts
for (const f of files) {
  const expected = createSha256Hasher();
  expected.update(f.bytes);
  expect(observedEnds.find((e) => e.id === f.meta.id)?.sha256).toBe(expected.digest());
}
```

Acrescente o teste de corrupção como um `it` novo dentro do mesmo `describe`:

```ts
it("stops with an integrity error when a byte is flipped in transit and never commits the file", async () => {
  // XOR no 1º byte do 3º frame binário que cruza o canal.
  const [hostCh, guestCh] = makeLoopbackPair(2 * 1024, (frame, i) => {
    if (i === 2) new Uint8Array(frame)[0] ^= 0xff;
  });

  const files: { meta: FileMeta; bytes: Uint8Array }[] = [
    {
      meta: { id: "a", name: "a.bin", size: 200, type: "" },
      bytes: new Uint8Array(200).map((_, i) => i % 256)
    },
    {
      meta: { id: "b", name: "b.bin", size: 4 * 1024, type: "" },
      bytes: new Uint8Array(4 * 1024).map((_, i) => (i * 7) % 256)
    }
  ];

  const sinkMap = new Map<string, MemorySink>();
  let settle!: (e: unknown) => void;
  const errored = new Promise<unknown>((res) => {
    settle = res;
  });
  const onBatchComplete = vi.fn();

  const receiver = new TransferReceiver(
    guestCh,
    (meta) => {
      const sink = new MemorySink();
      sinkMap.set(meta.id, sink);
      return Promise.resolve(sink);
    },
    { onBatchComplete, onError: (e) => settle(e) }
  );

  const sender = new TransferSender(
    hostCh,
    "batch-x",
    files.map((f) => ({ meta: f.meta, source: sourceOf(f.bytes) })),
    {},
    { chunkSize: 512, highWaterMark: 3 * 1024, lowWaterMark: 512 }
  );

  guestCh.addEventListener("message", (event) => {
    if (typeof event.data === "string" && event.data.includes("batch-offer")) receiver.accept();
  });

  sender.start();
  const err = (await errored) as { code: string };

  expect(err.code).toBe("integrity");
  expect(onBatchComplete).not.toHaveBeenCalled();
  const corrupted = sinkMap.get("a")!;
  expect(corrupted.closed).toBe(false);
  expect(corrupted.aborted).toBe(true);
});
```

> Este teste usa `vi` — acrescente-o ao import do `vitest` no topo (`import { describe, expect, it, vi } from "vitest";`).

- [ ] **Step 2: Rodar e ver o novo teste falhar (e o antigo passar)**

Run: `pnpm --filter @transfergo/transfer-engine test -- loopback`
Expected: o teste de bytes + hashes passa; sem a Task 4 aplicada o de corrupção falharia — como as Tasks 3–4 já estão no lugar, ele deve **passar** aqui. Se você está executando estritamente em ordem, os dois passam; registre a saída real.

- [ ] **Step 3: Portão completo do pacote do motor**

Run: `pnpm --filter @transfergo/transfer-engine run lint typecheck test build`
Expected: tudo verde. Este é o primeiro ponto em que o pacote inteiro volta a compilar desde a Task 2.

- [ ] **Step 4: Commit**

```bash
git add packages/transfer-engine/src/loopback.integration.test.ts
git commit -m "test(engine): loopback proves real SHA-256 end to end and rejects a flipped byte

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Hook — mensagem de erro `integrity` + `integrityVerified`

**Files:**

- Modify: `apps/web/src/lib/use-file-transfer.ts` — `ERROR_MESSAGES`, `UseFileTransferResult`, valor de retorno
- Test: `apps/web/src/lib/use-file-transfer.test.ts`
- Modify: `apps/web/src/app/transferir/page.test.tsx`, `apps/web/src/app/s/[token]/page.test.tsx` (stubs do mock)

**Interfaces:**

- Consumes: `phase` (já existe).
- Produces:
  - `UseFileTransferResult` ganha `integrityVerified: boolean`.
  - `ERROR_MESSAGES.integrity === "Um arquivo chegou corrompido. A transferência foi interrompida."`

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/web/src/lib/use-file-transfer.test.ts`, acrescente um `describe` novo (as fixtures/hel­pers `renderTransfer`, `acceptAsGuest`, `channel`, `flush`, `enc` já existem no arquivo):

```ts
describe("useFileTransfer — integridade (Plano 8)", () => {
  it("maps an integrity TransferError to the pt-BR corrupted-file message", async () => {
    const { result } = renderTransfer("host");
    act(() => result.current.addFiles([bigFile("a.bin", 4, "application/octet-stream")]));
    act(() => result.current.startSend());
    act(() => channel.feed(enc({ t: "batch-accept" })));
    await flush();
    // O emissor cai em erro quando o receptor manda cancel após o hash divergir;
    // aqui exercitamos o mapeamento direto do código.
    act(() => channel.feed(enc({ t: "cancel", scope: "batch" })));
    await flush();
    // cancel remoto → cancelled; para o mapa de mensagem, force um erro:
  });
});
```

> **Nota para o implementador:** o caminho realista para `onError({code:"integrity"})` no hook é o receptor. Prefira testar pelo lado `guest`, dirigindo `acceptAsGuest` e alimentando um `file-end` com `sha256` errado, espelhando `use-file-transfer.test.ts` já existente para `size-mismatch` (procure o teste de `size-mismatch` no arquivo e clone a estrutura, trocando o `file-end` por um com `sha256: "f".repeat(64)` e bytes que não batem). O essencial a afirmar:

```ts
expect(result.current.phase).toBe("failed");
expect(result.current.errorMessage).toBe(
  "Um arquivo chegou corrompido. A transferência foi interrompida."
);
```

E dois testes de `integrityVerified` que não dependem do fio:

```ts
it("integrityVerified is false until the batch completes", () => {
  const { result } = renderTransfer("guest");
  expect(result.current.integrityVerified).toBe(false);
});

it("integrityVerified is true once phase is completed", async () => {
  const { result } = renderTransfer("guest");
  // leve um lote de 1 arquivo até batch-complete (clone o teste de conclusão
  // feliz já existente no arquivo para o guest), então:
  expect(result.current.phase).toBe("completed");
  expect(result.current.integrityVerified).toBe(true);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @transfergo/web test -- use-file-transfer`
Expected: FAIL — `integrityVerified` é `undefined`; `errorMessage` cai no fallback `"A transferência falhou."`.

- [ ] **Step 3: Implementar — `ERROR_MESSAGES`**

Em `apps/web/src/lib/use-file-transfer.ts`, acrescente a chave ao mapa (a ordem segue o union em `types.ts`):

```ts
const ERROR_MESSAGES: Record<TransferError["code"], string | null> = {
  rejected: "O outro lado recusou a transferência.",
  "over-limit": "A seleção passou do limite de 50 arquivos ou 5 GB.",
  busy: "O outro lado já está no meio de outra transferência.",
  "size-mismatch": "Um arquivo chegou incompleto. A transferência foi interrompida.",
  integrity: "Um arquivo chegou corrompido. A transferência foi interrompida.",
  "bad-frame": "A conexão falhou durante a transferência.",
  "channel-error": "A conexão falhou durante a transferência.",
  cancelled: null
};
```

- [ ] **Step 4: Implementar — `UseFileTransferResult` e o retorno**

Acrescente o campo à interface, perto de `errorMessage`:

```ts
  errorMessage: string | null;
  integrityVerified: boolean;
  cancel: () => void;
```

No corpo do hook, logo antes do `return {`:

```ts
// Verdadeiro só no estado terminal de sucesso. No receptor é literal — batch-complete
// só chega depois de todo file-end ter passado pela comparação de hash. No emissor é
// verdade por inferência — um hash divergente no receptor dispara fail("integrity") →
// cancel, e o emissor nunca vê batch-complete.
const integrityVerified = phase === "completed";
```

E no objeto retornado, junto de `errorMessage`:

```ts
(errorMessage, integrityVerified, cancel);
```

- [ ] **Step 5: Atualizar os stubs do mock nos testes de página**

Em `apps/web/src/app/transferir/page.test.tsx` e `apps/web/src/app/s/[token]/page.test.tsx`, no objeto literal que satisfaz `UseFileTransferResult`, acrescente logo depois de `errorMessage: null,`:

```ts
      integrityVerified: false,
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @transfergo/web test -- use-file-transfer`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/use-file-transfer.ts apps/web/src/lib/use-file-transfer.test.ts apps/web/src/app/transferir/page.test.tsx "apps/web/src/app/s/[token]/page.test.tsx"
git commit -m "feat(web): hook maps integrity errors and exposes integrityVerified

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: UI — "Verificado" no receptor + linha de integridade nos dois painéis

**Files:**

- Modify: `apps/web/src/components/s/ReceivePanel.tsx`
- Test: `apps/web/src/components/s/ReceivePanel.test.tsx`
- Modify: `apps/web/src/components/transferir/SendPanel.tsx`
- Test: `apps/web/src/components/transferir/SendPanel.test.tsx`

**Interfaces:**

- Consumes: `transfer.integrityVerified` (Task 6), `CheckCircle2` (já importado nos dois painéis de `@transfergo/ui`).
- Produces: nenhum contrato novo — só marcação.

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/web/src/components/s/ReceivePanel.test.tsx`, acrescente `integrityVerified: false` ao objeto `base` (depois de `errorMessage: null,`). Depois acrescente:

```ts
  it("labels a finished file 'Verificado' during an active transfer", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({
          phase: "receiving",
          overall: { bytesDone: 10, bytesTotal: 10, filesDone: 1, filesTotal: 1 },
          incomingBatch: {
            files: [{ id: "f1", name: "a.bin", size: 10, type: "" }],
            totalBytes: 10,
            summary: "",
            requiresMemoryWarning: false
          },
          perFile: { f1: { bytes: 10, size: 10, pct: 100, state: "completed" } }
        })}
      />
    );
    expect(screen.getByText("Verificado")).toBeInTheDocument();
    expect(screen.queryByText("Concluído")).not.toBeInTheDocument();
  });

  it("shows the SHA-256 integrity line on the success screen", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({
          phase: "completed",
          integrityVerified: true,
          overall: { bytesDone: 0, bytesTotal: 0, filesDone: 2, filesTotal: 2 }
        })}
      />
    );
    expect(screen.getByText("Integridade verificada (SHA-256)")).toBeInTheDocument();
  });
```

Em `apps/web/src/components/transferir/SendPanel.test.tsx`, acrescente `integrityVerified: false` ao objeto `base`. Depois:

```ts
  it("keeps the sender per-file label as 'Concluído' (the sender verified nothing)", () => {
    render(
      <SendPanel
        transfer={withOverrides({
          phase: "sending",
          overall: { bytesDone: 10, bytesTotal: 10, filesDone: 1, filesTotal: 1 },
          selectedFiles: [{ id: "f1", name: "a.bin", size: 10, type: "", sizeClass: "small" }],
          perFile: { f1: { bytes: 10, size: 10, pct: 100, state: "completed" } }
        })}
      />
    );
    expect(screen.getByText("Concluído")).toBeInTheDocument();
    expect(screen.queryByText("Verificado")).not.toBeInTheDocument();
  });

  it("shows the SHA-256 integrity line on the success screen", () => {
    render(
      <SendPanel
        transfer={withOverrides({
          phase: "completed",
          integrityVerified: true,
          overall: { bytesDone: 0, bytesTotal: 0, filesDone: 2, filesTotal: 2 }
        })}
      />
    );
    expect(screen.getByText("Integridade verificada (SHA-256)")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @transfergo/web test -- ReceivePanel SendPanel`
Expected: FAIL — "Verificado" e a linha de integridade não existem ainda.

- [ ] **Step 3: Implementar — `ReceivePanel.tsx` rótulo por arquivo**

No `map` dos arquivos da fase ativa, troque o cálculo do `label` e renderize o ícone quando verificado:

```tsx
          {(incomingBatch?.files ?? []).map((file) => {
            const pf = transfer.perFile[file.id];
            const state = pf?.state ?? "queued";
            const label =
              state === "completed"
                ? "Verificado"
                : state === "receiving"
                  ? "Recebendo"
                  : state === "failed"
                    ? "Falhou"
                    : "Na fila";
            return (
              <li key={file.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="flex min-w-0 items-center gap-2">
                    <FileText className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
                    <span className="truncate">{file.name}</span>
                  </span>
                  <span className="ml-3 flex shrink-0 items-center gap-1 text-text-muted">
                    {state === "completed" && <CheckCircle2 className="size-3 text-success" aria-hidden="true" />}
                    {label}
                  </span>
                </div>
```

- [ ] **Step 4: Implementar — `ReceivePanel.tsx` tela de sucesso**

Troque o bloco `if (phase === "completed")` para envolver o `StateScreen` num wrapper e acrescentar a linha de integridade (`StateScreen` não aceita filhos — vai como irmão):

```tsx
if (phase === "completed") {
  const n = transfer.overall.filesTotal;
  return (
    <div className="w-full">
      <StateScreen
        icon={CheckCircle2}
        tone="success"
        title={n === 1 ? "Arquivo recebido com sucesso" : `${n} arquivos recebidos com sucesso`}
        description="Os arquivos foram salvos neste dispositivo."
      />
      {transfer.integrityVerified && (
        <p className="-mt-6 flex items-center justify-center gap-1 text-xs text-success">
          <CheckCircle2 className="size-3.5" aria-hidden="true" />
          Integridade verificada (SHA-256)
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Implementar — `SendPanel.tsx` tela de sucesso**

O rótulo por arquivo do emissor **não muda** (continua "Concluído"). Só a tela de sucesso ganha a linha. Troque o bloco `if (phase === "completed")`:

```tsx
if (phase === "completed") {
  const n = transfer.overall.filesTotal;
  return (
    <div className="w-full">
      <StateScreen
        icon={CheckCircle2}
        tone="success"
        title={
          n === 1 ? "Arquivo transferido com sucesso" : `${n} arquivos transferidos com sucesso`
        }
        description="Os arquivos chegaram ao outro dispositivo."
        actions={[{ label: "Enviar mais arquivos", onClick: transfer.clearSelection }]}
      />
      {transfer.integrityVerified && (
        <p className="-mt-2 flex items-center justify-center gap-1 text-xs text-success">
          <CheckCircle2 className="size-3.5" aria-hidden="true" />
          Integridade verificada (SHA-256)
        </p>
      )}
    </div>
  );
}
```

> As margens negativas (`-mt-6` / `-mt-2`) só encostam a linha no `StateScreen` (que tem `py-12` / `mt-6` nos `actions`). Se o resultado visual ficar apertado na verificação manual da Task 8, troque por uma margem positiva pequena — o texto e a condição (`integrityVerified`) são o que importa.

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @transfergo/web test -- ReceivePanel SendPanel`
Expected: PASS. Confira que os testes já existentes que procuram `"Concluído"` no `ReceivePanel` (se houver) foram atualizados — busque por `"Concluído"` em `ReceivePanel.test.tsx` e ajuste para `"Verificado"` onde o estado é `completed`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/s/ReceivePanel.tsx apps/web/src/components/s/ReceivePanel.test.tsx apps/web/src/components/transferir/SendPanel.tsx apps/web/src/components/transferir/SendPanel.test.tsx
git commit -m "feat(web): show 'Verificado' and a SHA-256 integrity line on success

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Portão completo + verificação manual

**Files:** nenhum (a menos que o portão aponte algo).

- [ ] **Step 1: Portão do monorepo**

Run: `pnpm turbo run lint typecheck test build`
Expected: tudo verde em todos os pacotes. Se `apps/web` falhar a resolução de `@noble/hashes` (import transitivo via o pacote só-fonte), rode `pnpm add @noble/hashes --filter @transfergo/web` fixando **a mesma versão** da Task 1, e rode o portão de novo. Commit desse ajuste isolado se ele acontecer:

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "build(web): pin @noble/hashes so the source-only engine resolves it in web

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Verificação manual (dois navegadores reais)**

Suba o app (`pnpm --filter @transfergo/web dev` + o servidor de signaling conforme os planos anteriores), abra host e guest, transfira um lote de 2–3 arquivos com bytes reais. Confirme:

- As duas telas de sucesso mostram **"Integridade verificada (SHA-256)"**.
- No painel do receptor, cada arquivo terminado aparece como **"Verificado"** com o ícone de check; no do emissor, **"Concluído"**.
- `sha256sum` (ou `Get-FileHash -Algorithm SHA256`) do arquivo recebido bate com o do original.

> O usuário é leigo em operação de navegador/DevTools — se esta verificação for delegada, faça-a você pelo ambiente, não peça para ele abrir DevTools.

- [ ] **Step 3: Commit final (se o Step 1/2 não gerou nenhum)**

Nada a commitar — as Tasks 1–7 já cobriram tudo. Marque o plano como concluído.

---

## Self-Review

**1. Cobertura da spec**

| Item da spec                                                                                                                         | Task                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| §2 dependência `@noble/hashes` no pacote do motor                                                                                    | 1, 8 (fallback web)                                                                                               |
| §3 `hash.ts` — `Hasher`/`CreateHasher`/`createSha256Hasher`, síncrono                                                                | 1                                                                                                                 |
| §4.1 `file-end` com `sha256`                                                                                                         | 2                                                                                                                 |
| §4.2 `decodeControl` valida `/^[0-9a-f]{64}$/`                                                                                       | 2                                                                                                                 |
| §4.3 `TransferErrorCode` ganha `"integrity"` + mensagem interna                                                                      | 2 (código), 4 (mensagem no `fail`)                                                                                |
| §5.1 sem estado `verifying`                                                                                                          | respeitado — nenhuma task adiciona `verifying`                                                                    |
| §5.2 emissor: `createHasher` + `Hasher` por arquivo + `sha256` no `file-end`                                                         | 3                                                                                                                 |
| §5.3 receptor: `createHasher`, `currentHash`, comparação antes do `close()`, `fail("integrity")`, higiene em cancel/fail             | 4                                                                                                                 |
| §6 hook: `ERROR_MESSAGES.integrity`, `integrityVerified` derivado                                                                    | 6                                                                                                                 |
| §7.1 rótulo "Verificado" (receptor) / "Concluído" (emissor)                                                                          | 7                                                                                                                 |
| §7.2 linha "Integridade verificada (SHA-256)" nas duas telas de sucesso                                                              | 7                                                                                                                 |
| §7.3 tela de `failed` sem marcação nova                                                                                              | respeitado — nada muda em `phase === "failed"`                                                                    |
| §8 bordas: 0 byte, hash malformado, divergência, cancel no meio, `file-begin` duplo, view com `byteOffset`, `createHasher` injetável | 1 (0 byte, formato), 2 (malformado), 4 (divergência, injeção, file-begin duplo herda o abort atual), 5 (loopback) |
| §9.1 testes de protocolo                                                                                                             | 2                                                                                                                 |
| §9.2 testes de `hash.ts`                                                                                                             | 1                                                                                                                 |
| §9.3 testes de emissor                                                                                                               | 3                                                                                                                 |
| §9.4 testes de receptor                                                                                                              | 4                                                                                                                 |
| §9.5 loopback (prova principal)                                                                                                      | 5                                                                                                                 |
| §9.6 testes do hook                                                                                                                  | 6                                                                                                                 |
| §9.7 testes do `ReceivePanel`                                                                                                        | 7                                                                                                                 |
| §9.8 testes do `SendPanel`                                                                                                           | 7                                                                                                                 |
| §9.9 portão                                                                                                                          | 8                                                                                                                 |

**2. Placeholders:** a Task 6 tem duas passagens em prosa ("clone o teste de `size-mismatch`", "clone o teste de conclusão feliz") em vez de código completo — isso é deliberado: o caminho realista de erro no hook vem do fio do receptor e o arquivo `use-file-transfer.test.ts` já tem a máquina de estados montada para `size-mismatch`/conclusão; reproduzir 60+ linhas de setup aqui divergiria do arquivo real. As asserções finais (o que verificar) estão explícitas. Se o executor preferir, os dois testes de `integrityVerified` que não dependem do fio (`false` no início, `true` após `completed`) já estão completos e cobrem o contrato novo.

**3. Consistência de tipos:**

- `Hasher.update(bytes: Uint8Array): void` / `digest(): string` — usado em 1, 3, 4, 5 sempre como `h.update(new Uint8Array(chunk))` + `h.digest()` (nunca encadeado).
- `CreateHasher = () => Hasher` — `SenderOptions.createHasher?` e `ReceiverOptions.createHasher?`, ambos com default `createSha256Hasher` em `DEFAULTS`, lidos como `this.opts.createHasher()`.
- `ControlFrame` `file-end` = `{ t; id; bytesSent; sha256 }` — produzido em 3 (`sender.send`), consumido em 4 (`frame.sha256`), validado em 2 (`decodeControl`).
- `TransferErrorCode` inclui `"integrity"` (2); `fail("integrity", …)` (4) tipa contra `TransferError["code"]`; `ERROR_MESSAGES` (6) é `Record<TransferError["code"], …>` e ganha a chave.
- `UseFileTransferResult.integrityVerified: boolean` (6) — consumido por `transfer.integrityVerified` em 7 e nos stubs de mock (6).

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-03-transfergo-v1-08-sha256-integridade.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
