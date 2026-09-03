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

export type TransferPhase = "idle" | "offering" | "transferring" | "completed" | "cancelled" | "failed";

export interface PerFileStatus {
  bytes: number;
  size: number;
  state: "queued" | "active" | "completed" | "failed";
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
  overall: { done: number; total: number };
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

let batchCounter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(batchCounter++).toString(36)}`;

export function useFileTransfer(params: UseFileTransferParams): UseFileTransferResult {
  const { role, dataChannel, channelState } = params;
  const ready = channelState === "open" && dataChannel !== null;

  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [incomingBatch, setIncomingBatch] = useState<IncomingBatch | null>(null);
  const [phase, setPhase] = useState<TransferPhase>("idle");
  const [perFile, setPerFile] = useState<Record<string, PerFileStatus>>({});
  const [overall, setOverall] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Bumped after a terminal state so the guest effect below rebuilds a fresh
  // TransferReceiver on the same channel — a receiver disposes itself once a
  // batch ends, so without this a second "Enviar mais arquivos" batch would
  // reach nobody.
  const [receiverEpoch, setReceiverEpoch] = useState(0);

  const fileMapRef = useRef<Map<string, File>>(new Map());
  const senderRef = useRef<TransferSender | null>(null);
  const receiverRef = useRef<TransferReceiver | null>(null);
  const openSinkRef = useRef<((meta: FileMeta, offset: number) => Promise<import("@transfergo/transfer-engine").FileSink>) | null>(
    null
  );

  const applyProgress = useCallback((p: TransferProgress) => {
    setPerFile((prev) => ({
      ...prev,
      [p.fileId]: { bytes: p.fileBytes, size: p.fileSize, state: p.fileBytes >= p.fileSize ? "completed" : "active" }
    }));
    setOverall({ done: p.filesDone, total: p.filesTotal });
  }, []);

  const wireCommon = useMemo(
    () => ({
      onProgress: applyProgress,
      onFileComplete: (fileId: string) =>
        setPerFile((prev) => ({ ...prev, [fileId]: { ...prev[fileId]!, state: "completed" } })),
      onBatchComplete: () => setPhase("completed"),
      onError: (e: TransferError) => {
        setPhase("failed");
        setErrorMessage(ERROR_MESSAGES[e.code] ?? "A transferência falhou.");
      },
      onCancelled: () => setPhase((current) => (current === "completed" ? current : "cancelled"))
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
        onCancelled: () => {
          wireCommon.onCancelled();
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
  }, [ready, role, dataChannel, wireCommon, receiverEpoch]);

  // Tear down any in-flight transfer machinery when the hook unmounts so a
  // running send/receive loop can't outlive the component.
  useEffect(
    () => () => {
      senderRef.current?.dispose();
      receiverRef.current?.dispose();
    },
    []
  );

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
    setOverall({ done: 0, total: 0 });
    setErrorMessage(null);
    setPhase("idle");
  }, []);

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
      Object.fromEntries(selectedFiles.map((f) => [f.id, { bytes: 0, size: f.size, state: "queued" as const }]))
    );
    setOverall({ done: 0, total: selectedFiles.length });
    setErrorMessage(null);
    const sender = new TransferSender(adaptRtcDataChannel(dataChannel), nextId("batch"), inputs, {
      ...wireCommon,
      onAccepted: () => setPhase("transferring")
    });
    senderRef.current = sender;
    setPhase("offering");
    sender.start();
  }, [ready, dataChannel, role, limitError, selectedFiles, wireCommon]);

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
      Object.fromEntries(incomingBatch.files.map((f) => [f.id, { bytes: 0, size: f.size, state: "queued" as const }]))
    );
    setOverall({ done: 0, total: incomingBatch.files.length });
    setPhase("transferring");
    receiverRef.current.accept();
  }, [incomingBatch]);

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
    errorMessage,
    cancel
  };
}
