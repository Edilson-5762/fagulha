import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { UseFileTransferResult } from "../../lib/use-file-transfer.js";
import { SendPanel } from "./SendPanel.js";

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

const withOverrides = (over: Partial<UseFileTransferResult>): UseFileTransferResult => ({ ...base, ...over });

describe("SendPanel", () => {
  it("lists selected files with a size badge and a total", () => {
    render(
      <SendPanel
        transfer={withOverrides({
          selectedFiles: [{ id: "f1", name: "a.jpg", size: 5 * 1024 * 1024, type: "image/jpeg", sizeClass: "small" }],
          totalBytes: 5 * 1024 * 1024
        })}
      />
    );
    expect(screen.getByText("a.jpg")).toBeInTheDocument();
    expect(screen.getByText("Pequeno")).toBeInTheDocument();
    // "5 MB" appears twice — once per row, once in the footer total.
    expect(screen.getAllByText(/5 MB/).length).toBeGreaterThan(0);
  });

  it("shows the limit error and disables the send button", () => {
    render(
      <SendPanel
        transfer={withOverrides({
          selectedFiles: [{ id: "f1", name: "big.bin", size: 9e9, type: "", sizeClass: "large" }],
          totalBytes: 9e9,
          limitError: "Você selecionou 8.4 GB. O limite por envio é 5 GB. Remova alguns arquivos para continuar."
        })}
      />
    );
    expect(screen.getByText(/limite por envio é 5 GB/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
  });

  it("calls startSend when Enviar is clicked", async () => {
    const startSend = vi.fn();
    const user = userEvent.setup();
    render(
      <SendPanel
        transfer={withOverrides({
          selectedFiles: [{ id: "f1", name: "a.bin", size: 10, type: "", sizeClass: "small" }],
          totalBytes: 10,
          startSend
        })}
      />
    );
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    expect(startSend).toHaveBeenCalledOnce();
  });

  it("shows the progress header while sending", () => {
    render(
      <SendPanel
        transfer={withOverrides({
          phase: "sending",
          overall: { bytesDone: 0, bytesTotal: 0, filesDone: 3, filesTotal: 5 },
          selectedFiles: [{ id: "f1", name: "a.bin", size: 10, type: "", sizeClass: "small" }],
          perFile: { f1: { bytes: 10, size: 10, pct: 100, state: "completed" } }
        })}
      />
    );
    expect(screen.getByText("Enviando arquivo 4 de 5")).toBeInTheDocument();
  });

  it("shows the byte progress, speed and ETA while sending", () => {
    const GiB = 1024 * 1024 * 1024;
    render(
      <SendPanel
        transfer={withOverrides({
          phase: "sending",
          // formatBytes(1.5*GiB) === "1,5 GB"; formatBytes(3*GiB) === "3 GB"
          overall: { bytesDone: 1.5 * GiB, bytesTotal: 3 * GiB, filesDone: 1, filesTotal: 5 },
          // formatSpeed(12.3*MiB) === "12,3 MB/s"; formatDuration(130) === "cerca de 2 min"
          stats: { speedBytesPerSec: 12.3 * 1024 * 1024, etaSeconds: 130 },
          selectedFiles: [
            { id: "f1", name: "a.mp4", size: 1e9, type: "video/mp4", sizeClass: "large" },
            { id: "f2", name: "b.zip", size: 2e9, type: "", sizeClass: "large" }
          ],
          perFile: {
            f1: { bytes: 6e8, size: 1e9, pct: 60, state: "sending" },
            f2: { bytes: 0, size: 2e9, pct: 0, state: "queued" }
          }
        })}
      />
    );
    expect(screen.getByText("Enviando arquivo 2 de 5")).toBeInTheDocument();
    expect(screen.getByText(/1,5 GB de 3 GB/)).toBeInTheDocument();
    expect(screen.getByText(/12,3 MB\/s/)).toBeInTheDocument();
    expect(screen.getByText(/cerca de 2 min/)).toBeInTheDocument();
    // barrinha só no arquivo ativo (a ProgressBar com label rende "<n>%")
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("Na fila")).toBeInTheDocument();
  });

  it("shows 'calculando…' when speed and ETA are both null", () => {
    render(
      <SendPanel
        transfer={withOverrides({
          phase: "sending",
          overall: { bytesDone: 1024, bytesTotal: 4096, filesDone: 0, filesTotal: 1 },
          stats: { speedBytesPerSec: null, etaSeconds: null },
          selectedFiles: [{ id: "f1", name: "a.bin", size: 4096, type: "", sizeClass: "small" }],
          perFile: { f1: { bytes: 1024, size: 4096, pct: 25, state: "sending" } }
        })}
      />
    );
    expect(screen.getByText(/calculando…/)).toBeInTheDocument();
  });

  it("with a single file uses the name in the header and shows no per-file mini bar", () => {
    render(
      <SendPanel
        transfer={withOverrides({
          phase: "sending",
          overall: { bytesDone: 300, bytesTotal: 1000, filesDone: 0, filesTotal: 1 },
          stats: { speedBytesPerSec: 1024, etaSeconds: null },
          selectedFiles: [{ id: "f1", name: "solo.bin", size: 1000, type: "", sizeClass: "small" }],
          perFile: { f1: { bytes: 500, size: 1000, pct: 50, state: "sending" } }
        })}
      />
    );
    expect(screen.getByText("Enviando solo.bin")).toBeInTheDocument();
    // overall bar always carries its percentage
    expect(screen.getByText("30%")).toBeInTheDocument();
    // no per-file mini bar for a single file, so the per-file 50% never renders
    expect(screen.queryByText("50%")).not.toBeInTheDocument();
  });

  it("shows the partial count on the cancelled screen", () => {
    render(
      <SendPanel
        transfer={withOverrides({
          phase: "cancelled",
          filesSaved: 3,
          overall: { bytesDone: 0, bytesTotal: 0, filesDone: 3, filesTotal: 5 }
        })}
      />
    );
    expect(screen.getByText("3 de 5 arquivos chegaram.")).toBeInTheDocument();
  });

  it("says nothing arrived when filesSaved is 0 on cancel", () => {
    render(
      <SendPanel
        transfer={withOverrides({ phase: "cancelled", filesSaved: 0, overall: { bytesDone: 0, bytesTotal: 0, filesDone: 0, filesTotal: 5 } })}
      />
    );
    expect(screen.getByText("Nenhum arquivo chegou.")).toBeInTheDocument();
  });

  it("shows the preparing message", () => {
    render(<SendPanel transfer={withOverrides({ phase: "preparing", overall: { bytesDone: 0, bytesTotal: 0, filesDone: 0, filesTotal: 3 } })} />);
    expect(screen.getByText("Preparando a transferência…")).toBeInTheDocument();
  });

  it("shows the success screen when completed", () => {
    render(
      <SendPanel
        transfer={withOverrides({ phase: "completed", overall: { bytesDone: 0, bytesTotal: 0, filesDone: 2, filesTotal: 2 } })}
      />
    );
    expect(screen.getByText("2 arquivos transferidos com sucesso")).toBeInTheDocument();
  });

  it("shows the error screen when failed", () => {
    render(
      <SendPanel transfer={withOverrides({ phase: "failed", errorMessage: "O outro lado recusou a transferência." })} />
    );
    expect(screen.getByText("O outro lado recusou a transferência.")).toBeInTheDocument();
  });
});
