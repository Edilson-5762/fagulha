import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Hero } from "./Hero.js";

describe("Hero", () => {
  it("renders the headline and a primary CTA linking to /transferir", () => {
    render(<Hero />);
    expect(
      screen.getByRole("heading", {
        name: "Transfira arquivos com segurança entre seus dispositivos."
      })
    ).toBeInTheDocument();

    const cta = screen.getByRole("link", { name: "Nova transferência" });
    expect(cta).toHaveAttribute("href", "/transferir");
  });
});
