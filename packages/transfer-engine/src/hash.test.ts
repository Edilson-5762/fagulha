import { describe, expect, it } from "vitest";
import { createSha256Hasher } from "./hash.js";

// Vetores canônicos NIST para SHA-256.
const SHA256_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const SHA256_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const utf8 = (s: string) => new TextEncoder().encode(s);

describe("createSha256Hasher", () => {
  it("matches the NIST vector for \"abc\"", () => {
    const h = createSha256Hasher();
    h.update(utf8("abc"));
    expect(h.digest()).toBe(SHA256_ABC);
  });

  it("returns the known digest of the empty input when never updated", () => {
    expect(createSha256Hasher().digest()).toBe(SHA256_EMPTY);
  });

  it("gives the same digest whether fed in one call or in pieces", () => {
    const whole = createSha256Hasher();
    whole.update(utf8("the quick brown fox"));

    const pieces = createSha256Hasher();
    pieces.update(utf8("the quick "));
    pieces.update(utf8("brown fox"));

    expect(pieces.digest()).toBe(whole.digest());
  });

  it("produces a 64-char lowercase hex string", () => {
    const h = createSha256Hasher();
    h.update(new Uint8Array([1, 2, 3]));
    const digest = h.digest();
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
