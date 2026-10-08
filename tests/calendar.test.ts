import { describe, expect, it } from "vitest";
import { addDays, addMonths, formatClock, formatIso, formatMonth, formatStamp, monthGrid, startOfWeek, zonedParts } from "../src/time";
import { zonedParts as serverZonedParts } from "../functions/src/logic/time";

describe("care calendar dates", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("starts the week on Sunday", () => {
    expect(startOfWeek("2026-10-07")).toBe("2026-10-04");
    expect(startOfWeek("2026-10-04")).toBe("2026-10-04");
  });

  it("clamps the day when a month is shorter", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-03-15", -1)).toBe("2026-02-15");
  });

  it("builds a six-week month grid with the days outside the month marked", () => {
    const cells = monthGrid("2026-10-07");
    expect(cells).toHaveLength(42);
    expect(cells[0]).toEqual({ date: "2026-09-27", inMonth: false });
    expect(cells.find((cell) => cell.date === "2026-10-01")).toEqual({ date: "2026-10-01", inMonth: true });
    expect(cells.filter((cell) => cell.inMonth)).toHaveLength(31);
  });

  it("names the month for the monthly calendar", () => {
    expect(formatMonth("2026-10-08")).toBe("October");
    expect(formatMonth("2026-01-15")).toBe("January");
  });

  it("formats clock times for a shift", () => {
    expect(formatClock("00:00")).toBe("12:00 AM");
    expect(formatClock("08:05")).toBe("8:05 AM");
    expect(formatClock("12:00")).toBe("12:00 PM");
    expect(formatClock("20:00")).toBe("8:00 PM");
  });

  it("formats stamps and leaves a missing timestamp blank", () => {
    expect(formatStamp(undefined)).toBe("");
    expect(formatIso("not-a-date")).toBe("not-a-date");
    const stamp = formatStamp({ toDate: () => new Date("2026-10-07T14:05:00Z") });
    expect(stamp.length).toBeGreaterThan(0);
  });

  it("uses the same zoned clock on the client and the reminder server", () => {
    const instant = new Date("2026-01-15T05:00:00Z");
    expect(zonedParts(instant, "America/New_York")).toEqual({ date: "2026-01-15", time: "00:00" });
    expect(serverZonedParts(instant, "America/New_York")).toEqual({ date: "2026-01-15", time: "00:00" });
    expect(zonedParts(new Date("2026-01-15T04:59:00Z"), "America/New_York")).toEqual({
      date: "2026-01-14",
      time: "23:59",
    });
  });
});
