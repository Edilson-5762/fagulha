# Plano 10 — TURN real com Metered — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um servidor TURN real (Metered.ca, free tier, credenciais temporárias) como fallback de conexão quando o STUN sozinho não é suficiente, e distinguir na UI uma falha específica do TURN (credencial/cota rejeitada) de uma falha comum de conexão — sem nunca expor a Secret Key do Metered no navegador e sem nunca travar a conexão se o Metered falhar.

**Architecture:** O servidor de sinalização (`apps/signaling-server`) ganha uma rota `GET /turn-credentials` que encadeia duas chamadas server-to-server ao Metered (criar credencial temporária → trocar o `apiKey` dela pela lista pronta de `iceServers`) usando a `METERED_SECRET_KEY`, nunca enviada ao cliente. O hook `usePeerConnection` no navegador busca essa rota antes de criar o `RTCPeerConnection`, mescla o resultado com o STUN fixo, e nunca lança — qualquer falha (rede, timeout, cota esgotada) devolve lista vazia e a conexão segue só com STUN, como antes deste plano. Um novo campo `failureReason` (`"connection_lost" | "turn_unavailable"`), populado via `RTCPeerConnection.onicecandidateerror`, chega até `SendPanel`/`ReceivePanel` para mostrar uma mensagem diferente e acionável quando a falha for especificamente do TURN.

**Tech Stack:** TypeScript, Node.js 24 (fetch nativo), WebRTC (`RTCPeerConnection`, `onicecandidateerror`), Vitest 2, React 19, Next.js 15, `@testing-library/react`, pnpm workspaces + Turborepo.

**Spec:** `docs/superpowers/specs/2026-09-05-fagulha-v1-10-turn-metered-design.md`

## Global Constraints

- **Idioma:** todo texto de UI em português do Brasil. Nomes internos de estado/código em inglês.
- **A `METERED_SECRET_KEY` nunca sai do servidor de sinalização.** Nenhuma chamada ao Metered acontece no navegador.
- **O fetch de credenciais TURN nunca lança.** Qualquer falha (rede, timeout, cota mensal esgotada, env var ausente) resulta em lista vazia de servidores TURN — a conexão sempre segue tentando só com STUN.
- **Duas chamadas HTTP encadeadas ao Metered:** `POST {baseUrl}/credential?secretKey=...` (cria a credencial, devolve `apiKey`) → `GET {baseUrl}/credentials?apiKey=...` (devolve o array pronto de `iceServers`, já com usuário/senha temporários).
- **`expiryInSeconds` padrão: 14400 (4 horas).**
- **Timeout de 3 segundos** no fetch do cliente ao endpoint de credenciais (`AbortController`).
- **Sem mudança no protocolo de sinalização** (`SignalPayload`, `ClientMessage`, `ServerMessage` em `@fagulha/shared` continuam iguais).
- **Sem jargão técnico/comercial** ("cota", "upgrade") em qualquer texto visível ao usuário.
- **Portão por tarefa:** cada tarefa termina com os testes do pacote/app afetado verdes. A última tarefa roda `pnpm turbo run lint typecheck test build` inteiro.
- **Commits frequentes**, um por tarefa no mínimo, mensagem `feat(...)` / `fix(...)` / `docs(...)` conforme o conteúdo, terminando com:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`

---

## Estrutura de arquivos

| Arquivo | Papel | Tarefa |
| --- | --- | --- |
| `apps/signaling-server/src/turn-credentials.ts` | **novo** — `fetchTurnIceServers`: encadeia as 2 chamadas ao Metered, nunca lança | 1 |
| `apps/signaling-server/src/turn-credentials.test.ts` | **novo** — sucesso, cada falha isolada | 1 |
| `apps/signaling-server/src/server.ts` | rota `GET /turn-credentials` (origem + CORS), `sendJsonWithCors` | 1 |
| `apps/signaling-server/src/server.test.ts` | testes da rota nova | 1 |
| `apps/web/src/lib/peer-connection.ts` | `fetchTurnServers`, gate assíncrono antes de criar o `RTCPeerConnection`, `onicecandidateerror`, `failureReason` | 2 |
| `apps/web/src/lib/peer-connection.test.ts` | reescrito — flush assíncrono antes das asserções + testes novos de TURN/`failureReason` | 2 |
| `apps/web/src/components/transferir/SendPanel.tsx` | mensagem diferenciada por `failureReason` | 3 |
| `apps/web/src/components/transferir/SendPanel.test.tsx` | teste novo da mensagem de TURN | 3 |
| `apps/web/src/components/s/ReceivePanel.tsx` | descrição diferenciada por `failureReason` | 3 |
| `apps/web/src/components/s/ReceivePanel.test.tsx` | teste novo da mensagem de TURN | 3 |
| `apps/web/src/app/transferir/page.tsx` | repassa `failureReason` ao `SendPanel` | 3 |
| `apps/web/src/app/transferir/page.test.tsx` | stubs do mock ganham `failureReason: null` | 3 |
| `apps/web/src/app/s/[token]/page.tsx` | repassa `failureReason` ao `ReceivePanel` | 3 |
| `apps/web/src/app/s/[token]/page.test.tsx` | stubs do mock ganham `failureReason: null` | 3 |
| `render.yaml` | `METERED_SECRET_KEY`, `METERED_TURN_BASE_URL` (`sync: false`) | 4 |
| `README.md` | atualiza a seção "Limitações conhecidas" e o roadmap | 4 |

---

## Task 1: Servidor de sinalização — módulo Metered + rota `/turn-credentials`

**Files:**

- Create: `apps/signaling-server/src/turn-credentials.ts`
- Test: `apps/signaling-server/src/turn-credentials.test.ts`
- Modify: `apps/signaling-server/src/server.ts`
- Test: `apps/signaling-server/src/server.test.ts`

**Interfaces:**

- Consumes: nada de outras tasks.
- Produces:
  - `export interface IceServer { urls: string; username?: string; credential?: string }`
  - `export interface FetchTurnIceServersOptions { secretKey: string; baseUrl: string; expiryInSeconds?: number; fetchImpl?: typeof fetch }`
  - `export async function fetchTurnIceServers(options: FetchTurnIceServersOptions): Promise<IceServer[]>` — nunca lança.
  - Rota `GET /turn-credentials` em `server.ts`: `200 { iceServers: IceServer[] }` com header `access-control-allow-origin: {WEB_ORIGIN}`; `403 { error: "forbidden" }` se a origem não bater com `WEB_ORIGIN`.

- [x] **Step 1: Escrever o teste que falha — `turn-credentials.test.ts`**

Crie `apps/signaling-server/src/turn-credentials.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { fetchTurnIceServers } from "./turn-credentials.js";

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(body) } as Response;
}

describe("fetchTurnIceServers", () => {
  it("chains the create-credential and list-credentials calls, returning the ICE servers", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ apiKey: "key-1", username: "u", password: "p" }))
      .mockResolvedValueOnce(
        jsonResponse([
          { urls: "stun:example.metered.live:80" },
          { urls: "turn:example.metered.live:80", username: "u", credential: "p" }
        ])
      );

    const result = await fetchTurnIceServers({
      secretKey: "secret",
      baseUrl: "https://example.metered.live/api/v1/turn",
      fetchImpl
    });

    expect(result).toEqual([
      { urls: "stun:example.metered.live:80" },
      { urls: "turn:example.metered.live:80", username: "u", credential: "p" }
    ]);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://example.metered.live/api/v1/turn/credential?secretKey=secret",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiryInSeconds: 14400 })
      }
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://example.metered.live/api/v1/turn/credentials?apiKey=key-1"
    );
  });

  it("sends a custom expiryInSeconds when provided", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ apiKey: "key-1" }))
      .mockResolvedValueOnce(jsonResponse([]));

    await fetchTurnIceServers({
      secretKey: "secret",
      baseUrl: "https://example.metered.live/api/v1/turn",
      expiryInSeconds: 3600,
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://example.metered.live/api/v1/turn/credential?secretKey=secret",
      expect.objectContaining({ body: JSON.stringify({ expiryInSeconds: 3600 }) })
    );
  });

  it("returns an empty list when the create-credential call fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({}, false));
    const result = await fetchTurnIceServers({
      secretKey: "secret",
      baseUrl: "https://example.metered.live/api/v1/turn",
      fetchImpl
    });
    expect(result).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list when the create-credential response has no apiKey", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ username: "u" }));
    const result = await fetchTurnIceServers({
      secretKey: "secret",
      baseUrl: "https://example.metered.live/api/v1/turn",
      fetchImpl
    });
    expect(result).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list when the list-credentials call fails", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ apiKey: "key-1" }))
      .mockResolvedValueOnce(jsonResponse({}, false));
    const result = await fetchTurnIceServers({
      secretKey: "secret",
      baseUrl: "https://example.metered.live/api/v1/turn",
      fetchImpl
    });
    expect(result).toEqual([]);
  });

  it("returns an empty list when fetch throws (network error, timeout, DNS, etc.)", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("network down"));
    const result = await fetchTurnIceServers({
      secretKey: "secret",
      baseUrl: "https://example.metered.live/api/v1/turn",
      fetchImpl
    });
    expect(result).toEqual([]);
  });

  it("returns an empty list when the list-credentials response isn't an array", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ apiKey: "key-1" }))
      .mockResolvedValueOnce(jsonResponse({ error: "unexpected shape" }));
    const result = await fetchTurnIceServers({
      secretKey: "secret",
      baseUrl: "https://example.metered.live/api/v1/turn",
      fetchImpl
    });
    expect(result).toEqual([]);
  });
});
```

- [x] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @fagulha/signaling-server test -- turn-credentials`
Expected: FAIL — `Cannot find module './turn-credentials.js'`.

- [x] **Step 3: Implementar `turn-credentials.ts`**

Crie `apps/signaling-server/src/turn-credentials.ts`:

```ts
export interface IceServer {
  urls: string;
  username?: string;
  credential?: string;
}

export interface FetchTurnIceServersOptions {
  secretKey: string;
  baseUrl: string;
  expiryInSeconds?: number;
  fetchImpl?: typeof fetch;
}

interface CreateCredentialResponse {
  apiKey?: string;
}

// Duas chamadas server-to-server ao Metered: a 1ª cria uma credencial
// temporária (a secretKey nunca sai do backend); a 2ª troca o apiKey dessa
// credencial pela lista pronta de iceServers (STUN + variantes TURN
// udp/tcp/443) já com usuário e senha temporários embutidos. Qualquer falha
// (rede, credencial rejeitada, cota mensal do Metered esgotada) devolve uma
// lista vazia — nunca lança — para o chamador seguir só com STUN.
export async function fetchTurnIceServers(
  options: FetchTurnIceServersOptions
): Promise<IceServer[]> {
  const { secretKey, baseUrl, expiryInSeconds = 14400, fetchImpl = fetch } = options;
  try {
    const createResponse = await fetchImpl(
      `${baseUrl}/credential?secretKey=${encodeURIComponent(secretKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiryInSeconds })
      }
    );
    if (!createResponse.ok) {
      return [];
    }
    const created = (await createResponse.json()) as CreateCredentialResponse;
    if (!created.apiKey) {
      return [];
    }

    const listResponse = await fetchImpl(
      `${baseUrl}/credentials?apiKey=${encodeURIComponent(created.apiKey)}`
    );
    if (!listResponse.ok) {
      return [];
    }
    const iceServers = (await listResponse.json()) as unknown;
    return Array.isArray(iceServers) ? (iceServers as IceServer[]) : [];
  } catch {
    return [];
  }
}
```

- [x] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @fagulha/signaling-server test -- turn-credentials`
Expected: PASS (7/7).

- [x] **Step 5: Escrever os testes que falham — rota em `server.test.ts`**

Em `apps/signaling-server/src/server.test.ts`, acrescente ao final do arquivo (dentro de um novo `describe`, mesmo nível do existente):

```ts
describe("GET /turn-credentials", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("responds with an empty iceServers list and a CORS header when Metered env vars are not configured", async () => {
    delete process.env.METERED_SECRET_KEY;
    delete process.env.METERED_TURN_BASE_URL;

    const response = await fetch(`${baseUrl}/turn-credentials`, {
      headers: { origin: "http://localhost:3000" }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    await expect(response.json()).resolves.toEqual({ iceServers: [] });
  });

  it("rejects requests from an origin other than WEB_ORIGIN", async () => {
    const response = await fetch(`${baseUrl}/turn-credentials`, {
      headers: { origin: "https://not-fagulha.example" }
    });
    expect(response.status).toBe(403);
  });
});
```

> Este arquivo já importa `afterEach` de `"vitest"` no topo — confirme e acrescente se faltar.

- [x] **Step 6: Rodar e ver falhar**

Run: `pnpm --filter @fagulha/signaling-server test -- server`
Expected: FAIL — `404` em vez de `200`/`403` (a rota não existe ainda).

- [x] **Step 7: Implementar a rota em `server.ts`**

Em `apps/signaling-server/src/server.ts`, acrescente o import no topo:

```ts
import { fetchTurnIceServers } from "./turn-credentials.js";
```

Depois de `function handleNotFound`, acrescente:

```ts
function sendJsonWithCors(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "access-control-allow-origin": ALLOWED_ORIGIN
  });
  res.end(JSON.stringify(body));
}

async function handleTurnCredentials(res: ServerResponse): Promise<void> {
  const secretKey = process.env.METERED_SECRET_KEY;
  const baseUrl = process.env.METERED_TURN_BASE_URL;
  if (!secretKey || !baseUrl) {
    sendJsonWithCors(res, 200, { iceServers: [] });
    return;
  }
  const iceServers = await fetchTurnIceServers({ secretKey, baseUrl });
  sendJsonWithCors(res, 200, { iceServers });
}
```

No corpo de `createServer`, dentro do handler HTTP existente, acrescente a rota nova antes da chamada a `handleNotFound(res)`:

```ts
    if (req.method === "GET" && pathname === "/health") {
      handleHealthCheck(res);
      return;
    }

    if (req.method === "GET" && pathname === "/turn-credentials") {
      if (req.headers.origin !== ALLOWED_ORIGIN) {
        sendJson(res, 403, { error: "forbidden" });
        return;
      }
      void handleTurnCredentials(res);
      return;
    }

    handleNotFound(res);
```

- [x] **Step 8: Rodar e ver passar**

Run: `pnpm --filter @fagulha/signaling-server test -- server`
Expected: PASS.

- [x] **Step 9: Portão do pacote**

Run: `pnpm --filter @fagulha/signaling-server run lint typecheck test`
Expected: tudo verde.

- [x] **Step 10: Commit**

```bash
git add apps/signaling-server/src/turn-credentials.ts apps/signaling-server/src/turn-credentials.test.ts apps/signaling-server/src/server.ts apps/signaling-server/src/server.test.ts
git commit -m "feat(signaling): add /turn-credentials endpoint proxying Metered's TURN API

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Cliente — `usePeerConnection` busca credenciais TURN e expõe `failureReason`

**Files:**

- Modify: `apps/web/src/lib/peer-connection.ts` (reescrita quase completa do arquivo)
- Test: `apps/web/src/lib/peer-connection.test.ts` (reescrita completa do arquivo)

**Interfaces:**

- Consumes: nada de outras tasks (chama a rota HTTP da Task 1 via `fetch`, sem import direto).
- Produces:
  - `export type ChannelFailureReason = "connection_lost" | "turn_unavailable"`
  - `UsePeerConnectionResult` ganha `failureReason: ChannelFailureReason | null`.
  - O `RTCPeerConnection` só é criado depois que o fetch de `/turn-credentials` resolve (sucesso ou falha) — nunca lança, sempre segue com STUN se o TURN não vier.

- [x] **Step 1: Escrever o teste que falha — reescrever `peer-connection.test.ts`**

Substitua o conteúdo inteiro de `apps/web/src/lib/peer-connection.test.ts` por:

```ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SignalPayload } from "@fagulha/shared";
import { usePeerConnection } from "./peer-connection.js";

class FakeDataChannel {
  readyState: "connecting" | "open" | "closing" | "closed" = "connecting";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;

  open() {
    this.readyState = "open";
    this.onopen?.();
  }
}

type FakeCandidate = { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };
type FakeIceErrorEvent = { url: string; errorCode: number };

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  static shouldFailSetRemoteDescription = false;

  onicecandidate: ((event: { candidate: FakeCandidate | null }) => void) | null = null;
  onicecandidateerror: ((event: FakeIceErrorEvent) => void) | null = null;
  ondatachannel: ((event: { channel: FakeDataChannel }) => void) | null = null;
  closed = false;

  localDescriptions: unknown[] = [];
  remoteDescriptions: unknown[] = [];
  addedCandidates: unknown[] = [];
  createdDataChannels: string[] = [];
  iceServers: RTCIceServer[];

  constructor(config?: { iceServers?: RTCIceServer[] }) {
    this.iceServers = config?.iceServers ?? [];
    FakePeerConnection.instances.push(this);
  }

  createOffer() {
    return Promise.resolve({ type: "offer", sdp: "offer-sdp" });
  }

  createAnswer() {
    return Promise.resolve({ type: "answer", sdp: "answer-sdp" });
  }

  setLocalDescription(description: unknown) {
    this.localDescriptions.push(description);
    return Promise.resolve();
  }

  setRemoteDescription(description: unknown) {
    if (FakePeerConnection.shouldFailSetRemoteDescription) {
      return Promise.reject(new Error("boom"));
    }
    this.remoteDescriptions.push(description);
    return Promise.resolve();
  }

  addIceCandidate(candidate: unknown) {
    this.addedCandidates.push(candidate);
    return Promise.resolve();
  }

  createDataChannel(label: string) {
    this.createdDataChannels.push(label);
    return new FakeDataChannel();
  }

  close() {
    this.closed = true;
  }
}

function latestPeerConnection(): FakePeerConnection {
  const pc = FakePeerConnection.instances.at(-1);
  if (!pc) {
    throw new Error("no RTCPeerConnection created");
  }
  return pc;
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function fetchOk(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakePeerConnection.instances = [];
  FakePeerConnection.shouldFailSetRemoteDescription = false;
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
  fetchMock = vi.fn().mockImplementation(() => fetchOk({ iceServers: [] }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePeerConnection", () => {
  it("does not create a peer connection before the session is accepted", () => {
    renderHook(() =>
      usePeerConnection({ role: "host", accepted: false, sendSignal: vi.fn(), lastSignal: null })
    );
    expect(FakePeerConnection.instances).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates the peer connection only once across re-renders", async () => {
    const sendSignal = vi.fn();
    const { rerender } = renderHook(() =>
      usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null })
    );
    await flushAsync();
    rerender();
    rerender();
    expect(FakePeerConnection.instances).toHaveLength(1);
    expect(FakePeerConnection.instances[0]!.closed).toBe(false);
  });

  it("as host: creates a data channel and sends an offer once accepted", async () => {
    const sendSignal = vi.fn();
    const { result } = renderHook(() =>
      usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null })
    );
    await flushAsync();

    expect(latestPeerConnection().createdDataChannels).toEqual(["fagulha"]);
    expect(result.current.channelState).toBe("connecting");
    expect(sendSignal).toHaveBeenCalledWith({ kind: "offer", sdp: "offer-sdp" });
  });

  it("as guest: answers an incoming offer", async () => {
    const sendSignal = vi.fn();
    const { rerender } = renderHook(
      (props: { lastSignal: SignalPayload | null }) =>
        usePeerConnection({
          role: "guest",
          accepted: true,
          sendSignal,
          lastSignal: props.lastSignal
        }),
      { initialProps: { lastSignal: null as SignalPayload | null } }
    );
    await flushAsync();

    rerender({ lastSignal: { kind: "offer", sdp: "remote-offer-sdp" } });
    await flushAsync();

    expect(latestPeerConnection().remoteDescriptions).toEqual([
      { type: "offer", sdp: "remote-offer-sdp" }
    ]);
    expect(sendSignal).toHaveBeenCalledWith({ kind: "answer", sdp: "answer-sdp" });
  });

  it("buffers an ICE candidate received before the remote description, then flushes it", async () => {
    const sendSignal = vi.fn();
    const candidate = {
      candidate: "candidate:1 1 UDP 1 1.2.3.4 5000 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0
    };
    const { rerender } = renderHook(
      (props: { lastSignal: SignalPayload | null }) =>
        usePeerConnection({
          role: "guest",
          accepted: true,
          sendSignal,
          lastSignal: props.lastSignal
        }),
      { initialProps: { lastSignal: null as SignalPayload | null } }
    );
    await flushAsync();

    rerender({ lastSignal: { kind: "candidate", candidate } });
    expect(latestPeerConnection().addedCandidates).toEqual([]);

    rerender({ lastSignal: { kind: "offer", sdp: "remote-offer-sdp" } });
    await flushAsync();

    expect(latestPeerConnection().addedCandidates).toEqual([candidate]);
  });

  it("forwards local ICE candidates to sendSignal", async () => {
    const sendSignal = vi.fn();
    renderHook(() =>
      usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null })
    );
    await flushAsync();

    const candidate = {
      candidate: "candidate:1 1 UDP 1 1.2.3.4 5000 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0
    };
    act(() => latestPeerConnection().onicecandidate?.({ candidate }));

    expect(sendSignal).toHaveBeenCalledWith({ kind: "candidate", candidate });
  });

  it("ignores a null candidate from onicecandidate (end-of-gathering marker)", async () => {
    const sendSignal = vi.fn();
    renderHook(() =>
      usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null })
    );
    await flushAsync();

    act(() => latestPeerConnection().onicecandidate?.({ candidate: null }));

    expect(sendSignal).not.toHaveBeenCalled();
  });

  it("reflects the data channel opening in channelState", async () => {
    const sendSignal = vi.fn();
    const { result } = renderHook(() =>
      usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null })
    );
    await flushAsync();

    expect(result.current.channelState).toBe("connecting");
    act(() => (result.current.dataChannel as unknown as FakeDataChannel).open());

    expect(result.current.channelState).toBe("open");
  });

  it("as host: applies a remote answer", async () => {
    const sendSignal = vi.fn();
    const { rerender } = renderHook(
      (props: { lastSignal: SignalPayload | null }) =>
        usePeerConnection({
          role: "host",
          accepted: true,
          sendSignal,
          lastSignal: props.lastSignal
        }),
      { initialProps: { lastSignal: null as SignalPayload | null } }
    );
    await flushAsync();

    rerender({ lastSignal: { kind: "answer", sdp: "remote-answer-sdp" } });
    await flushAsync();

    expect(latestPeerConnection().remoteDescriptions).toEqual([
      { type: "answer", sdp: "remote-answer-sdp" }
    ]);
  });

  it("as guest: binds the data channel delivered via ondatachannel", async () => {
    const sendSignal = vi.fn();
    const { result } = renderHook(() =>
      usePeerConnection({ role: "guest", accepted: true, sendSignal, lastSignal: null })
    );
    await flushAsync();

    const channel = new FakeDataChannel();
    act(() => latestPeerConnection().ondatachannel?.({ channel }));

    expect(result.current.dataChannel).toBe(channel as unknown as RTCDataChannel);
    expect(result.current.channelState).toBe("connecting");
  });

  it("transitions channelState to failed when the data channel closes", async () => {
    const sendSignal = vi.fn();
    const { result } = renderHook(() =>
      usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null })
    );
    await flushAsync();

    const channel = result.current.dataChannel as unknown as FakeDataChannel;
    act(() => channel.open());
    expect(result.current.channelState).toBe("open");

    act(() => channel.onclose?.());
    expect(result.current.channelState).toBe("failed");
    expect(result.current.failureReason).toBe("connection_lost");
  });

  it("does not recreate the peer connection when sendSignal has a new identity every render", async () => {
    const { rerender } = renderHook(() =>
      usePeerConnection({ role: "host", accepted: true, sendSignal: vi.fn(), lastSignal: null })
    );
    await flushAsync();

    rerender();
    rerender();
    rerender();

    expect(FakePeerConnection.instances).toHaveLength(1);
  });

  it("ignores a second offer once the remote description has already been set", async () => {
    const sendSignal = vi.fn();
    const { rerender } = renderHook(
      (props: { lastSignal: SignalPayload | null }) =>
        usePeerConnection({
          role: "guest",
          accepted: true,
          sendSignal,
          lastSignal: props.lastSignal
        }),
      { initialProps: { lastSignal: null as SignalPayload | null } }
    );
    await flushAsync();

    rerender({ lastSignal: { kind: "offer", sdp: "offer-sdp-1" } });
    await flushAsync();

    rerender({ lastSignal: { kind: "offer", sdp: "offer-sdp-2" } });
    await flushAsync();

    expect(latestPeerConnection().remoteDescriptions).toHaveLength(1);
    expect(sendSignal).toHaveBeenCalledWith({ kind: "answer", sdp: "answer-sdp" });
    expect(sendSignal).toHaveBeenCalledTimes(1);
  });

  it("marks channelState as failed when setRemoteDescription rejects", async () => {
    FakePeerConnection.shouldFailSetRemoteDescription = true;
    const sendSignal = vi.fn();
    const { result, rerender } = renderHook(
      (props: { lastSignal: SignalPayload | null }) =>
        usePeerConnection({
          role: "guest",
          accepted: true,
          sendSignal,
          lastSignal: props.lastSignal
        }),
      { initialProps: { lastSignal: null as SignalPayload | null } }
    );
    await flushAsync();

    rerender({ lastSignal: { kind: "offer", sdp: "remote-offer-sdp" } });
    await flushAsync();

    expect(result.current.channelState).toBe("failed");
    expect(result.current.failureReason).toBe("connection_lost");
  });

  describe("credenciais TURN (Plano 10)", () => {
    it("fetches /turn-credentials before creating the RTCPeerConnection", async () => {
      renderHook(() =>
        usePeerConnection({ role: "host", accepted: true, sendSignal: vi.fn(), lastSignal: null })
      );
      expect(FakePeerConnection.instances).toHaveLength(0);

      await flushAsync();

      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4000/turn-credentials",
        expect.objectContaining({ signal: expect.anything() })
      );
      expect(FakePeerConnection.instances).toHaveLength(1);
    });

    it("merges the fetched TURN servers with the fixed STUN server", async () => {
      const turnServer = { urls: "turn:example.metered.live:80", username: "u", credential: "p" };
      fetchMock.mockImplementation(() => fetchOk({ iceServers: [turnServer] }));

      renderHook(() =>
        usePeerConnection({ role: "host", accepted: true, sendSignal: vi.fn(), lastSignal: null })
      );
      await flushAsync();

      expect(latestPeerConnection().iceServers).toEqual([
        { urls: "stun:stun.l.google.com:19302" },
        turnServer
      ]);
    });

    it("falls back to STUN-only when the credentials fetch rejects", async () => {
      fetchMock.mockImplementation(() => Promise.reject(new Error("network down")));

      renderHook(() =>
        usePeerConnection({ role: "host", accepted: true, sendSignal: vi.fn(), lastSignal: null })
      );
      await flushAsync();

      expect(latestPeerConnection().iceServers).toEqual([{ urls: "stun:stun.l.google.com:19302" }]);
    });

    it("falls back to STUN-only when the credentials endpoint responds with an error status", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response)
      );

      renderHook(() =>
        usePeerConnection({ role: "host", accepted: true, sendSignal: vi.fn(), lastSignal: null })
      );
      await flushAsync();

      expect(latestPeerConnection().iceServers).toEqual([{ urls: "stun:stun.l.google.com:19302" }]);
    });

    it("marks failureReason as turn_unavailable after a 401/403 ICE candidate error from a turn: URL", async () => {
      const sendSignal = vi.fn();
      const { result } = renderHook(() =>
        usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null })
      );
      await flushAsync();

      act(() =>
        latestPeerConnection().onicecandidateerror?.({
          url: "turn:example.metered.live:80",
          errorCode: 403
        })
      );
      const channel = result.current.dataChannel as unknown as FakeDataChannel;
      act(() => channel.onclose?.());

      expect(result.current.failureReason).toBe("turn_unavailable");
    });

    it("keeps failureReason as connection_lost for a non-TURN or non-auth ICE candidate error", async () => {
      const sendSignal = vi.fn();
      const { result } = renderHook(() =>
        usePeerConnection({ role: "host", accepted: true, sendSignal, lastSignal: null })
      );
      await flushAsync();

      act(() =>
        latestPeerConnection().onicecandidateerror?.({
          url: "stun:stun.l.google.com:19302",
          errorCode: 701
        })
      );
      const channel = result.current.dataChannel as unknown as FakeDataChannel;
      act(() => channel.onclose?.());

      expect(result.current.failureReason).toBe("connection_lost");
    });
  });
});
```

- [x] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @fagulha/web test -- peer-connection`
Expected: FAIL — a maioria dos testes falha porque `FakePeerConnection.instances` ainda está vazio nas asserções síncronas (o hook antigo cria o `RTCPeerConnection` de forma síncrona, então o `fetchMock` nem existe como conceito para ele) — na prática, como o código de produção ainda não busca `fetch`, alguns testes antigos passam mas os novos (`describe("credenciais TURN …")`) falham, e `failureReason` é `undefined` em todos.

- [x] **Step 3: Reescrever `peer-connection.ts`**

Substitua o conteúdo inteiro de `apps/web/src/lib/peer-connection.ts` por:

```ts
"use client";

import { useEffect, useRef, useState } from "react";
import type { ConnectionRole, IceCandidateData, SignalPayload } from "@fagulha/shared";

export type PeerChannelState = "idle" | "connecting" | "open" | "failed";
export type ChannelFailureReason = "connection_lost" | "turn_unavailable";

export interface UsePeerConnectionResult {
  dataChannel: RTCDataChannel | null;
  channelState: PeerChannelState;
  failureReason: ChannelFailureReason | null;
}

export interface UsePeerConnectionParams {
  role: ConnectionRole | undefined;
  accepted: boolean;
  sendSignal: (payload: SignalPayload) => void;
  lastSignal: SignalPayload | null;
}

const STUN_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
const TURN_FETCH_TIMEOUT_MS = 3000;

function getSignalingHttpUrl(): string {
  return process.env.NEXT_PUBLIC_SIGNALING_URL ?? "http://localhost:4000";
}

// Nunca lança: qualquer falha (rede, timeout, cota mensal do Metered esgotada,
// endpoint fora do ar) faz a conexão seguir só com STUN, exatamente como antes
// deste plano.
async function fetchTurnServers(): Promise<RTCIceServer[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TURN_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${getSignalingHttpUrl()}/turn-credentials`, {
      signal: controller.signal
    });
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as { iceServers?: RTCIceServer[] };
    return data.iceServers ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export function usePeerConnection(params: UsePeerConnectionParams): UsePeerConnectionResult {
  const { role, accepted, sendSignal, lastSignal } = params;

  const [dataChannel, setDataChannel] = useState<RTCDataChannel | null>(null);
  const [channelState, setChannelState] = useState<PeerChannelState>("idle");
  const [failureReason, setFailureReason] = useState<ChannelFailureReason | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const remoteDescriptionSetRef = useRef(false);
  const pendingCandidatesRef = useRef<IceCandidateData[]>([]);
  const sendSignalRef = useRef(sendSignal);
  sendSignalRef.current = sendSignal;
  // Preenchido por onicecandidateerror quando o TURN especificamente recusa a
  // credencial (401/403) — não significa que a conexão já falhou (outros
  // candidatos podem funcionar), só registra a causa para quando ela falhar.
  const turnErrorSeenRef = useRef(false);

  useEffect(() => {
    if (!accepted || !role) {
      return;
    }

    let cancelled = false;

    function markFailed(): void {
      setFailureReason(turnErrorSeenRef.current ? "turn_unavailable" : "connection_lost");
      setChannelState("failed");
    }

    function bindDataChannel(channel: RTCDataChannel): void {
      setDataChannel(channel);
      setChannelState("connecting");
      channel.onopen = () => setChannelState("open");
      channel.onclose = () => markFailed();
    }

    async function setup(): Promise<void> {
      const turnServers = await fetchTurnServers();
      if (cancelled) {
        return;
      }

      const pc = new RTCPeerConnection({ iceServers: [...STUN_SERVERS, ...turnServers] });
      pcRef.current = pc;

      pc.onicecandidate = (event) => {
        if (!event.candidate) {
          return;
        }
        sendSignalRef.current({
          kind: "candidate",
          candidate: {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex
          }
        });
      };

      pc.onicecandidateerror = (event) => {
        const url = event.url ?? "";
        const isTurnUrl = url.startsWith("turn:") || url.startsWith("turns:");
        const isAuthError = event.errorCode === 401 || event.errorCode === 403;
        if (isTurnUrl && isAuthError) {
          turnErrorSeenRef.current = true;
        }
      };

      pc.ondatachannel = (event) => bindDataChannel(event.channel);

      if (role === "host") {
        bindDataChannel(pc.createDataChannel("fagulha"));
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer).then(() => offer))
          .then((offer) => sendSignalRef.current({ kind: "offer", sdp: offer.sdp ?? "" }))
          .catch(() => markFailed());
      }
    }

    void setup();

    return () => {
      cancelled = true;
      pcRef.current?.close();
      pcRef.current = null;
      remoteDescriptionSetRef.current = false;
      pendingCandidatesRef.current = [];
      turnErrorSeenRef.current = false;
      setDataChannel(null);
      setChannelState("idle");
      setFailureReason(null);
    };
  }, [accepted, role]);

  useEffect(() => {
    const pc = pcRef.current;
    if (!pc || !lastSignal) {
      return;
    }

    function markFailed(): void {
      setFailureReason(turnErrorSeenRef.current ? "turn_unavailable" : "connection_lost");
      setChannelState("failed");
    }

    async function flushPendingCandidates(conn: RTCPeerConnection): Promise<void> {
      const pending = pendingCandidatesRef.current;
      pendingCandidatesRef.current = [];
      for (const candidate of pending) {
        await conn.addIceCandidate(candidate);
      }
    }

    if (lastSignal.kind === "offer") {
      if (remoteDescriptionSetRef.current) {
        return;
      }
      pc.setRemoteDescription({ type: "offer", sdp: lastSignal.sdp })
        .then(() => {
          remoteDescriptionSetRef.current = true;
          return flushPendingCandidates(pc);
        })
        .then(() => pc.createAnswer())
        .then((answer) => pc.setLocalDescription(answer).then(() => answer))
        .then((answer) => sendSignalRef.current({ kind: "answer", sdp: answer.sdp ?? "" }))
        .catch(() => markFailed());
    } else if (lastSignal.kind === "answer") {
      pc.setRemoteDescription({ type: "answer", sdp: lastSignal.sdp })
        .then(() => {
          remoteDescriptionSetRef.current = true;
          return flushPendingCandidates(pc);
        })
        .catch(() => markFailed());
    } else if (lastSignal.kind === "candidate") {
      const candidate = lastSignal.candidate;
      if (remoteDescriptionSetRef.current) {
        pc.addIceCandidate(candidate).catch(() => markFailed());
      } else {
        pendingCandidatesRef.current.push(candidate);
      }
    }
    // `accepted` is a dependency so a signal buffered before effect 1 has created the
    // peer connection (pcRef.current still null) gets reprocessed once it exists.
  }, [lastSignal, accepted]);

  return { dataChannel, channelState, failureReason };
}
```

- [x] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @fagulha/web test -- peer-connection`
Expected: PASS (todos os testes, antigos e novos).

- [x] **Step 5: Portão do pacote (parcial — outros arquivos ainda quebram, resolvidos na Task 3)**

Run: `pnpm --filter @fagulha/web run typecheck`
Expected: falha em `SendPanel.tsx`, `ReceivePanel.tsx`, `transferir/page.tsx`, `s/[token]/page.tsx` e seus testes — nenhum ainda usa `failureReason`, mas `UsePeerConnectionResult` também não obriga ninguém a lê-lo (é só um campo a mais no objeto de retorno), então o typecheck real só quebra nos mocks de `usePeerConnection` em `*.page.test.tsx`, que tipam o retorno contra `UsePeerConnectionResult` inteiro. Isso é esperado e resolvido na Task 3 — **não** tente corrigir aqui.

- [x] **Step 6: Commit**

```bash
git add apps/web/src/lib/peer-connection.ts apps/web/src/lib/peer-connection.test.ts
git commit -m "feat(web): fetch Metered TURN credentials before creating the RTCPeerConnection

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: UI — mensagem diferenciada quando a falha é do TURN

**Files:**

- Modify: `apps/web/src/components/transferir/SendPanel.tsx:17-34,167-172`
- Test: `apps/web/src/components/transferir/SendPanel.test.tsx`
- Modify: `apps/web/src/components/s/ReceivePanel.tsx:16-26,166-179`
- Test: `apps/web/src/components/s/ReceivePanel.test.tsx`
- Modify: `apps/web/src/app/transferir/page.tsx:15,50`
- Test: `apps/web/src/app/transferir/page.test.tsx:49,125-128,141-144,151`
- Modify: `apps/web/src/app/s/[token]/page.tsx:30,60`
- Test: `apps/web/src/app/s/[token]/page.test.tsx:55,171-174,188-191,195`

**Interfaces:**

- Consumes: `ChannelFailureReason` de `../../lib/peer-connection.js` (Task 2).
- Produces: nenhum contrato novo além de um prop `failureReason?: ChannelFailureReason | null` em `SendPanel` e `ReceivePanel`.

- [x] **Step 1: Escrever os testes que falham**

Em `apps/web/src/components/transferir/SendPanel.test.tsx`, logo depois do teste `"shows a connection-lost notice on the idle screen when the channel isn't open"` (por volta da linha 248), acrescente:

```ts
  it("shows the TURN-specific notice when failureReason is turn_unavailable", () => {
    render(
      <SendPanel
        transfer={withOverrides({ phase: "idle" })}
        channelState="failed"
        failureReason="turn_unavailable"
      />
    );
    expect(
      screen.getByText(/Não foi possível usar o servidor de apoio à conexão agora/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Conexão com o outro dispositivo perdida/)).not.toBeInTheDocument();
  });
```

Em `apps/web/src/components/s/ReceivePanel.test.tsx`, logo depois do teste `"shows a connection-lost screen instead of waiting when the channel isn't open"` (por volta da linha 47), acrescente:

```ts
  it("shows the TURN-specific description when failureReason is turn_unavailable", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({})}
        channelState="failed"
        failureReason="turn_unavailable"
      />
    );
    expect(
      screen.getByText(/Não foi possível usar o servidor de apoio à conexão agora/)
    ).toBeInTheDocument();
  });
```

Em `apps/web/src/app/transferir/page.test.tsx`, acrescente `failureReason: null` a cada um dos 4 `mockedUsePeerConnection.mockReturnValue({...})` (linhas 49, ~125-128, ~141-144, 151):

```ts
  mockedUsePeerConnection.mockReturnValue({
    dataChannel: null,
    channelState: "connecting",
    failureReason: null
  });
```

```ts
    mockedUsePeerConnection.mockReturnValue({
      dataChannel: {} as RTCDataChannel,
      channelState: "open",
      failureReason: null
    });
```
(as duas ocorrências desse formato, linhas ~125 e ~141)

```ts
    mockedUsePeerConnection.mockReturnValue({
      dataChannel: null,
      channelState: "failed",
      failureReason: null
    });
```

Aplique o mesmo padrão (as mesmas 4 formas, mesmas posições relativas) em `apps/web/src/app/s/[token]/page.test.tsx` (linhas 55, ~171-174, ~188-191, 195).

- [x] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @fagulha/web test -- SendPanel ReceivePanel`
Expected: FAIL — o texto novo não existe ainda; `pnpm --filter @fagulha/web run typecheck` também falha nos 4 arquivos de página/teste por causa do campo `failureReason` que falta no tipo `UsePeerConnectionResult` usado nos mocks.

- [x] **Step 3: Implementar — `SendPanel.tsx`**

No topo do arquivo, troque o import de tipo:

```tsx
import type { ChannelFailureReason, PeerChannelState } from "../../lib/peer-connection.js";
```

Troque a assinatura da função:

```tsx
export function SendPanel({
  transfer,
  channelState,
  failureReason
}: {
  transfer: UseFileTransferResult;
  channelState?: PeerChannelState;
  failureReason?: ChannelFailureReason | null;
}) {
```

No bloco da tela `idle` (por volta da linha 167), troque o texto fixo pela mensagem condicional:

```tsx
      {channelState && channelState !== "open" && (
        <p className="mb-4 flex items-center justify-center gap-1.5 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-center text-xs text-danger">
          <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
          {failureReason === "turn_unavailable"
            ? "Não foi possível usar o servidor de apoio à conexão agora. Tente novamente mais tarde ou use outra rede (Wi-Fi em vez de dados móveis)."
            : "Conexão com o outro dispositivo perdida. Peça um novo link para tentar de novo."}
        </p>
      )}
```

- [x] **Step 4: Implementar — `ReceivePanel.tsx`**

No topo do arquivo, troque o import de tipo:

```tsx
import type { ChannelFailureReason, PeerChannelState } from "../../lib/peer-connection.js";
```

Troque a assinatura da função:

```tsx
export function ReceivePanel({
  transfer,
  channelState,
  failureReason
}: {
  transfer: UseFileTransferResult;
  channelState?: PeerChannelState;
  failureReason?: ChannelFailureReason | null;
}) {
```

No bloco `phase === "idle"` sem `incomingBatch` (por volta da linha 167-178), troque a `description` fixa:

```tsx
    if (channelState && channelState !== "open") {
      return (
        <StateScreen
          icon={WifiOff}
          tone="danger"
          title="Conexão perdida"
          description={
            failureReason === "turn_unavailable"
              ? "Não foi possível usar o servidor de apoio à conexão agora. Tente novamente mais tarde ou use outra rede (Wi-Fi em vez de dados móveis)."
              : "A conexão com o outro dispositivo caiu. Peça um novo link para tentar de novo."
          }
          actions={[exitAction]}
        />
      );
    }
```

- [x] **Step 5: Implementar — repassar o prop nas páginas**

Em `apps/web/src/app/transferir/page.tsx`, troque:

```tsx
  const { dataChannel, channelState } = usePeerConnection({
```

por:

```tsx
  const { dataChannel, channelState, failureReason } = usePeerConnection({
```

E troque:

```tsx
        <SendPanel transfer={transfer} channelState={channelState} />
```

por:

```tsx
        <SendPanel transfer={transfer} channelState={channelState} failureReason={failureReason} />
```

Em `apps/web/src/app/s/[token]/page.tsx`, aplique a mesma troca (`usePeerConnection` desestrutura `failureReason`; `<ReceivePanel transfer={transfer} channelState={channelState} failureReason={failureReason} />`).

- [x] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @fagulha/web run typecheck test`
Expected: tudo verde.

- [x] **Step 7: Commit**

```bash
git add apps/web/src/components/transferir/SendPanel.tsx apps/web/src/components/transferir/SendPanel.test.tsx apps/web/src/components/s/ReceivePanel.tsx apps/web/src/components/s/ReceivePanel.test.tsx apps/web/src/app/transferir/page.tsx apps/web/src/app/transferir/page.test.tsx "apps/web/src/app/s/[token]/page.tsx" "apps/web/src/app/s/[token]/page.test.tsx"
git commit -m "feat(web): show a distinct, actionable message when the TURN relay is unavailable

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Configuração — variáveis de ambiente e documentação

**Files:**

- Modify: `render.yaml`
- Modify: `README.md:56-65,74-81`

**Interfaces:** nenhuma — só configuração e documentação.

- [x] **Step 1: Acrescentar as variáveis ao `render.yaml`**

Em `render.yaml`, dentro de `envVars`, acrescente depois de `WEB_ORIGIN`:

```yaml
      - key: METERED_SECRET_KEY
        sync: false
      - key: METERED_TURN_BASE_URL
        sync: false
```

- [x] **Step 2: Atualizar o README**

Em `README.md`, substitua o primeiro bullet da seção "Limitações conhecidas da V1" (linhas 58-65):

```markdown
- **TURN real via Metered.ca (free tier)** — cobre os casos em que o STUN
  sozinho não basta (NATs simétricos, algumas redes corporativas/de
  operadora). O plano gratuito do Metered dá 0,5 GB/mês de tráfego
  retransmitido sem cartão; se essa cota esgotar num mês, o app volta a
  funcionar só com STUN até o mês seguinte (a UI mostra um aviso específico
  pedindo para tentar mais tarde ou trocar de rede, em vez de parecer um
  bug). Migração para um plano pago fica em aberto, a depender do uso real.
```

Troque a última frase da seção "Roadmap" (linha 78-81):

```markdown
Planos 1–8 (fundação, design system, sessões, sinalização, WebRTC, motor
de transferência, progresso/cancelamento, integridade SHA-256) e Plano 9
(deploy + demo pública) concluídos. Plano 10 (TURN real com Metered)
concluído. Faltando para fechar a V1: transferência bidirecional,
endurecimento de segurança, validação formal cross-browser/mobile.
```

- [x] **Step 3: Commit**

```bash
git add render.yaml README.md
git commit -m "docs: document the Metered TURN fallback, update render.yaml env vars

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Portão completo + configuração do deploy + verificação manual

**Files:** nenhum (a menos que o portão aponte algo).

- [x] **Step 1: Portão do monorepo**

Run: `pnpm turbo run lint typecheck test build`
Expected: tudo verde em todos os pacotes.

- [ ] **Step 2: Configurar as variáveis reais no Render (só o usuário tem a Secret Key)**

No painel do Render, no serviço `fagulha-signaling`, adicionar:

- `METERED_SECRET_KEY`: a Secret Key copiada do painel do Metered (Desenvolvedores).
- `METERED_TURN_BASE_URL`: `https://<subdomínio-escolhido-no-metered>.metered.live/api/v1/turn` (o subdomínio é o que foi digitado ao criar o app "Servidor TURN" no painel do Metered).

Depois de salvar, o Render reimplanta o serviço automaticamente.

- [x] **Step 3: Verificação manual (feita pelo agente, não pelo usuário)**

Suba os dois servidores localmente (`pnpm dev`), configure `METERED_SECRET_KEY`/`METERED_TURN_BASE_URL` no `.env` local do `apps/signaling-server`, e confirme com um script (ex.: `curl http://localhost:4000/turn-credentials -H "Origin: http://localhost:3000"`) que a resposta traz `iceServers` não-vazio contendo pelo menos uma entrada `turn:`.

- [x] **Step 4: Verificação manual com 2 dispositivos em produção (só o usuário consegue)**

Depois do deploy, o teste que só o usuário pode fazer é confirmar que dois dispositivos em redes restritivas de verdade (ex. ambos no 4G/5G de operadoras diferentes) agora conseguem se conectar — isso já estava na lista de pendências da V1 ("validação formal cross-browser/mobile").

Confirmado em 2026-09-05: envio de vídeo de 31,7 MB entre dois celulares em dados móveis (sinais de operadoras diferentes) concluído com sucesso — lento pelo sinal fraco do local, não pela conexão em si.

- [x] **Step 5: Commit final (se o Step 1 gerou algum ajuste)**

Se o portão completo não exigiu nenhuma correção, nada a commitar aqui — marque o plano como concluído.

---

## Self-Review

**1. Cobertura da spec**

| Item da spec | Task |
| --- | --- |
| Endpoint `GET /turn-credentials` no servidor de sinalização | 1 |
| Chamada server-to-server ao Metered, secretKey nunca no cliente | 1 |
| Degradação graciosa (lista vazia em qualquer falha) | 1, 2 |
| `METERED_SECRET_KEY` / config nova | 1 (leitura), 4 (declaração), 5 (valor real) |
| Cliente busca credenciais antes de criar o `RTCPeerConnection` | 2 |
| Duração da credencial 14400s (4h) | 1 |
| `onicecandidateerror` distingue falha do TURN | 2 |
| Mensagens de erro diferenciadas, sem jargão | 3 |
| Testes do servidor de sinalização (mock do fetch ao Metered) | 1 |
| Testes do cliente (fetch falha → STUN-only; TURN ok → mesclado) | 2 |
| Verificação manual com 2 dispositivos | 5 |

**2. Placeholders:** nenhum encontrado — todos os blocos de código são completos e prontos para colar; a única menção a "critério do plano" na spec (o tipo exato de `failureReason`) foi resolvida aqui como `ChannelFailureReason = "connection_lost" | "turn_unavailable"`.

**3. Consistência de tipos:**

- `IceServer` (Task 1, servidor) e o `RTCIceServer` usado no cliente (Task 2) têm o mesmo formato (`urls`, `username?`, `credential?`) — o cliente lê a resposta HTTP como JSON solto (`{ iceServers?: RTCIceServer[] }`), sem importar o tipo do servidor (são processos/pacotes diferentes, sem dependência compartilhada nova).
- `ChannelFailureReason` (Task 2) é consumido em `SendPanel`/`ReceivePanel` (Task 3) com a mesma união de strings.
- `UsePeerConnectionResult.failureReason: ChannelFailureReason | null` (Task 2) — os 8 stubs de mock em `transferir/page.test.tsx` e `s/[token]/page.test.tsx` (Task 3) ganham `failureReason: null` para satisfazer o tipo.
- `fetchTurnIceServers` (Task 1) e `fetchTurnServers` (Task 2) são funções distintas e não relacionadas por import — a única ligação entre elas é o contrato HTTP da rota `/turn-credentials`, coberto pelos testes de cada lado.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-05-fagulha-v1-10-turn-metered.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
