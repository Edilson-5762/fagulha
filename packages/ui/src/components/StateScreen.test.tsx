import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CheckCircle2 } from "../icons/index.js";
import { StateScreen } from "./StateScreen.js";

describe("StateScreen", () => {
  it("renders the title and description", () => {
    render(
      <StateScreen
        icon={CheckCircle2}
        tone="success"
        title="Transferência concluída"
        description="Integridade verificada (SHA-256)."
      />
    );

    expect(screen.getByRole("heading", { name: "Transferência concluída" })).toBeInTheDocument();
    expect(screen.getByText("Integridade verificada (SHA-256).")).toBeInTheDocument();
  });

  it("renders no action button when actions is omitted", () => {
    render(<StateScreen icon={CheckCircle2} title="Vazio" description="Nada por aqui ainda." />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("calls the action handler when a single action button is clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <StateScreen
        icon={CheckCircle2}
        title="Sessão expirada"
        description="Peça um novo link ao remetente."
        actions={[{ label: "Voltar ao início", onClick }]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Voltar ao início" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders two independent action buttons and calls the matching handler for each", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    const onReject = vi.fn();
    render(
      <StateScreen
        icon={CheckCircle2}
        title="Convite de transferência"
        description="Alguém quer iniciar uma transferência de arquivos com você."
        actions={[
          { label: "Aceitar", variant: "primary", onClick: onAccept },
          { label: "Recusar", variant: "secondary", onClick: onReject }
        ]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Recusar" }));
    expect(onReject).toHaveBeenCalledOnce();
    expect(onAccept).not.toHaveBeenCalled();
  });
});
