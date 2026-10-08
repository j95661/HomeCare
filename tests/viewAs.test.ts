import { describe, expect, it } from "vitest";
import type { Session } from "../src/types";
import { canViewAsEmployee, displaySession, type ViewIdentity } from "../src/viewAs";

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
      viewingAs: true,
    });

    const back = displaySession(account, null);
    expect(back.uid).toBe("dad");
    expect(back.role).toBe("super_admin");
    expect(back.viewingAs).toBe(false);
    expect(back.personalColorScheme).toBe("custom:#29327a");
  });
});
