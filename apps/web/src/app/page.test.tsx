import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page.js";

describe("HomePage", () => {
  it("renders the hero headline and primary call to action", () => {
    render(<HomePage />);
    expect(
      screen.getByRole("heading", { name: "Transfira arquivos com segurança entre seus dispositivos." })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nova transferência" })).toHaveAttribute("href", "/transferir");
  });

  it("renders the three how-it-works steps in order", () => {
    render(<HomePage />);
    expect(screen.getByText("1. Selecionar")).toBeInTheDocument();
    expect(screen.getByText("2. Conectar")).toBeInTheDocument();
    expect(screen.getByText("3. Transferir")).toBeInTheDocument();
  });

  it("renders a GitHub link in the footer", () => {
    render(<HomePage />);
    expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/Edilson-5762/transfergo"
    );
  });
});
