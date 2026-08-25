import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSignalingSocket, type UseSignalingSocketResult } from "../../lib/signaling-socket.js";
import TransferPage from "./page.js";

vi.mock("../../lib/signaling-socket.js", () => ({
  useSignalingSocket: vi.fn()
}));

const mockedUseSignalingSocket = vi.mocked(useSignalingSocket);

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
    const session = { token: "abc123", status: "waiting" as const, createdAt: "t0", expiresAt: "t1" };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session, peerOnline: true }));
    render(<TransferPage />);

    expect(screen.getByRole("heading", { name: "Aguardando resposta" })).toBeInTheDocument();
    expect(screen.getByText(/\/s\/abc123$/)).toBeInTheDocument();
    expect(screen.getByText(/Destinatário conectado/)).toBeInTheDocument();
  });

  it("shows the accepted screen", () => {
    const session = { token: "abc123", status: "accepted" as const, createdAt: "t0", expiresAt: "t1" };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session }));
    render(<TransferPage />);
    expect(screen.getByRole("heading", { name: "Convite aceito" })).toBeInTheDocument();
  });

  it("shows the rejected screen with a retry action", async () => {
    const session = { token: "abc123", status: "rejected" as const, createdAt: "t0", expiresAt: "t1" };
    const createSession = vi.fn();
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session, createSession }));
    const user = userEvent.setup();
    render(<TransferPage />);

    expect(screen.getByRole("heading", { name: "Convite recusado" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Nova transferência" }));
    expect(createSession).toHaveBeenCalled();
  });

  it("shows the expired screen", () => {
    const session = { token: "abc123", status: "expired" as const, createdAt: "t0", expiresAt: "t1" };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session }));
    render(<TransferPage />);
    expect(screen.getByRole("heading", { name: "Link expirado" })).toBeInTheDocument();
  });

  it("shows a reconnecting banner when the connection drops", () => {
    const session = { token: "abc123", status: "waiting" as const, createdAt: "t0", expiresAt: "t1" };
    mockedUseSignalingSocket.mockReturnValue(makeResult({ session, connectionState: "reconnecting" }));
    render(<TransferPage />);
    expect(screen.getByText("Conexão perdida")).toBeInTheDocument();
  });
});
