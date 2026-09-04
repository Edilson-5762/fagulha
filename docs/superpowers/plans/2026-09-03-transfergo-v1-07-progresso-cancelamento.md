# Plano 7/9 — Progresso real e Cancelamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a barra de progresso por contagem de arquivos do Plano 6 por progresso real medido em bytes — com velocidade e tempo restante honestos calculados no hook — e transformar o cancelamento num fluxo completo dos dois lados, com a tela final informando quantos arquivos de fato pousaram.

**Architecture:** Toda a matemática de progresso (janela deslizante de 5 s, velocidade, ETA com portão de estabilização, ticker de decaimento, bytes acumulados do lote) mora no hook `apps/web/src/lib/use-file-transfer.ts`, mais duas funções puras de formatação em `transfer-format.ts`. O `packages/transfer-engine` só ganha o argumento `filesDone` no callback `onCancelled`. Os painéis `SendPanel`/`ReceivePanel` consomem a API enriquecida do hook.

**Tech Stack:** TypeScript, React 19, Next.js 15, Vitest 2 (+ `@testing-library/react`, fake timers), pnpm workspaces + Turborepo, `@transfergo/transfer-engine` (pacote só-fonte), `@transfergo/ui`.

**Spec:** `docs/superpowers/specs/2026-09-03-transfergo-v1-07-progresso-cancelamento-design.md`

## Global Constraints

- **Idioma:** todo texto de UI em português do Brasil. Nomes internos de estado em inglês.
- **Sem estimativa inventada (spec §1, produto §3.11):** velocidade é média medida; ETA só aparece depois de estabilizar; numa travada os números caem para "calculando…", nunca congelam num valor mentiroso.
- **Vírgula decimal pt-BR** em todo número formatado (`toLocaleString("pt-BR")`, já usado em `formatBytes`).
- **Sem mudança no protocolo de fio do Plano 6:** nenhum quadro novo no `RTCDataChannel`. Progresso do emissor é otimista (bytes empurrados no canal).
- **Fora de escopo:** SHA-256 / `verifying`; retomada real / `paused`; bidirecional; TURN; botão de pausar.
- **Constantes de tempo, num só lugar** no topo de `use-file-transfer.ts`: `SPEED_WINDOW_MS = 5000`, `SPEED_MIN_SPAN_MS = 1000`, `ETA_MIN_ELAPSED_MS = 3000`, `STATS_TICK_MS = 1000`.
- **Portão por tarefa:** cada tarefa termina com os testes do pacote afetado verdes. A última tarefa roda `pnpm turbo run lint typecheck test build` inteiro.
- **Commits frequentes**, um por tarefa no mínimo, mensagem `feat(...)` / `fix(...)` / `test(...)` conforme o conteúdo, terminando com:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`

---

## Estrutura de arquivos

| Arquivo                                                 | Papel                                                                                                 | Tarefa |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------ |
| `apps/web/src/lib/transfer-format.ts`                   | +`formatSpeed`, +`formatDuration` (puras)                                                             | 1      |
| `apps/web/src/lib/transfer-format.test.ts`              | testes das duas funções novas                                                                         | 1      |
| `packages/transfer-engine/src/receiver.ts`              | `onCancelled?: (filesDone) => void` + passar `this.filesDone`                                         | 2      |
| `packages/transfer-engine/src/sender.ts`                | `onCancelled?: (filesDone) => void` + contador `filesDone`                                            | 2      |
| `packages/transfer-engine/src/receiver.test.ts`         | teste: `onCancelled` recebe a contagem                                                                | 2      |
| `packages/transfer-engine/src/sender.test.ts`           | teste: `onCancelled` recebe a contagem                                                                | 2      |
| `apps/web/src/lib/use-file-transfer.ts`                 | reshape da API + progresso por bytes + `filesSaved` + fases; depois velocidade/ETA/ticker             | 3, 4   |
| `apps/web/src/lib/use-file-transfer.test.ts`            | testes do progresso por bytes / cancelamento parcial / fases; depois velocidade/ETA com timers falsos | 3, 4   |
| `apps/web/src/components/transferir/SendPanel.tsx`      | update mecânico; depois barra por bytes, linha de status, mini-barra, tela `cancelled` parcial        | 3, 5   |
| `apps/web/src/components/transferir/SendPanel.test.tsx` | fixtures + testes de progresso/cancelamento                                                           | 3, 5   |
| `apps/web/src/components/s/ReceivePanel.tsx`            | espelho do `SendPanel`                                                                                | 3, 6   |
| `apps/web/src/components/s/ReceivePanel.test.tsx`       | fixtures + testes                                                                                     | 3, 6   |
| `apps/web/src/app/transferir/page.test.tsx`             | stub do mock de `useFileTransfer` com a nova forma                                                    | 3      |
| `apps/web/src/app/s/[token]/page.test.tsx`              | idem                                                                                                  | 3      |

Sem arquivos novos.

---

## Task 1: `formatSpeed` e `formatDuration` em `transfer-format.ts`

**Files:**

- Modify: `apps/web/src/lib/transfer-format.ts`
- Test: `apps/web/src/lib/transfer-format.test.ts`

**Interfaces:**

- Consumes: `formatBytes` (já existe no mesmo arquivo).
- Produces:
  - `export function formatSpeed(bytesPerSec: number): string` — `formatBytes(arredondado)` + `"/s"`. Ex.: `0 → "0 B/s"`, `820*1024 → "820 KB/s"`, `12.3*1024*1024 → "12,3 MB/s"`.
  - `export function formatDuration(seconds: number): string` — faixas: `<10 → "menos de 10 s"`; `<60 → "cerca de <n> s"` (n = múltiplo de 10 mais próximo); `<3600 → "cerca de <m> min"` (m = minutos arredondados, mínimo 1); `>=3600 → "mais de 1 h"`.

- [ ] **Step 1: Escrever os testes que falham**

Adicione ao fim de `apps/web/src/lib/transfer-format.test.ts` (o `import` no topo já traz de `./transfer-format.js` — inclua as duas funções novas nele):

```ts
import {
  formatBytes,
  formatDuration,
  formatSpeed,
  SIZE_CLASS_LABELS,
  summarizeBatch
} from "./transfer-format.js";
```

```ts
describe("formatSpeed", () => {
  it("reuses the byte scale with a /s suffix and a pt-BR comma", () => {
    expect(formatSpeed(0)).toBe("0 B/s");
    expect(formatSpeed(820 * 1024)).toBe("820 KB/s");
    expect(formatSpeed(12.3 * 1024 * 1024)).toBe("12,3 MB/s");
  });

  it("rounds fractional byte counts before formatting", () => {
    expect(formatSpeed(500.7)).toBe("501 B/s");
  });
});

describe("formatDuration", () => {
  it("uses coarse pt-BR buckets so the number does not jitter", () => {
    expect(formatDuration(5)).toBe("menos de 10 s");
    expect(formatDuration(10)).toBe("cerca de 10 s");
    expect(formatDuration(44)).toBe("cerca de 40 s");
    expect(formatDuration(95)).toBe("cerca de 2 min");
    expect(formatDuration(3600)).toBe("mais de 1 h");
    expect(formatDuration(4000)).toBe("mais de 1 h");
  });

  it("never shows '0 min' just below an hour", () => {
    expect(formatDuration(60)).toBe("cerca de 1 min");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @transfergo/web test -- src/lib/transfer-format.test.ts`
Expected: FAIL — `formatSpeed`/`formatDuration` não existem (erro de import / `is not a function`).

- [ ] **Step 3: Implementar**

Em `apps/web/src/lib/transfer-format.ts`, logo depois da função `formatBytes`:

```ts
/** Velocidade legível: reaproveita a escala de formatBytes e acrescenta "/s". */
export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(Math.round(bytesPerSec))}/s`;
}

/**
 * Tempo restante em faixas grosseiras, para o número não tremer a cada segundo.
 * Nunca é uma estimativa "exata" — o hook só chama isto quando a medição já
 * estabilizou (ver spec §4.4).
 */
export function formatDuration(seconds: number): string {
  if (seconds < 10) {
    return "menos de 10 s";
  }
  if (seconds < 60) {
    return `cerca de ${Math.round(seconds / 10) * 10} s`;
  }
  if (seconds < 3600) {
    return `cerca de ${Math.max(1, Math.round(seconds / 60))} min`;
  }
  return "mais de 1 h";
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @transfergo/web test -- src/lib/transfer-format.test.ts`
Expected: PASS (todos os `describe`, incluindo os do Plano 6).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/transfer-format.ts apps/web/src/lib/transfer-format.test.ts
git commit -m "feat(web): add formatSpeed and formatDuration pt-BR helpers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `onCancelled(filesDone)` no motor

**Files:**

- Modify: `packages/transfer-engine/src/receiver.ts` (interface `ReceiverCallbacks`; duas chamadas de `onCancelled`)
- Modify: `packages/transfer-engine/src/sender.ts` (interface `SenderCallbacks`; novo campo `filesDone`; duas chamadas de `onCancelled`)
- Test: `packages/transfer-engine/src/receiver.test.ts`, `packages/transfer-engine/src/sender.test.ts`

**Interfaces:**

- Consumes: nada novo.
- Produces:
  - `ReceiverCallbacks.onCancelled?: (filesDone: number) => void` — `filesDone` = arquivos fechados com `close()` antes do corte (o arquivo com sink aberto **não** conta; seu sink é abortado).
  - `SenderCallbacks.onCancelled?: (filesDone: number) => void` — `filesDone` = arquivos cujo `file-end` já foi emitido antes do corte.
  - Callers que passam `onCancelled` sem parâmetro continuam válidos (parâmetro extra num callback é compatível em TS).

- [ ] **Step 1: Escrever os testes que falham**

Em `packages/transfer-engine/src/receiver.test.ts`, adicione dentro do `describe("TransferReceiver", ...)`:

```ts
it("reports the count of fully-received files when cancelled mid-batch", async () => {
  const ch = new FakeChannel();
  const onCancelled = vi.fn();
  const receiver = new TransferReceiver(ch, () => Promise.resolve(new MemorySink()), {
    onCancelled
  });
  ch.feed(
    offer([meta({ id: "f1", size: 2 }), meta({ id: "f2", size: 2 }), meta({ id: "f3", size: 2 })])
  );
  receiver.accept();
  ch.feed(encodeControl({ t: "file-begin", id: "f1", offset: 0 }));
  await flush();
  ch.feed(new Uint8Array([1, 2]).buffer);
  ch.feed(encodeControl({ t: "file-end", id: "f1", bytesSent: 2 }));
  await flush();
  ch.feed(encodeControl({ t: "file-begin", id: "f2", offset: 0 }));
  await flush();
  ch.feed(encodeControl({ t: "cancel", scope: "batch" }));
  await flush();
  expect(onCancelled).toHaveBeenCalledWith(1);
});

it("reports 0 fully-received files when cancelled before any file-end", async () => {
  const ch = new FakeChannel();
  const onCancelled = vi.fn();
  const receiver = new TransferReceiver(ch, () => Promise.resolve(new MemorySink()), {
    onCancelled
  });
  ch.feed(offer([meta({ id: "f1", size: 2 })]));
  receiver.accept();
  ch.feed(encodeControl({ t: "file-begin", id: "f1", offset: 0 }));
  await flush();
  ch.feed(encodeControl({ t: "cancel", scope: "batch" }));
  await flush();
  expect(onCancelled).toHaveBeenCalledWith(0);
});
```

Em `packages/transfer-engine/src/sender.test.ts`, adicione dentro do `describe("TransferSender", ...)`:

```ts
it("reports the count of finished files when cancelled mid-batch", async () => {
  const ch = new FakeChannel();
  const onCancelled = vi.fn();
  let resolveRead: (buf: ArrayBuffer) => void = () => {};
  const gated = {
    size: 4,
    read: () =>
      new Promise<ArrayBuffer>((resolve) => {
        resolveRead = resolve;
      })
  };
  const sender = new TransferSender(
    ch,
    "b1",
    [
      { meta: meta({ id: "f1", size: 4 }), source: bytesSource(new Uint8Array([1, 2, 3, 4])) },
      { meta: meta({ id: "f2", size: 4 }), source: gated }
    ],
    { onCancelled },
    { chunkSize: 4 }
  );
  sender.start();
  ch.emitMessage(JSON.stringify({ t: "batch-accept" }));
  await flush(); // f1 completes, f2 parks inside source.read()
  sender.cancel();
  expect(onCancelled).toHaveBeenCalledWith(1);
  resolveRead(new Uint8Array(4).buffer); // let the parked read settle; no frame expected
  await flush();
});

it("reports 0 finished files when cancelled before the first file-end", async () => {
  const ch = new FakeChannel();
  const onCancelled = vi.fn();
  let resolveRead: (buf: ArrayBuffer) => void = () => {};
  const gated = {
    size: 4,
    read: () =>
      new Promise<ArrayBuffer>((resolve) => {
        resolveRead = resolve;
      })
  };
  const sender = new TransferSender(
    ch,
    "b1",
    [{ meta: meta({ id: "f1", size: 4 }), source: gated }],
    { onCancelled },
    { chunkSize: 4 }
  );
  sender.start();
  ch.emitMessage(JSON.stringify({ t: "batch-accept" }));
  await flush();
  sender.cancel();
  expect(onCancelled).toHaveBeenCalledWith(0);
  resolveRead(new Uint8Array(4).buffer);
  await flush();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @transfergo/transfer-engine test`
Expected: FAIL — os 4 testes novos: `onCancelled` foi chamado com `undefined`/sem argumento (`toHaveBeenCalledWith(1)` falha).

- [ ] **Step 3: Implementar no receptor**

`packages/transfer-engine/src/receiver.ts`:

Na interface `ReceiverCallbacks`, troque a linha do `onCancelled`:

```ts
  onCancelled?: (filesDone: number) => void;
```

No método `cancel()`, a linha `void this.currentSink?.abort().catch(() => undefined);` é seguida de `this.cb.onCancelled?.();` — troque para:

```ts
this.cb.onCancelled?.(this.filesDone);
```

No `handleControl`, `case "cancel":`, a única chamada `this.cb.onCancelled?.();` vira `this.cb.onCancelled?.(this.filesDone);`. O bloco fica:

```ts
      case "cancel": {
        void this.currentSink?.abort().catch(() => undefined);
        this.cb.onCancelled?.(this.filesDone);
        this.dispose();
        return;
      }
```

`this.filesDone` já é mantido pelo receptor (incrementado no `case "file-end"` após `close()`), então nada mais muda aqui.

- [ ] **Step 4: Implementar no emissor**

`packages/transfer-engine/src/sender.ts`:

Na interface `SenderCallbacks`, troque a linha do `onCancelled`:

```ts
  onCancelled?: (filesDone: number) => void;
```

Adicione um contador de instância junto dos outros campos privados (perto de `private lastProgressAt = 0;`):

```ts
  private filesDone = 0;
```

No `runBatch`, logo depois de `this.cb.onFileComplete?.(meta.id);`, incremente:

```ts
this.cb.onFileComplete?.(meta.id);
this.filesDone += 1;
```

No `cancel()`, troque `this.cb.onCancelled?.();` por:

```ts
this.cb.onCancelled?.(this.filesDone);
```

No `handleControl`, ramo `else if (frame.t === "cancel")`, troque `this.cb.onCancelled?.();` por:

```ts
this.cb.onCancelled?.(this.filesDone);
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @transfergo/transfer-engine test`
Expected: PASS — 34 testes anteriores + 4 novos. Os testes do Plano 6 que passam `onCancelled: vi.fn()` continuam válidos.

- [ ] **Step 6: Commit**

```bash
git add packages/transfer-engine/src/receiver.ts packages/transfer-engine/src/sender.ts packages/transfer-engine/src/receiver.test.ts packages/transfer-engine/src/sender.test.ts
git commit -m "feat(transfer-engine): pass filesDone to the onCancelled callback

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Reshape do hook — progresso por bytes, fases, `filesSaved`

Sem velocidade/ETA ainda (`stats` fica constante `{ speedBytesPerSec: null, etaSeconds: null }`). Esta tarefa muda a **forma** do `UseFileTransferResult` e propaga a mudança para painéis e stubs de teste, mantendo `typecheck` e `test` verdes.

**Files:**

- Modify: `apps/web/src/lib/use-file-transfer.ts`
- Modify: `apps/web/src/components/transferir/SendPanel.tsx` (update mecânico)
- Modify: `apps/web/src/components/s/ReceivePanel.tsx` (update mecânico)
- Modify: `apps/web/src/components/transferir/SendPanel.test.tsx` (fixtures + renomear fase)
- Modify: `apps/web/src/components/s/ReceivePanel.test.tsx` (fixtures + renomear fase)
- Modify: `apps/web/src/app/transferir/page.test.tsx` (stub do mock)
- Modify: `apps/web/src/app/s/[token]/page.test.tsx` (stub do mock)
- Test: `apps/web/src/lib/use-file-transfer.test.ts`

**Interfaces:**

- Consumes: `TransferProgress { batchId, fileId, fileBytes, fileSize, filesDone, filesTotal }` (motor, inalterado); `ReceiverCallbacks.onCancelled(filesDone)` / `SenderCallbacks.onCancelled(filesDone)` (Task 2).
- Produces — `UseFileTransferResult` passa a ter:
  - `phase: "idle" | "offering" | "preparing" | "sending" | "receiving" | "completed" | "cancelled" | "failed"`
  - `overall: { bytesDone: number; bytesTotal: number; filesDone: number; filesTotal: number }`
  - `perFile: Record<string, { bytes: number; size: number; pct: number; state: "queued" | "preparing" | "sending" | "receiving" | "completed" | "failed" }>`
  - `stats: { speedBytesPerSec: number | null; etaSeconds: number | null }`
  - `filesSaved: number`
  - demais campos inalterados (`ready`, `selectedFiles`, `totalBytes`, `limitError`, `addFiles`, `removeFile`, `clearSelection`, `startSend`, `incomingBatch`, `acceptBatch`, `rejectBatch`, `errorMessage`, `cancel`).

- [ ] **Step 1: Escrever os testes que falham (hook)**

Substitua o conteúdo de `apps/web/src/lib/use-file-transfer.test.ts` pelo abaixo (mantém os testes do Plano 6 que ainda fazem sentido, ajusta o stub do mock, e adiciona os novos). O ponto-chave: o `openSink` do mock agora devolve um sink que **aceita escritas**, para o `TransferReceiver` conseguir gravar e emitir progresso.

```ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const makeSink = () => ({
  write: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
  abort: vi.fn(() => Promise.resolve())
});

vi.mock("./browser-io.js", () => ({
  createFileChunkSource: (file: File) => ({
    size: file.size,
    read: () => Promise.resolve(new ArrayBuffer(0))
  }),
  adaptRtcDataChannel: (c: unknown) => c,
  isFileSystemAccessSupported: vi.fn(() => false),
  pickSaveTarget: vi.fn(() =>
    Promise.resolve({ kind: "download", openSink: vi.fn(() => Promise.resolve(makeSink())) })
  )
}));

import { isFileSystemAccessSupported } from "./browser-io.js";
import { useFileTransfer } from "./use-file-transfer.js";

class FakeChannel {
  sent: (string | ArrayBuffer)[] = [];
  bufferedAmount = 64 * 1024 * 1024;
  bufferedAmountLowThreshold = 0;
  private listeners: Record<string, ((e: { data?: unknown }) => void)[]> = {};
  send(d: string | ArrayBuffer) {
    this.sent.push(d);
  }
  addEventListener(t: string, l: (e: { data?: unknown }) => void) {
    (this.listeners[t] ??= []).push(l);
  }
  removeEventListener(t: string, l: (e: { data?: unknown }) => void) {
    this.listeners[t] = (this.listeners[t] ?? []).filter((x) => x !== l);
  }
  feed(data: unknown) {
    for (const l of this.listeners.message ?? []) l({ data });
  }
}

const bigFile = (name: string, size: number, type = "application/octet-stream") => {
  const f = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

const flush = () => new Promise((r) => setTimeout(r, 0));

let channel: FakeChannel;

beforeEach(() => {
  channel = new FakeChannel();
  (isFileSystemAccessSupported as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
});
afterEach(() => vi.clearAllMocks());

const renderTransfer = (role: "host" | "guest") =>
  renderHook(() =>
    useFileTransfer({
      role,
      dataChannel: channel as unknown as RTCDataChannel,
      channelState: "open"
    })
  );

const enc = (frame: unknown) => JSON.stringify(frame);
const offer = (files: { id: string; name: string; size: number; type: string }[], id = "b1") =>
  enc({ t: "batch-offer", batch: { id, files } });

// Drives the guest receiver through a real frame sequence. Returns after each
// caller-inserted `act`.
async function acceptAsGuest(
  result: { current: ReturnType<typeof useFileTransfer> },
  files: { id: string; name: string; size: number; type: string }[]
) {
  act(() => channel.feed(offer(files)));
  await act(async () => {
    await result.current.acceptBatch();
  });
}

describe("useFileTransfer — host limits (Plano 6, still valid)", () => {
  it("classifies added files and totals their bytes", () => {
    const { result } = renderTransfer("host");
    act(() => result.current.addFiles([bigFile("a.jpg", 5 * 1024 * 1024, "image/jpeg")]));
    expect(result.current.selectedFiles[0]).toMatchObject({ name: "a.jpg", sizeClass: "small" });
    expect(result.current.totalBytes).toBe(5 * 1024 * 1024);
  });

  it("sets a pt-BR limit error when the selection exceeds 5 GiB", () => {
    const { result } = renderTransfer("host");
    act(() => result.current.addFiles([bigFile("huge.bin", 6 * 1024 * 1024 * 1024)]));
    expect(result.current.limitError).toMatch(/limite por envio é 5 GB/i);
  });

  it("startSend sits in 'offering', then moves to 'preparing' on accept", () => {
    const { result } = renderTransfer("host");
    act(() => result.current.addFiles([bigFile("a.bin", 10)]));
    act(() => result.current.startSend());
    expect(result.current.phase).toBe("offering");
    act(() => channel.feed(enc({ t: "batch-accept" })));
    expect(result.current.phase).toBe("preparing");
  });

  it("maps a peer batch-reject to phase 'failed' with a pt-BR message", () => {
    const { result } = renderTransfer("host");
    act(() => result.current.addFiles([bigFile("a.bin", 10)]));
    act(() => result.current.startSend());
    act(() => channel.feed(enc({ t: "batch-reject", reason: "declined" })));
    expect(result.current.phase).toBe("failed");
    expect(result.current.errorMessage).toMatch(/recusou/i);
  });
});

describe("useFileTransfer — guest progress by bytes", () => {
  const files = [
    { id: "f1", name: "a.bin", size: 3, type: "" },
    { id: "f2", name: "b.bin", size: 2, type: "" }
  ];

  it("goes preparing → receiving and accumulates batch bytes across files", async () => {
    const { result } = renderTransfer("guest");
    await acceptAsGuest(result, files);
    expect(result.current.phase).toBe("preparing");
    expect(result.current.overall).toMatchObject({
      bytesDone: 0,
      bytesTotal: 5,
      filesDone: 0,
      filesTotal: 2
    });

    act(() => channel.feed(enc({ t: "file-begin", id: "f1", offset: 0 })));
    await flush();
    act(() => channel.feed(new Uint8Array([1, 2]).buffer));
    await flush();
    expect(result.current.phase).toBe("receiving");
    expect(result.current.overall.bytesDone).toBe(2);
    expect(result.current.perFile.f1).toMatchObject({
      bytes: 2,
      size: 3,
      pct: 67,
      state: "receiving"
    });

    act(() => channel.feed(new Uint8Array([3]).buffer));
    act(() => channel.feed(enc({ t: "file-end", id: "f1", bytesSent: 3 })));
    await flush();
    expect(result.current.overall).toMatchObject({ bytesDone: 3, filesDone: 1 });
    expect(result.current.perFile.f1).toMatchObject({ pct: 100, state: "completed" });

    act(() => channel.feed(enc({ t: "file-begin", id: "f2", offset: 0 })));
    await flush();
    act(() => channel.feed(new Uint8Array([4, 5]).buffer));
    act(() => channel.feed(enc({ t: "file-end", id: "f2", bytesSent: 2 })));
    act(() => channel.feed(enc({ t: "batch-complete" })));
    await flush();
    expect(result.current.phase).toBe("completed");
    expect(result.current.overall.bytesDone).toBe(5);
    expect(result.current.filesSaved).toBe(2);
  });

  it("on cancel mid-batch reports the partial count and a cancelled phase", async () => {
    const { result } = renderTransfer("guest");
    await acceptAsGuest(result, files);
    act(() => channel.feed(enc({ t: "file-begin", id: "f1", offset: 0 })));
    await flush();
    act(() => channel.feed(new Uint8Array([1, 2, 3]).buffer));
    act(() => channel.feed(enc({ t: "file-end", id: "f1", bytesSent: 3 })));
    await flush();
    await act(async () => {
      channel.feed(enc({ t: "cancel", scope: "batch" }));
      await flush();
    });
    expect(result.current.phase).toBe("cancelled");
    expect(result.current.filesSaved).toBe(1);
  });

  it("treats a 0-byte file as 100% once it ends", async () => {
    const { result } = renderTransfer("guest");
    await acceptAsGuest(result, [{ id: "f1", name: "empty", size: 0, type: "" }]);
    act(() => channel.feed(enc({ t: "file-begin", id: "f1", offset: 0 })));
    await flush();
    act(() => channel.feed(enc({ t: "file-end", id: "f1", bytesSent: 0 })));
    act(() => channel.feed(enc({ t: "batch-complete" })));
    await flush();
    expect(result.current.perFile.f1.pct).toBe(100);
    expect(result.current.phase).toBe("completed");
  });
});

describe("useFileTransfer — stats placeholder (Task 3)", () => {
  it("exposes a null stats object until Task 4 wires the math", () => {
    const { result } = renderTransfer("guest");
    expect(result.current.stats).toEqual({ speedBytesPerSec: null, etaSeconds: null });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @transfergo/web test -- src/lib/use-file-transfer.test.ts`
Expected: FAIL — `phase` nunca é `"preparing"`/`"receiving"`; `overall.bytesDone`/`bytesTotal`/`filesTotal` são `undefined`; `perFile.*.pct` `undefined`; `result.current.stats` `undefined`; `filesSaved` `undefined`.

- [ ] **Step 3: Reshape dos tipos no hook**

`apps/web/src/lib/use-file-transfer.ts`:

Troque `TransferPhase` e `PerFileStatus`, e adicione os tipos novos:

```ts
export type TransferPhase =
  | "idle"
  | "offering"
  | "preparing"
  | "sending"
  | "receiving"
  | "completed"
  | "cancelled"
  | "failed";

export type PerFileState =
  "queued" | "preparing" | "sending" | "receiving" | "completed" | "failed";

export interface PerFileStatus {
  bytes: number;
  size: number;
  pct: number;
  state: PerFileState;
}

export interface TransferOverall {
  bytesDone: number;
  bytesTotal: number;
  filesDone: number;
  filesTotal: number;
}

export interface TransferStats {
  speedBytesPerSec: number | null;
  etaSeconds: number | null;
}
```

No `UseFileTransferResult`, troque as três linhas e adicione duas:

```ts
phase: TransferPhase;
perFile: Record<string, PerFileStatus>;
overall: TransferOverall;
stats: TransferStats;
filesSaved: number;
```

Adicione, perto do topo do arquivo (depois de `ERROR_MESSAGES`):

```ts
const EMPTY_OVERALL: TransferOverall = { bytesDone: 0, bytesTotal: 0, filesDone: 0, filesTotal: 0 };
const EMPTY_STATS: TransferStats = { speedBytesPerSec: null, etaSeconds: null };
```

- [ ] **Step 4: Reshape do estado e do progresso no hook**

Ainda em `use-file-transfer.ts`, dentro de `useFileTransfer`:

Troque a declaração de `overall` e adicione `stats`/`filesSaved` e os refs do lote:

```ts
const [overall, setOverall] = useState<TransferOverall>(EMPTY_OVERALL);
const [stats] = useState<TransferStats>(EMPTY_STATS); // Task 4 troca por useState + setter
const [filesSaved, setFilesSaved] = useState(0);
```

```ts
// Ordem e tamanhos do lote em andamento — base do cálculo de bytes acumulados.
const batchFilesRef = useRef<{ id: string; size: number }[]>([]);
const batchBytesTotalRef = useRef(0);
// Arquivos concluídos (onFileComplete) no lote atual — usado para filesSaved.
const filesCompletedRef = useRef(0);
```

Troque `applyProgress`:

```ts
const applyProgress = useCallback(
  (p: TransferProgress) => {
    const files = batchFilesRef.current;
    const bytesInCompleted = files.slice(0, p.filesDone).reduce((s, f) => s + f.size, 0);
    const currentId = files[p.filesDone]?.id;
    const bytesDone = bytesInCompleted + (p.fileId === currentId ? p.fileBytes : 0);
    setOverall({
      bytesDone,
      bytesTotal: batchBytesTotalRef.current,
      filesDone: p.filesDone,
      filesTotal: p.filesTotal
    });
    const activeState: PerFileState = role === "host" ? "sending" : "receiving";
    setPerFile((prev) => ({
      ...prev,
      [p.fileId]: {
        bytes: p.fileBytes,
        size: p.fileSize,
        pct: p.fileSize === 0 ? 100 : Math.min(100, Math.round((p.fileBytes / p.fileSize) * 100)),
        state: p.fileBytes >= p.fileSize ? "completed" : activeState
      }
    }));
    setPhase((cur) => (cur === "preparing" ? activeState : cur));
  },
  [role]
);
```

Troque `wireCommon` (o `onFileComplete` agora conta; `onBatchComplete`/`onError`/`onCancelled` gravam `filesSaved`):

```ts
const wireCommon = useMemo(
  () => ({
    onProgress: applyProgress,
    onFileComplete: (fileId: string) => {
      filesCompletedRef.current += 1;
      setFilesSaved(filesCompletedRef.current);
      setPerFile((prev) => ({
        ...prev,
        [fileId]: { ...prev[fileId]!, pct: 100, state: "completed" }
      }));
    },
    onBatchComplete: () => {
      setFilesSaved(batchFilesRef.current.length);
      setPhase("completed");
    },
    onError: (e: TransferError) => {
      setFilesSaved(filesCompletedRef.current);
      setPhase("failed");
      setErrorMessage(ERROR_MESSAGES[e.code] ?? "A transferência falhou.");
    },
    onCancelled: (filesDone: number) => {
      setFilesSaved(Math.min(filesDone, filesCompletedRef.current));
      setPhase((current) => (current === "completed" ? current : "cancelled"));
    }
  }),
  [applyProgress]
);
```

No efeito do convidado (guest), o wrapper de `onCancelled` precisa repassar o argumento; e o `onBatchOffered` zera o estado do lote anterior antes de aceitar o próximo:

```ts
        onCancelled: (filesDone: number) => {
          wireCommon.onCancelled(filesDone);
          rearm();
        },
```

```ts
onBatchOffered: (offer) => {
  setErrorMessage(null);
  setFilesSaved(0);
  filesCompletedRef.current = 0;
  setPerFile({});
  setOverall(EMPTY_OVERALL);
  setPhase("idle");
  setIncomingBatch({
    files: offer.files,
    totalBytes: offer.totalBytes,
    summary: summarizeBatch(offer.files),
    requiresMemoryWarning:
      !isFileSystemAccessSupported() &&
      offer.files.some((f) => classifyFileSize(f.size) === "large")
  });
};
```

Em `clearSelection`, troque o reset de `overall` e some `filesSaved`/contador:

```ts
const clearSelection = useCallback(() => {
  fileMapRef.current.clear();
  setSelectedFiles([]);
  setPerFile({});
  setOverall(EMPTY_OVERALL);
  setFilesSaved(0);
  filesCompletedRef.current = 0;
  setErrorMessage(null);
  setPhase("idle");
}, []);
```

Em `startSend`, prepare os refs do lote, o `overall` por bytes, e mude a fase de aceite para `preparing`:

```ts
setPerFile(
  Object.fromEntries(
    selectedFiles.map((f) => [f.id, { bytes: 0, size: f.size, pct: 0, state: "queued" as const }])
  )
);
batchFilesRef.current = selectedFiles.map((f) => ({ id: f.id, size: f.size }));
batchBytesTotalRef.current = totalBytes;
filesCompletedRef.current = 0;
setFilesSaved(0);
setOverall({
  bytesDone: 0,
  bytesTotal: totalBytes,
  filesDone: 0,
  filesTotal: selectedFiles.length
});
setErrorMessage(null);
const sender = new TransferSender(adaptRtcDataChannel(dataChannel), nextId("batch"), inputs, {
  ...wireCommon,
  onAccepted: () => setPhase("preparing")
});
senderRef.current = sender;
setPhase("offering");
sender.start();
```

(`startSend` já depende de `selectedFiles`; adicione `totalBytes` à lista de deps do `useCallback`.)

Em `acceptBatch`, idem, depois de `openSinkRef.current = target.openSink;`:

```ts
openSinkRef.current = target.openSink;
setPerFile(
  Object.fromEntries(
    incomingBatch.files.map((f) => [
      f.id,
      { bytes: 0, size: f.size, pct: 0, state: "queued" as const }
    ])
  )
);
batchFilesRef.current = incomingBatch.files.map((f) => ({ id: f.id, size: f.size }));
batchBytesTotalRef.current = incomingBatch.totalBytes;
filesCompletedRef.current = 0;
setFilesSaved(0);
setOverall({
  bytesDone: 0,
  bytesTotal: incomingBatch.totalBytes,
  filesDone: 0,
  filesTotal: incomingBatch.files.length
});
setPhase("preparing");
receiverRef.current.accept();
```

No `return` do hook, adicione `stats` e `filesSaved`:

```ts
(phase, perFile, overall, stats, filesSaved, errorMessage, cancel);
```

- [ ] **Step 5: Update mecânico dos painéis**

`apps/web/src/components/transferir/SendPanel.tsx`:

- A condição da tela de progresso: troque `if (phase === "offering" || phase === "transferring") {` por
  `if (phase === "offering" || phase === "preparing" || phase === "sending") {`.
- O cabeçalho dentro dela: troque o `<p>` do topo por:

```tsx
<p className="mb-4 text-center text-sm font-medium text-text">
  {phase === "offering"
    ? "Aguardando o outro lado aceitar…"
    : phase === "preparing"
      ? "Preparando a transferência…"
      : `Enviando ${transfer.overall.filesDone} de ${transfer.overall.filesTotal}…`}
</p>
```

- A `ProgressBar` e seu guard: troque `transfer.overall.total > 0` por `transfer.overall.filesTotal > 0` e
  `value={(transfer.overall.done / transfer.overall.total) * 100}` por
  `value={transfer.overall.filesTotal > 0 ? (transfer.overall.filesDone / transfer.overall.filesTotal) * 100 : 0}`.
- Na lista de arquivos dessa tela, o rótulo de estado: troque `status === "active" ? "Enviando"` por
  `status === "sending" ? "Enviando"`.
- Na tela `phase === "completed"`: troque `const n = transfer.overall.total;` por `const n = transfer.overall.filesTotal;`.

`apps/web/src/components/s/ReceivePanel.tsx`:

- Troque `if (phase === "transferring") {` por `if (phase === "preparing" || phase === "receiving") {`.
- Cabeçalho:

```tsx
<p className="mb-4 text-center text-sm font-medium text-text">
  {phase === "preparing"
    ? "Preparando a transferência…"
    : `Recebendo ${transfer.overall.filesDone} de ${transfer.overall.filesTotal}…`}
</p>
```

- `ProgressBar`: `transfer.overall.total > 0` → `transfer.overall.filesTotal > 0`;
  `value={(transfer.overall.done / transfer.overall.total) * 100}` →
  `value={transfer.overall.filesTotal > 0 ? (transfer.overall.filesDone / transfer.overall.filesTotal) * 100 : 0}`.
- Rótulo de estado: `status === "active" ? "Recebendo"` → `status === "receiving" ? "Recebendo"`.
- Tela `completed`: `const n = transfer.overall.total;` → `const n = transfer.overall.filesTotal;`.

- [ ] **Step 6: Update das fixtures e stubs de teste**

`apps/web/src/components/transferir/SendPanel.test.tsx` e `apps/web/src/components/s/ReceivePanel.test.tsx` — no objeto `base`, troque a linha do `overall` e adicione duas:

```ts
  overall: { bytesDone: 0, bytesTotal: 0, filesDone: 0, filesTotal: 0 },
  stats: { speedBytesPerSec: null, etaSeconds: null },
  filesSaved: 0,
```

No `SendPanel.test.tsx`, o teste "shows the progress header while transferring": troque para

```ts
  it("shows the progress header while sending", () => {
    render(
      <SendPanel
        transfer={withOverrides({
          phase: "sending",
          overall: { bytesDone: 0, bytesTotal: 0, filesDone: 3, filesTotal: 5 },
          selectedFiles: [{ id: "f1", name: "a.bin", size: 10, type: "", sizeClass: "small" }],
          perFile: { f1: { bytes: 10, size: 10, pct: 100, state: "completed" } }
        })}
      />
    );
    expect(screen.getByText("Enviando 3 de 5…")).toBeInTheDocument();
  });
```

E "shows the success screen when completed": troque `overall: { done: 2, total: 2 }` por
`overall: { bytesDone: 0, bytesTotal: 0, filesDone: 2, filesTotal: 2 }`.

No `ReceivePanel.test.tsx`, análogo: "shows the progress header while transferring" →

```ts
  it("shows the progress header while receiving", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({ phase: "receiving", overall: { bytesDone: 0, bytesTotal: 0, filesDone: 2, filesTotal: 4 } })}
      />
    );
    expect(screen.getByText("Recebendo 2 de 4…")).toBeInTheDocument();
  });
```

E "shows the success screen when completed": `overall: { done: 3, total: 3 }` →
`overall: { bytesDone: 0, bytesTotal: 0, filesDone: 3, filesTotal: 3 }`.

`apps/web/src/app/transferir/page.test.tsx` e `apps/web/src/app/s/[token]/page.test.tsx` — no objeto retornado pelo mock de `useFileTransfer`, troque a linha `overall: { done: 0, total: 0 },` por:

```ts
      overall: { bytesDone: 0, bytesTotal: 0, filesDone: 0, filesTotal: 0 },
      stats: { speedBytesPerSec: null, etaSeconds: null },
      filesSaved: 0,
```

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @transfergo/web test`
Expected: PASS — todos os testes de `apps/web`, incluindo os novos do hook.

Run: `pnpm --filter @transfergo/web typecheck`
Expected: PASS — sem erros de tipo (a forma nova do `UseFileTransferResult` bate em todos os consumidores).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/use-file-transfer.ts apps/web/src/lib/use-file-transfer.test.ts apps/web/src/components/transferir/SendPanel.tsx apps/web/src/components/transferir/SendPanel.test.tsx apps/web/src/components/s/ReceivePanel.tsx apps/web/src/components/s/ReceivePanel.test.tsx "apps/web/src/app/transferir/page.test.tsx" "apps/web/src/app/s/[token]/page.test.tsx"
git commit -m "feat(web): byte-based transfer progress, richer phases, filesSaved

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Velocidade e tempo restante no hook

**Files:**

- Modify: `apps/web/src/lib/use-file-transfer.ts`
- Test: `apps/web/src/lib/use-file-transfer.test.ts`

**Interfaces:**

- Consumes: `overall.bytesDone`/`bytesTotal` e os refs `batchBytesTotalRef` (Task 3); o `phase` `"sending"`/`"receiving"`.
- Produces: `stats.speedBytesPerSec` e `stats.etaSeconds` deixam de ser sempre `null` — passam a refletir a medição descrita na spec §4. `null` continua significando "ainda não dá para dizer".

- [ ] **Step 1: Escrever os testes que falham (timers falsos)**

Adicione ao fim de `apps/web/src/lib/use-file-transfer.test.ts`:

```ts
describe("useFileTransfer — speed and ETA", () => {
  const files = [{ id: "f1", name: "big.bin", size: 1_000_000, type: "" }];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Feeds a 16 KiB binary chunk and lets the engine's throttled progress through.
  const pump = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      await act(async () => {
        vi.advanceTimersByTime(250);
        channel.feed(new Uint8Array(16 * 1024).buffer);
        await Promise.resolve();
      });
    }
  };

  it("holds speed at null until the sample span reaches 1s, then reports a stable value", async () => {
    const { result } = renderTransfer("guest");
    await act(async () => {
      channel.feed(offer(files));
      await result.current.acceptBatch();
    });
    await act(async () => {
      channel.feed(enc({ t: "file-begin", id: "f1", offset: 0 }));
      await Promise.resolve();
    });

    await pump(3); // ~750ms of samples
    expect(result.current.stats.speedBytesPerSec).toBeNull();

    await pump(4); // now well past 1s
    const speed = result.current.stats.speedBytesPerSec;
    expect(speed).not.toBeNull();
    // 16 KiB per 250ms ≈ 65536 B/s, within a wide tolerance
    expect(speed!).toBeGreaterThan(30_000);
    expect(speed!).toBeLessThan(120_000);
  });

  it("holds ETA at null before 3s of transfer, then reports a finite estimate", async () => {
    const { result } = renderTransfer("guest");
    await act(async () => {
      channel.feed(offer(files));
      await result.current.acceptBatch();
    });
    await act(async () => {
      channel.feed(enc({ t: "file-begin", id: "f1", offset: 0 }));
      await Promise.resolve();
    });

    await pump(8); // ~2s
    expect(result.current.stats.etaSeconds).toBeNull();

    await pump(6); // past 3s
    const eta = result.current.stats.etaSeconds;
    expect(eta).not.toBeNull();
    expect(Number.isFinite(eta!)).toBe(true);
    expect(eta!).toBeGreaterThan(0);
  });

  it("decays speed toward zero and drops ETA when the channel stalls", async () => {
    const { result } = renderTransfer("guest");
    await act(async () => {
      channel.feed(offer(files));
      await result.current.acceptBatch();
    });
    await act(async () => {
      channel.feed(enc({ t: "file-begin", id: "f1", offset: 0 }));
      await Promise.resolve();
    });
    await pump(16); // steady flow past 3s
    const movingSpeed = result.current.stats.speedBytesPerSec!;
    expect(movingSpeed).toBeGreaterThan(0);

    // No more feeds. The 1s ticker keeps recomputing against a growing "now".
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    expect(result.current.stats.speedBytesPerSec!).toBeLessThan(movingSpeed);
    expect(result.current.stats.etaSeconds).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @transfergo/web test -- src/lib/use-file-transfer.test.ts`
Expected: FAIL — `stats.speedBytesPerSec`/`etaSeconds` são sempre `null` (o `toBeGreaterThan` e o `not.toBeNull` falham).

- [ ] **Step 3: Implementar o cálculo**

`apps/web/src/lib/use-file-transfer.ts`:

No topo do arquivo, junto das outras constantes de módulo:

```ts
const SPEED_WINDOW_MS = 5000;
const SPEED_MIN_SPAN_MS = 1000;
const ETA_MIN_ELAPSED_MS = 3000;
const STATS_TICK_MS = 1000;

const monotonicNow = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
```

Troque `const [stats] = useState<TransferStats>(EMPTY_STATS);` por:

```ts
const [stats, setStats] = useState<TransferStats>(EMPTY_STATS);
```

Adicione os refs de amostragem junto de `batchFilesRef` etc.:

```ts
const samplesRef = useRef<{ t: number; bytes: number }[]>([]);
const startedAtRef = useRef<number | null>(null);
```

Adicione `recomputeStats` e `resetStats` (antes de `applyProgress`):

```ts
const recomputeStats = useCallback(() => {
  const buf = samplesRef.current;
  const nowT = monotonicNow();
  // Descarta amostras fora da janela, sempre deixando pelo menos 2.
  while (buf.length > 2 && nowT - buf[1]!.t > SPEED_WINDOW_MS) {
    buf.shift();
  }
  if (buf.length < 2 || startedAtRef.current == null) {
    setStats(EMPTY_STATS);
    return;
  }
  const oldest = buf[0]!;
  const newest = buf[buf.length - 1]!;
  // Span medido contra AGORA (não contra a última amostra): numa travada,
  // "agora" cresce, o span cresce e a velocidade decai sozinha.
  const span = nowT - oldest.t;
  let speed: number | null;
  if (span < SPEED_MIN_SPAN_MS) {
    speed = null;
  } else {
    speed = (Math.max(0, newest.bytes - oldest.bytes) / span) * 1000;
  }
  const elapsed = nowT - startedAtRef.current;
  const remaining = Math.max(0, batchBytesTotalRef.current - newest.bytes);
  let eta: number | null;
  if (speed == null || speed <= 0 || elapsed < ETA_MIN_ELAPSED_MS || buf.length < 3) {
    eta = null;
  } else {
    eta = remaining / speed;
  }
  setStats({ speedBytesPerSec: speed, etaSeconds: eta });
}, []);

const resetStats = useCallback(() => {
  samplesRef.current = [];
  startedAtRef.current = null;
  setStats(EMPTY_STATS);
}, []);
```

Em `applyProgress`, depois de `setOverall({ ... })`, registre a amostra e recalcule:

```ts
const sampleT = monotonicNow();
startedAtRef.current ??= sampleT;
samplesRef.current.push({ t: sampleT, bytes: bytesDone });
recomputeStats();
```

(adicione `recomputeStats` às deps do `useCallback` de `applyProgress`.)

Adicione o ticker de decaimento (depois do efeito de unmount):

```ts
// Enquanto os bytes andam, recalcula 1x/s mesmo sem evento novo — assim uma
// travada de canal faz a velocidade cair para ~0 em vez de congelar.
useEffect(() => {
  if (phase !== "sending" && phase !== "receiving") {
    return;
  }
  const id = setInterval(recomputeStats, STATS_TICK_MS);
  return () => clearInterval(id);
}, [phase, recomputeStats]);
```

Em `startSend`, `acceptBatch`, `clearSelection` e no `onBatchOffered` do efeito guest, chame `resetStats()` no mesmo ponto em que já se zera `filesSaved`/`filesCompletedRef`. Exemplos:

- `startSend`: depois de `setFilesSaved(0);` → `resetStats();`
- `acceptBatch`: depois de `setFilesSaved(0);` → `resetStats();`
- `clearSelection`: depois de `filesCompletedRef.current = 0;` → `resetStats();`
- `onBatchOffered` (guest): depois de `setOverall(EMPTY_OVERALL);` → `resetStats();`

(`clearSelection`, `startSend` e `acceptBatch` ganham `resetStats` nas deps dos respectivos `useCallback`; o efeito guest ganha `resetStats` nas deps — como é `useCallback` estável, não recria o receptor à toa.)

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @transfergo/web test -- src/lib/use-file-transfer.test.ts`
Expected: PASS — os 3 testes novos + todos os da Task 3.

Se algum teste da Task 3 quebrar por causa de `vi.useFakeTimers` vazando: confirme que o novo `describe` chama `vi.useRealTimers()` no `afterEach`. Os `describe` anteriores não usam timers falsos.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/use-file-transfer.ts apps/web/src/lib/use-file-transfer.test.ts
git commit -m "feat(web): rolling-window transfer speed and stabilized ETA

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `SendPanel` — barra por bytes, linha de status, mini-barra, cancelamento parcial

**Files:**

- Modify: `apps/web/src/components/transferir/SendPanel.tsx`
- Test: `apps/web/src/components/transferir/SendPanel.test.tsx`

**Interfaces:**

- Consumes: `transfer.overall` (`bytesDone`/`bytesTotal`/`filesDone`/`filesTotal`), `transfer.stats`, `transfer.filesSaved`, `transfer.perFile[id].{pct,state}`, `formatBytes`/`formatSpeed`/`formatDuration`.
- Produces: nada para outras tarefas (folha da árvore).

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/web/src/components/transferir/SendPanel.test.tsx`, ajuste o `import` para trazer `formatSpeed`/`formatDuration` não é necessário (o painel importa). Adicione:

```ts
  it("shows the byte progress, speed and ETA while sending", () => {
    const GiB = 1024 * 1024 * 1024;
    render(
      <SendPanel
        transfer={withOverrides({
          phase: "sending",
          // formatBytes(1.5*GiB) === "1,5 GB"; formatBytes(3*GiB) === "3 GB"
          overall: { bytesDone: 1.5 * GiB, bytesTotal: 3 * GiB, filesDone: 1, filesTotal: 5 },
          // formatSpeed(12.3*MiB) === "12,3 MB/s"; formatDuration(130) === "cerca de 2 min"
          stats: { speedBytesPerSec: 12.3 * 1024 * 1024, etaSeconds: 130 },
          selectedFiles: [
            { id: "f1", name: "a.mp4", size: 1e9, type: "video/mp4", sizeClass: "large" },
            { id: "f2", name: "b.zip", size: 2e9, type: "", sizeClass: "large" }
          ],
          perFile: {
            f1: { bytes: 6e8, size: 1e9, pct: 60, state: "sending" },
            f2: { bytes: 0, size: 2e9, pct: 0, state: "queued" }
          }
        })}
      />
    );
    expect(screen.getByText("Enviando arquivo 2 de 5")).toBeInTheDocument();
    expect(screen.getByText(/1,5 GB de 3 GB/)).toBeInTheDocument();
    expect(screen.getByText(/12,3 MB\/s/)).toBeInTheDocument();
    expect(screen.getByText(/cerca de 2 min/)).toBeInTheDocument();
    // barrinha só no arquivo ativo (a ProgressBar com label rende "<n>%")
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("Na fila")).toBeInTheDocument();
  });

  it("shows 'calculando…' when speed and ETA are both null", () => {
    render(
      <SendPanel
        transfer={withOverrides({
          phase: "sending",
          overall: { bytesDone: 1024, bytesTotal: 4096, filesDone: 0, filesTotal: 1 },
          stats: { speedBytesPerSec: null, etaSeconds: null },
          selectedFiles: [{ id: "f1", name: "a.bin", size: 4096, type: "", sizeClass: "small" }],
          perFile: { f1: { bytes: 1024, size: 4096, pct: 25, state: "sending" } }
        })}
      />
    );
    expect(screen.getByText(/calculando…/)).toBeInTheDocument();
  });

  it("with a single file uses the name in the header and shows no per-file mini bar", () => {
    render(
      <SendPanel
        transfer={withOverrides({
          phase: "sending",
          overall: { bytesDone: 512, bytesTotal: 1024, filesDone: 0, filesTotal: 1 },
          stats: { speedBytesPerSec: 1024, etaSeconds: null },
          selectedFiles: [{ id: "f1", name: "solo.bin", size: 1024, type: "", sizeClass: "small" }],
          perFile: { f1: { bytes: 512, size: 1024, pct: 50, state: "sending" } }
        })}
      />
    );
    expect(screen.getByText("Enviando solo.bin")).toBeInTheDocument();
    expect(screen.queryByText("50%")).not.toBeInTheDocument();
  });

  it("shows the partial count on the cancelled screen", () => {
    render(
      <SendPanel
        transfer={withOverrides({
          phase: "cancelled",
          filesSaved: 3,
          overall: { bytesDone: 0, bytesTotal: 0, filesDone: 3, filesTotal: 5 }
        })}
      />
    );
    expect(screen.getByText("3 de 5 arquivos chegaram.")).toBeInTheDocument();
  });

  it("says nothing arrived when filesSaved is 0 on cancel", () => {
    render(
      <SendPanel
        transfer={withOverrides({ phase: "cancelled", filesSaved: 0, overall: { bytesDone: 0, bytesTotal: 0, filesDone: 0, filesTotal: 5 } })}
      />
    );
    expect(screen.getByText("Nenhum arquivo chegou.")).toBeInTheDocument();
  });

  it("shows the preparing message", () => {
    render(<SendPanel transfer={withOverrides({ phase: "preparing", overall: { bytesDone: 0, bytesTotal: 0, filesDone: 0, filesTotal: 3 } })} />);
    expect(screen.getByText("Preparando a transferência…")).toBeInTheDocument();
  });
```

Os literais de `formatBytes` nos asserts já estão conferidos: `formatBytes(1.5*GiB)` → `"1,5 GB"` (não inteiro → arredonda para 1 casa, vírgula pt-BR); `formatBytes(3*GiB)` → `"3 GB"` (inteiro).

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @transfergo/web test -- src/components/transferir/SendPanel.test.tsx`
Expected: FAIL — sem linha de status, sem "arquivo N de M", sem "calculando…", tela `cancelled` ainda genérica ("O envio foi interrompido.").

- [ ] **Step 3: Implementar**

`apps/web/src/components/transferir/SendPanel.tsx`:

Atualize o import de `transfer-format`:

```tsx
import {
  formatBytes,
  formatDuration,
  formatSpeed,
  SIZE_CLASS_LABELS
} from "../../lib/transfer-format.js";
```

Troque a tela `phase === "cancelled"`:

```tsx
if (phase === "cancelled") {
  const saved = transfer.filesSaved;
  const total = transfer.overall.filesTotal;
  return (
    <StateScreen
      icon={AlertTriangle}
      tone="warning"
      title="Transferência cancelada"
      description={
        saved === 0 ? "Nenhum arquivo chegou." : `${saved} de ${total} arquivos chegaram.`
      }
      actions={[{ label: "Nova transferência", onClick: transfer.clearSelection }]}
    />
  );
}
```

Troque todo o bloco `if (phase === "offering" || phase === "preparing" || phase === "sending") { ... }` por:

```tsx
if (phase === "offering" || phase === "preparing" || phase === "sending") {
  const { overall, stats } = transfer;
  const multi = overall.filesTotal > 1;
  const currentIndex = Math.min(overall.filesDone + 1, overall.filesTotal);
  const activeName = transfer.selectedFiles[overall.filesDone]?.name ?? "";
  const bytesPct = overall.bytesTotal > 0 ? (overall.bytesDone / overall.bytesTotal) * 100 : 0;

  const statusParts: string[] = [
    `${formatBytes(overall.bytesDone)} de ${formatBytes(overall.bytesTotal)}`
  ];
  if (stats.speedBytesPerSec === 0) {
    statusParts.push("parado");
  } else if (stats.speedBytesPerSec != null) {
    statusParts.push(formatSpeed(stats.speedBytesPerSec));
  }
  if (stats.etaSeconds != null) {
    statusParts.push(formatDuration(stats.etaSeconds));
  }
  if (stats.speedBytesPerSec == null && stats.etaSeconds == null) {
    statusParts.push("calculando…");
  }

  return (
    <div className="w-full max-w-md">
      <p className="mb-2 text-center text-sm font-medium text-text">
        {phase === "offering"
          ? "Aguardando o outro lado aceitar…"
          : phase === "preparing"
            ? "Preparando a transferência…"
            : multi
              ? `Enviando arquivo ${currentIndex} de ${overall.filesTotal}`
              : `Enviando ${activeName}`}
      </p>

      {phase === "sending" && (
        <>
          <ProgressBar className="mb-1" value={bytesPct} label="Progresso" />
          <p className="mb-4 text-center text-xs text-text-muted">{statusParts.join(" · ")}</p>
        </>
      )}

      <ul className="flex flex-col gap-2">
        {transfer.selectedFiles.map((file) => {
          const pf = transfer.perFile[file.id];
          const state = pf?.state ?? "queued";
          const label =
            state === "completed"
              ? "Concluído"
              : state === "sending"
                ? "Enviando"
                : state === "failed"
                  ? "Falhou"
                  : "Na fila";
          return (
            <li key={file.id} className="rounded-lg border border-border px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 truncate">
                  <FileText className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
                  <span className="truncate">{file.name}</span>
                </span>
                <span className="ml-3 shrink-0 text-text-muted">{label}</span>
              </div>
              {multi && state === "sending" && pf && (
                <ProgressBar className="mt-2" value={pf.pct} label={file.name} />
              )}
            </li>
          );
        })}
      </ul>

      <Button className="mt-4 w-full" variant="secondary" onClick={transfer.cancel}>
        Cancelar
      </Button>
    </div>
  );
}
```

Observações:

- A `ProgressBar` com `label` renderiza `label` à esquerda e `<n>%` à direita — é o que faz `screen.getByText("60%")` passar para a mini-barra (a `pct` do arquivo ativo) e `screen.getByText("50%")` **não** existir quando `multi` é `false`.
- A barra geral usa `label="Progresso"`, então mostra a % dos bytes. Se algum teste do Plano 6 dependia de "Progresso" ausente, não há — o Plano 6 já usava `label="Progresso"`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @transfergo/web test -- src/components/transferir/SendPanel.test.tsx`
Expected: PASS — os testes novos + os do Plano 6 ajustados na Task 3.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/transferir/SendPanel.tsx apps/web/src/components/transferir/SendPanel.test.tsx
git commit -m "feat(web): SendPanel shows byte progress, speed, ETA and partial cancel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: `ReceivePanel` — espelho, e portão completo

**Files:**

- Modify: `apps/web/src/components/s/ReceivePanel.tsx`
- Test: `apps/web/src/components/s/ReceivePanel.test.tsx`

**Interfaces:**

- Consumes: igual à Task 5.
- Produces: nada.

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/web/src/components/s/ReceivePanel.test.tsx`, adicione:

```ts
  it("shows byte progress, speed and ETA while receiving", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({
          phase: "receiving",
          overall: { bytesDone: 512 * 1024, bytesTotal: 1024 * 1024, filesDone: 0, filesTotal: 3 },
          stats: { speedBytesPerSec: 256 * 1024, etaSeconds: 20 },
          incomingBatch: {
            files: [
              { id: "f1", name: "a.bin", size: 512 * 1024, type: "" },
              { id: "f2", name: "b.bin", size: 512 * 1024, type: "" }
            ],
            totalBytes: 1024 * 1024,
            summary: "",
            requiresMemoryWarning: false
          },
          perFile: {
            f1: { bytes: 512 * 1024, size: 512 * 1024, pct: 100, state: "completed" },
            f2: { bytes: 0, size: 512 * 1024, pct: 0, state: "queued" }
          }
        })}
      />
    );
    expect(screen.getByText("Recebendo arquivo 1 de 3")).toBeInTheDocument();
    expect(screen.getByText(/512 KB de 1 MB/)).toBeInTheDocument();
    expect(screen.getByText(/256 KB\/s/)).toBeInTheDocument();
    expect(screen.getByText(/cerca de 20 s/)).toBeInTheDocument();
  });

  it("shows 'calculando…' when stats are null", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({
          phase: "receiving",
          overall: { bytesDone: 10, bytesTotal: 100, filesDone: 0, filesTotal: 1 },
          stats: { speedBytesPerSec: null, etaSeconds: null },
          incomingBatch: { files: [{ id: "f1", name: "a", size: 100, type: "" }], totalBytes: 100, summary: "", requiresMemoryWarning: false },
          perFile: { f1: { bytes: 10, size: 100, pct: 10, state: "receiving" } }
        })}
      />
    );
    expect(screen.getByText(/calculando…/)).toBeInTheDocument();
  });

  it("shows the preparing message", () => {
    render(<ReceivePanel transfer={withOverrides({ phase: "preparing", overall: { bytesDone: 0, bytesTotal: 0, filesDone: 0, filesTotal: 2 } })} />);
    expect(screen.getByText("Preparando a transferência…")).toBeInTheDocument();
  });

  it("shows the partial count on the cancelled screen", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({ phase: "cancelled", filesSaved: 2, overall: { bytesDone: 0, bytesTotal: 0, filesDone: 2, filesTotal: 4 } })}
      />
    );
    expect(screen.getByText("2 de 4 arquivos foram salvos neste dispositivo.")).toBeInTheDocument();
  });

  it("says nothing was saved when filesSaved is 0 on cancel", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({ phase: "cancelled", filesSaved: 0, overall: { bytesDone: 0, bytesTotal: 0, filesDone: 0, filesTotal: 4 } })}
      />
    );
    expect(screen.getByText("Nenhum arquivo foi salvo.")).toBeInTheDocument();
  });
```

(Confirme `formatBytes(512*1024)` → `"512 KB"` e `formatBytes(1024*1024)` → `"1 MB"` — ambos inteiros, sem vírgula.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @transfergo/web test -- src/components/s/ReceivePanel.test.tsx`
Expected: FAIL — sem linha de status / "arquivo N de M" / tela `cancelled` parcial.

- [ ] **Step 3: Implementar**

`apps/web/src/components/s/ReceivePanel.tsx`:

Import:

```tsx
import { formatBytes, formatDuration, formatSpeed } from "../../lib/transfer-format.js";
```

Troque a tela `phase === "cancelled"`:

```tsx
if (phase === "cancelled") {
  const saved = transfer.filesSaved;
  const total = transfer.overall.filesTotal;
  return (
    <StateScreen
      icon={AlertTriangle}
      tone="warning"
      title="Transferência cancelada"
      description={
        saved === 0
          ? "Nenhum arquivo foi salvo."
          : `${saved} de ${total} arquivos foram salvos neste dispositivo.`
      }
    />
  );
}
```

Troque o bloco `if (phase === "preparing" || phase === "receiving") { ... }` por:

```tsx
if (phase === "preparing" || phase === "receiving") {
  const { overall, stats } = transfer;
  const multi = overall.filesTotal > 1;
  const currentIndex = Math.min(overall.filesDone + 1, overall.filesTotal);
  const activeName = incomingBatch?.files[overall.filesDone]?.name ?? "";
  const bytesPct = overall.bytesTotal > 0 ? (overall.bytesDone / overall.bytesTotal) * 100 : 0;

  const statusParts: string[] = [
    `${formatBytes(overall.bytesDone)} de ${formatBytes(overall.bytesTotal)}`
  ];
  if (stats.speedBytesPerSec === 0) {
    statusParts.push("parado");
  } else if (stats.speedBytesPerSec != null) {
    statusParts.push(formatSpeed(stats.speedBytesPerSec));
  }
  if (stats.etaSeconds != null) {
    statusParts.push(formatDuration(stats.etaSeconds));
  }
  if (stats.speedBytesPerSec == null && stats.etaSeconds == null) {
    statusParts.push("calculando…");
  }

  return (
    <div className="w-full max-w-md">
      <p className="mb-2 text-center text-sm font-medium text-text">
        {phase === "preparing"
          ? "Preparando a transferência…"
          : multi
            ? `Recebendo arquivo ${currentIndex} de ${overall.filesTotal}`
            : `Recebendo ${activeName}`}
      </p>

      {phase === "receiving" && (
        <>
          <ProgressBar className="mb-1" value={bytesPct} label="Progresso" />
          <p className="mb-4 text-center text-xs text-text-muted">{statusParts.join(" · ")}</p>
        </>
      )}

      <ul className="flex flex-col gap-2">
        {(incomingBatch?.files ?? []).map((file) => {
          const pf = transfer.perFile[file.id];
          const state = pf?.state ?? "queued";
          const label =
            state === "completed"
              ? "Concluído"
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
                <span className="ml-3 shrink-0 text-text-muted">{label}</span>
              </div>
              {multi && state === "receiving" && pf && (
                <ProgressBar className="mt-2" value={pf.pct} label={file.name} />
              )}
            </li>
          );
        })}
      </ul>

      <Button className="mt-4 w-full" variant="secondary" onClick={transfer.cancel}>
        Cancelar
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Rodar os testes do pacote web**

Run: `pnpm --filter @transfergo/web test`
Expected: PASS — todos.

- [ ] **Step 5: Portão completo do monorepo**

Run: `pnpm turbo run lint typecheck test build`
Expected: PASS — 19/19 tarefas turbo, exit 0. Se `lint` reclamar de `import` não usado (ex.: `CheckCircle2` que deixou de ser referenciado num painel), remova o import órfão e rode de novo.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/s/ReceivePanel.tsx apps/web/src/components/s/ReceivePanel.test.tsx
git commit -m "feat(web): ReceivePanel shows byte progress, speed, ETA and partial cancel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review (feito pelo autor do plano)

**Cobertura da spec:**

| Seção da spec                                                                                      | Tarefa                                                                                 |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| §3.1 bytes acumulados (fórmula anti-dupla-contagem)                                                | 3 (Step 4 `applyProgress`)                                                             |
| §3.2 barra geral por bytes                                                                         | 5 (`bytesPct`), 6                                                                      |
| §3.3 `pct` por arquivo + mini-barra só no ativo + esconder com 1 arquivo                           | 3 (`pct`), 5/6 (`multi && state === active`)                                           |
| §4.1 constantes num lugar                                                                          | 4 (Step 3)                                                                             |
| §4.2 amostragem + evicção mantendo ≥2                                                              | 4 (`recomputeStats`, `applyProgress`)                                                  |
| §4.3 velocidade + `null` abaixo de 1s                                                              | 4 + testes                                                                             |
| §4.4 ETA com portão de 3s / ≥3 amostras                                                            | 4 + testes                                                                             |
| §4.5 ticker de decaimento                                                                          | 4 (`useEffect` do `setInterval`) + teste "decays…"                                     |
| §4.6 `formatSpeed`/`formatDuration` pt-BR em faixas                                                | 1                                                                                      |
| §4.7 reset em startSend/acceptBatch/rearm                                                          | 3 (estado), 4 (`resetStats`)                                                           |
| §5.1 vocabulário de fases + `preparing` + `sending`/`receiving` por papel                          | 3                                                                                      |
| §5.2 forma nova do `UseFileTransferResult`                                                         | 3                                                                                      |
| §5.3 quebra dos consumidores do P6 atualizada junto                                                | 3 (Steps 5–6)                                                                          |
| §6 `onCancelled(filesDone)` no motor + reconciliação `min` no hook                                 | 2 (motor), 3 (`Math.min` no `onCancelled`)                                             |
| §7.1 linha de status (bytes · velocidade · eta / "calculando…" / "parado")                         | 5/6 (`statusParts`)                                                                    |
| §7.2 `preparing` sem barra                                                                         | 5/6                                                                                    |
| §7.3 telas finais (`completed` inalterada, `cancelled` parcial, `failed` inalterada)               | 3 (completed), 5/6 (cancelled)                                                         |
| §8 casos de borda (1 arquivo, 0 byte, overrun, ETA gigante, travada, cancelar em preparing, rearm) | 3 (0 byte, rearm), 4 (travada), 5/6 (1 arquivo, teto de `formatDuration` já na Task 1) |
| §9 testes                                                                                          | todas as tarefas                                                                       |
| §10 textos pt-BR                                                                                   | 5/6 (strings verbatim)                                                                 |

**Scan de placeholders:** sem "TBD/TODO/etc." — todo passo tem código real. A nota da Task 6 "confirme `formatBytes(512*1024)` → `512 KB`" é uma checagem de sanidade (ambos os valores são inteiros → sem vírgula), não um placeholder: o assert já traz o literal.

**Consistência de tipos:** `PerFileState` (`queued|preparing|sending|receiving|completed|failed`) usado igual no hook (Task 3) e nos painéis (Tasks 5/6, ramos `state === "sending"`/`"receiving"`/`"completed"`/default "Na fila"). `TransferOverall` (`bytesDone|bytesTotal|filesDone|filesTotal`) idêntico em hook, fixtures e painéis. `TransferStats` (`speedBytesPerSec|etaSeconds`, ambos `number | null`) idêntico. `onCancelled(filesDone: number)` casado entre motor (Task 2) e wrappers do hook (Task 3).

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-03-transfergo-v1-07-progresso-cancelamento.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session via executing-plans, batch execution with checkpoints.

**Which approach?**
