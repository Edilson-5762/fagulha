import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "./Card.js";

describe("Card", () => {
  it("renders children inside a bordered, elevated container", () => {
    render(<Card data-testid="card">Conteúdo</Card>);
    const card = screen.getByTestId("card");
    expect(card).toHaveTextContent("Conteúdo");
    expect(card).toHaveClass("border-border");
  });

  it("merges a custom className with the base classes", () => {
    render(
      <Card data-testid="card" className="mt-4">
        Conteúdo
      </Card>
    );
    expect(screen.getByTestId("card")).toHaveClass("mt-4");
  });
});
