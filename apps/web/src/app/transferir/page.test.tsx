import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TransferPlaceholderPage from "./page.js";

describe("TransferPlaceholderPage", () => {
  it("renders an under-construction message", () => {
    render(<TransferPlaceholderPage />);
    expect(screen.getByRole("heading", { name: "Em construção" })).toBeInTheDocument();
  });
});
