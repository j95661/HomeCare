import { describe, expect, it } from "vitest";
import * as client from "../src/schedule";
import * as server from "../functions/src/logic/schedule";

const apis = [
  { name: "client", api: client },
  { name: "server", api: server },
];

function template(overrides: Partial<client.ShiftTemplate> = {}): client.ShiftTemplate {
  return {
    id: "alex-wed",
    userId: "alex",
    userName: "Alex",
    weekday: 3,
    start: "08:00",
    end: "16:00",
    effectiveFrom: "2000-01-01",
    effectiveUntil: "",
    ...overrides,
  };
}

function exception(overrides: Partial<client.ShiftException> = {}): client.ShiftException {
  return {
    id: "ex1",
    date: "2026-10-07",
    templateId: "alex-wed",
    kind: "swap",
    userId: "sam",
    userName: "Sam",
    start: "08:00",
    end: "16:00",
    requestId: "req1",
    ...overrides,
  };
}

describe("coverage request list", () => {
  it("drops cancelled requests and keeps pending and accepted ones", () => {
    const rows = [
      { id: "open", status: "pending" },
      { id: "gone", status: "cancelled" },
      { id: "taken", status: "accepted" },
    ];
    expect(client.visibleCoverageRequests(rows).map((row) => row.id)).toEqual(["open", "taken"]);
  });
});

describe("repeating shifts by person", () => {
  it("groups weekdays under each employee, ordered by name", () => {
    const groups = client.groupTemplatesByPerson([
      template({ id: "sam-fri", userId: "sam", userName: "Sam", weekday: 5, start: "16:00", end: "22:00" }),
      template({ id: "alex-mon", userId: "alex", userName: "Alex", weekday: 1, start: "08:00", end: "16:00" }),
      template({ id: "alex-wed", weekday: 3 }),
    ]);
    expect(groups.map((group) => group.userName)).toEqual(["Alex", "Sam"]);
    expect(groups[0].shifts.map((shift) => shift.weekday)).toEqual([1, 3]);
    expect(groups[1].shifts.map((shift) => shift.id)).toEqual(["sam-fri"]);
  });

  it("keeps employees who have no weekly shift on the list", () => {
    const groups = client.repeatingShiftGroups(
      [
        { id: "michelle", displayName: "Michelle" },
        { id: "zoe", displayName: "Zoe" },
      ],
      [template({ id: "zoe-wed", userId: "zoe", userName: "Zoe", weekday: 3, start: "16:30", end: "20:30" })],
    );
    expect(groups.map((group) => [group.userName, group.shifts.length])).toEqual([
      ["Michelle", 0],
      ["Zoe", 1],
    ]);
    expect(groups[1].shifts[0].id).toBe("zoe-wed");
  });

  it("keeps a weekly shift whose person is no longer on the roster", () => {
    const groups = client.repeatingShiftGroups([], [template({ userId: "former", userName: "Former" })]);
    expect(groups).toEqual([
      expect.objectContaining({ userId: "former", userName: "Former", shifts: [expect.objectContaining({ id: "alex-wed" })] }),
    ]);
  });
});

for (const { name, api } of apis) {
  describe(`weekly schedule (${name})`, () => {
    it("counts weekdays from the known Sunday", () => {
      expect(api.weekdayOf("2026-10-04")).toBe(0);
      expect(api.weekdayOf("2026-10-07")).toBe(3);
      expect(api.weekdayOf("2026-10-10")).toBe(6);
    });

    it("shows the template on matching weekdays and hides other days", () => {
      const shifts = api.resolveRange("2026-10-04", "2026-10-10", [template()], []);
      expect(shifts.map((shift) => shift.date)).toEqual(["2026-10-07"]);
      expect(shifts[0]).toMatchObject({ userName: "Alex", source: "template", kind: "", id: "alex-wed_2026-10-07" });
    });

    it("applies a swap or day off to that date only", () => {
      const templates = [template()];
      const exceptions = [exception(), exception({ id: "off", date: "2026-10-14", kind: "day_off", userId: "lead", userName: "Lead" })];
      const swapped = api.resolveDay("2026-10-07", templates, exceptions);
      const following = api.resolveDay("2026-10-14", templates, exceptions);
      const previous = api.resolveDay("2026-09-30", templates, exceptions);
      expect(swapped).toMatchObject([{ userName: "Sam", source: "exception", kind: "swap" }]);
      expect(following).toMatchObject([{ userName: "Lead", source: "exception", kind: "day_off" }]);
      expect(previous).toMatchObject([{ userName: "Alex", source: "template", kind: "" }]);
      expect(api.dayExceptionLabel(swapped)).toBe("Swap");
      expect(api.dayExceptionLabel(following)).toBe("Day off");
      expect(api.dayExceptionLabel(previous)).toBe("");
    });

    it("keeps an exception whose template is gone and ignores a duplicate", () => {
      const orphan = exception({ id: "gone", templateId: "missing", userName: "Riley" });
      const duplicate = exception({ id: "ex0", userName: "Earlier" });
      const day = api.resolveDay("2026-10-07", [template()], [exception(), duplicate, orphan]);
      expect(day.map((shift) => shift.userName)).toEqual(["Earlier", "Riley"]);
      expect(day[0]?.exceptionId).toBe("ex0");
    });

    it("sorts a split shift and respects the effective window", () => {
      const morning = template({ id: "early", start: "06:00", end: "10:00", effectiveFrom: "2026-10-07" });
      const afternoon = template({ id: "late", start: "12:00", end: "16:00", effectiveUntil: "2026-10-14" });
      expect(api.resolveDay("2026-09-30", [morning, afternoon], []).map((shift) => shift.id)).toEqual(["late_2026-09-30"]);
      expect(api.resolveDay("2026-10-07", [morning, afternoon], []).map((shift) => shift.start)).toEqual(["06:00", "12:00"]);
      expect(api.resolveDay("2026-10-14", [morning, afternoon], []).map((shift) => shift.id)).toEqual(["early_2026-10-14"]);
    });

    it("plans an exception write and refuses a shift that already moved", () => {
      expect(api.planCoverageWrite({ templateUserId: "alex", exceptionUserId: null, requesterId: "alex" })).toBe("create");
      expect(api.planCoverageWrite({ templateUserId: "alex", exceptionUserId: "sam", requesterId: "sam" })).toBe("update");
      expect(() => api.planCoverageWrite({ templateUserId: "alex", exceptionUserId: null, requesterId: "sam" })).toThrow(/already changed/);
      expect(() => api.planCoverageWrite({ templateUserId: "alex", exceptionUserId: "sam", requesterId: "alex" })).toThrow(/already changed/);
    });

    it("copies an accepted swap onto future weeks and leaves the swap date as an exception", () => {
      const current = template();
      const plan = api.promoteSwap({
        template: current,
        shiftDate: "2026-10-07",
        acceptorId: "sam",
        acceptorName: "Sam",
        alreadyPromoted: false,
      });
      expect(plan.effectiveUntil).toBe("2026-10-14");
      expect(plan.next).toMatchObject({
        userId: "sam",
        userName: "Sam",
        weekday: 3,
        start: "08:00",
        end: "16:00",
        effectiveFrom: "2026-10-14",
        effectiveUntil: "",
      });
      const closed = { ...current, effectiveUntil: plan.effectiveUntil };
      const opened = { ...plan.next, id: "sam-wed" };
      const exceptions = [exception()];
      expect(api.resolveDay("2026-09-30", [closed, opened], exceptions)).toMatchObject([{ userName: "Alex", source: "template" }]);
      expect(api.resolveDay("2026-10-07", [closed, opened], exceptions)).toMatchObject([{ userName: "Sam", source: "exception", kind: "swap" }]);
      expect(api.resolveDay("2026-10-14", [closed, opened], exceptions)).toMatchObject([{ userName: "Sam", source: "template", kind: "" }]);
      expect(api.resolveDay("2026-10-21", [closed, opened], exceptions)).toMatchObject([{ userName: "Sam", source: "template" }]);
    });

    it("refuses to promote a swap twice or after the pattern has already ended", () => {
      const current = template();
      expect(() =>
        api.promoteSwap({
          template: current,
          shiftDate: "2026-10-07",
          acceptorId: "sam",
          acceptorName: "Sam",
          alreadyPromoted: true,
        }),
      ).toThrow(/already the weekly pattern/);
      expect(() =>
        api.promoteSwap({
          template: { ...current, effectiveUntil: "2026-10-14" },
          shiftDate: "2026-10-07",
          acceptorId: "sam",
          acceptorName: "Sam",
          alreadyPromoted: false,
        }),
      ).toThrow(/already ends/);
      expect(api.isOpenTemplate(current, "2026-10-08")).toBe(true);
      expect(api.isOpenTemplate({ effectiveUntil: "2026-10-08" }, "2026-10-08")).toBe(false);
    });

    it("is on shift only inside that person's working hours", () => {
      const working = api.resolveDay("2026-10-07", [template()], []);
      const swapped = api.resolveDay("2026-10-07", [template()], [exception()]);
      const off = api.resolveDay("2026-10-14", [template()], [
        exception({ id: "off", date: "2026-10-14", kind: "day_off", userId: "alex", userName: "Alex" }),
      ]);
      expect(api.isDuringShift("07:59", working, "alex")).toBe(false);
      expect(api.isDuringShift("08:00", working, "alex")).toBe(true);
      expect(api.isDuringShift("15:59", working, "alex")).toBe(true);
      expect(api.isDuringShift("16:00", working, "alex")).toBe(false);
      expect(api.isDuringShift("10:00", swapped, "sam")).toBe(true);
      expect(api.isDuringShift("10:00", swapped, "alex")).toBe(false);
      expect(api.isDuringShift("10:00", off, "alex")).toBe(false);
    });

    it("holds a manual shift until the schedule matches it", () => {
      expect(api.planShiftSync({ onShift: false, shiftHold: false, scheduled: true })).toEqual({
        onShift: true,
        shiftHold: false,
        write: true,
      });
      expect(api.planShiftSync({ onShift: true, shiftHold: false, scheduled: true })).toEqual({
        onShift: true,
        shiftHold: false,
        write: false,
      });
      expect(api.planShiftSync({ onShift: false, shiftHold: true, scheduled: true })).toEqual({
        onShift: false,
        shiftHold: true,
        write: false,
      });
      expect(api.planShiftSync({ onShift: false, shiftHold: true, scheduled: false })).toEqual({
        onShift: false,
        shiftHold: false,
        write: true,
      });
      expect(api.planShiftSync({ onShift: true, shiftHold: true, scheduled: true })).toEqual({
        onShift: true,
        shiftHold: false,
        write: true,
      });
    });

    it("matches the other implementation on the same inputs", () => {
      const templates = [template(), template({ id: "split", start: "16:00", end: "20:00", userName: "Sam", userId: "sam" })];
      const exceptions = [exception()];
      const left = client.resolveRange("2026-10-01", "2026-10-21", templates, exceptions);
      const right = server.resolveRange("2026-10-01", "2026-10-21", templates, exceptions);
      expect(left).toEqual(right);
      expect(client.promoteSwap({
        template: template(),
        shiftDate: "2026-10-07",
        acceptorId: "sam",
        acceptorName: "Sam",
        alreadyPromoted: false,
      })).toEqual(
        server.promoteSwap({
          template: template(),
          shiftDate: "2026-10-07",
          acceptorId: "sam",
          acceptorName: "Sam",
          alreadyPromoted: false,
        }),
      );
    });
  });
}
