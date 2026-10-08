import { describe, expect, it } from "vitest";
import {
  applyAcceptance,
  approveTimeOff,
  assertAdminTimeOff,
  assertTeamResponse,
  offerToCover,
  returnUnanswered,
  type ShiftRecord,
  type ShiftRequestRecord,
} from "../functions/src/logic/shifts";

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

  it("rejects a closed request, the requester, a shift that already moved, and time off", () => {
    const accepted = applyAcceptance(shift, request(), { uid: "sam", name: "Sam" }, "2026-10-07T13:00:00Z");
    expect(() => applyAcceptance(accepted.shift, accepted.request, { uid: "lead", name: "Lead" }, "2026-10-07T14:00:00Z")).toThrow(
      /no longer open/,
    );
    expect(() => applyAcceptance(shift, request(), { uid: "pat", name: "Pat" }, "2026-10-07T13:00:00Z")).toThrow(/your own request/);
    expect(() => applyAcceptance({ ...shift, userId: "sam", userName: "Sam" }, request(), { uid: "lead", name: "Lead" }, "2026-10-07T13:00:00Z")).toThrow(
      /already changed/,
    );
    expect(() => applyAcceptance(shift, request({ type: "day_off" }), { uid: "sam", name: "Sam" }, "2026-10-07T13:00:00Z")).toThrow(
      /wait for an admin/,
    );
  });

  it("lets the care team offer to cover and an admin approve that cover", () => {
    const offered = offerToCover(request({ type: "sick_leave" }), { uid: "sam", name: "Sam" }, "2026-10-07T13:00:00Z");
    expect(offered.status).toBe("awaiting_admin");
    expect(offered.coverBy).toBe("sam");
    expect(offered.history.at(-1)?.action).toBe("offered to cover");
    const approved = approveTimeOff(shift, offered, { uid: "admin", name: "Admin" }, "2026-10-07T14:00:00Z");
    expect(approved.kind).toBe("swap");
    expect(approved.shift).toEqual({ ...shift, userId: "sam", userName: "Sam" });
    expect(approved.request.history.at(-1)?.action).toBe("approved");
  });

  it("returns an unanswered request and keeps the day with the requester when an admin approves", () => {
    const returned = returnUnanswered(request({ type: "day_off" }), "2026-10-08T12:00:00Z", "Pat");
    expect(returned.status).toBe("awaiting_admin");
    expect(returned.history.at(-1)?.action).toBe("returned");
    const approved = approveTimeOff(shift, returned, { uid: "admin", name: "Admin" }, "2026-10-08T13:00:00Z");
    expect(approved.kind).toBe("day_off");
    expect(approved.shift.userId).toBe("pat");
  });

  it("lets care staff respond and only an admin approve time off", () => {
    expect(() => assertTeamResponse("care_provider")).not.toThrow();
    expect(() => assertTeamResponse("team_lead")).not.toThrow();
    expect(() => assertTeamResponse("admin")).toThrow(/care team/);
    expect(() => assertAdminTimeOff("admin")).not.toThrow();
    expect(() => assertAdminTimeOff("super_admin")).not.toThrow();
    expect(() => assertAdminTimeOff("team_lead")).toThrow(/admin can approve/);
  });
});
