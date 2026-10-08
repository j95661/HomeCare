import { useEffect, useState } from "react";
import type { MedLog } from "./types";

export const MED_ACTIONS = ["given", "declined", "missed", "snooze"] as const;
export type MedAction = (typeof MED_ACTIONS)[number];

export type QueuedMedAction = {
  actionId: string;
  userId: string;
  medicationId: string;
  scheduledTime: string;
  action: MedAction;
  note: string;
  actedAt: number;
};

export type SyncOutcome = { kind: "synced" } | { kind: "retry" } | { kind: "keep"; message: string };

export type DrainResult = {
  synced: string[];
  retry: boolean;
  keptMessage: string;
};

export type MedQueueStore = {
  list(): Promise<QueuedMedAction[]>;
  put(item: QueuedMedAction): Promise<void>;
  delete(actionId: string): Promise<void>;
};

const ACTION_ID = /^[A-Za-z0-9_-]{8,80}$/;
const CLOCK = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const DB_NAME = "homecare-offline";
const STORE = "medActions";

export function normalizeActionId(raw: unknown): string | null {
  const id = String(raw ?? "").trim();
  return ACTION_ID.test(id) ? id : null;
}

export function newMedActionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export function normalizeQueuedAction(input: {
  actionId: unknown;
  userId: unknown;
  medicationId: unknown;
  scheduledTime: unknown;
  action: unknown;
  note: unknown;
  actedAt: unknown;
}): QueuedMedAction | null {
  const actionId = normalizeActionId(input.actionId);
  const userId = String(input.userId ?? "");
  const medicationId = String(input.medicationId ?? "");
  const scheduledTime = String(input.scheduledTime ?? "");
  const action = String(input.action ?? "");
  const actedAt = typeof input.actedAt === "number" ? input.actedAt : Number(input.actedAt);
  if (!actionId || !userId || !medicationId || !CLOCK.test(scheduledTime)) return null;
  if (!MED_ACTIONS.includes(action as MedAction) || !Number.isFinite(actedAt)) return null;
  return {
    actionId,
    userId,
    medicationId,
    scheduledTime,
    action: action as MedAction,
    note: String(input.note ?? "").slice(0, 500),
    actedAt: Math.floor(actedAt),
  };
}

export function mergeMedicationLogs(
  logs: MedLog[],
  queued: QueuedMedAction[],
  meds: { id: string; name: string; dose: string }[],
  userName: string,
  day: string,
): MedLog[] {
  const extras: MedLog[] = [];
  for (const item of queued) {
    const already = logs.some(
      (log) =>
        log.id === item.actionId ||
        (log.userId === item.userId &&
          log.medicationId === item.medicationId &&
          log.scheduledTime === item.scheduledTime &&
          log.action === item.action),
    );
    if (already) continue;
    const med = meds.find((row) => row.id === item.medicationId);
    extras.push({
      id: item.actionId,
      userId: item.userId,
      userName,
      medicationId: item.medicationId,
      medicationName: med?.name || "",
      dose: med?.dose || "",
      scheduledTime: item.scheduledTime,
      action: item.action,
      note: item.note,
      day,
      createdAt: { toDate: () => new Date(item.actedAt) },
    });
  }
  return [...logs, ...extras];
}

export function memoryMedQueueStore(): MedQueueStore {
  const rows = new Map<string, QueuedMedAction>();
  return {
    async list() {
      return [...rows.values()];
    },
    async put(item) {
      rows.set(item.actionId, item);
    },
    async delete(actionId) {
      rows.delete(actionId);
    },
  };
}

function compareQueue(a: QueuedMedAction, b: QueuedMedAction): number {
  return a.actedAt - b.actedAt || a.actionId.localeCompare(b.actionId);
}

export function createMedQueue(store: MedQueueStore) {
  const listeners = new Set<() => void>();
  let tail: Promise<void> = Promise.resolve();

  function emit() {
    listeners.forEach((listener) => listener());
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async list(userId?: string) {
      const rows = await store.list();
      const mine = userId ? rows.filter((item) => item.userId === userId) : rows;
      return mine.sort(compareQueue);
    },
    async enqueue(item: QueuedMedAction) {
      const saved = normalizeQueuedAction(item);
      if (!saved) throw new Error("That medication action could not be saved on this device.");
      await store.put(saved);
      emit();
    },
    sync(userId: string, send: (item: QueuedMedAction) => Promise<SyncOutcome>): Promise<DrainResult> {
      const run = tail.then(() => drain(store, userId, send, emit));
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

async function drain(
  store: MedQueueStore,
  userId: string,
  send: (item: QueuedMedAction) => Promise<SyncOutcome>,
  emit: () => void,
): Promise<DrainResult> {
  const result: DrainResult = { synced: [], retry: false, keptMessage: "" };
  if (!userId) return result;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    result.retry = true;
    return result;
  }
  const items = (await store.list()).filter((item) => item.userId === userId).sort(compareQueue);
  for (const item of items) {
    const outcome = await send(item);
    if (outcome.kind === "retry") {
      result.retry = true;
      break;
    }
    if (outcome.kind === "synced") {
      await store.delete(item.actionId);
      result.synced.push(item.actionId);
      emit();
      continue;
    }
    if (!result.keptMessage) result.keptMessage = outcome.message;
  }
  emit();
  return result;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "actionId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const idbStore: MedQueueStore = {
  async list() {
    const db = await openDb();
    try {
      const rows = await idbRequest(db.transaction(STORE, "readonly").objectStore(STORE).getAll());
      return (rows as QueuedMedAction[]) || [];
    } finally {
      db.close();
    }
  },
  async put(item) {
    const db = await openDb();
    try {
      await idbRequest(db.transaction(STORE, "readwrite").objectStore(STORE).put(item));
    } finally {
      db.close();
    }
  },
  async delete(actionId) {
    const db = await openDb();
    try {
      await idbRequest(db.transaction(STORE, "readwrite").objectStore(STORE).delete(actionId));
    } finally {
      db.close();
    }
  },
};

const browserQueue = createMedQueue(idbStore);

export function enqueueMedAction(item: QueuedMedAction): Promise<void> {
  return browserQueue.enqueue(item);
}

export function syncMedicationQueue(
  userId: string,
  send: (item: QueuedMedAction) => Promise<SyncOutcome>,
): Promise<DrainResult> {
  return browserQueue.sync(userId, send);
}

export function useQueuedMedActions(userId: string): QueuedMedAction[] {
  const [items, setItems] = useState<QueuedMedAction[]>([]);
  useEffect(() => {
    if (!userId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      void browserQueue.list(userId).then((rows) => {
        if (!cancelled) setItems(rows);
      });
    };
    refresh();
    const unsubscribe = browserQueue.subscribe(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId]);
  return items;
}
