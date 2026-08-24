export type TransferState =
  | "queued"
  | "preparing"
  | "connecting"
  | "sending"
  | "receiving"
  | "verifying"
  | "completed"
  | "paused"
  | "cancelled"
  | "failed";

export const TRANSFER_STATES: readonly TransferState[] = [
  "queued",
  "preparing",
  "connecting",
  "sending",
  "receiving",
  "verifying",
  "completed",
  "paused",
  "cancelled",
  "failed"
];
