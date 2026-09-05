"use client";

import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Button,
  CheckCircle2,
  Download,
  FileText,
  Inbox,
  ProgressBar,
  StateScreen,
  WifiOff,
  XCircle
} from "@fagulha/ui";
import type { ChannelFailureReason, PeerChannelState } from "../../lib/peer-connection.js";
import type { UseFileTransferResult } from "../../lib/use-file-transfer.js";
import { formatBytes, formatDuration, formatSpeed } from "../../lib/transfer-format.js";

export function ReceivePanel({
  transfer,
  channelState,
  failureReason
}: {
  transfer: UseFileTransferResult;
  channelState?: PeerChannelState;
  failureReason?: ChannelFailureReason | null;
}) {
  const router = useRouter();
  const { phase, incomingBatch } = transfer;
  const exitAction = {
    label: "Sair",
    variant: "secondary" as const,
    onClick: () => router.push("/")
  };

  if (phase === "completed") {
    const n = transfer.overall.filesTotal;
    return (
      <div className="w-full">
        <StateScreen
          icon={CheckCircle2}
          tone="success"
          title={n === 1 ? "Arquivo recebido com sucesso" : `${n} arquivos recebidos com sucesso`}
          description="Os arquivos foram salvos neste dispositivo."
          actions={[exitAction]}
        />
        {transfer.integrityVerified && (
          <p className="-mt-6 flex items-center justify-center gap-1 text-xs text-success">
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
            Integridade verificada (SHA-256)
          </p>
        )}
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <StateScreen
        icon={XCircle}
        tone="danger"
        title="A transferência falhou"
        description={transfer.errorMessage ?? "Algo deu errado durante a transferência."}
        actions={[exitAction]}
      />
    );
  }

  if (phase === "cancelled") {
    const saved = transfer.filesSaved;
    const total = transfer.overall.filesTotal;
    return (
      <StateScreen
        icon={AlertTriangle}
        tone="warning"
        title="Transferência cancelada"
        description={
          saved === 0
            ? "Nenhum arquivo foi salvo."
            : `${saved} de ${total} arquivos foram salvos neste dispositivo.`
        }
        actions={[exitAction]}
      />
    );
  }

  if (phase === "preparing" || phase === "receiving") {
    const { overall, stats } = transfer;
    const multi = overall.filesTotal > 1;
    const currentIndex = Math.min(overall.filesDone + 1, overall.filesTotal);
    const activeName = incomingBatch?.files[overall.filesDone]?.name ?? "";
    const bytesPct = overall.bytesTotal > 0 ? (overall.bytesDone / overall.bytesTotal) * 100 : 0;

    const statusParts: string[] = [
      `${formatBytes(overall.bytesDone)} de ${formatBytes(overall.bytesTotal)}`
    ];
    if (stats.speedBytesPerSec === 0) {
      statusParts.push("parado");
    } else if (stats.speedBytesPerSec != null) {
      statusParts.push(formatSpeed(stats.speedBytesPerSec));
    }
    if (stats.etaSeconds != null) {
      statusParts.push(formatDuration(stats.etaSeconds));
    }
    if (stats.speedBytesPerSec == null && stats.etaSeconds == null) {
      statusParts.push("calculando…");
    }

    return (
      <div className="w-full max-w-md">
        <p className="mb-2 text-center text-sm font-medium text-text">
          {phase === "preparing"
            ? "Preparando a transferência…"
            : multi
              ? `Recebendo arquivo ${currentIndex} de ${overall.filesTotal}`
              : `Recebendo ${activeName}`}
        </p>

        {phase === "receiving" && (
          <>
            <ProgressBar className="mb-1" value={bytesPct} label="Progresso" />
            <p className="mb-4 text-center text-xs text-text-muted">{statusParts.join(" · ")}</p>
          </>
        )}

        <ul className="flex flex-col gap-2">
          {(incomingBatch?.files ?? []).map((file) => {
            const pf = transfer.perFile[file.id];
            const state = pf?.state ?? "queued";
            const label =
              state === "completed"
                ? "Verificado"
                : state === "receiving"
                  ? "Recebendo"
                  : state === "failed"
                    ? "Falhou"
                    : "Na fila";
            return (
              <li key={file.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="flex min-w-0 items-center gap-2">
                    <FileText className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
                    <span className="truncate">{file.name}</span>
                  </span>
                  <span className="ml-3 flex shrink-0 items-center gap-1 text-text-muted">
                    {state === "completed" && (
                      <CheckCircle2 className="size-3 text-success" aria-hidden="true" />
                    )}
                    {label}
                  </span>
                </div>
                {multi && state === "receiving" && pf && (
                  <ProgressBar className="mt-2" value={pf.pct} label={file.name} />
                )}
              </li>
            );
          })}
        </ul>

        <Button className="mt-4 w-full" variant="secondary" onClick={transfer.cancel}>
          Cancelar
        </Button>
      </div>
    );
  }

  // phase === "idle"
  if (!incomingBatch) {
    if (channelState && channelState !== "open") {
      return (
        <StateScreen
          icon={WifiOff}
          tone="danger"
          title="Conexão perdida"
          description={
            failureReason === "turn_unavailable"
              ? "Não foi possível usar o servidor de apoio à conexão agora. Tente novamente mais tarde ou use outra rede (Wi-Fi em vez de dados móveis)."
              : "A conexão com o outro dispositivo caiu. Peça um novo link para tentar de novo."
          }
          actions={[exitAction]}
        />
      );
    }
    return <StateScreen icon={Inbox} title="Conectado" description="Aguardando os arquivos…" />;
  }

  return (
    <div className="w-full max-w-md text-center">
      <StateScreen
        icon={Download}
        title="Arquivos a caminho"
        description={incomingBatch.summary}
        actions={[
          { label: "Receber", variant: "primary", onClick: () => void transfer.acceptBatch() },
          { label: "Recusar", variant: "secondary", onClick: transfer.rejectBatch }
        ]}
      />
      {incomingBatch.requiresMemoryWarning && (
        <p className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          Este navegador vai precisar segurar o arquivo inteiro na memória. Para arquivos grandes,
          use o Chrome ou o Edge no computador.
        </p>
      )}
    </div>
  );
}
