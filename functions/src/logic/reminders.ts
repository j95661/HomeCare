import { isWithinWindow } from "./time";

export type ReminderUser = {
  uid: string;
  displayName: string;
  active: boolean;
  otpVerified: boolean;
  onShift: boolean;
  role?: string;
  enabled?: boolean;
};

export type ReminderMed = {
  id: string;
  name: string;
  dose: string;
  times: string[];
  active: boolean;
};

export type PendingSnooze = {
  id: string;
  userId: string;
  medicationId: string;
  medicationName: string;
  dose: string;
  scheduledTime: string;
  fireAt: Date;
};

export type ReminderDispatch = {
  uid: string;
  medicationId: string;
  medicationName: string;
  dose: string;
  scheduledTime: string;
  date: string;
  receiptId: string;
  snoozeId?: string;
  title: string;
  body: string;
};

const WINDOW_MINUTES = 2;
const SNOOZE_GRACE_MS = 10 * 60 * 1000;

export function medicationRecipients(users: ReminderUser[]): ReminderUser[] {
  return users.filter((user) => user.active && user.otpVerified && user.onShift && user.enabled !== false);
}

export function messageRecipients(users: ReminderUser[], senderId: string): ReminderUser[] {
  return users.filter((user) => user.active && user.otpVerified && user.enabled !== false && user.uid !== senderId);
}

/** Ordinary care-team chat notifies care providers and team leads only. */
export function careTeamRecipients(users: ReminderUser[], senderId: string): ReminderUser[] {
  return messageRecipients(users, senderId).filter((user) => user.role === "care_provider" || user.role === "team_lead");
}

/** A Home notice reaches every active person except the sender. */
export function noticeRecipients(users: ReminderUser[], senderId: string): ReminderUser[] {
  return messageRecipients(users, senderId);
}

/** A shift swap, time off, or sick leave reaches the care team, not admins. */
export function coverageRecipients(users: ReminderUser[], senderId: string): ReminderUser[] {
  return careTeamRecipients(users, senderId);
}

/** Admins approve time off and sick leave after the team window. */
export function adminRecipients(users: ReminderUser[]): ReminderUser[] {
  return users.filter(
    (user) =>
      user.active &&
      user.otpVerified &&
      user.enabled !== false &&
      (user.role === "admin" || user.role === "super_admin"),
  );
}

export function directRecipients(users: ReminderUser[], senderId: string, participantIds: string[]): string[] {
  const allowed = new Set(messageRecipients(users, senderId).map((user) => user.uid));
  return participantIds.filter((uid) => allowed.has(uid));
}

export function selectMedicationDispatches(input: {
  now: Date;
  date: string;
  time: string;
  medications: ReminderMed[];
  users: ReminderUser[];
  alreadySent: Set<string>;
  snoozes: PendingSnooze[];
}): ReminderDispatch[] {
  const recipients = medicationRecipients(input.users);
  const recipientIds = new Set(recipients.map((user) => user.uid));
  const dispatches: ReminderDispatch[] = [];

  for (const med of input.medications) {
    if (!med.active) continue;
    for (const scheduledTime of med.times) {
      if (!isWithinWindow(scheduledTime, input.time, WINDOW_MINUTES)) continue;
      for (const user of recipients) {
        const receiptId = `${med.id}_${input.date}_${scheduledTime}_${user.uid}`;
        if (input.alreadySent.has(receiptId)) continue;
        dispatches.push({
          uid: user.uid,
          medicationId: med.id,
          medicationName: med.name,
          dose: med.dose,
          scheduledTime,
          date: input.date,
          receiptId,
          title: "Medication due",
          body: med.dose ? `${med.name} · ${med.dose} · ${scheduledTime}` : `${med.name} · ${scheduledTime}`,
        });
      }
    }
  }

  for (const snooze of input.snoozes) {
    if (!recipientIds.has(snooze.userId)) continue;
    const fireAt = snooze.fireAt.getTime();
    if (input.now.getTime() < fireAt) continue;
    if (input.now.getTime() > fireAt + SNOOZE_GRACE_MS) continue;
    const receiptId = `snooze_${snooze.id}`;
    if (input.alreadySent.has(receiptId)) continue;
    dispatches.push({
      uid: snooze.userId,
      medicationId: snooze.medicationId,
      medicationName: snooze.medicationName,
      dose: snooze.dose,
      scheduledTime: snooze.scheduledTime,
      date: input.date,
      receiptId,
      snoozeId: snooze.id,
      title: "Medication reminder",
      body: snooze.dose
        ? `${snooze.medicationName} · ${snooze.dose} · snoozed`
        : `${snooze.medicationName} · snoozed`,
    });
  }

  return dispatches;
}
