import type { Meta, StoryObj } from "@storybook/react";
import { AlertTriangle, CheckCircle2, Inbox, ShieldCheck, WifiOff } from "../icons/index.js";
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
    actions: [{ label: "Voltar ao início", onClick: () => {} }]
  }
};

export const Invite: Story = {
  args: {
    icon: ShieldCheck,
    title: "Convite de transferência",
    description: "Alguém quer iniciar uma transferência de arquivos com você.",
    actions: [
      { label: "Aceitar", variant: "primary", onClick: () => {} },
      { label: "Recusar", variant: "secondary", onClick: () => {} }
    ]
  }
};
