import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Textarea } from "./Textarea.js";

describe("Textarea", () => {
  it("renders with the default border and no aria-invalid", () => {
    render(<Textarea placeholder="Mensagem" />);
    const textarea = screen.getByPlaceholderText("Mensagem");
    expect(textarea).toHaveClass("border-border");
    expect(textarea).not.toHaveAttribute("aria-invalid");
  });

  it("applies the error state when error is true", () => {
    render(<Textarea placeholder="Mensagem" error />);
    expect(screen.getByPlaceholderText("Mensagem")).toHaveClass("border-danger");
  });
});
