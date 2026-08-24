import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionLinkPanel } from "./SessionLinkPanel.js";

describe("SessionLinkPanel", () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it("shows the shareable link containing the token", () => {
    render(<SessionLinkPanel token="abc123" />);
    expect(screen.getByText(/\/s\/abc123$/)).toBeInTheDocument();
  });

  it("copies the link and shows confirmation when clicked", async () => {
    const user = userEvent.setup();
    // userEvent.setup() installs its own navigator.clipboard stub, replacing the
    // beforeEach mock; spy on it here (after setup) so the assertion below works.
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<SessionLinkPanel token="abc123" />);

    await user.click(screen.getByRole("button", { name: "Copiar link" }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("/s/abc123"));
    expect(await screen.findByRole("button", { name: "Copiado!" })).toBeInTheDocument();
  });
});
