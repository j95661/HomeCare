import { describe, expect, it } from "vitest";
import {
  adminReviewText,
  coverageReplyHours,
  replyDeadline,
  shouldReturnUnanswered,
  unansweredReplyText,
} from "../functions/src/logic/coverage";
import { adminRecipients } from "../functions/src/logic/reminders";
import { coverageMessageText, coveragePinsNotice } from "../functions/src/logic/messages";
import { canCancelCoverageRequest, showBoardNotice, showCoverageRequest } from "../src/schedule";

describe("coverage reply window", () => {
  it("clamps the reply window and builds a deadline from it", () => {
    expect(coverageReplyHours(24)).toBe(24);
    expect(coverageReplyHours(0)).toBe(24);
    expect(coverageReplyHours(200)).toBe(24);
    expect(coverageReplyHours("12")).toBe(12);
    expect(coverageReplyHours("no")).toBe(24);
    expect(replyDeadline(new Date("2026-10-08T12:00:00Z"), 2).toISOString()).toBe("2026-10-08T14:00:00.000Z");
  });

  it("returns only an unanswered away request after the deadline", () => {
    const replyBy = new Date("2026-10-08T12:00:00Z");
    const now = new Date("2026-10-08T12:00:00Z");
    expect(shouldReturnUnanswered({ type: "day_off", status: "pending", replyBy, coverBy: "" }, now)).toBe(true);
    expect(shouldReturnUnanswered({ type: "sick_leave", status: "pending", replyBy, coverBy: "" }, now)).toBe(true);
    expect(shouldReturnUnanswered({ type: "swap", status: "pending", replyBy, coverBy: "" }, now)).toBe(false);
    expect(shouldReturnUnanswered({ type: "day_off", status: "awaiting_admin", replyBy, coverBy: "" }, now)).toBe(false);
    expect(shouldReturnUnanswered({ type: "day_off", status: "pending", replyBy, coverBy: "sam" }, now)).toBe(false);
    expect(shouldReturnUnanswered({ type: "day_off", status: "pending", replyBy: null, coverBy: "" }, now)).toBe(false);
    expect(
      shouldReturnUnanswered({ type: "day_off", status: "pending", replyBy, coverBy: "" }, new Date("2026-10-08T11:59:00Z")),
    ).toBe(false);
  });

  it("tells the employee and the admins what happened", () => {
    expect(unansweredReplyText("day_off", "Wed, Oct 14, 8:00 AM–4:00 PM")).toBe(
      "Nobody responded to your time off for Wed, Oct 14, 8:00 AM–4:00 PM. It is back with you, waiting for an admin to approve.",
    );
    expect(adminReviewText("sick_leave", "Alex", "Wed, Oct 14, 8:00 AM–4:00 PM", "")).toBe(
      "Alex requested sick leave for Wed, Oct 14, 8:00 AM–4:00 PM. Nobody on the team responded. Please approve it.",
    );
    expect(adminReviewText("day_off", "Alex", "Wed, Oct 14, 8:00 AM–4:00 PM", "Sam")).toBe(
      "Sam offered to cover Alex's time off for Wed, Oct 14, 8:00 AM–4:00 PM. Please approve it.",
    );
    expect(
      coverageMessageText({
        action: "requested",
        type: "swap",
        date: "2026-10-07",
        start: "08:00",
        end: "16:00",
        reason: "Doctor visit",
      }),
    ).toBe("Requested a shift swap for Wed, Oct 7, 8:00 AM–4:00 PM. Reason: Doctor visit");
  });

  it("notifies admins only and shows team requests to the care team", () => {
    const roster = [
      { uid: "lead", displayName: "Lead", role: "team_lead", active: true, otpVerified: true, onShift: false, enabled: true },
      { uid: "admin", displayName: "Admin", role: "admin", active: true, otpVerified: true, onShift: false, enabled: true },
      { uid: "super", displayName: "Super", role: "super_admin", active: true, otpVerified: true, onShift: true, enabled: true },
      { uid: "hold", displayName: "Hold", role: "admin", active: true, otpVerified: true, onShift: true, enabled: false },
    ];
    expect(adminRecipients(roster).map((user) => user.uid)).toEqual(["admin", "super"]);
    const pendingSwap = { status: "pending", type: "swap", requesterId: "alex" };
    expect(showCoverageRequest(pendingSwap, "care_provider", "sam")).toBe(true);
    expect(showCoverageRequest(pendingSwap, "admin", "parent")).toBe(true);
    expect(canCancelCoverageRequest(pendingSwap, "care_provider", "alex")).toBe(true);
    expect(canCancelCoverageRequest(pendingSwap, "care_provider", "sam")).toBe(false);
    expect(canCancelCoverageRequest(pendingSwap, "admin", "parent")).toBe(true);
    expect(canCancelCoverageRequest({ status: "accepted", type: "swap", requesterId: "alex" }, "care_provider", "alex")).toBe(true);
    expect(canCancelCoverageRequest({ status: "accepted", type: "swap", requesterId: "alex" }, "team_lead", "lead")).toBe(false);
    expect(canCancelCoverageRequest({ status: "cancelled", type: "swap", requesterId: "alex" }, "admin", "parent")).toBe(false);
    expect(showCoverageRequest({ status: "awaiting_admin", type: "day_off", requesterId: "alex" }, "admin", "parent")).toBe(true);
    expect(showCoverageRequest({ status: "accepted", type: "swap", requesterId: "alex" }, "super_admin", "dad")).toBe(true);
    expect(showCoverageRequest(pendingSwap, "admin", "alex")).toBe(true);
  });

  it("pulls an accepted or cancelled swap off the notice board", () => {
    const when = { date: "2026-10-08", start: "08:00", end: "16:00" };
    expect(coveragePinsNotice({ action: "requested", type: "swap", ...when })).toBe(true);
    expect(coveragePinsNotice({ action: "accepted", type: "swap", ...when })).toBe(false);
    expect(coveragePinsNotice({ action: "cancelled", type: "swap", ...when })).toBe(false);
    expect(coveragePinsNotice({ action: "accepted", type: "day_off", ...when })).toBe(true);
    expect(coveragePinsNotice({ action: "cancelled", type: "sick_leave", ...when })).toBe(false);
    expect(showBoardNotice({ kind: "coverage", coverageType: "swap" }, "pending")).toBe(true);
    expect(showBoardNotice({ kind: "coverage", coverageType: "swap" }, "accepted")).toBe(false);
    expect(showBoardNotice({ kind: "coverage", coverageType: "swap" }, "cancelled")).toBe(false);
    expect(showBoardNotice({ kind: "coverage", coverageType: "day_off" }, "accepted")).toBe(true);
    expect(showBoardNotice({ kind: "notice", coverageType: "" }, "")).toBe(true);
    expect(showBoardNotice(null, "accepted")).toBe(false);
  });
});
