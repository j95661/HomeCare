import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { call, errorText, isPermissionDenied } from "../api";
import { withEmoji } from "../emoji";
import { Empty, Field, Notice } from "../components";
import { db } from "../firebase";
import { canManageSchedule, isAccountEnabled } from "../roles";
import { VIEW_CHANGE } from "../viewAs";
import {
  WEEKDAY_NAMES,
  dayExceptionLabel,
  exceptionFromData,
  exceptionLabel,
  isOpenTemplate,
  repeatingShiftGroups,
  resolveRange,
  templateFromData,
  visibleCoverageRequests,
  weekdayOf,
  type ResolvedShift,
  type ShiftException,
  type ShiftTemplate,
} from "../schedule";
import { useSession } from "../session";
import { addDays, addMonths, formatClock, formatDay, formatIso, monthGrid, startOfWeek, todayISO } from "../time";
import type { Person, ShiftRequest } from "../types";

function rosterName(person: Person): string {
  const name = withEmoji(person.displayName, person.emoji);
  return isAccountEnabled(person) ? name : `${name} (Not enabled)`;
}

function patternSpan(template: ShiftTemplate): string {
  const parts: string[] = [];
  if (template.effectiveFrom !== "2000-01-01") parts.push(`Starts ${formatDay(template.effectiveFrom)}`);
  if (template.effectiveUntil) parts.push(`Ends ${formatDay(template.effectiveUntil)}`);
  return parts.length > 0 ? parts.join(" · ") : "Every week";
}

export function CalendarScreen() {
  const session = useSession();
  const [mode, setMode] = useState<"day" | "week" | "month">("day");
  const [anchor, setAnchor] = useState(() => todayISO(session.timezone));
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [exceptions, setExceptions] = useState<ShiftException[]>([]);
  const [requests, setRequests] = useState<ShiftRequest[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [openPatternPeople, setOpenPatternPeople] = useState<ReadonlySet<string>>(() => new Set());
  const [form, setForm] = useState({ userId: "", weekday: weekdayOf(anchor), start: "08:00", end: "16:00" });
  const manage = canManageSchedule(session.role);
  const [board, setBoard] = useState<"mine" | "team">("mine");
  const today = todayISO(session.timezone);

  const range = useMemo(() => {
    if (!manage) {
      const focus = board === "team" ? anchor : today;
      const start = startOfWeek(focus);
      return { start, end: addDays(start, 6) };
    }
    if (mode === "day") return { start: anchor, end: anchor };
    if (mode === "week") {
      const start = startOfWeek(anchor);
      return { start, end: addDays(start, 6) };
    }
    const grid = monthGrid(anchor);
    return { start: grid[0]?.date ?? anchor, end: grid[grid.length - 1]?.date ?? anchor };
  }, [manage, board, today, mode, anchor]);

  const shifts = useMemo(
    () => resolveRange(range.start, range.end, templates, exceptions),
    [range.start, range.end, templates, exceptions],
  );

  const patternGroups = useMemo(
    () =>
      repeatingShiftGroups(
        people.map((person) => ({ id: person.id, displayName: person.displayName })),
        templates.filter((template) => isOpenTemplate(template, today)),
      ),
    [people, templates, today],
  );
  const myTemplates = useMemo(
    () =>
      templates
        .filter((template) => template.userId === session.uid && isOpenTemplate(template, today))
        .sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start) || a.id.localeCompare(b.id)),
    [templates, session.uid, today],
  );

  useEffect(() => {
    const unsubs = [
      onSnapshot(
        collection(db, "shiftTemplates"),
        (snap) => setTemplates(snap.docs.map((item) => templateFromData(item.id, item.data() as Record<string, unknown>))),
        (err) => (isPermissionDenied(err) ? session.onDenied() : setError(errorText(err))),
      ),
      onSnapshot(
        query(
          collection(db, "shiftExceptions"),
          where("date", ">=", range.start),
          where("date", "<=", range.end),
          orderBy("date"),
        ),
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
  }, [range.start, range.end, session]);

  function move(direction: -1 | 1) {
    if (!manage || mode === "week") setAnchor((current) => addDays(current, direction * 7));
    else if (mode === "month") setAnchor((current) => addMonths(current, direction));
    else setAnchor((current) => addDays(current, direction));
  }

  async function savePattern() {
    if (session.viewingAs) {
      setError(VIEW_CHANGE);
      return;
    }
    const person = people.find((item) => item.id === form.userId);
    if (!person) {
      setError("Choose a person.");
      return;
    }
    if (form.start >= form.end) {
      setError("The shift must end after it starts.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await addDoc(collection(db, "shiftTemplates"), {
        userId: person.id,
        userName: person.displayName,
        weekday: form.weekday,
        start: form.start,
        end: form.end,
        effectiveFrom: "2000-01-01",
        effectiveUntil: "",
        createdBy: session.uid,
        updatedAt: serverTimestamp(),
      });
      setShowForm(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function changePerson(template: ShiftTemplate, userId: string) {
    if (session.viewingAs) {
      setError(VIEW_CHANGE);
      return;
    }
    const person = people.find((item) => item.id === userId);
    if (!person || person.id === template.userId) return;
    try {
      await updateDoc(doc(db, "shiftTemplates", template.id), {
        userId: person.id,
        userName: person.displayName,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function removePattern(id: string) {
    if (session.viewingAs) {
      setError(VIEW_CHANGE);
      return;
    }
    try {
      await deleteDoc(doc(db, "shiftTemplates", id));
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function requestCoverage(templateId: string, date: string, type: "swap" | "day_off") {
    setBusy(true);
    setError("");
    try {
      await call("requestShiftCoverage", { templateId, date, type });
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

  const pendingIds = new Set(requests.filter((item) => item.status === "pending").map((item) => item.shiftId));
  const shownRequests = visibleCoverageRequests(requests);
  const weekStart = startOfWeek(!manage && board === "mine" ? today : anchor);
  const days =
    !manage || mode === "week"
      ? Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
      : mode === "day"
        ? [anchor]
        : [];

  function renderShift(shift: ResolvedShift) {
    return (
      <li
        key={shift.id}
        className={shift.source === "exception" ? "card exception" : "card"}
        data-testid="resolved-shift"
        data-source={shift.source}
        data-kind={shift.kind}
        data-date={shift.date}
        data-user={shift.userName}
      >
        {shift.source === "exception" ? (
          <span className="badge" data-testid="exception-badge">
            {exceptionLabel(shift.kind)}
          </span>
        ) : null}
        <strong>{withEmoji(shift.userName, people.find((person) => person.id === shift.userId)?.emoji)}</strong>
        <p>
          {formatClock(shift.start)} – {formatClock(shift.end)}
          {people.find((person) => person.id === shift.userId)?.onShift ? " · On shift now" : ""}
        </p>
        {shift.userId === session.uid && shift.templateId ? (
          <div className="split">
            <button
              type="button"
              data-testid="request-swap"
              disabled={busy || pendingIds.has(shift.id)}
              onClick={() => void requestCoverage(shift.templateId, shift.date, "swap")}
            >
              Request swap
            </button>
            <button
              type="button"
              data-testid="request-day-off"
              disabled={busy || pendingIds.has(shift.id)}
              onClick={() => void requestCoverage(shift.templateId, shift.date, "day_off")}
            >
              Request day off
            </button>
          </div>
        ) : null}
      </li>
    );
  }

  function dayBlock(date: string, onlyUserId: string | null) {
    const dayShifts = shifts.filter((shift) => shift.date === date && (onlyUserId === null || shift.userId === onlyUserId));
    if (onlyUserId && dayShifts.length === 0) return null;
    const mark = dayExceptionLabel(dayShifts);
    return (
      <section key={date} className={mark ? "panel exception" : "panel"} data-testid={`schedule-day-${date}`}>
        <h2>{formatDay(date)}</h2>
        {mark ? (
          <span className="badge" data-testid="day-exception">
            {mark}
          </span>
        ) : null}
        {dayShifts.length === 0 ? <Empty>No shifts.</Empty> : null}
        <ul className="list">{dayShifts.map(renderShift)}</ul>
      </section>
    );
  }

  return (
    <div className="stack">
      {manage ? null : (
        <div className="split">
          <button type="button" className={board === "mine" ? "primary" : ""} data-testid="calendar-mine" onClick={() => setBoard("mine")}>
            My schedule
          </button>
          <button type="button" className={board === "team" ? "primary" : ""} data-testid="calendar-team" onClick={() => setBoard("team")}>
            Team schedule
          </button>
        </div>
      )}
      {manage ? (
      <>
      <div className="split">
        {(["day", "week", "month"] as const).map((item) => (
          <button key={item} type="button" className={mode === item ? "primary" : ""} data-testid={`calendar-${item}`} onClick={() => setMode(item)}>
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>
      <div className="split">
        <button type="button" onClick={() => move(-1)}>
          Previous
        </button>
        <button type="button" onClick={() => setAnchor(today)}>
          Today
        </button>
        <button type="button" onClick={() => move(1)}>
          Next
        </button>
      </div>
      <p className="meta">{formatDay(anchor)}</p>
      {manage ? (
        <button type="button" data-testid="weekly-pattern" onClick={() => setShowForm((open) => !open)}>
          {showForm ? "Close form" : "Weekly pattern"}
        </button>
      ) : null}
      {showForm ? (
        <section className="panel">
          <h2>Weekly pattern</h2>
          <p className="hint">This repeats every week. A swap or day off changes one date only.</p>
          <Field label="Person">
            <select data-testid="pattern-person" value={form.userId} onChange={(event) => setForm({ ...form, userId: event.target.value })}>
              <option value="">Choose</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {rosterName(person)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Weekday">
            <select
              data-testid="pattern-weekday"
              value={form.weekday}
              onChange={(event) => setForm({ ...form, weekday: Number(event.target.value) })}
            >
              {WEEKDAY_NAMES.map((name, index) => (
                <option key={name} value={index}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Start">
            <input data-testid="pattern-start" type="time" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} />
          </Field>
          <Field label="End">
            <input data-testid="pattern-end" type="time" value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} />
          </Field>
          <button type="button" className="primary" data-testid="pattern-save" disabled={busy} onClick={() => void savePattern()}>
            Save weekly shift
          </button>
        </section>
      ) : null}
      {manage ? (
        <section className="panel" data-testid="repeating-shifts">
          <h2>Repeating shifts</h2>
          {patternGroups.length === 0 ? <Empty>No weekly shifts yet.</Empty> : null}
          <ul className="list">
            {patternGroups.map((group) => {
              const open = openPatternPeople.has(group.userId);
              const person = people.find((item) => item.id === group.userId);
              const dayCount = group.shifts.length;
              const dayLabel = dayCount === 0 ? "No days" : dayCount === 1 ? "1 day" : `${dayCount} days`;
              return (
                <li key={group.userId} className="card" data-testid="pattern-person" data-user={group.userName} data-open={open ? "true" : "false"}>
                  <button
                    type="button"
                    className="collapse-toggle"
                    data-testid="pattern-person-toggle"
                    aria-expanded={open}
                    onClick={() =>
                      setOpenPatternPeople((current) => {
                        const next = new Set(current);
                        if (next.has(group.userId)) next.delete(group.userId);
                        else next.add(group.userId);
                        return next;
                      })
                    }
                  >
                    <span className="collapse-title">{withEmoji(person?.displayName || group.userName, person?.emoji)}</span>
                    <span className="collapse-summary">
                      <span>{dayLabel}</span>
                      <span aria-hidden="true">{open ? "▾" : "▸"}</span>
                    </span>
                  </button>
                  {open && group.shifts.length === 0 ? (
                    <div className="collapse-body">
                      <Empty>No weekly shifts yet.</Empty>
                    </div>
                  ) : null}
                  {open && group.shifts.length > 0 ? (
                    <ul className="list collapse-body">
                      {group.shifts.map((template) => (
                        <li key={template.id} className="card" data-testid="pattern-row" data-weekday={template.weekday}>
                          <strong>{WEEKDAY_NAMES[template.weekday] ?? "Weekday"}</strong>
                          <p>
                            {formatClock(template.start)} – {formatClock(template.end)}
                          </p>
                          <p className="meta">{patternSpan(template)}</p>
                          <Field label="Person">
                            <select value={template.userId} onChange={(event) => void changePerson(template, event.target.value)}>
                              {people.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {rosterName(item)}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <button type="button" onClick={() => void removePattern(template.id)}>
                            Remove weekly shift
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      </>
      ) : board === "mine" ? (
        <>
          <section className="panel" data-testid="my-repeating">
            <h2>Repeating shift</h2>
            <p className="hint">This repeats every week. A swap or day off changes one date, and the team week shows it.</p>
            {myTemplates.length === 0 ? <Empty>No weekly shifts yet.</Empty> : null}
            <ul className="list">
              {myTemplates.map((template) => (
                <li key={template.id} className="card" data-testid="my-pattern" data-weekday={template.weekday}>
                  <strong>{WEEKDAY_NAMES[template.weekday] ?? "Weekday"}</strong>
                  <p>
                    {formatClock(template.start)} – {formatClock(template.end)}
                  </p>
                  <p className="meta">{patternSpan(template)}</p>
                </li>
              ))}
            </ul>
          </section>
          <h2>This week</h2>
          {days.some((date) => shifts.some((shift) => shift.date === date && shift.userId === session.uid)) ? (
            days.map((date) => dayBlock(date, session.uid))
          ) : (
            <Empty>Nothing on your schedule this week.</Empty>
          )}
        </>
      ) : (
        <>
          <div className="split thirds">
            <button type="button" onClick={() => move(-1)}>
              Previous
            </button>
            <button type="button" onClick={() => setAnchor(today)}>
              This week
            </button>
            <button type="button" onClick={() => move(1)}>
              Next
            </button>
          </div>
          <p className="meta">
            {formatDay(range.start)} – {formatDay(range.end)}
          </p>
          {days.some((date) => shifts.some((shift) => shift.date === date)) ? (
            days.filter((date) => shifts.some((shift) => shift.date === date)).map((date) => dayBlock(date, null))
          ) : (
            <Empty>No shifts this week.</Empty>
          )}
        </>
      )}

      {manage && mode === "month" ? (
        <div className="month">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
            <span key={label} className="dow">
              {label}
            </span>
          ))}
          {monthGrid(anchor).map((cell) => {
            const dayShifts = shifts.filter((shift) => shift.date === cell.date);
            const mark = dayExceptionLabel(dayShifts);
            return (
              <button
                key={cell.date}
                type="button"
                data-testid={`day-${cell.date}`}
                data-exception={mark ? "true" : "false"}
                className={["day-cell", cell.inMonth ? "" : "muted-cell", mark ? "exception" : ""].filter(Boolean).join(" ")}
                onClick={() => {
                  setAnchor(cell.date);
                  setMode("day");
                }}
              >
                {Number(cell.date.slice(8))}
                {mark ? (
                  <span className="exception-mark" data-testid="month-exception">
                    {mark}
                  </span>
                ) : null}
                {dayShifts.length > 0 ? <span className="count">{dayShifts.length}</span> : null}
              </button>
            );
          })}
        </div>
      ) : manage ? (
        days.map((date) => dayBlock(date, null))
      ) : null}

      <section className="panel">
        <h2>Coverage requests</h2>
        {shownRequests.length === 0 ? <Empty>No requests yet.</Empty> : null}
        <ul className="list">
          {shownRequests.map((item) => (
            <li key={item.id} className="card" data-testid="coverage-request" data-status={item.status} data-type={item.type}>
              <strong>{item.type === "day_off" ? "Day off" : "Shift swap"}</strong>
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
              {item.patternUpdated ? <p className="meta">This is the weekly pattern.</p> : null}
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
