import type { Meta, StoryObj } from "@storybook/react";
import { Spinner } from "./Spinner.js";

const meta: Meta<typeof Spinner> = {
  title: "Progresso/Spinner",
  component: Spinner
};

export default meta;
type Story = StoryObj<typeof Spinner>;

export const Small: Story = { args: { size: "sm" } };
export const Medium: Story = { args: { size: "md" } };
export const Large: Story = { args: { size: "lg" } };
