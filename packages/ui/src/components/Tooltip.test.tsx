import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./Tooltip.js";

describe("Tooltip", () => {
  it("shows the tooltip content when the trigger receives focus", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger>Ajuda</TooltipTrigger>
          <TooltipContent>Link expira em 24 horas</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    expect(screen.queryByText("Link expira em 24 horas")).not.toBeInTheDocument();
    await user.tab();
    expect(await screen.findByText("Link expira em 24 horas")).toBeInTheDocument();
  });
});
