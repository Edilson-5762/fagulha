import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./Dialog.js";

describe("Dialog", () => {
  it("opens on trigger click and closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Abrir</DialogTrigger>
        <DialogContent>
          <DialogTitle>Convite para transferência</DialogTitle>
          <DialogDescription>Um dispositivo deseja estabelecer uma sessão.</DialogDescription>
        </DialogContent>
      </Dialog>
    );

    expect(screen.queryByText("Convite para transferência")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Abrir" }));
    expect(await screen.findByText("Convite para transferência")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByText("Convite para transferência")).not.toBeInTheDocument();
  });
});
