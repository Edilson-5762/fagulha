import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "./Input.js";

const meta: Meta<typeof Input> = {
  title: "Entrada/Input",
  component: Input,
  args: { placeholder: "https://fagulha.app/s/..." }
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {};
export const Error: Story = { args: { error: true, defaultValue: "link-invalido" } };
export const Disabled: Story = { args: { disabled: true } };
