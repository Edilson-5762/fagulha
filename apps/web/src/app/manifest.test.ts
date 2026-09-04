import { describe, expect, it } from "vitest";
import manifest from "./manifest.js";

describe("web app manifest", () => {
  const m = manifest();

  it("identifies the app and opens standalone from the root", () => {
    expect(m.name).toBe("Fagulha");
    expect(m.short_name).toBe("Fagulha");
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
  });

  it("uses the brand colors so the splash and status bar match", () => {
    expect(m.background_color).toBe("#0a0e17");
    expect(m.theme_color).toBe("#0a0e17");
  });

  it("ships 192, 512 and a maskable icon for installability", () => {
    const sizes = m.icons?.map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));

    const maskable = m.icons?.find((i) => i.purpose === "maskable");
    expect(maskable).toBeDefined();
    expect(maskable?.type).toBe("image/png");
  });
});
