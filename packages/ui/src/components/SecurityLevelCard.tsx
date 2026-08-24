"use client";

import { AlertTriangle, CheckCircle2, Lock } from "../icons/index.js";
import { StateScreen, type StateScreenAction } from "./StateScreen.js";

const LEVEL_CONFIG = {
  normal: {
    icon: CheckCircle2,
    tone: "security-normal" as const,
    title: "Transferência normal",
    description: "Confirme para receber este arquivo."
  },
  sensitive: {
    icon: AlertTriangle,
    tone: "security-sensitive" as const,
    title: "Conteúdo sensível",
    description: "Confirme que você estava esperando esta transferência."
  },
  confidential: {
    icon: Lock,
    tone: "security-confidential" as const,
    title: "Conteúdo confidencial",
    description: "Você precisará de uma chave obtida diretamente com o remetente."
  }
};

export interface SecurityLevelCardProps {
  level: keyof typeof LEVEL_CONFIG;
  action?: StateScreenAction;
}

export function SecurityLevelCard({ level, action }: SecurityLevelCardProps) {
  const config = LEVEL_CONFIG[level];
  return (
    <StateScreen icon={config.icon} tone={config.tone} title={config.title} description={config.description} action={action} />
  );
}
