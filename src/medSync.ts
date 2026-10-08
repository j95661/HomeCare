import { call, errorText } from "./api";
import { isReachabilityError } from "./offline";
import { syncMedicationQueue, type DrainResult, type QueuedMedAction, type SyncOutcome } from "./medQueue";

export async function sendMedAction(item: QueuedMedAction): Promise<SyncOutcome> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { kind: "retry" };
  try {
    await call("logMedicationResponse", {
      actionId: item.actionId,
      userId: item.userId,
      medicationId: item.medicationId,
      scheduledTime: item.scheduledTime,
      action: item.action,
      note: item.note,
      actedAt: item.actedAt,
    });
    return { kind: "synced" };
  } catch (error) {
    if (isReachabilityError(error)) return { kind: "retry" };
    return { kind: "keep", message: errorText(error) };
  }
}

export function syncMeds(userId: string): Promise<DrainResult> {
  return syncMedicationQueue(userId, sendMedAction);
}
