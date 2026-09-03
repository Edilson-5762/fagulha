"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BATCH_MAX_BYTES,
  BATCH_MAX_FILES,
  classifyFileSize,
  type ConnectionRole,
  type FileSizeClass
} from "@transfergo/shared";
import {
  TransferReceiver,
  TransferSender,
  type FileMeta,
  type TransferError,
  type TransferProgress
} from "@transfergo/transfer-engine";
import {
  adaptRtcDataChannel,
  createFileChunkSource,
  isFileSystemAccessSupported,
  pickSaveTarget
} from "./browser-io.js";
import { formatBytes, summarizeBatch } from "./transfer-format.js";

export interface SelectedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  sizeClass: FileSizeClass;
}

export type TransferPhase =
  | "idle"
  | "offering"
  | "preparing"
  | "sending"
  | "receiving"
  | "completed"
  | "cancelled"
  | "failed";

export type PerFileState = "queued" | "preparing" | "sending" | "receiving" | "completed" | "failed";

export interface PerFileStatus {
  bytes: number;
  size: number;
  pct: number;
  state: PerFileState;
}

export interface TransferOverall {
  bytesDone: number;
  bytesTotal: number;
  filesDone: number;
  filesTotal: number;
}

export interface TransferStats {
  speedBytesPerSec: number | null;
  etaSeconds: number | null;
}

export interface IncomingBatch {
  files: FileMeta[];
  totalBytes: number;
  summary: string;
  requiresMemoryWarning: boolean;
}

export interface UseFileTransferParams {
  role: ConnectionRole | undefined;
  dataChannel: RTCDataChannel | null;
  channelState: "idle" | "connecting" | "open" | "failed";
}

export interface UseFileTransferResult {
  ready: boolean;
  selectedFiles: SelectedFile[];
  totalBytes: number;
  limitError: string | null;
  addFiles: (files: File[]) => void;
  removeFile: (id: string) => void;
  clearSelection: () => void;
  startSend: () => void;
  incomingBatch: IncomingBatch | null;
  acceptBatch: () => Promise<void>;
  rejectBatch: () => void;
  phase: TransferPhase;
  perFile: Record<string, PerFileStatus>;
  overall: TransferOverall;
  stats: TransferStats;
  filesSaved: number;
  errorMessage: string | null;
  cancel: () => void;
}

const ERROR_MESSAGES: Record<TransferError["code"], string | null> = {
  rejected: "O outro lado recusou a transferência.",
  "over-limit": "A seleção passou do limite de 50 arquivos ou 5 GB.",
  busy: "O outro lado já está no meio de outra transferência.",
  "size-mismatch": "Um arquivo chegou incompleto. A transferência foi interrompida.",
  "bad-frame": "A conexão falhou durante a transferência.",
  "channel-error": "A conexão falhou durante a transferência.",
  cancelled: null
};

const EMPTY_OVERALL: TransferOverall = { bytesDone: 0, bytesTotal: 0, filesDone: 0, filesTotal: 0 };
const EMPTY_STATS: TransferStats = { speedBytesPerSec: null, etaSeconds: null };

const SPEED_WINDOW_MS = 5000;
const SPEED_MIN_SPAN_MS = 1000;
const ETA_MIN_ELAPSED_MS = 3000;
const STATS_TICK_MS = 1000;

const monotonicNow = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();

let batchCounter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(batchCounter++).toString(36)}`;

export function useFileTransfer(params: UseFileTransferParams): UseFileTransferResult {
  const { role, dataChannel, channelState } = params;
  const ready = channelState === "open" && dataChannel !== null;

  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [incomingBatch, setIncomingBatch] = useState<IncomingBatch | null>(null);
  const [phase, setPhase] = useState<TransferPhase>("idle");
  const [perFile, setPerFile] = useState<Record<string, PerFileStatus>>({});
  const [overall, setOverall] = useState<TransferOverall>(EMPTY_OVERALL);
  const [stats, setStats] = useState<TransferStats>(EMPTY_STATS);
  const [filesSaved, setFilesSaved] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Bumped after a terminal state so the guest effect below rebuilds a fresh
  // TransferReceiver on the same channel — a receiver disposes itself once a
  // batch ends, so without this a second "Enviar mais arquivos" batch would
  // reach nobody.
  const [receiverEpoch, setReceiverEpoch] = useState(0);

  // Ordem e tamanhos do lote em andamento — base do cálculo de bytes acumulados.
  const batchFilesRef = useRef<{ id: string; size: number }[]>([]);
  const batchBytesTotalRef = useRef(0);
  // Arquivos concluídos (onFileComplete) no lote atual — usado para filesSaved.
  const filesCompletedRef = useRef(0);
  // Amostras (t, bytes acumulados) para a janela de velocidade e o início da medição.
  const samplesRef = useRef<{ t: number; bytes: number }[]>([]);
  const startedAtRef = useRef<number | null>(null);

  const fileMapRef = useRef<Map<string, File>>(new Map());
  const senderRef = useRef<TransferSender | null>(null);
  const receiverRef = useRef<TransferReceiver | null>(null);
  const openSinkRef = useRef<((meta: FileMeta, offset: number) => Promise<import("@transfergo/transfer-engine").FileSink>) | null>(
    null
  );

  const recomputeStats = useCallback(() => {
    const buf = samplesRef.current;
    const nowT = monotonicNow();
    // Descarta amostras fora da janela, sempre deixando pelo menos 2.
    while (buf.length > 2 && nowT - buf[1]!.t > SPEED_WINDOW_MS) {
      buf.shift();
    }
    if (buf.length < 2 || startedAtRef.current == null) {
      setStats(EMPTY_STATS);
      return;
    }
    const oldest = buf[0]!;
    const newest = buf[buf.length - 1]!;
    // Span medido contra AGORA (não contra a última amostra): numa travada,
    // "agora" cresce, o span cresce e a velocidade decai sozinha.
    const span = nowT - oldest.t;
    let speed: number | null;
    if (span < SPEED_MIN_SPAN_MS) {
      speed = null;
    } else {
      speed = (Math.max(0, newest.bytes - oldest.bytes) / span) * 1000;
    }
    const elapsed = nowT - startedAtRef.current;
    const remaining = Math.max(0, batchBytesTotalRef.current - newest.bytes);
    let eta: number | null;
    if (speed == null || speed <= 0 || elapsed < ETA_MIN_ELAPSED_MS || buf.length < 3) {
      eta = null;
    } else {
      eta = remaining / speed;
    }
    setStats({ speedBytesPerSec: speed, etaSeconds: eta });
  }, []);

  const resetStats = useCallback(() => {
    samplesRef.current = [];
    startedAtRef.current = null;
    setStats(EMPTY_STATS);
  }, []);

  const applyProgress = useCallback(
    (p: TransferProgress) => {
      const files = batchFilesRef.current;
      const bytesInCompleted = files.slice(0, p.filesDone).reduce((s, f) => s + f.size, 0);
      const currentId = files[p.filesDone]?.id;
      const bytesDone = bytesInCompleted + (p.fileId === currentId ? p.fileBytes : 0);
      setOverall({
        bytesDone,
        bytesTotal: batchBytesTotalRef.current,
        filesDone: p.filesDone,
        filesTotal: p.filesTotal
      });
      const sampleT = monotonicNow();
      startedAtRef.current ??= sampleT;
      samplesRef.current.push({ t: sampleT, bytes: bytesDone });
      recomputeStats();
      const activeState: PerFileState = role === "host" ? "sending" : "receiving";
      setPerFile((prev) => ({
        ...prev,
        [p.fileId]: {
          bytes: p.fileBytes,
          size: p.fileSize,
          pct: p.fileSize === 0 ? 100 : Math.min(100, Math.round((p.fileBytes / p.fileSize) * 100)),
          state: p.fileBytes >= p.fileSize ? "completed" : activeState
        }
      }));
      setPhase((cur) => (cur === "preparing" ? activeState : cur));
    },
    [role, recomputeStats]
  );

  const wireCommon = useMemo(
    () => ({
      onProgress: applyProgress,
      onFileComplete: (fileId: string) => {
        filesCompletedRef.current += 1;
        setFilesSaved(filesCompletedRef.current);
        setPerFile((prev) => ({ ...prev, [fileId]: { ...prev[fileId]!, pct: 100, state: "completed" } }));
      },
      onBatchComplete: () => {
        setFilesSaved(batchFilesRef.current.length);
        setPhase("completed");
      },
      onError: (e: TransferError) => {
        setFilesSaved(filesCompletedRef.current);
        setPhase("failed");
        setErrorMessage(ERROR_MESSAGES[e.code] ?? "A transferência falhou.");
      },
      onCancelled: (filesDone: number) => {
        setFilesSaved(Math.min(filesDone, filesCompletedRef.current));
        setPhase((current) => (current === "completed" ? current : "cancelled"));
      }
    }),
    [applyProgress]
  );

  // Guest: stand up a receiver as soon as the channel is open so it can catch the
  // offer. Rebuilds after every terminal state (receiverEpoch) so a follow-up
  // batch on the same channel is caught by a fresh receiver.
  useEffect(() => {
    if (!ready || role !== "guest" || !dataChannel) {
      return;
    }
    const channel = adaptRtcDataChannel(dataChannel);
    const rearm = () => {
      setIncomingBatch(null);
      openSinkRef.current = null;
      setReceiverEpoch((n) => n + 1);
    };
    const receiver = new TransferReceiver(
      channel,
      (meta, offset) => {
        const open = openSinkRef.current;
        if (!open) {
          return Promise.reject(new Error("no save target chosen"));
        }
        return open(meta, offset);
      },
      {
        ...wireCommon,
        onBatchComplete: () => {
          wireCommon.onBatchComplete();
          rearm();
        },
        onCancelled: (filesDone: number) => {
          wireCommon.onCancelled(filesDone);
          rearm();
        },
        onError: (e) => {
          wireCommon.onError(e);
          rearm();
        },
        onBatchOffered: (offer) => {
          // A fresh offer after a completed/failed transfer must pull the guest
          // out of the terminal screen and back to the accept prompt.
          setErrorMessage(null);
          setFilesSaved(0);
          filesCompletedRef.current = 0;
          setPerFile({});
          setOverall(EMPTY_OVERALL);
          resetStats();
          setPhase("idle");
          setIncomingBatch({
            files: offer.files,
            totalBytes: offer.totalBytes,
            summary: summarizeBatch(offer.files),
            requiresMemoryWarning:
              !isFileSystemAccessSupported() && offer.files.some((f) => classifyFileSize(f.size) === "large")
          });
        }
      }
    );
    receiverRef.current = receiver;
    return () => {
      receiver.dispose();
      receiverRef.current = null;
    };
  }, [ready, role, dataChannel, wireCommon, receiverEpoch, resetStats]);

  // Tear down any in-flight transfer machinery when the hook unmounts so a
  // running send/receive loop can't outlive the component.
  useEffect(
    () => () => {
      senderRef.current?.dispose();
      receiverRef.current?.dispose();
    },
    []
  );

  // Enquanto os bytes andam, recalcula 1x/s mesmo sem evento novo — assim uma
  // travada de canal faz a velocidade cair para ~0 em vez de congelar.
  useEffect(() => {
    if (phase !== "sending" && phase !== "receiving") {
      return;
    }
    const id = setInterval(recomputeStats, STATS_TICK_MS);
    return () => clearInterval(id);
  }, [phase, recomputeStats]);

  const totalBytes = useMemo(() => selectedFiles.reduce((sum, f) => sum + f.size, 0), [selectedFiles]);

  const limitError = useMemo(() => {
    if (selectedFiles.length > BATCH_MAX_FILES) {
      return `Você selecionou ${selectedFiles.length} arquivos. O limite é ${BATCH_MAX_FILES} por envio. Remova alguns para continuar.`;
    }
    if (totalBytes > BATCH_MAX_BYTES) {
      return `Você selecionou ${formatBytes(totalBytes)}. O limite por envio é 5 GB. Remova alguns arquivos para continuar.`;
    }
    return null;
  }, [selectedFiles.length, totalBytes]);

  const addFiles = useCallback((files: File[]) => {
    setSelectedFiles((prev) => {
      const next = [...prev];
      for (const file of files) {
        const id = nextId("file");
        fileMapRef.current.set(id, file);
        next.push({
          id,
          name: file.name,
          size: file.size,
          type: file.type,
          sizeClass: classifyFileSize(file.size)
        });
      }
      return next;
    });
  }, []);

  const removeFile = useCallback((id: string) => {
    fileMapRef.current.delete(id);
    setSelectedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clearSelection = useCallback(() => {
    fileMapRef.current.clear();
    setSelectedFiles([]);
    setPerFile({});
    setOverall(EMPTY_OVERALL);
    setFilesSaved(0);
    filesCompletedRef.current = 0;
    resetStats();
    setErrorMessage(null);
    setPhase("idle");
  }, [resetStats]);

  const startSend = useCallback(() => {
    if (!ready || !dataChannel || role !== "host" || limitError || selectedFiles.length === 0) {
      return;
    }
    const inputs = selectedFiles.map((f) => {
      const file = fileMapRef.current.get(f.id)!;
      return {
        meta: { id: f.id, name: f.name, size: f.size, type: f.type } satisfies FileMeta,
        source: createFileChunkSource(file)
      };
    });
    setPerFile(
      Object.fromEntries(selectedFiles.map((f) => [f.id, { bytes: 0, size: f.size, pct: 0, state: "queued" as const }]))
    );
    batchFilesRef.current = selectedFiles.map((f) => ({ id: f.id, size: f.size }));
    batchBytesTotalRef.current = totalBytes;
    filesCompletedRef.current = 0;
    setFilesSaved(0);
    resetStats();
    setOverall({ bytesDone: 0, bytesTotal: totalBytes, filesDone: 0, filesTotal: selectedFiles.length });
    setErrorMessage(null);
    const sender = new TransferSender(adaptRtcDataChannel(dataChannel), nextId("batch"), inputs, {
      ...wireCommon,
      onAccepted: () => setPhase("preparing")
    });
    senderRef.current = sender;
    setPhase("offering");
    sender.start();
  }, [ready, dataChannel, role, limitError, selectedFiles, totalBytes, wireCommon, resetStats]);

  const acceptBatch = useCallback(async () => {
    if (!receiverRef.current || !incomingBatch) {
      return;
    }
    let target: Awaited<ReturnType<typeof pickSaveTarget>>;
    try {
      target = await pickSaveTarget();
    } catch {
      // The user dismissed the folder picker (AbortError on Escape/Cancel).
      // Stay on the offer screen so they can accept again or refuse.
      return;
    }
    openSinkRef.current = target.openSink;
    setPerFile(
      Object.fromEntries(incomingBatch.files.map((f) => [f.id, { bytes: 0, size: f.size, pct: 0, state: "queued" as const }]))
    );
    batchFilesRef.current = incomingBatch.files.map((f) => ({ id: f.id, size: f.size }));
    batchBytesTotalRef.current = incomingBatch.totalBytes;
    filesCompletedRef.current = 0;
    setFilesSaved(0);
    resetStats();
    setOverall({ bytesDone: 0, bytesTotal: incomingBatch.totalBytes, filesDone: 0, filesTotal: incomingBatch.files.length });
    setPhase("preparing");
    receiverRef.current.accept();
  }, [incomingBatch, resetStats]);

  const rejectBatch = useCallback(() => {
    receiverRef.current?.reject();
    setPhase("cancelled");
  }, []);

  const cancel = useCallback(() => {
    senderRef.current?.cancel();
    receiverRef.current?.cancel();
    setPhase((current) => (current === "completed" ? current : "cancelled"));
  }, []);

  return {
    ready,
    selectedFiles,
    totalBytes,
    limitError,
    addFiles,
    removeFile,
    clearSelection,
    startSend,
    incomingBatch,
    acceptBatch,
    rejectBatch,
    phase,
    perFile,
    overall,
    stats,
    filesSaved,
    errorMessage,
    cancel
  };
}
