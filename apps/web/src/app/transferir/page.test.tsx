import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePeerConnection } from "../../lib/peer-connection.js";
import { useSignalingSocket, type UseSignalingSocketResult } from "../../lib/signaling-socket.js";
import type { UseFileTransferResult } from "../../lib/use-file-transfer.js";
import TransferPage from "./page.js";

vi.mock("../../lib/signaling-socket.js", () => ({
  useSignalingSocket: vi.fn()
}));

vi.mock("../../lib/peer-connection.js", () => ({
  usePeerConnection: vi.fn()
}));

vi.mock("../../lib/use-file-transfer.js", () => ({
  useFileTransfer: vi.fn((): UseFileTransferResult => ({
    ready: false,
    selectedFiles: [],
    totalBytes: 0,
    limitError: null,
    addFiles: vi.fn(),
    removeFile: vi.fn(),
    clearSelection: vi.fn(),
    startSend: vi.fn(),
    incomingBatch: null,
    acceptBatch: vi.fn(),
    rejectBatch: vi.fn(),
    phase: "idle",
    perFile: {},
    overall: { bytesDone: 0, bytesTotal: 0, filesDone: 0, filesTotal: 0 },
    stats: { speedBytesPerSec: null, etaSeconds: null },
    filesSaved: 0,
    errorMessage: null,
    integrityVerified: false,
    cancel: vi.fn()
  }))
}));

const mockedUseSignalingSocket = vi.mocked(useSignalingSocket);
const mockedUsePeerConnection = vi.mocked(usePeerConnection);

beforeEach(() => {
  mockedUsePeerConnection.mockReturnValue({ dataChannel: null, channelState: "connecting" });
});

function makeResult(overrides: Partial<UseSignalingSocketResult> = {}): UseSignalingSocketResult {
  return {
    session: undefined,
    peerOnline: false,
    connectionState: "connecting",
    role: undefined,
    lastSignal: null,
    createSession: vi.fn(),
    joinSession: vi.fn(),
    accept: vi.fn(),
    reject: vi.fn(),
    sendSignal: vi.fn(),
    ...overrides
  };
}

describe("TransferPage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows the creation screen before any session exists", () => {
    mockedUseSignalingSocket.mockReturnValue(makeResult());
    render(<TransferPage />);
    expect(screen.getByRole("heading", { name: "Nova transferência" })).toBeInTheDocument();
  });

  it("calls createSession when the button is clicked", async () => {
    const createSession = vi.fn();
    mockedUseSignalingSocket.mockReturnValue(makeResult({ createSession }));
    const user = userEvent.setup();
    render(<TransferPage />);

    await user.click(screen.getByRole("button", { name: "Nova transferência" }));

    expect(createSession).toHaveBeenCalled();
  });

  it("shows the shareable link and peer presence while waiting", () => {
    const session = {
      token: "abc123",
      status: "waiting" as const,
      createdAt: "t0",
      expiresAt: "t1"
    };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session, peerOnline: true }));
    render(<TransferPage />);

    expect(screen.getByRole("heading", { name: "Aguardando resposta" })).toBeInTheDocument();
    expect(screen.getByText(/\/s\/abc123$/)).toBeInTheDocument();
    expect(screen.getByText(/Destinatário conectado/)).toBeInTheDocument();
  });

  it("shows the accepted screen", () => {
    const session = {
      token: "abc123",
      status: "accepted" as const,
      createdAt: "t0",
      expiresAt: "t1"
    };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session }));
    render(<TransferPage />);
    expect(screen.getByRole("heading", { name: "Convite aceito" })).toBeInTheDocument();
  });

  it("shows the send panel once the data channel is open", () => {
    const session = {
      token: "abc123",
      status: "accepted" as const,
      createdAt: "t0",
      expiresAt: "t1"
    };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session, role: "host" }));
    mockedUsePeerConnection.mockReturnValue({
      dataChannel: {} as RTCDataChannel,
      channelState: "open"
    });
    render(<TransferPage />);
    expect(screen.getByRole("button", { name: "Escolher arquivos" })).toBeInTheDocument();
  });

  it("starts the peer connection once the session is accepted", () => {
    const session = {
      token: "abc123",
      status: "accepted" as const,
      createdAt: "t0",
      expiresAt: "t1"
    };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session, role: "host" }));
    render(<TransferPage />);

    expect(mockedUsePeerConnection).toHaveBeenCalledWith(
      expect.objectContaining({ role: "host", accepted: true })
    );
  });

  it("does not mark the peer connection as accepted while still waiting", () => {
    const session = {
      token: "abc123",
      status: "waiting" as const,
      createdAt: "t0",
      expiresAt: "t1"
    };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session, role: "host" }));
    render(<TransferPage />);

    expect(mockedUsePeerConnection).toHaveBeenCalledWith(
      expect.objectContaining({ accepted: false })
    );
  });

  it("shows the rejected screen with a retry action", async () => {
    const session = {
      token: "abc123",
      status: "rejected" as const,
      createdAt: "t0",
      expiresAt: "t1"
    };
    const createSession = vi.fn();
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session, createSession }));
    const user = userEvent.setup();
    render(<TransferPage />);

    expect(screen.getByRole("heading", { name: "Convite recusado" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Nova transferência" }));
    expect(createSession).toHaveBeenCalled();
  });

  it("shows the expired screen", () => {
    const session = {
      token: "abc123",
      status: "expired" as const,
      createdAt: "t0",
      expiresAt: "t1"
    };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session }));
    render(<TransferPage />);
    expect(screen.getByRole("heading", { name: "Link expirado" })).toBeInTheDocument();
  });

  it("shows a reconnecting banner when the connection drops", () => {
    const session = {
      token: "abc123",
      status: "waiting" as const,
      createdAt: "t0",
      expiresAt: "t1"
    };
    mockedUseSignalingSocket.mockReturnValue(
      makeResult({ session, connectionState: "reconnecting" })
    );
    render(<TransferPage />);
    expect(screen.getByText("Conexão perdida")).toBeInTheDocument();
  });
});
