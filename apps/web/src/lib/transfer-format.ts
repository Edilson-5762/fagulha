import type { FileSizeClass } from "@transfergo/shared";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  // pt-BR uses a decimal comma: "6,2 GB", not "6.2 GB".
  return `${rounded.toLocaleString("pt-BR")} ${units[unit]}`;
}

type Category = "foto" | "vídeo" | "PDF" | "arquivo";

const CATEGORY_ORDER: Category[] = ["foto", "vídeo", "PDF", "arquivo"];
const PLURAL: Record<Category, string> = {
  foto: "fotos",
  "vídeo": "vídeos",
  PDF: "PDFs",
  arquivo: "arquivos"
};

function categoryOf(type: string): Category {
  if (type.startsWith("image/")) {
    return "foto";
  }
  if (type.startsWith("video/")) {
    return "vídeo";
  }
  if (type === "application/pdf") {
    return "PDF";
  }
  return "arquivo";
}

export function summarizeBatch(files: { type: string; size: number }[]): string {
  const counts = new Map<Category, number>();
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.size;
    const category = categoryOf(file.type);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const parts = CATEGORY_ORDER.filter((category) => counts.has(category)).map((category) => {
    const count = counts.get(category)!;
    return `${count} ${count === 1 ? category : PLURAL[category]}`;
  });
  const fileWord = files.length === 1 ? "arquivo" : "arquivos";
  return `${files.length} ${fileWord} — ${parts.join(", ")} — ${formatBytes(totalBytes)}`;
}

export const SIZE_CLASS_LABELS: Record<FileSizeClass, string> = {
  small: "Pequeno",
  medium: "Médio",
  large: "Grande"
};

export const SIZE_CLASS_HINTS: Record<FileSizeClass, string> = {
  small: "Vai num instante.",
  medium: "Pode levar alguns segundos.",
  large: "Transferência longa — não feche a aba. No computador com Chrome ou Edge funciona melhor."
};
