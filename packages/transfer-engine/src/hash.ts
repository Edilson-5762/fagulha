import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Hash incremental: alimente com `update`, feche com um único `digest`. */
export interface Hasher {
  update(bytes: Uint8Array): void;
  /** Hex minúsculo, 64 chars. Consome o hasher — chame uma vez só. */
  digest(): string;
}

export type CreateHasher = () => Hasher;

export const createSha256Hasher: CreateHasher = () => {
  const h = sha256.create();
  return {
    update: (bytes) => {
      h.update(bytes);
    },
    digest: () => bytesToHex(h.digest())
  };
};
