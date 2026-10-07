import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

const emulator = process.argv.includes("--emulator");
if (emulator) {
  process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
}

if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error("Refusing to run. Pass --emulator for the local emulators, or set GOOGLE_APPLICATION_CREDENTIALS for a real project.");
  process.exit(1);
}

const email = (process.env.SUPER_ADMIN_EMAIL || "").trim().toLowerCase();
const password = process.env.SUPER_ADMIN_PASSWORD || "";
const displayName = process.env.SUPER_ADMIN_NAME || "Super admin";

if (!email || !email.includes("@")) {
  console.error("Set SUPER_ADMIN_EMAIL to the one super admin address.");
  process.exit(1);
}
if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
  console.error("Set SUPER_ADMIN_PASSWORD to at least 8 characters with a letter and a number.");
  process.exit(1);
}

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "demo-family-care";
initializeApp({ projectId });
const auth = getAuth();
const db = getFirestore();

const DAY = 24 * 60 * 60 * 1000;
const MAX_DAYS = 183;

function zonedNow(timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type)?.value ?? "";
  let hour = value("hour");
  if (hour === "24") hour = "00";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, time: `${hour}:${value("minute")}` };
}

async function ensureUser({ email: userEmail, password: userPassword, displayName: name, role, protectedAccount }) {
  let record;
  try {
    record = await auth.getUserByEmail(userEmail);
    await auth.updateUser(record.uid, { displayName: name, disabled: false });
  } catch (error) {
    if (error?.code !== "auth/user-not-found") throw error;
    record = await auth.createUser({ email: userEmail, password: userPassword, displayName: name, disabled: false });
  }
  const ref = db.doc(`users/${record.uid}`);
  const existing = await ref.get();
  const otpVerified = existing.exists ? existing.get("otpVerified") === true : false;
  const onShift = existing.exists ? existing.get("onShift") === true : false;
  const passwordChangedAt = existing.exists && existing.get("passwordChangedAt") ? existing.get("passwordChangedAt") : Timestamp.now();
  const passwordExpiresAt =
    existing.exists && existing.get("passwordExpiresAt")
      ? existing.get("passwordExpiresAt")
      : Timestamp.fromMillis(Date.now() + MAX_DAYS * DAY);
  await ref.set(
    {
      email: userEmail,
      displayName: name,
      role,
      active: true,
      protected: protectedAccount,
      signIn: existing.exists && existing.get("signIn") ? existing.get("signIn") : "password",
      otpVerified,
      onShift,
      passwordChangedAt,
      passwordExpiresAt,
      createdBy: existing.exists ? existing.get("createdBy") || "bootstrap" : "bootstrap",
      createdAt: existing.exists ? existing.get("createdAt") || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await auth.setCustomUserClaims(record.uid, { role, active: true, otpVerified });
  return record.uid;
}

const superUid = await ensureUser({
  email,
  password,
  displayName,
  role: "super_admin",
  protectedAccount: true,
});

const settingsRef = db.doc("settings/app");
const settings = await settingsRef.get();
const timezone = settings.exists && settings.get("timezone") ? settings.get("timezone") : "America/Los_Angeles";
await settingsRef.set(
  {
    passwordMaxAgeDays: settings.exists && settings.get("passwordMaxAgeDays") ? settings.get("passwordMaxAgeDays") : MAX_DAYS,
    timezone,
    snoozeMinutes: settings.exists && settings.get("snoozeMinutes") ? settings.get("snoozeMinutes") : 10,
    colorScheme: settings.exists && settings.get("colorScheme") ? settings.get("colorScheme") : "forest",
    superAdminEmail: email,
    superAdminUid: superUid,
  },
  { merge: true },
);

const groupRef = db.doc("groupThread/main");
if (!(await groupRef.get()).exists) {
  await groupRef.set({
    type: "group",
    title: "Everyone",
    lastMessageText: "",
    lastMessageAt: FieldValue.serverTimestamp(),
    lastSenderId: "",
    lastSenderName: "",
  });
}

if (process.env.SEED_DEMO === "1") {
  const demoPassword = process.env.SEED_DEMO_PASSWORD || password;
  const parent = await ensureUser({
    email: "parent@homecare.test",
    password: demoPassword,
    displayName: "Parent",
    role: "admin",
    protectedAccount: false,
  });
  const lead = await ensureUser({
    email: "lead@homecare.test",
    password: demoPassword,
    displayName: "Lead",
    role: "team_lead",
    protectedAccount: false,
  });
  const alex = await ensureUser({
    email: "alex@homecare.test",
    password: demoPassword,
    displayName: "Alex",
    role: "care_provider",
    protectedAccount: false,
  });
  const sam = await ensureUser({
    email: "sam@homecare.test",
    password: demoPassword,
    displayName: "Sam",
    role: "care_provider",
    protectedAccount: false,
  });
  const now = zonedNow(timezone);
  const times = [...new Set(["08:00", "20:00", now.time])];
  await db.doc("medications/vitamin").set({
    name: "Vitamin D",
    dose: "1 tablet",
    frequency: "Daily",
    times,
    careNotes: "With breakfast if Andrew is up.",
    active: true,
    updatedBy: parent,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await db.doc("shifts/alex-today").set({
    userId: alex,
    userName: "Alex",
    date: now.date,
    start: "08:00",
    end: "16:00",
    createdBy: lead,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await db.doc("shifts/sam-today").set({
    userId: sam,
    userName: "Sam",
    date: now.date,
    start: "16:00",
    end: "22:00",
    createdBy: lead,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await db.doc("guides/shower").set({
    title: "Shower",
    summary: "Evening hygiene routine.",
    steps: [
      { title: "Set out the towel", detail: "Warm towel on the rack before starting." },
      { title: "Check the water", detail: "Warm, not hot. Stay nearby." },
      { title: "Dry and dress", detail: "Help with each step. Talk through what is next." },
    ],
    updatedBy: parent,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await db.doc("activities/music").set({
    title: "Music in the afternoon",
    details: "Play two familiar songs and offer a walk if the weather is good.",
    createdBy: alex,
    updatedBy: alex,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await db.doc("handoverNotes/welcome").set({
    body: "Quiet morning. Andrew ate breakfast and spent time with music.",
    authorId: alex,
    authorName: "Alex",
    createdAt: FieldValue.serverTimestamp(),
  });
  console.log("Demo accounts: parent@homecare.test, lead@homecare.test, alex@homecare.test, sam@homecare.test");
}

console.log(`Super admin ready: ${email}`);
