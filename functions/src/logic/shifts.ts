import type { CoverageKind } from "./schedule";

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
  status: "pending" | "accepted" | "declined" | "cancelled";
  history: { action: string; uid: string; name: string; at: string }[];
};

export function applyAcceptance(
  shift: ShiftRecord,
  request: ShiftRequestRecord,
  acceptor: { uid: string; name: string },
  at: string,
): { shift: ShiftRecord; request: ShiftRequestRecord } {
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
