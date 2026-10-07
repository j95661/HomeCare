import { logger } from "firebase-functions";
import type { Firestore } from "firebase-admin/firestore";
import type { Messaging } from "firebase-admin/messaging";
import { buildMulticast } from "./logic/push";

export async function tokensForUsers(
  store: Firestore,
  uids: string[],
): Promise<{ token: string; uid: string }[]> {
  const found: { token: string; uid: string }[] = [];
  for (const uid of uids) {
    const devices = await store.collection(`users/${uid}/devices`).get();
    devices.forEach((doc) => {
      const token = doc.get("token");
      if (typeof token === "string" && token.length > 0) found.push({ token, uid });
    });
  }
  return found;
}

export async function sendVisiblePush(
  store: Firestore,
  fcm: Messaging,
  uids: string[],
  payload: { title: string; body: string; link: string; data: Record<string, string> },
): Promise<void> {
  const unique = [...new Set(uids)];
  if (unique.length === 0) return;
  const deviceTokens = await tokensForUsers(store, unique);
  if (deviceTokens.length === 0) return;
  const message = buildMulticast({
    tokens: deviceTokens.map((item) => item.token),
    title: payload.title,
    body: payload.body,
    link: payload.link,
    data: payload.data,
  });
  try {
    const result = await fcm.sendEachForMulticast(message);
    const dead: string[] = [];
    result.responses.forEach((response, index) => {
      const code = response.error?.code ?? "";
      if (
        !response.success &&
        (code.includes("registration-token-not-registered") || code.includes("invalid-registration-token"))
      ) {
        dead.push(deviceTokens[index]?.token ?? "");
      }
    });
    if (dead.length > 0) {
      for (const uid of unique) {
        const devices = await store.collection(`users/${uid}/devices`).get();
        await Promise.all(
          devices.docs.filter((doc) => dead.includes(String(doc.get("token")))).map((doc) => doc.ref.delete()),
        );
      }
    }
  } catch (error) {
    logger.error("Push delivery failed", error);
  }
}

export async function unsubscribeTokens(fcm: Messaging, tokens: string[], uid: string): Promise<void> {
  if (tokens.length === 0) return;
  try {
    await fcm.unsubscribeFromTopic(tokens, `user-${uid}`);
    await fcm.unsubscribeFromTopic(tokens, "homecare-broadcast");
  } catch (error) {
    logger.warn("Unsubscribe failed; device tokens will still be deleted", error);
  }
}
