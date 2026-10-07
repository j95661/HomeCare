import { describe, expect, it } from "vitest";
import { medicationRecipients, messageRecipients, selectMedicationDispatches, type ReminderUser } from "../functions/src/logic/reminders";
import { isWithinWindow, minutesOf } from "../functions/src/logic/time";

const users: ReminderUser[] = [
  { uid: "on", displayName: "On", active: true, otpVerified: true, onShift: true },
  { uid: "off", displayName: "Off", active: true, otpVerified: true, onShift: false },
  { uid: "new", displayName: "New", active: true, otpVerified: false, onShift: true },
  { uid: "gone", displayName: "Gone", active: false, otpVerified: true, onShift: true },
];

const meds = [
  { id: "med", name: "Vitamin", dose: "1 tablet", times: ["08:00", "20:00"], active: true },
  { id: "note", name: "Lotion", dose: "", times: ["08:00"], active: true },
  { id: "old", name: "Stopped", dose: "", times: ["08:00"], active: false },
];

describe("medication reminder selection", () => {
  it("notifies only active, verified people who are on shift", () => {
    expect(medicationRecipients(users).map((user) => user.uid)).toEqual(["on"]);
  });

  it("sends a due medication once, and skips inactive meds and people off shift", () => {
    const due = selectMedicationDispatches({
      now: new Date("2026-01-15T13:00:00Z"),
      date: "2026-01-15",
      time: "08:01",
      medications: meds,
      users,
      alreadySent: new Set(),
      snoozes: [],
    });
    expect(due.map((item) => item.receiptId)).toEqual(["med_2026-01-15_08:00_on", "note_2026-01-15_08:00_on"]);
    expect(due[0]).toMatchObject({
      title: "Medication due",
      body: "Vitamin · 1 tablet · 08:00",
      uid: "on",
    });
    expect(due[1].body).toBe("Lotion · 08:00");

    const again = selectMedicationDispatches({
      now: new Date("2026-01-15T13:00:00Z"),
      date: "2026-01-15",
      time: "08:01",
      medications: meds,
      users,
      alreadySent: new Set(due.map((item) => item.receiptId)),
      snoozes: [],
    });
    expect(again).toEqual([]);
  });

  it("keeps the two-minute window open at the scheduled minute and closed two minutes later", () => {
    expect(minutesOf("08:00")).toBe(480);
    expect(isWithinWindow("08:00", "08:00", 2)).toBe(true);
    expect(isWithinWindow("08:00", "08:01", 2)).toBe(true);
    expect(isWithinWindow("08:00", "08:02", 2)).toBe(false);
    expect(isWithinWindow("08:00", "07:59", 2)).toBe(false);
  });

  it("fires a snooze only while that person is still on shift and inside the grace period", () => {
    const base = {
      now: new Date("2026-01-15T13:05:00Z"),
      date: "2026-01-15",
      time: "10:00",
      medications: meds,
      users,
      alreadySent: new Set<string>(),
    };
    const snooze = {
      id: "s1",
      userId: "on",
      medicationId: "med",
      medicationName: "Vitamin",
      dose: "1 tablet",
      scheduledTime: "08:00",
      fireAt: new Date("2026-01-15T13:00:00Z"),
    };
    expect(selectMedicationDispatches({ ...base, snoozes: [snooze] }).map((item) => item.receiptId)).toEqual(["snooze_s1"]);
    expect(
      selectMedicationDispatches({
        ...base,
        snoozes: [{ ...snooze, userId: "off", id: "off" }],
      }),
    ).toEqual([]);
    expect(
      selectMedicationDispatches({
        ...base,
        snoozes: [{ ...snooze, fireAt: new Date("2026-01-15T13:06:00Z") }],
      }),
    ).toEqual([]);
    expect(
      selectMedicationDispatches({
        ...base,
        now: new Date("2026-01-15T13:10:01Z"),
        snoozes: [snooze],
      }),
    ).toEqual([]);
    expect(
      selectMedicationDispatches({
        ...base,
        alreadySent: new Set(["snooze_s1"]),
        snoozes: [snooze],
      }),
    ).toEqual([]);
  });
});

describe("message recipients", () => {
  it("includes people who are off shift and skips the sender, inactive, and unverified accounts", () => {
    expect(messageRecipients(users, "on").map((user) => user.uid)).toEqual(["off"]);
    expect(messageRecipients(users, "off").map((user) => user.uid)).toEqual(["on"]);
  });
});
