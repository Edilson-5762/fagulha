"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Session } from "@transfergo/shared";
import { AlertTriangle, CheckCircle2, Clock, ShieldCheck, StateScreen, XCircle } from "@transfergo/ui";
import { acceptSession, fetchSession, rejectSession } from "../../../lib/sessions-api.js";

export default function SessionInvitePage() {
  const { token } = useParams<{ token: string }>();
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchSession(token)
      .then((result) => {
        if (!cancelled) {
          setSession(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSession(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleAccept() {
    try {
      setSession(await acceptSession(token));
    } catch {
      setSession(await fetchSession(token));
    }
  }

  async function handleReject() {
    try {
      setSession(await rejectSession(token));
    } catch {
      setSession(await fetchSession(token));
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      {renderContent(session, handleAccept, handleReject)}
    </main>
  );
}

function renderContent(session: Session | null | undefined, onAccept: () => void, onReject: () => void) {
  if (session === undefined) {
    return <StateScreen icon={Clock} title="Carregando" description="Verificando o link recebido." />;
  }

  if (session === null) {
    return (
      <StateScreen
        icon={AlertTriangle}
        tone="danger"
        title="Link expirado"
        description="Peça um novo link a quem te convidou."
      />
    );
  }

  switch (session.status) {
    case "waiting":
      return (
        <StateScreen
          icon={ShieldCheck}
          title="Convite de transferência"
          description="Alguém quer iniciar uma transferência de arquivos com você."
          actions={[
            { label: "Aceitar", variant: "primary", onClick: onAccept },
            { label: "Recusar", variant: "secondary", onClick: onReject }
          ]}
        />
      );
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
          description="Você recusou esta transferência."
        />
      );
    case "expired":
      return (
        <StateScreen
          icon={AlertTriangle}
          tone="danger"
          title="Link expirado"
          description="Peça um novo link a quem te convidou."
        />
      );
    default: {
      const exhaustiveCheck: never = session.status;
      return exhaustiveCheck;
    }
  }
}
