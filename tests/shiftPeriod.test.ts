import { describe, expect, it } from "vitest";
import { periodsForShifts, shiftCoversPeriod } from "../src/shiftPeriod";

describe("shift periods", () => {
  it("covers only the parts of the day a shift overlaps", () => {
    expect(shiftCoversPeriod("08:00", "16:00", "morning")).toBe(true);
    expect(shiftCoversPeriod("08:00", "16:00", "afternoon")).toBe(true);
    expect(shiftCoversPeriod("08:00", "16:00", "evening")).toBe(false);
    expect(shiftCoversPeriod("16:00", "22:00", "morning")).toBe(false);
    expect(shiftCoversPeriod("16:00", "22:00", "afternoon")).toBe(true);
    expect(shiftCoversPeriod("16:00", "22:00", "evening")).toBe(true);
    expect(periodsForShifts([{ start: "08:00", end: "12:00", kind: "" }])).toEqual(["morning"]);
    expect(periodsForShifts([{ start: "12:00", end: "17:00", kind: "swap" }])).toEqual(["afternoon"]);
    expect(periodsForShifts([{ start: "17:00", end: "22:00", kind: "" }])).toEqual(["evening"]);
  });

  it("skips a day off", () => {
    expect(periodsForShifts([{ start: "08:00", end: "16:00", kind: "day_off" }])).toEqual([]);
  });
});
