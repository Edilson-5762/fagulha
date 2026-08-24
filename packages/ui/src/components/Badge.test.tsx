import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge.js";

describe("Badge", () => {
  it("applies the neutral tone by default", () => {
    render(<Badge>Normal</Badge>);
    expect(screen.getByText("Normal")).toHaveClass("text-text-muted");
  });

  it("applies each security tone correctly", () => {
    render(<Badge tone="security-sensitive">Sensível</Badge>);
    expect(screen.getByText("Sensível")).toHaveClass("text-security-sensitive");
  });
});
