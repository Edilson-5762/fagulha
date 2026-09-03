import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { UseFileTransferResult } from "../../lib/use-file-transfer.js";
import { ReceivePanel } from "./ReceivePanel.js";

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
  cancel: vi.fn()
};
const withOverrides = (over: Partial<UseFileTransferResult>): UseFileTransferResult => ({ ...base, ...over });

describe("ReceivePanel", () => {
  it("waits for files when there is no incoming batch", () => {
    render(<ReceivePanel transfer={withOverrides({})} />);
    expect(screen.getByText("Aguardando os arquivos…")).toBeInTheDocument();
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
        transfer={withOverrides({ phase: "receiving", overall: { bytesDone: 0, bytesTotal: 0, filesDone: 2, filesTotal: 4 } })}
      />
    );
    expect(screen.getByText("Recebendo 2 de 4…")).toBeInTheDocument();
  });

  it("shows the success screen when completed", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({ phase: "completed", overall: { bytesDone: 0, bytesTotal: 0, filesDone: 3, filesTotal: 3 } })}
      />
    );
    expect(screen.getByText("3 arquivos recebidos com sucesso")).toBeInTheDocument();
  });

  it("shows the error screen when failed", () => {
    render(
      <ReceivePanel
        transfer={withOverrides({ phase: "failed", errorMessage: "Um arquivo chegou incompleto. A transferência foi interrompida." })}
      />
    );
    expect(screen.getByText(/chegou incompleto/)).toBeInTheDocument();
  });
});
