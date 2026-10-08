import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";

const PROJECT_ID = "demo-family-care";
let testEnv: RulesTestEnvironment;

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const gif = new Uint8Array([71, 73, 70, 56, 57, 97]);
const future = () => Timestamp.fromMillis(Date.now() + 200 * 24 * 60 * 60 * 1000);

async function put(uid: string, path: string, bytes: Uint8Array, contentType: string) {
  const storage = testEnv.authenticatedContext(uid).storage();
  return uploadBytes(ref(storage, path), bytes, { contentType });
}

describe("storage pictures", () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
      storage: { rules: readFileSync("storage.rules", "utf8") },
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.clearStorage();
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
      await setDoc(doc(db, "users/admin"), { ...base, email: "admin@example.com", displayName: "Admin", role: "admin" });
      await setDoc(doc(db, "users/lead"), { ...base, email: "lead@example.com", displayName: "Lead", role: "team_lead" });
      await setDoc(doc(db, "users/pat"), { ...base, email: "pat@example.com", displayName: "Pat", role: "care_provider" });
      await setDoc(doc(db, "users/sam"), { ...base, email: "sam@example.com", displayName: "Sam", role: "care_provider" });
      await setDoc(doc(db, "threads/direct_pat_sam"), {
        type: "direct",
        participantIds: ["pat", "sam"],
        title: "Sam",
        lastMessageText: "",
        lastSenderId: "",
        lastSenderName: "",
        lastMessageAt: Timestamp.now(),
      });
    });
  });

  it("lets the author store a handover picture and a teammate open it", async () => {
    await assertSucceeds(put("pat", "handover/pat/note.png", png, "image/png"));
    await assertFails(put("pat", "handover/sam/note.png", png, "image/png"));
    await assertFails(put("pat", "handover/pat/note.txt", png, "text/plain"));
    const reader = testEnv.authenticatedContext("sam").storage();
    await assertSucceeds(getBytes(ref(reader, "handover/pat/note.png")));
    await assertFails(getBytes(ref(testEnv.unauthenticatedContext().storage(), "handover/pat/note.png")));
  });

  it("keeps group pictures with care staff and direct pictures with the thread", async () => {
    await assertSucceeds(put("pat", "messages/group/pat/meme.gif", gif, "image/gif"));
    await assertFails(put("admin", "messages/group/admin/meme.gif", gif, "image/gif"));
    await assertSucceeds(put("pat", "messages/direct_pat_sam/pat/pic.png", png, "image/png"));
    await assertFails(put("lead", "messages/direct_pat_sam/lead/pic.png", png, "image/png"));
    await assertSucceeds(getBytes(ref(testEnv.authenticatedContext("sam").storage(), "messages/direct_pat_sam/pat/pic.png")));
    await assertSucceeds(getBytes(ref(testEnv.authenticatedContext("admin").storage(), "messages/direct_pat_sam/pat/pic.png")));
    await assertFails(getBytes(ref(testEnv.authenticatedContext("lead").storage(), "messages/direct_pat_sam/pat/pic.png")));
  });
});
