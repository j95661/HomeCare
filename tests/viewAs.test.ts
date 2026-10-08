import { describe, expect, it } from "vitest";
import type { Session } from "../src/types";
import { canViewAsEmployee, displaySession, withActingEmployee, type ViewIdentity } from "../src/viewAs";

const account: Session = {
  uid: "dad",
  email: "dad@example.com",
  role: "super_admin",
  displayName: "Dad",
  emoji: "😎",
  onShift: false,
  timezone: "America/Los_Angeles",
  snoozeMinutes: 10,
  passwordMaxAgeDays: 183,
  colorScheme: "rose",
  personalColorScheme: "custom:#29327a",
  backgroundImage: "backgrounds/dad/p1.jpg",
};

const nora: ViewIdentity = {
  uid: "nora",
  displayName: "Nora",
  role: "care_provider",
  emoji: "",
  onShift: true,
  colorScheme: "lilac",
};

describe("view as employee", () => {
  it("lets an admin look through another person and switch back to themselves", () => {
    expect(canViewAsEmployee("super_admin")).toBe(true);
    expect(canViewAsEmployee("admin")).toBe(true);
    expect(canViewAsEmployee("team_lead")).toBe(false);
    expect(canViewAsEmployee("care_provider")).toBe(false);

    const viewing = displaySession(account, nora);
    expect(viewing).toMatchObject({
      uid: "nora",
      displayName: "Nora",
      role: "care_provider",
      emoji: "",
      onShift: true,
      personalColorScheme: "lilac",
      email: "dad@example.com",
      timezone: "America/Los_Angeles",
      backgroundImage: "backgrounds/dad/p1.jpg",
      viewingAs: true,
    });

    const back = displaySession(account, null);
    expect(back.uid).toBe("dad");
    expect(back.role).toBe("super_admin");
    expect(back.viewingAs).toBe(false);
    expect(back.personalColorScheme).toBe("custom:#29327a");
  });

  it("sends swap and time off as the employee an admin is acting as", () => {
    expect(withActingEmployee("requestShiftCoverage", { date: "2026-10-29", reason: "Appointment" }, "alex")).toEqual({
      date: "2026-10-29",
      reason: "Appointment",
      asUid: "alex",
    });
    expect(withActingEmployee("acceptShiftRequest", { id: "req" }, "sam")).toEqual({ id: "req", asUid: "sam" });
    expect(withActingEmployee("updateAppSettings", { snoozeMinutes: 10 }, "alex")).toEqual({ snoozeMinutes: 10 });
    expect(withActingEmployee("requestShiftCoverage", { reason: "Appointment" }, "")).toEqual({ reason: "Appointment" });
  });
});
