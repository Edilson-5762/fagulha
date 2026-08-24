import { fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import TransferPage from "./page.js";

function mockFetchSequence(...responses: Array<{ status: number; body: unknown }>) {
  const fetchMock = vi.fn();
  for (const { status, body } of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body)
    });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("TransferPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the creation screen before any session exists", () => {
    render(<TransferPage />);
    expect(screen.getByRole("heading", { name: "Nova transferência" })).toBeInTheDocument();
  });

  it("creates a session and shows the shareable link", async () => {
    const user = userEvent.setup();
    mockFetchSequence({
      status: 201,
      body: { token: "abc123", status: "waiting", createdAt: "t0", expiresAt: "t1" }
    });
    render(<TransferPage />);

    await user.click(screen.getByRole("button", { name: "Nova transferência" }));

    expect(await screen.findByRole("heading", { name: "Aguardando resposta" })).toBeInTheDocument();
    expect(screen.getByText(/\/s\/abc123$/)).toBeInTheDocument();
  });

  it("shows an error screen when session creation fails", async () => {
    const user = userEvent.setup();
    mockFetchSequence({ status: 500, body: { error: "internal" } });
    render(<TransferPage />);

    await user.click(screen.getByRole("button", { name: "Nova transferência" }));

    expect(await screen.findByRole("heading", { name: "Não foi possível criar a sessão" })).toBeInTheDocument();
  });

  it(
    "treats a 404 during polling as expiry and stops polling",
    async () => {
      mockFetchSequence(
        {
          status: 201,
          body: { token: "abc123", status: "waiting", createdAt: "t0", expiresAt: "t1" }
        },
        { status: 404, body: { error: "not_found" } }
      );
      render(<TransferPage />);

      fireEvent.click(screen.getByRole("button", { name: "Nova transferência" }));

      expect(await screen.findByRole("heading", { name: "Aguardando resposta" })).toBeInTheDocument();

      expect(
        await screen.findByRole("heading", { name: "Link expirado" }, { timeout: 4000 })
      ).toBeInTheDocument();
    },
    8000
  );
});
