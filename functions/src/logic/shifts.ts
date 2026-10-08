import { isAwayKind, type CoverageKind } from "./schedule";

export type ShiftRecord = {
  userId: string;
  userName: string;
  date: string;
  start: string;
  end: string;
};

export type ShiftRequestRecord = {
  type: CoverageKind;
  shiftId: string;
  requesterId: string;
  status: "pending" | "awaiting_admin" | "accepted" | "declined" | "cancelled";
  coverBy?: string;
  coverByName?: string;
  acceptedBy?: string;
  history: { action: string; uid: string; name: string; at: string }[];
};

/** The care team accepts swaps and offers to cover time off. Admins do not. */
export function assertTeamResponse(role: string): void {
  if (role !== "care_provider" && role !== "team_lead") {
    throw new Error("The care team responds to this request.");
  }
}

/** An admin approves time off or sick leave after the team has had time to respond. */
export function assertAdminTimeOff(role: string): void {
  if (role !== "super_admin" && role !== "admin") {
    throw new Error("Only an admin can approve time off or sick leave.");
  }
}

/** A swap moves to the person who accepts. */
export function applyAcceptance(
  shift: ShiftRecord,
  request: ShiftRequestRecord,
  acceptor: { uid: string; name: string },
  at: string,
): { shift: ShiftRecord; request: ShiftRequestRecord } {
  if (isAwayKind(request.type)) throw new Error("Time off and sick leave wait for an admin.");
  if (request.status !== "pending") throw new Error("That request is no longer open.");
  if (acceptor.uid === request.requesterId) throw new Error("You cannot accept your own request.");
  if (shift.userId !== request.requesterId) throw new Error("That shift has already changed.");
  return {
    shift: { ...shift, userId: acceptor.uid, userName: acceptor.name },
    request: {
      ...request,
      status: "accepted",
      history: [...request.history, { action: "accepted", uid: acceptor.uid, name: acceptor.name, at }],
    },
  };
}

/** A teammate offers to cover time off or sick leave. An admin still has to approve it. */
export function offerToCover(
  request: ShiftRequestRecord,
  person: { uid: string; name: string },
  at: string,
): ShiftRequestRecord {
  if (!isAwayKind(request.type)) throw new Error("Only time off or sick leave can be covered.");
  if (request.status !== "pending") throw new Error("That request is no longer open.");
  if (person.uid === request.requesterId) throw new Error("You cannot cover your own request.");
  return {
    ...request,
    status: "awaiting_admin",
    coverBy: person.uid,
    coverByName: person.name,
    history: [...request.history, { action: "offered to cover", uid: person.uid, name: person.name, at }],
  };
}

/** Nobody on the team responded, so the request returns to the employee and waits for an admin. */
export function returnUnanswered(request: ShiftRequestRecord, at: string, name: string): ShiftRequestRecord {
  if (!isAwayKind(request.type)) throw new Error("Only time off or sick leave can be returned.");
  if (request.status !== "pending") throw new Error("That request is no longer open.");
  if (request.coverBy) throw new Error("Someone already offered to cover this shift.");
  return {
    ...request,
    status: "awaiting_admin",
    history: [...request.history, { action: "returned", uid: request.requesterId, name, at }],
  };
}

/** Admin approval. A cover person takes the day. Otherwise the requester keeps it as time off. */
export function approveTimeOff(
  shift: ShiftRecord,
  request: ShiftRequestRecord,
  admin: { uid: string; name: string },
  at: string,
): { shift: ShiftRecord; request: ShiftRequestRecord; kind: CoverageKind } {
  if (!isAwayKind(request.type)) throw new Error("That request is a shift swap.");
  if (request.status !== "awaiting_admin") throw new Error("The team still has time to respond.");
  if (admin.uid === request.requesterId) throw new Error("You cannot approve your own request.");
  if (shift.userId !== request.requesterId) throw new Error("That shift has already changed.");
  const covered = Boolean(request.coverBy && request.coverBy !== request.requesterId);
  return {
    kind: covered ? "swap" : request.type,
    shift: covered
      ? { ...shift, userId: request.coverBy || shift.userId, userName: request.coverByName || shift.userName }
      : shift,
    request: {
      ...request,
      status: "accepted",
      acceptedBy: admin.uid,
      history: [...request.history, { action: "approved", uid: admin.uid, name: admin.name, at }],
    },
  };
}
