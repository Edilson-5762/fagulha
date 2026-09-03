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
    expect(screen.getByText("Enviando 3 de 5…")).toBeInTheDocument();
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
