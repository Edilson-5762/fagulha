import type { Meta, StoryObj } from "@storybook/react";
import { Card } from "./Card.js";

const meta: Meta<typeof Card> = {
  title: "Conteúdo/Card",
  component: Card
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  args: {
    children: "Um card do design system, com o vidro fosco discreto da direção Dark Tech."
  }
};
