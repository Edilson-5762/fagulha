import type { Meta, StoryObj } from "@storybook/react";
import { ProgressBar } from "./ProgressBar.js";

const meta: Meta<typeof ProgressBar> = {
  title: "Progresso/ProgressBar",
  component: ProgressBar
};

export default meta;
type Story = StoryObj<typeof ProgressBar>;

export const WithLabel: Story = { args: { value: 74, label: "video.mp4" } };
export const WithoutLabel: Story = { args: { value: 40 } };
export const Complete: Story = { args: { value: 100, label: "relatorio.pdf" } };
