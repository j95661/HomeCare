export function groupSeenKey(uid: string): string {
  return `homecare-group-seen:${uid}`;
}

/** A new care-team message lights Messages until this person opens that thread. */
export function nextMessageAlert(input: {
  latestAt: number;
  senderId: string;
  viewerId: string;
  seenAt: number;
  onMessages: boolean;
}): { unread: boolean; seenAt: number } {
  if (!input.viewerId || input.latestAt <= 0) return { unread: false, seenAt: input.seenAt };
  if (input.onMessages) return { unread: false, seenAt: Math.max(input.seenAt, input.latestAt) };
  return {
    unread: input.latestAt > input.seenAt && input.senderId !== input.viewerId,
    seenAt: input.seenAt,
  };
}
