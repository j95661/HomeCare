import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";

const PROJECT_ID = "demo-family-care";
let testEnv: RulesTestEnvironment;

const future = () => Timestamp.fromMillis(Date.now() + 200 * 24 * 60 * 60 * 1000);
const past = () => Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);

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
    await setDoc(doc(db, "settings/app"), {
      passwordMaxAgeDays: 183,
      timezone: "America/New_York",
      snoozeMinutes: 10,
      superAdminEmail: "super@example.com",
      superAdminUid: "super",
    });
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
    await setDoc(doc(db, "users/pat"), {
      ...base,
      email: "pat@example.com",
      displayName: "Pat",
      role: "care_provider",
      onShift: true,
    });
    await setDoc(doc(db, "users/sam"), { ...base, email: "sam@example.com", displayName: "Sam", role: "care_provider" });
    await setDoc(doc(db, "users/inactive"), {
      ...base,
      email: "old@example.com",
      displayName: "Old",
      role: "care_provider",
      active: false,
    });
    await setDoc(doc(db, "users/unverified"), {
      ...base,
      email: "new@example.com",
      displayName: "New",
      role: "care_provider",
      otpVerified: false,
    });
    await setDoc(doc(db, "users/expired"), {
      ...base,
      email: "exp@example.com",
      displayName: "Exp",
      role: "admin",
      passwordExpiresAt: past(),
    });
    await setDoc(doc(db, "groupThread/main"), {
      type: "group",
      title: "Everyone",
      lastMessageText: "",
      lastMessageAt: Timestamp.now(),
      lastSenderId: "",
      lastSenderName: "",
    });
    await setDoc(doc(db, "users/pat/devices/phone"), {
      token: "pat-device-token",
      platform: "web",
      updatedAt: Timestamp.now(),
    });
    await setDoc(doc(db, "medicationLogs/log1"), {
      userId: "pat",
      userName: "Pat",
      medicationName: "Vitamin",
      dose: "1",
      scheduledTime: "08:00",
      action: "given",
      note: "",
      day: "2026-10-08",
      createdAt: Timestamp.now(),
    });
  });
});

function dbFor(uid: string, claims?: Record<string, unknown>) {
  return testEnv.authenticatedContext(uid, claims).firestore();
}

function medication(uid: string) {
  return {
    name: "Vitamin",
    dose: "1 tablet",
    frequency: "Daily",
    times: ["08:00", "20:00"],
    careNotes: "With water",
    active: true,
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  };
}

function shift(createdBy: string) {
  return {
    userId: "pat",
    userName: "Pat",
    date: "2026-10-08",
    start: "08:00",
    end: "16:00",
    createdBy,
    updatedAt: serverTimestamp(),
  };
}

describe("security rules", () => {
  it("blocks signed-out, inactive, unverified, and expired accounts immediately", async () => {
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "medications/x")));
    await assertFails(getDoc(doc(dbFor("inactive"), "medications/x")));
    await assertFails(getDoc(doc(dbFor("inactive"), "users/inactive")));
    await assertFails(getDoc(doc(dbFor("unverified"), "medications/x")));
    await assertFails(getDoc(doc(dbFor("expired"), "medications/x")));
    await assertSucceeds(getDoc(doc(dbFor("pat"), "settings/app")));
  });

  it("ignores custom claims and keeps role changes off the client", async () => {
    const claimedAdmin = dbFor("pat", { role: "super_admin", active: true });
    await assertFails(setDoc(doc(claimedAdmin, "medications/x"), medication("pat")));
    await assertFails(updateDoc(doc(dbFor("pat"), "users/pat"), { role: "super_admin" }));
    await assertFails(updateDoc(doc(dbFor("super"), "users/pat"), { role: "admin", active: false }));
    await assertFails(setDoc(doc(dbFor("super"), "users/newbie"), { role: "admin", active: true }));
    await assertSucceeds(updateDoc(doc(dbFor("pat"), "users/pat"), { onShift: false }));
    await assertFails(updateDoc(doc(dbFor("pat"), "users/sam"), { onShift: true }));
  });

  it("lets admins edit medications and guides, and blocks care providers and team leads", async () => {
    await assertSucceeds(setDoc(doc(dbFor("admin"), "medications/vit"), medication("admin")));
    await assertSucceeds(setDoc(doc(dbFor("super"), "medications/other"), medication("super")));
    await assertFails(setDoc(doc(dbFor("pat"), "medications/nope"), medication("pat")));
    await assertFails(setDoc(doc(dbFor("lead"), "medications/nope"), medication("lead")));
    await assertSucceeds(getDoc(doc(dbFor("pat"), "medications/vit")));
    const guide = {
      title: "Shower",
      summary: "Evening",
      steps: [{ title: "Towel", detail: "Warm it" }],
      updatedBy: "admin",
      updatedAt: serverTimestamp(),
    };
    await assertSucceeds(setDoc(doc(dbFor("admin"), "guides/shower"), guide));
    await assertFails(setDoc(doc(dbFor("pat"), "guides/nope"), { ...guide, updatedBy: "pat" }));
    await assertSucceeds(getDoc(doc(dbFor("pat"), "guides/shower")));
    await assertFails(setDoc(doc(dbFor("pat"), "settings/app"), { passwordMaxAgeDays: 1 }));
    await assertFails(updateDoc(doc(dbFor("super"), "settings/app"), { passwordMaxAgeDays: 30 }));
  });

  it("lets team leads manage shifts and keeps coverage requests on the server", async () => {
    await assertSucceeds(setDoc(doc(dbFor("lead"), "shifts/day"), shift("lead")));
    await assertSucceeds(setDoc(doc(dbFor("admin"), "shifts/other"), shift("admin")));
    await assertFails(setDoc(doc(dbFor("pat"), "shifts/self"), shift("pat")));
    await assertFails(setDoc(doc(dbFor("lead"), "shifts/overnight"), { ...shift("lead"), start: "16:00", end: "08:00", updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(dbFor("pat"), "shiftRequests/r1"), { status: "accepted" }));
    await assertSucceeds(getDocs(collection(dbFor("pat"), "shiftRequests")));
  });

  it("keeps medication logs server-written and limits who can read them", async () => {
    await assertFails(setDoc(doc(dbFor("pat"), "medicationLogs/new"), { userId: "pat", action: "given" }));
    await assertSucceeds(getDoc(doc(dbFor("pat"), "medicationLogs/log1")));
    await assertFails(getDocs(collection(dbFor("pat"), "medicationLogs")));
    await assertSucceeds(getDocs(query(collection(dbFor("pat"), "medicationLogs"), where("userId", "==", "pat"))));
    await assertSucceeds(getDocs(collection(dbFor("lead"), "medicationLogs")));
    await assertSucceeds(getDocs(collection(dbFor("admin"), "medicationLogs")));
    await assertFails(getDoc(doc(dbFor("sam"), "users/pat/devices/phone")));
    await assertSucceeds(getDoc(doc(dbFor("pat"), "users/pat/devices/phone")));
    await assertFails(setDoc(doc(dbFor("pat"), "users/pat/devices/other"), { token: "x".repeat(30) }));
  });

  it("lets every active person post notes, ideas, and messages, with deletes limited to admins", async () => {
    await assertSucceeds(
      addDoc(collection(dbFor("pat"), "handoverNotes"), {
        body: "Quiet afternoon",
        authorId: "pat",
        authorName: "Pat",
        createdAt: serverTimestamp(),
      }),
    );
    const noteRef = doc(dbFor("pat"), "handoverNotes/n1");
    await assertSucceeds(
      setDoc(noteRef, {
        body: "Quiet afternoon",
        authorId: "pat",
        authorName: "Pat",
        createdAt: serverTimestamp(),
      }),
    );
    await assertFails(deleteDoc(doc(dbFor("pat"), "handoverNotes/n1")));
    await assertSucceeds(deleteDoc(doc(dbFor("admin"), "handoverNotes/n1")));

    const createdAt = Timestamp.now();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "activities/walk"), {
        title: "Walk",
        details: "Around the block",
        createdBy: "pat",
        updatedBy: "pat",
        createdAt,
        updatedAt: createdAt,
      });
    });
    await assertSucceeds(
      updateDoc(doc(dbFor("sam"), "activities/walk"), {
        title: "Long walk",
        details: "Park and back",
        updatedBy: "sam",
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(deleteDoc(doc(dbFor("pat"), "activities/walk")));
    await assertSucceeds(deleteDoc(doc(dbFor("admin"), "activities/walk")));

    await assertSucceeds(
      addDoc(collection(dbFor("pat"), "groupThread/main/messages"), {
        senderId: "pat",
        senderName: "Pat",
        text: "Can you cover Thursday?",
        createdAt: serverTimestamp(),
      }),
    );
    await assertFails(
      addDoc(collection(dbFor("pat"), "groupThread/main/messages"), {
        senderId: "sam",
        senderName: "Sam",
        text: "Pretending",
        createdAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      setDoc(doc(dbFor("pat"), "threads/direct_pat_sam"), {
        type: "direct",
        participantIds: ["pat", "sam"],
        title: "Sam",
        lastMessageText: "",
        lastMessageAt: serverTimestamp(),
        lastSenderId: "",
        lastSenderName: "",
      }),
    );
    await assertFails(
      setDoc(doc(dbFor("pat"), "threads/direct_admin_sam"), {
        type: "direct",
        participantIds: ["admin", "sam"],
        title: "Nope",
        lastMessageText: "",
        lastMessageAt: serverTimestamp(),
        lastSenderId: "",
        lastSenderName: "",
      }),
    );
    await assertFails(getDoc(doc(dbFor("lead"), "threads/direct_pat_sam")));
    await assertSucceeds(getDoc(doc(dbFor("sam"), "threads/direct_pat_sam")));
  });

  it("flips access off as soon as the profile is marked inactive", async () => {
    const pat = dbFor("pat");
    await assertSucceeds(getDoc(doc(pat, "medications/missing")));
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "users/pat"), { active: false });
    });
    await assertFails(getDoc(doc(pat, "medications/missing")));
  });
});
