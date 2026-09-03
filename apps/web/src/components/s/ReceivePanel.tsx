"use client";

import { AlertTriangle, Button, CheckCircle2, Download, FileText, Inbox, ProgressBar, StateScreen, XCircle } from "@transfergo/ui";
import type { UseFileTransferResult } from "../../lib/use-file-transfer.js";
import { formatBytes, formatDuration, formatSpeed } from "../../lib/transfer-format.js";

export function ReceivePanel({ transfer }: { transfer: UseFileTransferResult }) {
  const { phase, incomingBatch } = transfer;

  if (phase === "completed") {
    const n = transfer.overall.filesTotal;
    return (
      <StateScreen
        icon={CheckCircle2}
        tone="success"
        title={n === 1 ? "Arquivo recebido com sucesso" : `${n} arquivos recebidos com sucesso`}
        description="Os arquivos foram salvos neste dispositivo."
      />
    );
  }

  if (phase === "failed") {
    return (
      <StateScreen
        icon={XCircle}
        tone="danger"
        title="A transferência falhou"
        description={transfer.errorMessage ?? "Algo deu errado durante a transferência."}
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
      />
    );
  }

  if (phase === "preparing" || phase === "receiving") {
    const { overall, stats } = transfer;
    const multi = overall.filesTotal > 1;
    const currentIndex = Math.min(overall.filesDone + 1, overall.filesTotal);
    const activeName = incomingBatch?.files[overall.filesDone]?.name ?? "";
    const bytesPct = overall.bytesTotal > 0 ? (overall.bytesDone / overall.bytesTotal) * 100 : 0;

    const statusParts: string[] = [`${formatBytes(overall.bytesDone)} de ${formatBytes(overall.bytesTotal)}`];
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
                ? "Concluído"
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
                  <span className="ml-3 shrink-0 text-text-muted">{label}</span>
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
          Este navegador vai precisar segurar o arquivo inteiro na memória. Para arquivos grandes, use o Chrome ou o Edge no computador.
        </p>
      )}
    </div>
  );
}
