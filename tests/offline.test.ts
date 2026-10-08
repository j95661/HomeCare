import { describe, expect, it } from "vitest";
import { deviceActedAt, normalizeActionId } from "../functions/src/logic/medLog";
import {
  createMedQueue,
  memoryMedQueueStore,
  mergeMedicationLogs,
  normalizeQueuedAction,
  type QueuedMedAction,
} from "../src/medQueue";
import { parseCachedSession, readCachedSession, shouldRestoreCachedSession, writeCachedSession } from "../src/offline";
import { SHELL_CACHE, SHELL_PRECACHE, serviceWorkerSource } from "../scripts/swSource.mjs";
import type { MedLog, Session } from "../src/types";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

function session(partial: Partial<Session> = {}): Session {
  return {
    uid: "alex",
    email: "alex@homecare.test",
    role: "care_provider",
    displayName: "Alex",
    emoji: "",
    onShift: true,
    timezone: "America/Chicago",
    snoozeMinutes: 10,
    passwordMaxAgeDays: 90,
    colorScheme: "sky",
    personalColorScheme: "",
    backgroundImage: "",
    ...partial,
  };
}

function queued(partial: Partial<QueuedMedAction> = {}): QueuedMedAction {
  return {
    actionId: "action-01",
    userId: "alex",
    medicationId: "vitamin",
    scheduledTime: "08:00",
    action: "given",
    note: "with breakfast",
    actedAt: Date.UTC(2026, 9, 8, 13, 5, 0),
    ...partial,
  };
}

function log(partial: Partial<MedLog> = {}): MedLog {
  return {
    id: "server-log",
    userId: "alex",
    userName: "Alex",
    medicationId: "vitamin",
    medicationName: "Vitamin D",
    dose: "1 tablet",
    scheduledTime: "08:00",
    action: "given",
    note: "",
    day: "2026-10-08",
    ...partial,
  };
}

describe("offline session", () => {
  it("restores the signed-in session after the network drops", () => {
    const storage = memoryStorage();
    const saved = session({ onShift: false, backgroundImage: "backgrounds/alex/room.png" });
    writeCachedSession(storage, saved);
    expect(readCachedSession(storage, "alex")).toEqual(saved);
    expect(readCachedSession(storage, "sam")).toBeNull();
    expect(shouldRestoreCachedSession(new Error("Failed to fetch"), false)).toBe(true);
    expect(shouldRestoreCachedSession({ code: "unavailable", message: "offline" }, true)).toBe(true);
    expect(shouldRestoreCachedSession({ code: "permission-denied", message: "nope" }, true)).toBe(false);
  });

  it("rejects a cached session for a different account or a broken role", () => {
    expect(parseCachedSession(JSON.stringify(session({ uid: "sam" })), "alex")).toBeNull();
    expect(parseCachedSession(JSON.stringify({ ...session(), role: "owner" }), "alex")).toBeNull();
    expect(parseCachedSession("{", "alex")).toBeNull();
  });
});

describe("medication queue", () => {
  it("keeps a failed action and removes it only after a confirmed sync", async () => {
    const queue = createMedQueue(memoryMedQueueStore());
    const first = queued({ actionId: "action-01", actedAt: 1_700_000_000_000 });
    const second = queued({ actionId: "action-02", actedAt: 1_700_000_000_100, action: "snooze" });
    await queue.enqueue(first);
    await queue.enqueue(second);

    const retried: string[] = [];
    const retry = await queue.sync("alex", async (item) => {
      retried.push(item.actionId);
      return { kind: "retry" };
    });
    expect(retried).toEqual(["action-01"]);
    expect(retry.retry).toBe(true);
    expect(await queue.list("alex")).toHaveLength(2);

    const held = await queue.sync("alex", async () => ({ kind: "keep", message: "Turn on shift before logging a medication." }));
    expect(held.keptMessage).toContain("Turn on shift");
    expect(await queue.list("alex")).toHaveLength(2);

    let sends = 0;
    const synced = await queue.sync("alex", async () => {
      sends += 1;
      return { kind: "synced" };
    });
    expect(synced.synced).toEqual(["action-01", "action-02"]);
    expect(await queue.list("alex")).toEqual([]);
    await queue.sync("alex", async () => {
      sends += 1;
      return { kind: "synced" };
    });
    expect(sends).toBe(2);
  });

  it("leaves another account's action in the queue", async () => {
    const queue = createMedQueue(memoryMedQueueStore());
    await queue.enqueue(queued({ userId: "sam", actionId: "action-sam" }));
    let sends = 0;
    await queue.sync("alex", async () => {
      sends += 1;
      return { kind: "synced" };
    });
    expect(sends).toBe(0);
    expect(await queue.list()).toHaveLength(1);
  });

  it("shows a queued action once, with the device time and user", () => {
    const item = queued();
    const meds = [{ id: "vitamin", name: "Vitamin D", dose: "1 tablet" }];
    const shown = mergeMedicationLogs([], [item], meds, "Alex", "2026-10-08");
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({
      id: item.actionId,
      userId: "alex",
      medicationName: "Vitamin D",
      action: "given",
      day: "2026-10-08",
    });
    expect(shown[0].createdAt?.toDate().getTime()).toBe(item.actedAt);

    const again = mergeMedicationLogs([log({ id: item.actionId })], [item], meds, "Alex", "2026-10-08");
    expect(again).toHaveLength(1);
    const sameAction = mergeMedicationLogs([log()], [item], meds, "Alex", "2026-10-08");
    expect(sameAction).toHaveLength(1);
  });

  it("refuses an action id that could collide or escape the queue", () => {
    expect(normalizeQueuedAction({ ...queued(), actionId: "short" })).toBeNull();
    expect(normalizeQueuedAction({ ...queued(), actionId: "../secret" })).toBeNull();
    expect(normalizeQueuedAction({ ...queued(), action: "maybe" })).toBeNull();
  });
});

describe("medication log sync", () => {
  it("keeps the device timestamp and a stable action id", () => {
    const now = Date.UTC(2026, 9, 8, 15, 0, 0);
    expect(deviceActedAt(now - 5000, now)).toBe(now - 5000);
    expect(deviceActedAt("nope", now)).toBe(now);
    expect(deviceActedAt(now + 48 * 60 * 60 * 1000, now)).toBe(now);
    expect(normalizeActionId("action-01")).toBe("action-01");
    expect(normalizeActionId("bad/id")).toBeNull();
  });
});

describe("app shell cache", () => {
  it("serves the cached shell when a navigation has no network", () => {
    const source = serviceWorkerSource({ apiKey: "test", projectId: "demo" }, "11.9.1");
    expect(SHELL_PRECACHE).toContain("/index.html");
    expect(SHELL_PRECACHE).toContain("/");
    expect(source).toContain(SHELL_CACHE);
    expect(source).toContain('caches.match("/index.html")');
    expect(source).toContain('request.method !== "GET"');
    expect(source).toContain("url.origin !== self.location.origin");
    expect(source).toContain("onBackgroundMessage");
    expect(source).toContain("notificationclick");
  });
});
