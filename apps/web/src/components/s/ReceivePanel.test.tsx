import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { UseFileTransferResult } from "../../lib/use-file-transfer.js";
import { ReceivePanel } from "./ReceivePanel.js";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() })
}));

const base: UseFileTransferResult = {
  ready: true,
  selectedFiles: [],
  totalBytes: 0,
  limitError: null,
  addFiles: vi.fn(),
  removeFile: vi.fn(),
  clearSelection: vi.fn(),
  startSend: vi.fn(),
  incomingBatch: null,
  acceptBatch: vi.fn(),
  rejectBatch: vi.fn(),
  phase: "idle",
  perFile: {},
  overall: { bytesDone: 0, bytesTotal: 0, filesDone: 0, filesTotal: 0 },
  stats: { speedBytesPerSec: null, etaSeconds: null },
  filesSaved: 0,
  errorMessage: null,
  integrityVerified: false,
  cancel: vi.fn()
};
const withOverrides = (over: Partial<UseFileTransferResult>): UseFileTransferResult => ({
  ...base,
  ...over
});

describe("ReceivePanel", () => {
  it("waits for files when there is no incoming batch", () => {
    render(<ReceivePanel transfer={withOverrides({})} />);
    expect(screen.getByText("Aguardando os arquivos…")).toBeInTheDocument();
  });

  it("shows a connection-lost screen instead of waiting when the channel isn't open", () => {
    render(<ReceivePanel transfer={withOverrides({})} channelState="failed" />);
    expect(screen.getByText("Conexão perdida")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
  });

  it("shows the batch summary and Receber / Recusar actions", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({
          incomingBatch: {
            files: [{ id: "f1", name: "a.jpg", size: 10, type: "image/jpeg" }],
            totalBytes: 10,
            summary: "1 arquivo — 1 foto — 10 KB",
            requiresMemoryWarning: false
          }
        })}
      />
    );
    expect(screen.getByText("1 arquivo — 1 foto — 10 KB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Receber" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recusar" })).toBeInTheDocument();
  });

  it("shows the memory warning when requiresMemoryWarning is set", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({
          incomingBatch: {
            files: [{ id: "f1", name: "big.mp4", size: 9e8, type: "video/mp4" }],
            totalBytes: 9e8,
            summary: "1 arquivo — 1 vídeo — 858 MB",
            requiresMemoryWarning: true
          }
        })}
      />
    );
    expect(screen.getByText(/Chrome ou o Edge no computador/)).toBeInTheDocument();
  });

  it("calls acceptBatch when Receber is clicked", async () => {
    const acceptBatch = vi.fn();
    const user = userEvent.setup();
    render(
      <ReceivePanel
        transfer={withOverrides({
          acceptBatch,
          incomingBatch: {
            files: [{ id: "f1", name: "a.jpg", size: 10, type: "image/jpeg" }],
            totalBytes: 10,
            summary: "1 arquivo — 1 foto — 10 KB",
            requiresMemoryWarning: false
          }
        })}
      />
    );
    await user.click(screen.getByRole("button", { name: "Receber" }));
    expect(acceptBatch).toHaveBeenCalledOnce();
  });

  it("shows the progress header while receiving", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({
          phase: "receiving",
          overall: { bytesDone: 0, bytesTotal: 0, filesDone: 3, filesTotal: 5 },
          incomingBatch: {
            files: [{ id: "f1", name: "a.bin", size: 10, type: "" }],
            totalBytes: 10,
            summary: "",
            requiresMemoryWarning: false
          },
          perFile: { f1: { bytes: 10, size: 10, pct: 100, state: "completed" } }
        })}
      />
    );
    expect(screen.getByText("Recebendo arquivo 4 de 5")).toBeInTheDocument();
  });

  it("shows byte progress, speed and ETA while receiving", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({
          phase: "receiving",
          overall: { bytesDone: 512 * 1024, bytesTotal: 1024 * 1024, filesDone: 0, filesTotal: 3 },
          stats: { speedBytesPerSec: 256 * 1024, etaSeconds: 20 },
          incomingBatch: {
            files: [
              { id: "f1", name: "a.bin", size: 512 * 1024, type: "" },
              { id: "f2", name: "b.bin", size: 512 * 1024, type: "" }
            ],
            totalBytes: 1024 * 1024,
            summary: "",
            requiresMemoryWarning: false
          },
          perFile: {
            f1: { bytes: 512 * 1024, size: 512 * 1024, pct: 100, state: "completed" },
            f2: { bytes: 0, size: 512 * 1024, pct: 0, state: "queued" }
          }
        })}
      />
    );
    expect(screen.getByText("Recebendo arquivo 1 de 3")).toBeInTheDocument();
    expect(screen.getByText(/512 KB de 1 MB/)).toBeInTheDocument();
    expect(screen.getByText(/256 KB\/s/)).toBeInTheDocument();
    expect(screen.getByText(/cerca de 20 s/)).toBeInTheDocument();
  });

  it("renders the per-file mini bar for a multi-file batch while receiving", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({
          phase: "receiving",
          // overall bar → 30%, distinct from the active file's 60%
          overall: { bytesDone: 300, bytesTotal: 1000, filesDone: 0, filesTotal: 3 },
          stats: { speedBytesPerSec: 256 * 1024, etaSeconds: 20 },
          incomingBatch: {
            files: [
              { id: "f1", name: "a.bin", size: 500, type: "" },
              { id: "f2", name: "b.bin", size: 500, type: "" }
            ],
            totalBytes: 1000,
            summary: "",
            requiresMemoryWarning: false
          },
          perFile: {
            f1: { bytes: 300, size: 500, pct: 60, state: "receiving" },
            f2: { bytes: 0, size: 500, pct: 0, state: "queued" }
          }
        })}
      />
    );
    expect(screen.getByText("60%")).toBeInTheDocument();
  });

  it("shows no per-file mini bar for a single-file batch", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({
          phase: "receiving",
          // overall bar → 30%, the active file's 50% must never render
          overall: { bytesDone: 30, bytesTotal: 100, filesDone: 0, filesTotal: 1 },
          stats: { speedBytesPerSec: 1024, etaSeconds: null },
          incomingBatch: {
            files: [{ id: "f1", name: "solo.bin", size: 100, type: "" }],
            totalBytes: 100,
            summary: "",
            requiresMemoryWarning: false
          },
          perFile: { f1: { bytes: 50, size: 100, pct: 50, state: "receiving" } }
        })}
      />
    );
    expect(screen.getByText("30%")).toBeInTheDocument();
    expect(screen.queryByText("50%")).not.toBeInTheDocument();
  });

  it("shows 'calculando…' when stats are null", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({
          phase: "receiving",
          overall: { bytesDone: 10, bytesTotal: 100, filesDone: 0, filesTotal: 1 },
          stats: { speedBytesPerSec: null, etaSeconds: null },
          incomingBatch: {
            files: [{ id: "f1", name: "a", size: 100, type: "" }],
            totalBytes: 100,
            summary: "",
            requiresMemoryWarning: false
          },
          perFile: { f1: { bytes: 10, size: 100, pct: 10, state: "receiving" } }
        })}
      />
    );
    expect(screen.getByText(/calculando…/)).toBeInTheDocument();
  });

  it("shows the preparing message", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({
          phase: "preparing",
          overall: { bytesDone: 0, bytesTotal: 0, filesDone: 0, filesTotal: 2 }
        })}
      />
    );
    expect(screen.getByText("Preparando a transferência…")).toBeInTheDocument();
  });

  it("shows the partial count on the cancelled screen", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({
          phase: "cancelled",
          filesSaved: 2,
          overall: { bytesDone: 0, bytesTotal: 0, filesDone: 2, filesTotal: 4 }
        })}
      />
    );
    expect(screen.getByText("2 de 4 arquivos foram salvos neste dispositivo.")).toBeInTheDocument();
  });

  it("says nothing was saved when filesSaved is 0 on cancel", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({
          phase: "cancelled",
          filesSaved: 0,
          overall: { bytesDone: 0, bytesTotal: 0, filesDone: 0, filesTotal: 4 }
        })}
      />
    );
    expect(screen.getByText("Nenhum arquivo foi salvo.")).toBeInTheDocument();
  });

  it("shows the success screen when completed", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({
          phase: "completed",
          overall: { bytesDone: 0, bytesTotal: 0, filesDone: 3, filesTotal: 3 }
        })}
      />
    );
    expect(screen.getByText("3 arquivos recebidos com sucesso")).toBeInTheDocument();
  });

  it("offers an exit action on the success screen", () => {
    render(<ReceivePanel transfer={withOverrides({ phase: "completed" })} />);
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
  });

  it("shows the error screen when failed", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({
          phase: "failed",
          errorMessage: "Um arquivo chegou incompleto. A transferência foi interrompida."
        })}
      />
    );
    expect(screen.getByText(/chegou incompleto/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
  });

  it("labels a finished file 'Verificado' during an active transfer", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({
          phase: "receiving",
          overall: { bytesDone: 10, bytesTotal: 10, filesDone: 1, filesTotal: 1 },
          incomingBatch: {
            files: [{ id: "f1", name: "a.bin", size: 10, type: "" }],
            totalBytes: 10,
            summary: "",
            requiresMemoryWarning: false
          },
          perFile: { f1: { bytes: 10, size: 10, pct: 100, state: "completed" } }
        })}
      />
    );
    expect(screen.getByText("Verificado")).toBeInTheDocument();
    expect(screen.queryByText("Concluído")).not.toBeInTheDocument();
  });

  it("shows the SHA-256 integrity line on the success screen", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({
          phase: "completed",
          integrityVerified: true,
          overall: { bytesDone: 0, bytesTotal: 0, filesDone: 2, filesTotal: 2 }
        })}
      />
    );
    expect(screen.getByText("Integridade verificada (SHA-256)")).toBeInTheDocument();
  });
});
