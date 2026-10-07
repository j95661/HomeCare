export type PushInput = {
  tokens: string[];
  title: string;
  body: string;
  link: string;
  data: Record<string, string>;
};

export function buildMulticast(input: PushInput): {
  tokens: string[];
  notification: { title: string; body: string };
  data: Record<string, string>;
  webpush: {
    fcmOptions: { link: string };
    notification: { title: string; body: string; silent: boolean; requireInteraction: boolean; icon: string };
  };
  android: { priority: "high"; notification: { sound: string; priority: "high" } };
  apns: { headers: { "apns-priority": string }; payload: { aps: { sound: string } } };
} {
  if (input.tokens.length === 0) throw new Error("No tokens to notify.");
  if (!input.title || !input.body) throw new Error("Push notifications must be visible.");
  return {
    tokens: input.tokens,
    notification: { title: input.title, body: input.body },
    data: input.data,
    webpush: {
      fcmOptions: { link: input.link },
      notification: {
        title: input.title,
        body: input.body,
        silent: false,
        requireInteraction: input.data.type === "medication",
        icon: "/icons/icon-192.png",
      },
    },
    android: { priority: "high", notification: { sound: "default", priority: "high" } },
    apns: { headers: { "apns-priority": "10" }, payload: { aps: { sound: "default" } } },
  };
}
