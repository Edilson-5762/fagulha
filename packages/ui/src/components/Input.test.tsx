import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "./Input.js";

describe("Input", () => {
  it("renders with the default border and no aria-invalid", () => {
    render(<Input placeholder="Cole o link aqui" />);
    const input = screen.getByPlaceholderText("Cole o link aqui");
    expect(input).toHaveClass("border-border");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("applies the error state when error is true", () => {
    render(<Input placeholder="Cole o link aqui" error />);
    const input = screen.getByPlaceholderText("Cole o link aqui");
    expect(input).toHaveClass("border-danger");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });
});
