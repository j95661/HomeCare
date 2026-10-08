import { describe, expect, it } from "vitest";
import { swipeAxis, tabInDirection } from "../src/tabSwipe";

describe("tab swipe", () => {
  it("treats a long sideways move as a swipe and ignores a scroll", () => {
    expect(swipeAxis(-120, 10)).toBe("left");
    expect(swipeAxis(120, -8)).toBe("right");
    expect(swipeAxis(-40, 0)).toBeNull();
    expect(swipeAxis(-80, 90)).toBeNull();
    expect(swipeAxis(10, 140)).toBeNull();
  });

  it("moves between Home, Calendar, Messages, and More", () => {
    expect(tabInDirection("home", "left")).toBe("calendar");
    expect(tabInDirection("calendar", "left")).toBe("messages");
    expect(tabInDirection("messages", "left")).toBe("more");
    expect(tabInDirection("more", "left")).toBeNull();
    expect(tabInDirection("more", "right")).toBe("messages");
    expect(tabInDirection("calendar", "right")).toBe("home");
    expect(tabInDirection("home", "right")).toBeNull();
    expect(tabInDirection("meds", "left")).toBeNull();
    expect(tabInDirection("people", "right")).toBeNull();
  });
});
