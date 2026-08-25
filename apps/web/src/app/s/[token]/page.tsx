"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import type { Session } from "@transfergo/shared";
import { AlertTriangle, CheckCircle2, Clock, ShieldCheck, StateScreen, WifiOff, XCircle } from "@transfergo/ui";
import { usePeerConnection } from "../../../lib/peer-connection.js";
import { useSignalingSocket } from "../../../lib/signaling-socket.js";

export default function SessionInvitePage() {
  const { token } = useParams<{ token: string }>();
  const { session, connectionState, role, sendSignal, lastSignal, joinSession, accept, reject } = useSignalingSocket();

  useEffect(() => {
    joinSession(token);
  }, [token, joinSession]);

  usePeerConnection({ role, accepted: session?.status === "accepted", sendSignal, lastSignal });

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      {connectionState === "reconnecting" && (
        <StateScreen icon={WifiOff} tone="danger" title="Conexão perdida" description="Tentando reconectar..." />
      )}
      {renderContent(session, accept, reject)}
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
          description="Aguardando a conexão direta entre os dispositivos."
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
