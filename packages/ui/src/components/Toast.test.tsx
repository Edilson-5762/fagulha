import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Toast, ToastProvider, ToastViewport } from "./Toast.js";

describe("Toast", () => {
  it("renders the title and description inside the provider/viewport", () => {
    render(
      <ToastProvider>
        <Toast open title="Transferência concluída" description="Integridade verificada (SHA-256)." />
        <ToastViewport />
      </ToastProvider>
    );

    expect(screen.getByText("Transferência concluída")).toBeInTheDocument();
    expect(screen.getByText("Integridade verificada (SHA-256).")).toBeInTheDocument();
  });

  it("renders only the title when no description is given", () => {
    render(
      <ToastProvider>
        <Toast open title="Link copiado" />
        <ToastViewport />
      </ToastProvider>
    );

    expect(screen.getByText("Link copiado")).toBeInTheDocument();
  });
});
