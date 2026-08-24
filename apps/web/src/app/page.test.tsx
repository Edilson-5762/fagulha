import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("HomePage", () => {
  it("renders the TransferGo heading", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { name: "TransferGo" })).toBeInTheDocument();
  });

  it("lists every transfer state from the shared package", () => {
    render(<HomePage />);
    expect(screen.getByText("queued")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
  });
});
