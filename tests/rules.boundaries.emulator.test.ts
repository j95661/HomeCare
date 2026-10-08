import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where } from "firebase/firestore";

const PROJECT_ID = "demo-family-care";
let testEnv: RulesTestEnvironment;

const future = () => Timestamp.fromMillis(Date.now() + 200 * 24 * 60 * 60 * 1000);

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const base = {
      active: true,
      otpVerified: true,
      onShift: false,
      protected: false,
      passwordChangedAt: Timestamp.now(),
      passwordExpiresAt: future(),
    };
    await setDoc(doc(db, "users/super"), {
      ...base,
      email: "super@example.com",
      displayName: "Super",
      role: "super_admin",
      protected: true,
      onShift: true,
    });
    await setDoc(doc(db, "users/admin"), { ...base, email: "admin@example.com", displayName: "Admin", role: "admin" });
    await setDoc(doc(db, "users/lead"), { ...base, email: "lead@example.com", displayName: "Lead", role: "team_lead" });
    await setDoc(doc(db, "users/pat"), { ...base, email: "pat@example.com", displayName: "Pat", role: "care_provider", onShift: true });
    await setDoc(doc(db, "users/sam"), { ...base, email: "sam@example.com", displayName: "Sam", role: "care_provider" });
    await setDoc(doc(db, "users/inactive"), {
      ...base,
      email: "old@example.com",
      displayName: "Old",
      role: "care_provider",
      active: false,
    });
    await setDoc(doc(db, "groupThread/main"), {
      type: "group",
      title: "Everyone",
      lastMessageText: "",
      lastMessageAt: Timestamp.now(),
      lastSenderId: "",
      lastSenderName: "",
    });
    await setDoc(doc(db, "private/otp"), { code: "secret" });
    await setDoc(doc(db, "medicationSnoozes/s1"), { userId: "pat" });
    await setDoc(doc(db, "reminderReceipts/r1"), { userId: "pat" });
    await setDoc(doc(db, "medicationLogs/pat-log"), {
      userId: "pat",
      userName: "Pat",
      medicationName: "Vitamin",
      scheduledTime: "08:00",
      action: "given",
      day: "2026-10-08",
      createdAt: Timestamp.now(),
    });
    await setDoc(doc(db, "medicationLogs/sam-log"), {
      userId: "sam",
      userName: "Sam",
      medicationName: "Vitamin",
      scheduledTime: "08:00",
      action: "given",
      day: "2026-10-08",
      createdAt: Timestamp.now(),
    });
  });
});

function dbFor(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

describe("server-only care records", () => {
  it("hides OTP challenges, snoozes, and reminder receipts from every client", async () => {
    for (const uid of ["pat", "super"]) {
      await assertFails(getDoc(doc(dbFor(uid), "private/otp")));
      await assertFails(getDoc(doc(dbFor(uid), "medicationSnoozes/s1")));
      await assertFails(getDoc(doc(dbFor(uid), "reminderReceipts/r1")));
      await assertFails(setDoc(doc(dbFor(uid), "medicationSnoozes/new"), { userId: uid }));
      await assertFails(setDoc(doc(dbFor(uid), "reminderReceipts/new"), { userId: uid }));
    }
  });

  it("lets a care provider read only their own medication log", async () => {
    await assertSucceeds(getDocs(query(collection(dbFor("pat"), "medicationLogs"), where("userId", "==", "pat"))));
    await assertFails(getDocs(query(collection(dbFor("pat"), "medicationLogs"), where("userId", "==", "sam"))));
    await assertFails(getDoc(doc(dbFor("pat"), "medicationLogs/sam-log")));
    await assertSucceeds(getDoc(doc(dbFor("lead"), "medicationLogs/sam-log")));
  });
});

describe("profile writes", () => {
  it("allows only the caller's own on-shift flag", async () => {
    await assertSucceeds(updateDoc(doc(dbFor("super"), "users/super"), { onShift: false }));
    await assertFails(updateDoc(doc(dbFor("super"), "users/super"), { protected: false }));
    await assertFails(updateDoc(doc(dbFor("super"), "users/super"), { role: "admin" }));
    await assertFails(updateDoc(doc(dbFor("pat"), "users/pat"), { displayName: "Patricia", onShift: true }));
    await assertFails(deleteDoc(doc(dbFor("super"), "users/pat")));
  });
});

describe("medication and shift shape", () => {
  it("rejects a medication with no times or a bad clock", async () => {
    const base = {
      name: "Vitamin",
      dose: "1",
      frequency: "Daily",
      careNotes: "",
      active: true,
      updatedBy: "admin",
      updatedAt: serverTimestamp(),
    };
    await assertFails(setDoc(doc(dbFor("admin"), "medications/empty"), { ...base, times: [] }));
    await assertFails(setDoc(doc(dbFor("admin"), "medications/bad"), { ...base, times: ["8:00"] }));
    await assertSucceeds(setDoc(doc(dbFor("admin"), "medications/ok"), { ...base, times: ["08:00"] }));
    await assertFails(deleteDoc(doc(dbFor("lead"), "medications/ok")));
    await assertSucceeds(deleteDoc(doc(dbFor("admin"), "medications/ok")));
  });

  it("rejects a shift for an inactive person and a shift a provider tries to delete", async () => {
    const open = {
      userId: "pat",
      userName: "Pat",
      date: "2026-10-08",
      start: "08:00",
      end: "16:00",
      createdBy: "lead",
      updatedAt: serverTimestamp(),
    };
    await assertFails(setDoc(doc(dbFor("lead"), "shifts/old"), { ...open, userId: "inactive", userName: "Old" }));
    await assertSucceeds(setDoc(doc(dbFor("lead"), "shifts/day"), open));
    await assertFails(deleteDoc(doc(dbFor("pat"), "shifts/day")));
    await assertSucceeds(deleteDoc(doc(dbFor("lead"), "shifts/day")));
  });

  it("rejects a weekly shift for an inactive person, a bad weekday, or a reversed window", async () => {
    const pattern = {
      userId: "pat",
      userName: "Pat",
      weekday: 3,
      start: "08:00",
      end: "16:00",
      effectiveFrom: "2000-01-01",
      effectiveUntil: "",
      createdBy: "lead",
      updatedAt: serverTimestamp(),
    };
    await assertFails(setDoc(doc(dbFor("lead"), "shiftTemplates/old"), { ...pattern, userId: "inactive", userName: "Old" }));
    await assertFails(setDoc(doc(dbFor("lead"), "shiftTemplates/bad-day"), { ...pattern, weekday: 7 }));
    await assertFails(
      setDoc(doc(dbFor("lead"), "shiftTemplates/backwards"), { ...pattern, effectiveFrom: "2026-10-08", effectiveUntil: "2026-10-01" }),
    );
    await assertSucceeds(setDoc(doc(dbFor("lead"), "shiftTemplates/ok"), pattern));
  });
});

describe("notes, guides, and threads", () => {
  it("keeps handover notes authored by the signed-in person and closed to edits", async () => {
    const note = {
      body: "Quiet afternoon",
      authorId: "pat",
      authorName: "Pat",
      createdAt: serverTimestamp(),
    };
    await assertSucceeds(setDoc(doc(dbFor("pat"), "handoverNotes/n1"), note));
    await assertFails(updateDoc(doc(dbFor("pat"), "handoverNotes/n1"), { body: "Changed" }));
    await assertFails(
      setDoc(doc(dbFor("pat"), "handoverNotes/spoof"), {
        ...note,
        authorId: "sam",
        authorName: "Sam",
      }),
    );
    await assertFails(setDoc(doc(dbFor("pat"), "handoverNotes/blank"), { ...note, body: "" }));
    await assertFails(deleteDoc(doc(dbFor("lead"), "handoverNotes/n1")));
  });

  it("lets a team lead read a guide and blocks them from editing or removing it", async () => {
    const guide = {
      title: "Shower",
      summary: "Evening",
      steps: [{ title: "Towel", detail: "Warm it" }],
      updatedBy: "admin",
      updatedAt: serverTimestamp(),
    };
    await assertSucceeds(setDoc(doc(dbFor("admin"), "guides/shower"), guide));
    await assertSucceeds(getDoc(doc(dbFor("lead"), "guides/shower")));
    await assertFails(updateDoc(doc(dbFor("lead"), "guides/shower"), { title: "Bath" }));
    await assertFails(deleteDoc(doc(dbFor("lead"), "guides/shower")));
    await assertSucceeds(deleteDoc(doc(dbFor("super"), "guides/shower")));
  });

  it("rejects a group message outside the main thread, a blank message, and an edit", async () => {
    const message = {
      senderId: "pat",
      senderName: "Pat",
      text: "Can you cover Thursday?",
      createdAt: serverTimestamp(),
    };
    await assertFails(getDoc(doc(dbFor("pat"), "groupThread/other")));
    await assertFails(addDoc(collection(dbFor("pat"), "groupThread/other/messages"), message));
    await assertFails(addDoc(collection(dbFor("pat"), "groupThread/main/messages"), { ...message, text: "   " }));
    const created = await assertSucceeds(addDoc(collection(dbFor("pat"), "groupThread/main/messages"), message));
    await assertSucceeds(
      addDoc(collection(dbFor("pat"), "groupThread/main/messages"), { ...message, text: "Quiet morning 🌸" }),
    );
    await assertFails(updateDoc(created, { text: "Edited" }));
    await assertFails(deleteDoc(created));
  });

  it("requires a sorted pair id and keeps outsiders out of a direct thread", async () => {
    const thread = {
      type: "direct",
      participantIds: ["sam", "pat"],
      title: "Sam",
      lastMessageText: "",
      lastMessageAt: serverTimestamp(),
      lastSenderId: "",
      lastSenderName: "",
    };
    await assertFails(setDoc(doc(dbFor("pat"), "threads/direct_sam_pat"), thread));
    await assertSucceeds(setDoc(doc(dbFor("pat"), "threads/direct_pat_sam"), { ...thread, participantIds: ["pat", "sam"] }));
    await assertFails(
      addDoc(collection(dbFor("lead"), "threads/direct_pat_sam/messages"), {
        senderId: "lead",
        senderName: "Lead",
        text: "I should not see this",
        createdAt: serverTimestamp(),
      }),
    );
    const sent = await assertSucceeds(
      addDoc(collection(dbFor("sam"), "threads/direct_pat_sam/messages"), {
        senderId: "sam",
        senderName: "Sam",
        text: "I can cover it",
        createdAt: serverTimestamp(),
      }),
    );
    await assertFails(deleteDoc(sent));
    await assertFails(getDocs(collection(dbFor("lead"), "threads/direct_pat_sam/messages")));
    await assertSucceeds(getDocs(collection(dbFor("admin"), "threads/direct_pat_sam/messages")));
    await assertSucceeds(getDocs(collection(dbFor("pat"), "threads/direct_pat_sam/messages")));
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users/hold"), {
        email: "hold@example.com",
        displayName: "Hold",
        role: "care_provider",
        active: true,
        enabled: false,
        otpVerified: false,
        onShift: false,
        protected: false,
        passwordChangedAt: Timestamp.now(),
        passwordExpiresAt: future(),
      });
    });
    await assertFails(
      setDoc(doc(dbFor("pat"), "threads/direct_hold_pat"), {
        ...thread,
        participantIds: ["hold", "pat"],
        title: "Hold",
      }),
    );
  });
});
