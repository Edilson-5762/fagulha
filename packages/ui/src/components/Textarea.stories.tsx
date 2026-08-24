import type { Meta, StoryObj } from "@storybook/react";
import { Textarea } from "./Textarea.js";

const meta: Meta<typeof Textarea> = {
  title: "Entrada/Textarea",
  component: Textarea,
  args: { placeholder: "Mensagem para o destinatário (opcional)" }
};

export default meta;
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {};
export const Error: Story = { args: { error: true } };
