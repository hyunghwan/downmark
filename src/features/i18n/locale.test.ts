import { describe, expect, it } from "vitest";

import { resolveSupportedLocale } from "./locale";

describe("locale resolution", () => {
  it("maps Korean system locales to ko", () => {
    expect(resolveSupportedLocale("ko-KR")).toBe("ko");
  });

  it("maps Spanish system locales to es", () => {
    expect(resolveSupportedLocale("es-MX")).toBe("es");
  });

  it("falls back to English for unsupported locales", () => {
    expect(resolveSupportedLocale("fr-FR")).toBe("en");
  });
});
