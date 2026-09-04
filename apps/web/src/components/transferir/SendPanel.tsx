"use client";

import { useRef } from "react";
import {
  AlertTriangle,
  Badge,
  Button,
  CheckCircle2,
  FileText,
  ProgressBar,
  StateScreen,
  Upload,
  XCircle
} from "@transfergo/ui";
import type { UseFileTransferResult } from "../../lib/use-file-transfer.js";
import {
  formatBytes,
  formatDuration,
  formatSpeed,
  SIZE_CLASS_LABELS
} from "../../lib/transfer-format.js";

const SIZE_BADGE_TONE = { small: "neutral", medium: "warning", large: "danger" } as const;

export function SendPanel({ transfer }: { transfer: UseFileTransferResult }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { phase } = transfer;

  if (phase === "completed") {
    const n = transfer.overall.filesTotal;
    return (
      <StateScreen
        icon={CheckCircle2}
        tone="success"
        title={
          n === 1 ? "Arquivo transferido com sucesso" : `${n} arquivos transferidos com sucesso`
        }
        description="Os arquivos chegaram ao outro dispositivo."
        actions={[{ label: "Enviar mais arquivos", onClick: transfer.clearSelection }]}
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
        actions={[{ label: "Tentar de novo", onClick: transfer.clearSelection }]}
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
          saved === 0 ? "Nenhum arquivo chegou." : `${saved} de ${total} arquivos chegaram.`
        }
        actions={[{ label: "Nova transferência", onClick: transfer.clearSelection }]}
      />
    );
  }

  if (phase === "offering" || phase === "preparing" || phase === "sending") {
    const { overall, stats } = transfer;
    const multi = overall.filesTotal > 1;
    const currentIndex = Math.min(overall.filesDone + 1, overall.filesTotal);
    const activeName = transfer.selectedFiles[overall.filesDone]?.name ?? "";
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
          {phase === "offering"
            ? "Aguardando o outro lado aceitar…"
            : phase === "preparing"
              ? "Preparando a transferência…"
              : multi
                ? `Enviando arquivo ${currentIndex} de ${overall.filesTotal}`
                : `Enviando ${activeName}`}
        </p>

        {phase === "sending" && (
          <>
            <ProgressBar className="mb-1" value={bytesPct} label="Progresso" />
            <p className="mb-4 text-center text-xs text-text-muted">{statusParts.join(" · ")}</p>
          </>
        )}

        <ul className="flex flex-col gap-2">
          {transfer.selectedFiles.map((file) => {
            const pf = transfer.perFile[file.id];
            const state = pf?.state ?? "queued";
            const label =
              state === "completed"
                ? "Concluído"
                : state === "sending"
                  ? "Enviando"
                  : state === "failed"
                    ? "Falhou"
                    : "Na fila";
            return (
              <li key={file.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="flex min-w-0 items-center gap-2 truncate">
                    <FileText className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
                    <span className="truncate">{file.name}</span>
                  </span>
                  <span className="ml-3 shrink-0 text-text-muted">{label}</span>
                </div>
                {multi && state === "sending" && pf && (
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
  return (
    <div className="w-full max-w-md">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        aria-label="Escolher arquivos"
        onChange={(event) => {
          transfer.addFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <Button className="w-full" onClick={() => inputRef.current?.click()}>
        <Upload className="size-4" aria-hidden="true" />
        Escolher arquivos
      </Button>

      {transfer.selectedFiles.length > 0 && (
        <>
          <ul className="mt-4 flex flex-col gap-2">
            {transfer.selectedFiles.map((file) => (
              <li
                key={file.id}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <FileText className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
                  <span className="truncate">{file.name}</span>
                </span>
                <span className="ml-3 flex shrink-0 items-center gap-2">
                  <span className="text-text-muted">{formatBytes(file.size)}</span>
                  <Badge tone={SIZE_BADGE_TONE[file.sizeClass]}>
                    {SIZE_CLASS_LABELS[file.sizeClass]}
                  </Badge>
                  <button
                    type="button"
                    className="text-text-muted hover:text-text"
                    aria-label={`Remover ${file.name}`}
                    onClick={() => transfer.removeFile(file.id)}
                  >
                    <XCircle className="size-4" aria-hidden="true" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-center text-xs text-text-muted">
            {transfer.selectedFiles.length}{" "}
            {transfer.selectedFiles.length === 1 ? "arquivo" : "arquivos"} ·{" "}
            {formatBytes(transfer.totalBytes)}
          </p>
        </>
      )}

      {transfer.limitError && (
        <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-center text-xs text-danger">
          {transfer.limitError}
        </p>
      )}

      <Button
        className="mt-4 w-full"
        disabled={
          !transfer.ready || transfer.selectedFiles.length === 0 || transfer.limitError !== null
        }
        onClick={transfer.startSend}
      >
        Enviar
      </Button>
    </div>
  );
}
