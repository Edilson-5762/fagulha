import type { Meta, StoryObj } from "@storybook/react";
import { Toast, ToastProvider, ToastViewport } from "./Toast.js";

const meta: Meta<typeof Toast> = {
  title: "Overlays/Toast",
  component: Toast
};

export default meta;
type Story = StoryObj<typeof Toast>;

export const Success: Story = {
  render: () => (
    <ToastProvider>
      <Toast open title="Transferência concluída" description="Integridade verificada (SHA-256)." />
      <ToastViewport />
    </ToastProvider>
  )
};

export const TitleOnly: Story = {
  render: () => (
    <ToastProvider>
      <Toast open title="Link copiado" />
      <ToastViewport />
    </ToastProvider>
  )
};
