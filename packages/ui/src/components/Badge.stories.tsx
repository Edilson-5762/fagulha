import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "./Badge.js";

const meta: Meta<typeof Badge> = {
  title: "Conteúdo/Badge",
  component: Badge,
  args: { children: "Normal" }
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Neutral: Story = { args: { tone: "neutral" } };
export const Success: Story = { args: { tone: "success", children: "Concluído" } };
export const Warning: Story = { args: { tone: "warning", children: "Atenção" } };
export const Danger: Story = { args: { tone: "danger", children: "Falha" } };
export const SecurityNormal: Story = { args: { tone: "security-normal", children: "Normal" } };
export const SecuritySensitive: Story = {
  args: { tone: "security-sensitive", children: "Sensível" }
};
export const SecurityConfidential: Story = {
  args: { tone: "security-confidential", children: "Confidencial" }
};
