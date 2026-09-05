"use client";

import { useState } from "react";
import type { Session } from "@fagulha/shared";
import { AlertTriangle, CheckCircle2, Share2, StateScreen, WifiOff, XCircle } from "@fagulha/ui";
import { SessionLinkPanel } from "../../components/transferir/SessionLinkPanel.js";
import { SendPanel } from "../../components/transferir/SendPanel.js";
import { usePeerConnection } from "../../lib/peer-connection.js";
import { useFileTransfer } from "../../lib/use-file-transfer.js";
import { useSignalingSocket } from "../../lib/signaling-socket.js";

export default function TransferPage() {
  const { session, peerOnline, connectionState, role, sendSignal, lastSignal, createSession } =
    useSignalingSocket();
  const { dataChannel, channelState, failureReason } = usePeerConnection({
    role,
    accepted: session?.status === "accepted",
    sendSignal,
    lastSignal
  });
  const transfer = useFileTransfer({ role, dataChannel, channelState });

  // Uma vez que o canal abriu, fica com o painel de envio na tela pro resto da
  // vida da página — sem isso, o canal fechar sozinho depois de concluído (comum
  // no celular, ex.: navegador em segundo plano) fazia a tela voltar pro "Convite
  // aceito" estático em vez de mostrar a tela de sucesso/erro do próprio painel.
  // Ajuste de estado durante o render (padrão documentado do React para "derivar
  // de uma mudança de prop/valor externo"), não em efeito — só uma bandeira que
  // liga e nunca desliga de novo.
  const [everConnected, setEverConnected] = useState(channelState === "open");
  const [prevChannelState, setPrevChannelState] = useState(channelState);
  if (channelState !== prevChannelState) {
    setPrevChannelState(channelState);
    if (channelState === "open" && !everConnected) {
      setEverConnected(true);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      {connectionState === "reconnecting" && (
        <StateScreen
          icon={WifiOff}
          tone="danger"
          title="Conexão perdida"
          description="Tentando reconectar..."
        />
      )}
      {everConnected || channelState === "failed" ? (
        <SendPanel transfer={transfer} channelState={channelState} failureReason={failureReason} />
      ) : (
        renderContent(session, peerOnline, createSession)
      )}
    </main>
  );
}

function renderContent(
  session: Session | null | undefined,
  peerOnline: boolean,
  onCreateSession: () => void
) {
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
      return <SessionLinkPanel token={session.token} peerOnline={peerOnline} />;
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
    default: {
      const exhaustiveCheck: never = session.status;
      return exhaustiveCheck;
    }
  }
}
