import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button.js";

describe("Button", () => {
  it("renders children and applies the primary variant by default", () => {
    render(<Button>Nova transferência</Button>);
    const button = screen.getByRole("button", { name: "Nova transferência" });
    expect(button).toHaveClass("bg-accent");
  });

  it("applies the secondary variant class when variant is secondary", () => {
    render(<Button variant="secondary">Cancelar</Button>);
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveClass("bg-bg-elevated");
  });

  it("disables the button and marks it busy when isLoading is true", () => {
    render(<Button isLoading>Enviando</Button>);
    const button = screen.getByRole("button", { name: "Enviando" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Clique</Button>);
    await user.click(screen.getByRole("button", { name: "Clique" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders the child element instead of a button when asChild is set, keeping the button classes and the child's own attributes", () => {
    render(
      <Button asChild variant="secondary">
        <a href="/transferir">Nova transferência</a>
      </Button>
    );
    const link = screen.getByRole("link", { name: "Nova transferência" });
    expect(link).toHaveAttribute("href", "/transferir");
    expect(link).toHaveClass("bg-bg-elevated");
  });
});
