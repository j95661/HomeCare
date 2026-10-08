export type Role = "super_admin" | "admin" | "team_lead" | "care_provider";

export type ViewName =
  | "home"
  | "calendar"
  | "messages"
  | "more"
  | "meds"
  | "medlog"
  | "activities"
  | "guides"
  | "people"
  | "settings";

export type RouteState = {
  view: ViewName;
  thread: string | null;
  guide: string | null;
  med: string | null;
  time: string | null;
};

export type Session = {
  uid: string;
  email: string;
  role: Role;
  displayName: string;
  emoji: string;
  onShift: boolean;
  timezone: string;
  snoozeMinutes: number;
  passwordMaxAgeDays: number;
  colorScheme: string;
  personalColorScheme: string;
};

export type Person = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  emoji?: string;
  signIn?: "password" | "google" | "email_otp";
  active: boolean;
  enabled?: boolean;
  awaitingGoogle?: boolean;
  protected: boolean;
  onShift: boolean;
};

export type Invite = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  signIn: "google";
  rosterUid?: string;
};

export type Medication = {
  id: string;
  name: string;
  dose: string;
  frequency: string;
  times: string[];
  careNotes: string;
  active: boolean;
};

export type Shift = {
  id: string;
  userId: string;
  userName: string;
  date: string;
  start: string;
  end: string;
  createdBy: string;
};

export type ShiftRequest = {
  id: string;
  type: "swap" | "day_off";
  shiftId: string;
  templateId?: string;
  shiftDate: string;
  shiftStart: string;
  shiftEnd: string;
  requesterId: string;
  requesterName: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
  acceptedBy?: string | null;
  acceptedByName?: string | null;
  patternUpdated?: boolean;
  history?: { action: string; uid: string; name: string; at: string }[];
};

export type Handover = {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt?: { toDate: () => Date };
};

export type Activity = {
  id: string;
  title: string;
  details: string;
  createdBy: string;
};

export type GuideStep = { title: string; detail: string };

export type Guide = {
  id: string;
  title: string;
  summary: string;
  steps: GuideStep[];
};

export type MedLog = {
  id: string;
  userId: string;
  userName: string;
  medicationId?: string;
  medicationName: string;
  dose: string;
  scheduledTime: string;
  action: string;
  note: string;
  day: string;
  createdAt?: { toDate: () => Date };
};

export type ChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt?: { toDate: () => Date };
};
