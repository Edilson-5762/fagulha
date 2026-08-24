import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "./ProgressBar.js";

describe("ProgressBar", () => {
  it("exposes the current value via ARIA progressbar attributes", () => {
    render(<ProgressBar value={74} label="video.mp4" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "74");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("clamps values outside the 0-100 range", () => {
    render(<ProgressBar value={150} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("renders the label and rounded percentage when a label is given", () => {
    render(<ProgressBar value={74.6} label="video.mp4" />);
    expect(screen.getByText("video.mp4")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
  });
});
