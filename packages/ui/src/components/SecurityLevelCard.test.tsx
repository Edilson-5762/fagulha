import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SecurityLevelCard } from "./SecurityLevelCard.js";

describe("SecurityLevelCard", () => {
  it("renders the normal level title", () => {
    render(<SecurityLevelCard level="normal" />);
    expect(screen.getByRole("heading", { name: "Transferência normal" })).toBeInTheDocument();
  });

  it("renders the sensitive level title", () => {
    render(<SecurityLevelCard level="sensitive" />);
    expect(screen.getByRole("heading", { name: "Conteúdo sensível" })).toBeInTheDocument();
  });

  it("renders the confidential level title", () => {
    render(<SecurityLevelCard level="confidential" />);
    expect(screen.getByRole("heading", { name: "Conteúdo confidencial" })).toBeInTheDocument();
  });
});
