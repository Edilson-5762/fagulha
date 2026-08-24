import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Spinner } from "./Spinner.js";

describe("Spinner", () => {
  it("renders a status role with a default label", () => {
    render(<Spinner />);
    expect(screen.getByRole("status", { name: "Carregando" })).toBeInTheDocument();
  });

  it("accepts a custom label", () => {
    render(<Spinner label="Conectando" />);
    expect(screen.getByRole("status", { name: "Conectando" })).toBeInTheDocument();
  });
});
