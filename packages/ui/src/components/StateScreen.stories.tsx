import type { Meta, StoryObj } from "@storybook/react";
import { AlertTriangle, CheckCircle2, Inbox, WifiOff } from "../icons/index.js";
import { StateScreen } from "./StateScreen.js";

const meta: Meta<typeof StateScreen> = {
  title: "Estados/StateScreen",
  component: StateScreen
};

export default meta;
type Story = StoryObj<typeof StateScreen>;

export const Success: Story = {
  args: {
    icon: CheckCircle2,
    tone: "success",
    title: "Transferência concluída",
    description: "Integridade verificada (SHA-256)."
  }
};

export const Empty: Story = {
  args: {
    icon: Inbox,
    title: "Nenhuma transferência ainda",
    description: "Quando você enviar ou receber um arquivo, ele aparece aqui."
  }
};

export const Offline: Story = {
  args: {
    icon: WifiOff,
    tone: "warning",
    title: "Conexão perdida",
    description: "Tentando reconectar automaticamente."
  }
};

export const Error: Story = {
  args: {
    icon: AlertTriangle,
    tone: "danger",
    title: "Sessão expirada",
    description: "Peça um novo link ao remetente.",
    action: { label: "Voltar ao início", onClick: () => {} }
  }
};
