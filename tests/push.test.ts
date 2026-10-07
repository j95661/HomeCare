import { describe, expect, it } from "vitest";
import { buildMulticast } from "../functions/src/logic/push";
import { pushSubscribeBlock } from "../src/pwa";

describe("visible push payloads", () => {
  it("keeps a medication reminder on screen with sound", () => {
    const message = buildMulticast({
      tokens: ["abc"],
      title: "Medication due",
      body: "Vitamin · 08:00",
      link: "/?view=home&med=med&time=08:00",
      data: { type: "medication", medicationId: "med", scheduledTime: "08:00" },
    });
    expect(message.notification).toEqual({ title: "Medication due", body: "Vitamin · 08:00" });
    expect(message.webpush.notification.silent).toBe(false);
    expect(message.webpush.notification.requireInteraction).toBe(true);
    expect(message.webpush.fcmOptions.link).toBe("/?view=home&med=med&time=08:00");
    expect(message.android.priority).toBe("high");
    expect(message.android.notification.sound).toBe("default");
    expect(message.apns.headers["apns-priority"]).toBe("10");
    expect(message.apns.payload.aps.sound).toBe("default");
  });

  it("still sounds for a message, without holding the banner open", () => {
    const message = buildMulticast({
      tokens: ["abc", "def"],
      title: "Pat",
      body: "Can you cover Thursday?",
      link: "/?view=messages&thread=group",
      data: { type: "message" },
    });
    expect(message.tokens).toEqual(["abc", "def"]);
    expect(message.webpush.notification.silent).toBe(false);
    expect(message.webpush.notification.requireInteraction).toBe(false);
  });

  it("refuses a silent or empty notification", () => {
    expect(() =>
      buildMulticast({ tokens: [], title: "Hi", body: "There", link: "/", data: { type: "message" } }),
    ).toThrow(/No tokens/);
    expect(() =>
      buildMulticast({ tokens: ["abc"], title: "", body: "There", link: "/", data: { type: "message" } }),
    ).toThrow(/must be visible/);
    expect(() =>
      buildMulticast({ tokens: ["abc"], title: "Hi", body: "", link: "/", data: { type: "message" } }),
    ).toThrow(/must be visible/);
  });
});

describe("Home Screen push gate", () => {
  it("explains each reason a browser tab cannot subscribe", () => {
    expect(pushSubscribeBlock({ standalone: false, pushSupported: true, vapidConfigured: true })).toMatch(/iOS 16.4/);
    expect(pushSubscribeBlock({ standalone: true, pushSupported: false, vapidConfigured: true })).toMatch(/does not support web push/);
    expect(pushSubscribeBlock({ standalone: true, pushSupported: true, vapidConfigured: false })).toMatch(/VAPID/);
    expect(pushSubscribeBlock({ standalone: true, pushSupported: true, vapidConfigured: true })).toBeNull();
  });
});
