"use client";

import { AlertTriangle, Button, CheckCircle2, Download, FileText, Inbox, ProgressBar, StateScreen, XCircle } from "@transfergo/ui";
import type { UseFileTransferResult } from "../../lib/use-file-transfer.js";

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
    return (
      <StateScreen
        icon={AlertTriangle}
        tone="warning"
        title="Transferência cancelada"
        description="O recebimento foi interrompido."
      />
    );
  }

  if (phase === "preparing" || phase === "receiving") {
    return (
      <div className="w-full max-w-md">
        <p className="mb-4 text-center text-sm font-medium text-text">
          {phase === "preparing"
            ? "Preparando a transferência…"
            : `Recebendo ${transfer.overall.filesDone} de ${transfer.overall.filesTotal}…`}
        </p>
        {transfer.overall.filesTotal > 0 && (
          <ProgressBar
            className="mb-4"
            value={transfer.overall.filesTotal > 0 ? (transfer.overall.filesDone / transfer.overall.filesTotal) * 100 : 0}
            label="Progresso"
          />
        )}
        <ul className="flex flex-col gap-2">
          {(incomingBatch?.files ?? []).map((file) => {
            const status = transfer.perFile[file.id]?.state ?? "queued";
            const label =
              status === "completed" ? "Concluído" : status === "receiving" ? "Recebendo" : status === "failed" ? "Falhou" : "Aguardando";
            return (
              <li key={file.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <FileText className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
                  <span className="truncate">{file.name}</span>
                </span>
                <span className="ml-3 shrink-0 text-text-muted">{label}</span>
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
