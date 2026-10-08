import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { call, errorText, isPermissionDenied } from "../api";
import { Empty, Notice } from "../components";
import { withEmoji } from "../emoji";
import { db } from "../firebase";
import { canEditWeeklyPattern } from "../roles";
import {
  coverageRequestLabel,
  exceptionFromData,
  exceptionLabel,
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

  const mine = useMemo(
    () =>
      resolveRange(today, end, templates, exceptions).filter((shift) => shift.userId === session.uid && shift.templateId),
    [today, end, templates, exceptions, session.uid],
  );

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

  const pendingIds = new Set(requests.filter((item) => item.status === "pending").map((item) => item.shiftId));
  const shownRequests = visibleCoverageRequests(requests);

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

  return (
    <div className="stack">
      <h2>Swap / time off</h2>
      <p className="hint">
        These days are yours for the next four weeks. Someone else has to accept before a swap, time off, or sick leave changes the schedule.
      </p>
      {mine.length === 0 ? <Empty>No days on your schedule in the next four weeks.</Empty> : null}
      <ul className="list">
        {mine.map((shift) => {
          const pending = pendingIds.has(shift.id);
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
              {pending ? <p className="meta">A request is already open for this day.</p> : null}
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
              {item.status === "pending" && item.requesterId !== session.uid ? (
                <button type="button" className="primary" data-testid="accept-coverage" disabled={busy} onClick={() => void accept(item.id)}>
                  Accept
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
