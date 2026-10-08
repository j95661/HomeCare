import { describe, expect, it } from "vitest";
import { normalizePhone } from "../functions/src/logic/phone";

describe("mobile numbers", () => {
  it("keeps a blank number and formats a US mobile number", () => {
    expect(normalizePhone("")).toEqual({ ok: true, phone: "" });
    expect(normalizePhone("  ")).toEqual({ ok: true, phone: "" });
    expect(normalizePhone("4155550100")).toEqual({ ok: true, phone: "(415) 555-0100" });
    expect(normalizePhone("(415) 555-0100")).toEqual({ ok: true, phone: "(415) 555-0100" });
    expect(normalizePhone("1-415-555-0100")).toEqual({ ok: true, phone: "(415) 555-0100" });
  });

  it("rejects a number that is not a 10-digit mobile", () => {
    expect(normalizePhone("555-0100").ok).toBe(false);
    expect(normalizePhone("415555010012").ok).toBe(false);
    expect(normalizePhone("call me").ok).toBe(false);
  });
});
