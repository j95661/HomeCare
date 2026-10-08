import { describe, expect, it } from "vitest";
import { nextMessageAlert } from "../src/messagesAlert";

describe("care team message alert", () => {
  it("marks Messages for every employee except the sender", () => {
    expect(
      nextMessageAlert({ latestAt: 20, senderId: "alex", viewerId: "sam", seenAt: 10, onMessages: false }),
    ).toEqual({ unread: true, seenAt: 10 });
    expect(
      nextMessageAlert({ latestAt: 20, senderId: "alex", viewerId: "alex", seenAt: 10, onMessages: false }),
    ).toEqual({ unread: false, seenAt: 10 });
  });

  it("clears the alert when that person opens Messages", () => {
    expect(
      nextMessageAlert({ latestAt: 20, senderId: "alex", viewerId: "sam", seenAt: 10, onMessages: true }),
    ).toEqual({ unread: false, seenAt: 20 });
  });
});
