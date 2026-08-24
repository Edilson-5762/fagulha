import type { Meta, StoryObj } from "@storybook/react";
import { SecurityLevelCard } from "./SecurityLevelCard.js";

const meta: Meta<typeof SecurityLevelCard> = {
  title: "Estados/SecurityLevelCard",
  component: SecurityLevelCard
};

export default meta;
type Story = StoryObj<typeof SecurityLevelCard>;

export const Normal: Story = { args: { level: "normal" } };
export const Sensitive: Story = { args: { level: "sensitive" } };
export const Confidential: Story = { args: { level: "confidential" } };
