import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./Tooltip.js";

const meta: Meta<typeof Tooltip> = {
  title: "Overlays/Tooltip",
  component: Tooltip
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const OnButton: Story = {
  render: () => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost">Copiar link</Button>
        </TooltipTrigger>
        <TooltipContent>Link expira em 24 horas</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
};
