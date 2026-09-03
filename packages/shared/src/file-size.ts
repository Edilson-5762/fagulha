export type FileSizeClass = "small" | "medium" | "large";

/** Inclusive ceiling for the "small" class — 10 MiB. */
export const SIZE_CLASS_SMALL_MAX = 10 * 1024 * 1024;
/** Inclusive ceiling for the "medium" class — 500 MiB. */
export const SIZE_CLASS_MEDIUM_MAX = 500 * 1024 * 1024;

/** Max files in one transfer batch. */
export const BATCH_MAX_FILES = 50;
/** Max total bytes in one transfer batch — 5 GiB. */
export const BATCH_MAX_BYTES = 5 * 1024 * 1024 * 1024;

export function classifyFileSize(bytes: number): FileSizeClass {
  if (bytes <= SIZE_CLASS_SMALL_MAX) {
    return "small";
  }
  if (bytes <= SIZE_CLASS_MEDIUM_MAX) {
    return "medium";
  }
  return "large";
}
