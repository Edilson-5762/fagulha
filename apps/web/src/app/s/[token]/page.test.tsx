import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePeerConnection } from "../../../lib/peer-connection.js";
import { useSignalingSocket, type UseSignalingSocketResult } from "../../../lib/signaling-socket.js";
import type { UseFileTransferResult } from "../../../lib/use-file-transfer.js";
import SessionInvitePage from "./page.js";

vi.mock("next/navigation", () => ({
  useParams: () => ({ token: "abc123" })
}));

vi.mock("../../../lib/signaling-socket.js", () => ({
  useSignalingSocket: vi.fn()
}));

vi.mock("../../../lib/peer-connection.js", () => ({
  usePeerConnection: vi.fn()
}));

vi.mock("../../../lib/use-file-transfer.js", () => ({
  useFileTransfer: vi.fn(
    (): UseFileTransferResult => ({
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
      cancel: vi.fn()
    })
  )
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

describe("SessionInvitePage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("joins the session for the token from the URL on mount", () => {
    const joinSession = vi.fn();
    mockedUseSignalingSocket.mockReturnValue(makeResult({ joinSession }));
    render(<SessionInvitePage />);
    expect(joinSession).toHaveBeenCalledWith("abc123");
  });

  it("shows a loading screen while the session is unknown", () => {
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session: undefined }));
    render(<SessionInvitePage />);
    expect(screen.getByRole("heading", { name: "Carregando" })).toBeInTheDocument();
  });

  it("shows the invite with accept/reject actions while waiting", () => {
    const session = { token: "abc123", status: "waiting" as const, createdAt: "t0", expiresAt: "t1" };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session }));
    render(<SessionInvitePage />);

    expect(screen.getByRole("heading", { name: "Convite de transferência" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aceitar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recusar" })).toBeInTheDocument();
  });

  it("shows the expired screen when the session is null", () => {
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session: null }));
    render(<SessionInvitePage />);
    expect(screen.getByRole("heading", { name: "Link expirado" })).toBeInTheDocument();
  });

  it("starts the peer connection once the invite is accepted", () => {
    const session = { token: "abc123", status: "accepted" as const, createdAt: "t0", expiresAt: "t1" };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session, role: "guest" }));
    render(<SessionInvitePage />);

    expect(mockedUsePeerConnection).toHaveBeenCalledWith(expect.objectContaining({ role: "guest", accepted: true }));
  });

  it("shows the receive panel once the data channel is open", () => {
    const session = { token: "abc123", status: "accepted" as const, createdAt: "t0", expiresAt: "t1" };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session, role: "guest" }));
    mockedUsePeerConnection.mockReturnValue({ dataChannel: {} as RTCDataChannel, channelState: "open" });
    render(<SessionInvitePage />);

    expect(screen.getByText("Aguardando os arquivos…")).toBeInTheDocument();
  });

  it("calls accept when the accept button is clicked", async () => {
    const accept = vi.fn();
    const session = { token: "abc123", status: "waiting" as const, createdAt: "t0", expiresAt: "t1" };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session, accept }));
    const user = userEvent.setup();
    render(<SessionInvitePage />);

    await user.click(screen.getByRole("button", { name: "Aceitar" }));
    expect(accept).toHaveBeenCalled();
  });

  it("calls reject when the reject button is clicked", async () => {
    const reject = vi.fn();
    const session = { token: "abc123", status: "waiting" as const, createdAt: "t0", expiresAt: "t1" };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session, reject }));
    const user = userEvent.setup();
    render(<SessionInvitePage />);

    await user.click(screen.getByRole("button", { name: "Recusar" }));
    expect(reject).toHaveBeenCalled();
  });

  it("shows a reconnecting banner on top of the invite when the connection drops", () => {
    const session = { token: "abc123", status: "waiting" as const, createdAt: "t0", expiresAt: "t1" };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session, connectionState: "reconnecting" }));
    render(<SessionInvitePage />);

    expect(screen.getByText("Conexão perdida")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Convite de transferência" })).toBeInTheDocument();
  });
});
