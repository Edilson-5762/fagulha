import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptSession, fetchSession, rejectSession } from "../../../lib/sessions-api.js";
import SessionInvitePage from "./page.js";

vi.mock("next/navigation", () => ({
  useParams: () => ({ token: "abc123" })
}));

vi.mock("../../../lib/sessions-api.js", () => ({
  fetchSession: vi.fn(),
  acceptSession: vi.fn(),
  rejectSession: vi.fn()
}));

const mockedFetchSession = vi.mocked(fetchSession);
const mockedAcceptSession = vi.mocked(acceptSession);
const mockedRejectSession = vi.mocked(rejectSession);

function makeSession(status: "waiting" | "accepted" | "rejected" | "expired") {
  return { token: "abc123", status, createdAt: "t0", expiresAt: "t1" };
}

describe("SessionInvitePage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows the invite with accept/reject actions while waiting", async () => {
    mockedFetchSession.mockResolvedValue(makeSession("waiting"));
    render(<SessionInvitePage />);

    expect(await screen.findByRole("heading", { name: "Convite de transferência" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aceitar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recusar" })).toBeInTheDocument();
  });

  it("shows the expired screen when the token does not exist", async () => {
    mockedFetchSession.mockResolvedValue(null);
    render(<SessionInvitePage />);

    expect(await screen.findByRole("heading", { name: "Link expirado" })).toBeInTheDocument();
  });

  it("accepts the invite and shows the accepted screen", async () => {
    const user = userEvent.setup();
    mockedFetchSession.mockResolvedValue(makeSession("waiting"));
    mockedAcceptSession.mockResolvedValue(makeSession("accepted"));
    render(<SessionInvitePage />);

    await user.click(await screen.findByRole("button", { name: "Aceitar" }));

    expect(await screen.findByRole("heading", { name: "Convite aceito" })).toBeInTheDocument();
    expect(mockedAcceptSession).toHaveBeenCalledWith("abc123");
  });

  it("rejects the invite and shows the rejected screen", async () => {
    const user = userEvent.setup();
    mockedFetchSession.mockResolvedValue(makeSession("waiting"));
    mockedRejectSession.mockResolvedValue(makeSession("rejected"));
    render(<SessionInvitePage />);

    await user.click(await screen.findByRole("button", { name: "Recusar" }));

    expect(await screen.findByRole("heading", { name: "Convite recusado" })).toBeInTheDocument();
  });
});
