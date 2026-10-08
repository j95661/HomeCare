import { describe, expect, it } from "vitest";
import { applyAcceptance, assertCoverageApproval, type ShiftRecord, type ShiftRequestRecord } from "../functions/src/logic/shifts";

const shift: ShiftRecord = {
  userId: "pat",
  userName: "Pat",
  date: "2026-10-08",
  start: "08:00",
  end: "16:00",
};

function request(overrides: Partial<ShiftRequestRecord> = {}): ShiftRequestRecord {
  return {
    type: "swap",
    shiftId: "s1",
    requesterId: "pat",
    status: "pending",
    history: [{ action: "requested", uid: "pat", name: "Pat", at: "2026-10-07T12:00:00Z" }],
    ...overrides,
  };
}

describe("shift acceptance", () => {
  it("moves a swap to the person who accepts and appends history", () => {
    const next = applyAcceptance(shift, request(), { uid: "sam", name: "Sam" }, "2026-10-07T13:00:00Z");
    expect(next.shift).toEqual({ ...shift, userId: "sam", userName: "Sam" });
    expect(next.request.status).toBe("accepted");
    expect(next.request.history).toEqual([
      { action: "requested", uid: "pat", name: "Pat", at: "2026-10-07T12:00:00Z" },
      { action: "accepted", uid: "sam", name: "Sam", at: "2026-10-07T13:00:00Z" },
    ]);
  });

  it("keeps time off and sick leave with the requester when a lead approves", () => {
    const timeOff = applyAcceptance(shift, request({ type: "day_off" }), { uid: "lead", name: "Lead" }, "2026-10-07T13:00:00Z");
    expect(timeOff.shift).toEqual(shift);
    expect(timeOff.request.history.at(-1)).toEqual({ action: "approved", uid: "lead", name: "Lead", at: "2026-10-07T13:00:00Z" });
    const sick = applyAcceptance(shift, request({ type: "sick_leave" }), { uid: "admin", name: "Admin" }, "2026-10-07T13:00:00Z");
    expect(sick.shift.userId).toBe("pat");
    expect(sick.request.history.at(-1)?.action).toBe("approved");
  });

  it("rejects a closed request, the requester, and a shift that already moved", () => {
    const accepted = applyAcceptance(shift, request(), { uid: "sam", name: "Sam" }, "2026-10-07T13:00:00Z");
    expect(() => applyAcceptance(accepted.shift, accepted.request, { uid: "lead", name: "Lead" }, "2026-10-07T14:00:00Z")).toThrow(
      /no longer open/,
    );
    expect(() => applyAcceptance(shift, request(), { uid: "pat", name: "Pat" }, "2026-10-07T13:00:00Z")).toThrow(/your own request/);
    expect(() => applyAcceptance({ ...shift, userId: "sam", userName: "Sam" }, request(), { uid: "lead", name: "Lead" }, "2026-10-07T13:00:00Z")).toThrow(
      /already changed/,
    );
  });

  it("lets any coworker accept a swap and only a lead or admin approve time off", () => {
    expect(() => assertCoverageApproval("swap", false)).not.toThrow();
    expect(() => assertCoverageApproval("day_off", true)).not.toThrow();
    expect(() => assertCoverageApproval("sick_leave", true)).not.toThrow();
    expect(() => assertCoverageApproval("day_off", false)).toThrow(/super admin, admin, or team lead/);
    expect(() => assertCoverageApproval("sick_leave", false)).toThrow(/approve time off or sick leave/);
  });
});
