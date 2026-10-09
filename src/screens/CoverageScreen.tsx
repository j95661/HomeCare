import { useEffect, useMemo, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { call, errorText, isPermissionDenied } from "../api";
import { Empty, Field, Modal, Notice } from "../components";
import { withEmoji } from "../emoji";
import { db } from "../firebase";
import { canApproveTimeOff, canEditWeeklyPattern, canManageSchedule, isCareStaff } from "../roles";
import { VIEW_CHANGE } from "../viewAs";
import {
  canCancelCoverageRequest,
  coverageRequestLabel,
  exceptionFromData,
  exceptionLabel,
  isAwayKind,
  resolveRange,
  showCoverageRequest,
  templateFromData,
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
  const [replyHours, setReplyHours] = useState(24);
  const [draft, setDraft] = useState<{ shift: ResolvedShift; type: CoverageKind } | null>(null);
  const [reason, setReason] = useState("");

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
      onSnapshot(doc(db, "settings/app"), (snap) => {
        const hours = Number(snap.get("coverageReplyHours"));
        setReplyHours(Number.isInteger(hours) && hours >= 1 && hours <= 168 ? hours : 24);
      }),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [today, end, session]);

  const openByShift = new Map(
    requests
      .filter((item) => item.status === "pending" || item.status === "awaiting_admin")
      .map((item) => [item.shiftId, item]),
  );
  const shownRequests = requests.filter((item) => showCoverageRequest(item, session.role, session.uid));

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

  function openRequest(shift: ResolvedShift, type: CoverageKind) {
    setReason("");
    setError("");
    setDraft({ shift, type });
  }

  async function sendRequest() {
    if (!draft) return;
    const note = reason.trim();
    if (!note) {
      setError("Add a reason for the team.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await call("requestShiftCoverage", {
        templateId: draft.shift.templateId,
        date: draft.shift.date,
        type: draft.type,
        reason: note,
      });
      setDraft(null);
      setReason("");
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
        These days are yours for the next four weeks. A swap, time off, or sick leave goes to the care team with your reason. The team has {replyHours}{" "}
        hours to respond to time off and sick leave. After that, the request comes back to you and an admin approves it.
      </p>
      {mine.length === 0 ? <Empty>No days on your schedule in the next four weeks.</Empty> : null}
      <ul className="list">
        {mine.map((shift) => {
          const open = openByShift.get(shift.id);
          return (
            <li key={shift.id} className="card" data-testid="coverage-day" data-date={shift.date} data-pending={open ? "true" : "false"}>
              {shift.source === "exception" ? (
                <span className="badge" data-testid="exception-badge">
                  {exceptionLabel(shift.kind)}
                </span>
              ) : null}
              <strong>{formatDay(shift.date)}</strong>
              <p>
                {formatClock(shift.start)} – {formatClock(shift.end)}
              </p>
              {open ? (
                <p className="meta" data-testid="coverage-waiting">
                  {waitingLine(open)}
                </p>
              ) : null}
              {open && canCancelCoverageRequest(open, session.role, session.uid) ? (
                <button type="button" data-testid="cancel-coverage-day" disabled={busy} onClick={() => void cancel(open.id)}>
                  Cancel request
                </button>
              ) : null}
              <div className="stack">
                <button type="button" data-testid="request-swap" disabled={busy || Boolean(open)} onClick={() => openRequest(shift, "swap")}>
                  Swap
                </button>
                <button
                  type="button"
                  data-testid="request-day-off"
                  disabled={busy || Boolean(open)}
                  onClick={() => openRequest(shift, "day_off")}
                >
                  Time off
                </button>
                <button
                  type="button"
                  data-testid="request-sick"
                  disabled={busy || Boolean(open)}
                  onClick={() => openRequest(shift, "sick_leave")}
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
              {item.reason ? <p data-testid="coverage-reason-text">{item.reason}</p> : null}
              <p className="meta">
                {coverageStatusLabel(item.status)}
                {item.coverByName ? ` · ${withEmoji(item.coverByName, people.find((person) => person.id === item.coverBy)?.emoji)} offered to cover` : ""}
                {item.acceptedByName
                  ? ` · ${withEmoji(item.acceptedByName, people.find((person) => person.id === item.acceptedBy)?.emoji)}`
                  : ""}
              </p>
              {manage && item.patternUpdated ? <p className="meta">This is the weekly pattern.</p> : null}
              {item.status === "pending" && item.requesterId !== session.uid && isCareStaff(session.role) ? (
                <button
                  type="button"
                  className="primary"
                  data-testid="accept-coverage"
                  disabled={busy}
                  onClick={() => void accept(item.id)}
                >
                  {isAwayKind(item.type) ? "I can cover this" : "Accept"}
                </button>
              ) : null}
              {item.status === "awaiting_admin" && isAwayKind(item.type) && item.requesterId !== session.uid && canApproveTimeOff(session.role) ? (
                <button type="button" className="primary" data-testid="approve-coverage" disabled={busy} onClick={() => void accept(item.id)}>
                  Approve
                </button>
              ) : null}
              {canCancelCoverageRequest(item, session.role, session.uid) ? (
                <button type="button" data-testid="cancel-coverage" disabled={busy} onClick={() => void cancel(item.id)}>
                  Cancel request
                </button>
              ) : null}
              <ul className="history">
                {(item.history ?? []).map((entry, index) => (
                  <li key={`${entry.at}-${index}`}>
                    {entry.action} by {withEmoji(entry.name, people.find((person) => person.id === entry.uid)?.emoji)} · {formatIso(entry.at)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
      {draft ? (
        <Modal
          title={draft.type === "swap" ? "Request a swap" : draft.type === "sick_leave" ? "Request sick leave" : "Request time off"}
          onClose={() => setDraft(null)}
        >
          <p>
            {formatDay(draft.shift.date)} · {formatClock(draft.shift.start)} – {formatClock(draft.shift.end)}
          </p>
          <p className="hint">
            {isAwayKind(draft.type)
              ? `The care team has ${replyHours} hours to offer to cover this. Then it comes back to you and an admin approves it.`
              : "The care team can accept this swap from Notice."}
          </p>
          <Field label="Reason for the team">
            <textarea data-testid="coverage-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} />
          </Field>
          <button type="button" className="primary" data-testid="coverage-send" disabled={busy || !reason.trim()} onClick={() => void sendRequest()}>
            Send to the care team
          </button>
        </Modal>
      ) : null}
      {error ? <Notice>{error}</Notice> : null}
    </div>
  );
}

function waitingLine(item: ShiftRequest): string {
  if (item.status === "awaiting_admin") {
    return item.coverByName
      ? `${item.coverByName} offered to cover this. Waiting for an admin to approve.`
      : "Nobody responded. Waiting for an admin to approve.";
  }
  if (isAwayKind(item.type)) return "Waiting for someone on the care team to cover this.";
  return "Waiting for someone on the care team to accept this swap.";
}

function coverageStatusLabel(status: string): string {
  if (status === "pending") return "Waiting for the care team";
  if (status === "awaiting_admin") return "Waiting for an admin";
  if (status === "accepted") return "Accepted";
  return status;
}
