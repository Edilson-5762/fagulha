"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@transfergo/shared";
import { AlertTriangle, CheckCircle2, Share2, StateScreen, XCircle } from "@transfergo/ui";
import { SessionLinkPanel } from "../../components/transferir/SessionLinkPanel.js";
import { createSession, fetchSession } from "../../lib/sessions-api.js";

const POLL_INTERVAL_MS = 2000;

export default function TransferPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [createError, setCreateError] = useState(false);

  const handleCreateSession = useCallback(async () => {
    setCreateError(false);
    try {
      const created = await createSession();
      setSession(created);
    } catch {
      setCreateError(true);
    }
  }, []);

  useEffect(() => {
    if (!session || session.status !== "waiting") {
      return;
    }

    const token = session.token;
    const interval = setInterval(() => {
      fetchSession(token)
        .then((updated) => {
          if (updated) {
            setSession(updated);
          }
        })
        .catch(() => {
          // transient failure; the next tick retries
        });
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [session]);

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      {renderContent(session, createError, handleCreateSession)}
    </main>
  );
}

function renderContent(session: Session | null, createError: boolean, onCreateSession: () => void) {
  if (createError) {
    return (
      <StateScreen
        icon={AlertTriangle}
        tone="danger"
        title="Não foi possível criar a sessão"
        description="Verifique sua conexão e tente novamente."
        actions={[{ label: "Tentar novamente", onClick: onCreateSession }]}
      />
    );
  }

  if (!session) {
    return (
      <StateScreen
        icon={Share2}
        title="Nova transferência"
        description="Crie uma sessão para gerar um link seguro e convidar outro dispositivo."
        actions={[{ label: "Nova transferência", onClick: onCreateSession }]}
      />
    );
  }

  switch (session.status) {
    case "waiting":
      return <SessionLinkPanel token={session.token} />;
    case "accepted":
      return (
        <StateScreen
          icon={CheckCircle2}
          tone="success"
          title="Convite aceito"
          description="A conexão real entre os dispositivos chega em um próximo passo do projeto."
        />
      );
    case "rejected":
      return (
        <StateScreen
          icon={XCircle}
          tone="danger"
          title="Convite recusado"
          description="O destinatário recusou esta transferência."
          actions={[{ label: "Nova transferência", onClick: onCreateSession }]}
        />
      );
    case "expired":
      return (
        <StateScreen
          icon={AlertTriangle}
          tone="danger"
          title="Link expirado"
          description="Crie uma nova sessão para gerar outro link."
          actions={[{ label: "Nova transferência", onClick: onCreateSession }]}
        />
      );
    default:
      return null;
  }
}
