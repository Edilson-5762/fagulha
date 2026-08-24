"use client";

import { useState } from "react";
import { Button, Clock, StateScreen } from "@transfergo/ui";

export interface SessionLinkPanelProps {
  token: string;
}

export function SessionLinkPanel({ token }: SessionLinkPanelProps) {
  const [copied, setCopied] = useState(false);
  const link = typeof window !== "undefined" ? `${window.location.origin}/s/${token}` : `/s/${token}`;

  async function handleCopyLink() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col items-center">
      <StateScreen
        icon={Clock}
        title="Aguardando resposta"
        description="Compartilhe o link abaixo com o outro dispositivo."
      />
      <code className="max-w-full break-all rounded-md border border-border bg-bg-elevated px-4 py-3 text-sm text-text">
        {link}
      </code>
      <Button className="mt-4" onClick={handleCopyLink}>
        {copied ? "Copiado!" : "Copiar link"}
      </Button>
    </div>
  );
}
