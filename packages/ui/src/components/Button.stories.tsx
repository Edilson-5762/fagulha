import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button.js";

const meta: Meta<typeof Button> = {
  title: "Ações/Button",
  component: Button,
  args: { children: "Nova transferência" }
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = { args: { variant: "primary" } };
export const Secondary: Story = { args: { variant: "secondary" } };
export const Ghost: Story = { args: { variant: "ghost" } };
export const Danger: Story = { args: { variant: "danger", children: "Recusar" } };
export const Loading: Story = { args: { isLoading: true, children: "Enviando" } };
