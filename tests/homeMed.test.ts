import { describe, expect, it } from "vitest";
import { homeMedicationFocus } from "../src/homeMed";

const vitamin = { id: "vitamin", name: "Vitamin D", times: ["08:00", "20:00"] };
const evening = { id: "evening", name: "Melatonin", times: ["20:00"] };

describe("home medication focus", () => {
  it("shows the earliest unanswered dose that is already due", () => {
    expect(homeMedicationFocus([vitamin], [], "12:00")).toEqual([
      { status: "due", id: "vitamin", name: "Vitamin D", time: "08:00" },
    ]);
  });

  it("keeps a past dose due until it is logged", () => {
    const snoozed = [{ medicationId: "vitamin", scheduledTime: "08:00", action: "snooze" }];
    expect(homeMedicationFocus([vitamin], snoozed, "20:30")[0]).toMatchObject({ status: "due", time: "08:00" });
    const given = [{ medicationId: "vitamin", scheduledTime: "08:00", action: "given" }];
    expect(homeMedicationFocus([vitamin], given, "12:00")).toEqual([
      { status: "next", id: "vitamin", name: "Vitamin D", time: "20:00" },
    ]);
  });

  it("shows every medication that shares the focus time", () => {
    expect(homeMedicationFocus([vitamin, evening], [{ medicationId: "vitamin", scheduledTime: "08:00", action: "given" }], "20:00")).toEqual([
      { status: "due", id: "evening", name: "Melatonin", time: "20:00" },
      { status: "due", id: "vitamin", name: "Vitamin D", time: "20:00" },
    ]);
  });

  it("is empty when every dose today is answered", () => {
    const logs = [
      { medicationId: "vitamin", scheduledTime: "08:00", action: "given" },
      { medicationId: "vitamin", scheduledTime: "20:00", action: "declined" },
    ];
    expect(homeMedicationFocus([vitamin], logs, "21:00")).toEqual([]);
  });
});
