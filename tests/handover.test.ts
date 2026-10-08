import { describe, expect, it } from "vitest";
import { handoverNoteDay, shouldArchiveHandover } from "../functions/src/logic/handover";
import { handoverNoteDay as clientDay, isTodaysHandover } from "../src/handover";

const zone = "America/Los_Angeles";

describe("handover days", () => {
  it("keeps today's notes on the board and archives earlier days", () => {
    const today = { day: "2026-10-08", createdAt: new Date("2026-10-08T20:00:00Z") };
    const yesterday = { day: "2026-10-07", createdAt: new Date("2026-10-07T20:00:00Z") };
    expect(shouldArchiveHandover(today, "2026-10-08", zone)).toBe(false);
    expect(shouldArchiveHandover(yesterday, "2026-10-08", zone)).toBe(true);
    expect(shouldArchiveHandover({ createdAt: new Date("2026-10-08T16:00:00Z") }, "2026-10-08", zone)).toBe(false);
    expect(shouldArchiveHandover({ createdAt: new Date("2026-10-08T06:00:00Z") }, "2026-10-08", zone)).toBe(true);
    expect(shouldArchiveHandover({}, "2026-10-08", zone)).toBe(false);
  });

  it("uses the same day on the home screen", () => {
    const createdAt = new Date("2026-10-08T16:00:00Z");
    expect(clientDay({ createdAt }, zone)).toBe(handoverNoteDay({ createdAt }, zone));
    expect(isTodaysHandover({ day: "2026-10-08" }, "2026-10-08", zone)).toBe(true);
    expect(isTodaysHandover({ day: "2026-10-07" }, "2026-10-08", zone)).toBe(false);
  });
});
