import { describe, expect, it } from "vitest";
import { assertCanAssign, assertCanEdit, AuthzError, revokeAccount, type AccountProfile } from "../functions/src/logic/accounts";
import { canSendOtp, checkOtpCode, hashOtp, OTP_TTL_MS } from "../functions/src/logic/otp";
import { DEFAULT_PASSWORD_MAX_AGE_DAYS, expiresAt, validatePassword } from "../functions/src/logic/password";
import { buildMulticast } from "../functions/src/logic/push";
import { careTeamRecipients, directRecipients, medicationRecipients, messageRecipients, noticeRecipients, selectMedicationDispatches } from "../functions/src/logic/reminders";
import { canAssignRole, canRevoke, isProtectedAccount } from "../functions/src/logic/roles";
import { applyAcceptance } from "../functions/src/logic/shifts";
import { isWithinWindow, zonedParts } from "../functions/src/logic/time";
import { pushSubscribeBlock } from "../src/pwa";

const users = [
  { uid: "on", displayName: "On", active: true, otpVerified: true, onShift: true },
  { uid: "off", displayName: "Off", active: true, otpVerified: true, onShift: false },
  { uid: "gone", displayName: "Gone", active: false, otpVerified: true, onShift: true },
];

function profile(partial: Partial<AccountProfile> & Pick<AccountProfile, "uid" | "role">): AccountProfile {
  return {
    email: `${partial.uid}@example.com`,
    displayName: partial.uid,
    active: true,
    protected: partial.role === "super_admin",
    otpVerified: true,
    ...partial,
  };
}

describe("roles", () => {
  it("lets only the super admin revoke, and never the protected account", () => {
    expect(canRevoke("super_admin")).toBe(true);
    expect(canRevoke("admin")).toBe(false);
    expect(canRevoke("team_lead")).toBe(false);
    expect(canRevoke("care_provider")).toBe(false);
    expect(isProtectedAccount({ role: "super_admin" })).toBe(true);
    expect(isProtectedAccount({ role: "admin", protected: true })).toBe(true);
    expect(canAssignRole("super_admin", "team_lead")).toBe(true);
    expect(canAssignRole("super_admin", "super_admin")).toBe(false);
    expect(canAssignRole("admin", "care_provider")).toBe(false);
  });
});

describe("accounts", () => {
  it("revokes by marking the profile inactive before the auth session is killed", async () => {
    const order: string[] = [];
    await revokeAccount(
      {
        markInactive: async () => {
          order.push("inactive");
        },
        setClaims: async () => {
          order.push("claims");
        },
        disableAuth: async () => {
          order.push("disable");
        },
        revokeTokens: async () => {
          order.push("revoke");
        },
        listTokens: async () => ["token-1"],
        unsubscribe: async () => {
          order.push("unsub");
        },
        deleteTokens: async () => {
          order.push("delete");
        },
      },
      profile({ uid: "super", role: "super_admin" }),
      profile({ uid: "pat", role: "care_provider", protected: false }),
    );
    expect(order).toEqual(["inactive", "claims", "disable", "revoke", "unsub", "delete"]);
  });

  it("refuses admin revocation and refuses to touch the super admin", async () => {
    const deps = {
      markInactive: async () => {
        throw new Error("should not mark");
      },
      setClaims: async () => undefined,
      disableAuth: async () => undefined,
      revokeTokens: async () => undefined,
      listTokens: async () => [],
      unsubscribe: async () => undefined,
      deleteTokens: async () => undefined,
    };
    await expect(
      revokeAccount(deps, profile({ uid: "admin", role: "admin", protected: false }), profile({ uid: "pat", role: "care_provider", protected: false })),
    ).rejects.toBeInstanceOf(AuthzError);
    await expect(
      revokeAccount(deps, profile({ uid: "super", role: "super_admin" }), profile({ uid: "root", role: "super_admin" })),
    ).rejects.toThrow(/cannot be revoked/);
  });

  it("blocks a second super admin and demotion", () => {
    const superAdmin = profile({ uid: "super", role: "super_admin" });
    expect(() => assertCanAssign(superAdmin, "super_admin", "new@example.com", "super@example.com")).toThrow(AuthzError);
    expect(() => assertCanAssign(superAdmin, "admin", "super@example.com", "super@example.com")).toThrow(/reserved/);
    expect(() => assertCanEdit(superAdmin, superAdmin, "admin")).toThrow(/cannot be demoted/);
    expect(() => assertCanEdit(profile({ uid: "admin", role: "admin", protected: false }), profile({ uid: "pat", role: "care_provider", protected: false }), "team_lead")).toThrow(
      /Only the super admin/,
    );
  });
});

describe("otp and passwords", () => {
  it("accepts the matching code and rejects expiry, guesses, and rapid resends", () => {
    const now = 1_000_000;
    const challenge = {
      hash: hashOtp("uid", "123456", "pepper"),
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      lastSentAt: now,
      hourlyCount: 1,
      windowStart: now,
    };
    expect(checkOtpCode(challenge, "uid", "123456", now + 1000, "pepper").ok).toBe(true);
    expect(checkOtpCode(challenge, "uid", "000000", now + 1000, "pepper")).toMatchObject({ ok: false, attempts: 1 });
    expect(checkOtpCode(challenge, "uid", "123456", now + OTP_TTL_MS + 1, "pepper").ok).toBe(false);
    expect(canSendOtp(challenge, now + 1000).ok).toBe(false);
    expect(canSendOtp(null, now)).toEqual({ ok: true, hourlyCount: 1, windowStart: now });
  });

  it("defaults the password window to six months", () => {
    expect(DEFAULT_PASSWORD_MAX_AGE_DAYS).toBe(183);
    const start = new Date("2026-01-01T00:00:00Z");
    expect(expiresAt(start, 183).getTime() - start.getTime()).toBe(183 * 24 * 60 * 60 * 1000);
    expect(validatePassword("short1")).toBeTruthy();
    expect(validatePassword("longpassword")).toBeTruthy();
    expect(validatePassword("goodpass1")).toBeNull();
  });
});

describe("reminders and push", () => {
  it("sends medication reminders only to people on shift, and messages to people off shift", () => {
    expect(medicationRecipients(users).map((user) => user.uid)).toEqual(["on"]);
    expect(messageRecipients(users, "on").map((user) => user.uid)).toEqual(["off"]);
    const due = selectMedicationDispatches({
      now: new Date("2026-01-15T13:00:00Z"),
      date: "2026-01-15",
      time: "08:01",
      medications: [
        { id: "med", name: "Vitamin", dose: "1", times: ["08:00"], active: true },
        { id: "old", name: "Stopped", dose: "", times: ["08:00"], active: false },
      ],
      users,
      alreadySent: new Set(["med_2026-01-15_08:00_on"]),
      snoozes: [
        {
          id: "s1",
          userId: "off",
          medicationId: "med",
          medicationName: "Vitamin",
          dose: "1",
          scheduledTime: "08:00",
          fireAt: new Date("2026-01-15T12:59:00Z"),
        },
        {
          id: "s2",
          userId: "on",
          medicationId: "med",
          medicationName: "Vitamin",
          dose: "1",
          scheduledTime: "08:00",
          fireAt: new Date("2026-01-15T12:59:00Z"),
        },
      ],
    });
    expect(due.map((item) => item.receiptId)).toEqual(["snooze_s2"]);
    expect(isWithinWindow("08:00", "08:01", 2)).toBe(true);
    expect(isWithinWindow("08:00", "08:02", 2)).toBe(false);
  });

  it("sends the care team thread only to enabled care providers and team leads", () => {
    const roster = [
      { uid: "lead", displayName: "Lead", role: "team_lead", active: true, otpVerified: true, onShift: false, enabled: true },
      { uid: "pat", displayName: "Pat", role: "care_provider", active: true, otpVerified: true, onShift: false, enabled: true },
      { uid: "admin", displayName: "Admin", role: "admin", active: true, otpVerified: true, onShift: false, enabled: true },
      { uid: "super", displayName: "Super", role: "super_admin", active: true, otpVerified: true, onShift: true, enabled: true },
      { uid: "hold", displayName: "Hold", role: "care_provider", active: true, otpVerified: true, onShift: true, enabled: false },
      { uid: "sam", displayName: "Sam", role: "care_provider", active: true, otpVerified: true, onShift: false },
    ];
    expect(careTeamRecipients(roster, "pat").map((user) => user.uid)).toEqual(["lead", "sam"]);
    expect(noticeRecipients(roster, "lead").map((user) => user.uid)).toEqual(["pat", "admin", "super", "sam"]);
    expect(directRecipients(roster, "pat", ["pat", "hold", "admin"])).toEqual(["admin"]);
  });

  it("builds an audible visible push, with the medication prompt kept on screen", () => {
    const message = buildMulticast({
      tokens: ["abc"],
      title: "Medication due",
      body: "Vitamin · 08:00",
      link: "/?view=home&med=med&time=08:00",
      data: { type: "medication", medicationId: "med", scheduledTime: "08:00" },
    });
    expect(message.notification.title).toBe("Medication due");
    expect(message.webpush.notification.silent).toBe(false);
    expect(message.webpush.notification.requireInteraction).toBe(true);
    expect(message.android.notification.sound).toBe("default");
    expect(message.apns.payload.aps.sound).toBe("default");
    expect(() =>
      buildMulticast({
        tokens: [],
        title: "Hi",
        body: "There",
        link: "/",
        data: { type: "message" },
      }),
    ).toThrow(/No tokens/);
  });

  it("formats zoned care-home time", () => {
    expect(zonedParts(new Date("2026-01-15T15:04:00Z"), "America/New_York")).toEqual({
      date: "2026-01-15",
      time: "10:04",
    });
  });
});

describe("shift acceptance", () => {
  it("moves the shift to the person who accepts and keeps history", () => {
    const next = applyAcceptance(
      { userId: "pat", userName: "Pat", date: "2026-10-08", start: "08:00", end: "16:00" },
      {
        type: "day_off",
        shiftId: "s1",
        requesterId: "pat",
        status: "pending",
        history: [{ action: "requested", uid: "pat", name: "Pat", at: "2026-10-07T12:00:00Z" }],
      },
      { uid: "sam", name: "Sam" },
      "2026-10-07T13:00:00Z",
    );
    expect(next.shift.userId).toBe("sam");
    expect(next.request.status).toBe("accepted");
    expect(next.request.history.map((entry) => entry.action)).toEqual(["requested", "accepted"]);
    expect(() =>
      applyAcceptance(
        next.shift,
        next.request,
        { uid: "sam", name: "Sam" },
        "2026-10-07T14:00:00Z",
      ),
    ).toThrow(/no longer open/);
  });
});

describe("installed push gate", () => {
  it("refuses a normal browser tab and allows an installed app", () => {
    expect(
      pushSubscribeBlock({ standalone: false, pushSupported: true, vapidConfigured: true }),
    ).toMatch(/Home Screen/);
    expect(pushSubscribeBlock({ standalone: true, pushSupported: true, vapidConfigured: false })).toMatch(/VAPID/);
    expect(pushSubscribeBlock({ standalone: true, pushSupported: true, vapidConfigured: true })).toBeNull();
  });
});
