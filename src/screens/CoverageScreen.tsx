import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { call, errorText, isPermissionDenied } from "../api";
import { Empty, Field, Notice } from "../components";
import { withEmoji } from "../emoji";
import { db } from "../firebase";
import { canEditWeeklyPattern, canManageSchedule } from "../roles";
import { VIEW_CHANGE } from "../viewAs";
import {
  coverageRequestLabel,
  exceptionFromData,
  exceptionLabel,
  isAwayKind,
  resolveRange,
  templateFromData,
  visibleCoverageRequests,
  type CoverageKind,
  type ResolvedShift,
  type ShiftException,
  type ShiftTemplate,
} from "../schedule";
import { useSession } from "../session";
import { addDays, formatClock, formatDay, formatIso, todayISO } from "../time";
import type { Person, ShiftRequest } from "../types";

const HORIZON_DAYS = 27;

export function CoverageScreen() {
  const session = useSession();
  const today = todayISO(session.timezone);
  const end = addDays(today, HORIZON_DAYS);
  const manage = canEditWeeklyPattern(session.role);
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [exceptions, setExceptions] = useState<ShiftException[]>([]);
  const [requests, setRequests] = useState<ShiftRequest[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [withId, setWithId] = useState("");
  const [swapped, setSwapped] = useState("");

  const windowShifts = useMemo(
    () => resolveRange(today, end, templates, exceptions).filter((shift) => shift.templateId),
    [today, end, templates, exceptions],
  );
  const mine = useMemo(
    () => windowShifts.filter((shift) => shift.userId === session.uid),
    [windowShifts, session.uid],
  );
  const roster = useMemo(
    () => [...people].sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id)),
    [people],
  );
  const employeeShifts = useMemo(
    () => windowShifts.filter((shift) => shift.userId === employeeId),
    [windowShifts, employeeId],
  );
  const selectedShift = employeeShifts.find((shift) => shift.id === shiftId) ?? null;

  useEffect(() => {
    const unsubs = [
      onSnapshot(
        collection(db, "shiftTemplates"),
        (snap) => setTemplates(snap.docs.map((item) => templateFromData(item.id, item.data() as Record<string, unknown>))),
        (err) => (isPermissionDenied(err) ? session.onDenied() : setError(errorText(err))),
      ),
      onSnapshot(
        query(collection(db, "shiftExceptions"), where("date", ">=", today), where("date", "<=", end), orderBy("date")),
        (snap) => setExceptions(snap.docs.map((item) => exceptionFromData(item.id, item.data() as Record<string, unknown>))),
        (err) => (isPermissionDenied(err) ? session.onDenied() : setError(errorText(err))),
      ),
      onSnapshot(
        query(collection(db, "shiftRequests"), orderBy("requestedAt", "desc"), limit(40)),
        (snap) => setRequests(snap.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<ShiftRequest, "id">) }))),
        (err) => (isPermissionDenied(err) ? session.onDenied() : setError(errorText(err))),
      ),
      onSnapshot(
        collection(db, "users"),
        (snap) =>
          setPeople(
            snap.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<Person, "id">) })).filter((person) => person.active),
          ),
        (err) => (isPermissionDenied(err) ? session.onDenied() : setError(errorText(err))),
      ),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [today, end, session]);

  const pendingByShift = new Map(
    requests.filter((item) => item.status === "pending").map((item) => [item.shiftId, item.type]),
  );
  const shownRequests = visibleCoverageRequests(requests);

  async function assignSwap() {
    if (!selectedShift || !withId) return;
    if (session.viewingAs) {
      setError(VIEW_CHANGE);
      return;
    }
    setBusy(true);
    setError("");
    setSwapped("");
    try {
      await call("assignShiftSwap", { templateId: selectedShift.templateId, date: selectedShift.date, assigneeId: withId });
      const takenBy = roster.find((person) => person.id === withId);
      setSwapped(`${formatDay(selectedShift.date)} now belongs to ${takenBy?.displayName || "that employee"}.`);
      setEmployeeId("");
      setShiftId("");
      setWithId("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function requestCoverage(shift: ResolvedShift, type: CoverageKind) {
    setBusy(true);
    setError("");
    try {
      await call("requestShiftCoverage", { templateId: shift.templateId, date: shift.date, type });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function accept(id: string) {
    if (session.viewingAs) {
      setError(VIEW_CHANGE);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await call("acceptShiftRequest", { id });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setBusy(true);
    try {
      await call("cancelShiftRequest", { id });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function makePattern(id: string) {
    setBusy(true);
    setError("");
    try {
      await call("makeWeeklyPattern", { id });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const canAssign = canManageSchedule(session.role);

  return (
    <div className="stack">
      <h2>Swap / time off</h2>
      {canAssign ? (
        <section className="panel" data-testid="direct-swap">
          <h2>Swap a shift</h2>
          <p className="hint">This changes that one day. Employees are not asked, and no one is notified.</p>
          <Field label="Employee">
            <select
              data-testid="swap-employee"
              value={employeeId}
              onChange={(event) => {
                setEmployeeId(event.target.value);
                setShiftId("");
                setWithId("");
                setSwapped("");
              }}
            >
              <option value="">Choose</option>
              {roster.map((person) => (
                <option key={person.id} value={person.id}>
                  {withEmoji(person.displayName, person.emoji)}
                </option>
              ))}
            </select>
          </Field>
          {employeeId ? (
            employeeShifts.length === 0 ? (
              <Empty>No days on that schedule in the next four weeks.</Empty>
            ) : (
              <Field label="Date and time">
                <select
                  data-testid="swap-shift"
                  value={selectedShift ? selectedShift.id : ""}
                  onChange={(event) => {
                    setShiftId(event.target.value);
                    setWithId("");
                    setSwapped("");
                  }}
                >
                  <option value="">Choose</option>
                  {employeeShifts.map((shift) => (
                    <option key={shift.id} value={shift.id}>
                      {formatDay(shift.date)} · {formatClock(shift.start)} – {formatClock(shift.end)}
                    </option>
                  ))}
                </select>
              </Field>
            )
          ) : null}
          {selectedShift ? (
            <Field label="Swap with">
              <select data-testid="swap-with" value={withId} onChange={(event) => setWithId(event.target.value)}>
                <option value="">Choose</option>
                {roster
                  .filter((person) => person.id !== selectedShift.userId)
                  .map((person) => (
                    <option key={person.id} value={person.id}>
                      {withEmoji(person.displayName, person.emoji)}
                    </option>
                  ))}
              </select>
            </Field>
          ) : null}
          <button
            type="button"
            className="primary"
            data-testid="direct-swap-save"
            disabled={busy || !selectedShift || !withId}
            onClick={() => void assignSwap()}
          >
            Swap
          </button>
          {swapped ? <Notice tone="info">{swapped}</Notice> : null}
        </section>
      ) : null}
      <p className="hint">
        These days are yours for the next four weeks. A swap waits for someone else to accept it. Time off and sick leave wait for a super admin, admin, or team lead to approve.
      </p>
      {mine.length === 0 ? <Empty>No days on your schedule in the next four weeks.</Empty> : null}
      <ul className="list">
        {mine.map((shift) => {
          const pendingType = pendingByShift.get(shift.id);
          const pending = pendingType !== undefined;
          return (
            <li key={shift.id} className="card" data-testid="coverage-day" data-date={shift.date} data-pending={pending ? "true" : "false"}>
              {shift.source === "exception" ? (
                <span className="badge" data-testid="exception-badge">
                  {exceptionLabel(shift.kind)}
                </span>
              ) : null}
              <strong>{formatDay(shift.date)}</strong>
              <p>
                {formatClock(shift.start)} – {formatClock(shift.end)}
              </p>
              {pending ? (
                <p className="meta" data-testid="coverage-waiting">
                  {isAwayKind(pendingType)
                    ? "Waiting for a super admin, admin, or team lead to approve."
                    : "Waiting for someone else to accept this swap."}
                </p>
              ) : null}
              <div className="stack">
                <button
                  type="button"
                  data-testid="request-swap"
                  disabled={busy || pending}
                  onClick={() => void requestCoverage(shift, "swap")}
                >
                  Swap
                </button>
                <button
                  type="button"
                  data-testid="request-day-off"
                  disabled={busy || pending}
                  onClick={() => void requestCoverage(shift, "day_off")}
                >
                  Time off
                </button>
                <button
                  type="button"
                  data-testid="request-sick"
                  disabled={busy || pending}
                  onClick={() => void requestCoverage(shift, "sick_leave")}
                >
                  Sick leave
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <section className="panel">
        <h2>Coverage requests</h2>
        {shownRequests.length === 0 ? <Empty>No requests yet.</Empty> : null}
        <ul className="list">
          {shownRequests.map((item) => (
            <li key={item.id} className="card" data-testid="coverage-request" data-status={item.status} data-type={item.type}>
              <strong>{coverageRequestLabel(item.type)}</strong>
              <p>
                {withEmoji(item.requesterName, people.find((person) => person.id === item.requesterId)?.emoji)} · {formatDay(item.shiftDate)} ·{" "}
                {formatClock(item.shiftStart)} – {formatClock(item.shiftEnd)}
              </p>
              <p className="meta">
                {item.status}
                {item.acceptedByName
                  ? ` · ${withEmoji(item.acceptedByName, people.find((person) => person.id === item.acceptedBy)?.emoji)}`
                  : ""}
              </p>
              {manage && item.patternUpdated ? <p className="meta">This is the weekly pattern.</p> : null}
              <ul className="history">
                {(item.history ?? []).map((entry, index) => (
                  <li key={`${entry.at}-${index}`}>
                    {entry.action} by {withEmoji(entry.name, people.find((person) => person.id === entry.uid)?.emoji)} · {formatIso(entry.at)}
                  </li>
                ))}
              </ul>
              {item.status === "pending" && item.requesterId !== session.uid && (!isAwayKind(item.type) || canAssign) ? (
                <button
                  type="button"
                  className="primary"
                  data-testid={isAwayKind(item.type) ? "approve-coverage" : "accept-coverage"}
                  disabled={busy}
                  onClick={() => void accept(item.id)}
                >
                  {isAwayKind(item.type) ? "Approve" : "Accept"}
                </button>
              ) : null}
              {item.status === "pending" && item.requesterId === session.uid ? (
                <button type="button" data-testid="cancel-coverage" disabled={busy} onClick={() => void cancel(item.id)}>
                  Cancel request
                </button>
              ) : null}
              {manage && item.type === "swap" && item.status === "accepted" && item.templateId && !item.patternUpdated ? (
                <button type="button" className="primary" data-testid="make-weekly-pattern" disabled={busy} onClick={() => void makePattern(item.id)}>
                  Make this the new weekly pattern
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      {error ? <Notice>{error}</Notice> : null}
    </div>
  );
}
