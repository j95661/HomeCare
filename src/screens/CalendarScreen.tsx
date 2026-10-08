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
import { canManageSchedule } from "../roles";
import { useSession } from "../session";
import { addDays, addMonths, formatClock, formatDay, formatIso, monthGrid, startOfWeek, todayISO } from "../time";
import type { Person, Shift, ShiftRequest } from "../types";

export function CalendarScreen() {
  const session = useSession();
  const [mode, setMode] = useState<"day" | "week" | "month">("day");
  const [anchor, setAnchor] = useState(() => todayISO(session.timezone));
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [requests, setRequests] = useState<ShiftRequest[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ userId: "", date: anchor, start: "08:00", end: "16:00" });
  const manage = canManageSchedule(session.role);

  const range = useMemo(() => {
    if (mode === "day") return { start: anchor, end: anchor };
    if (mode === "week") {
      const start = startOfWeek(anchor);
      return { start, end: addDays(start, 6) };
    }
    const grid = monthGrid(anchor);
    return { start: grid[0]?.date ?? anchor, end: grid[grid.length - 1]?.date ?? anchor };
  }, [mode, anchor]);

  useEffect(() => {
    const unsubs = [
      onSnapshot(
        query(
          collection(db, "shifts"),
          where("date", ">=", range.start),
          where("date", "<=", range.end),
          orderBy("date"),
          orderBy("start"),
        ),
        (snap) => setShifts(snap.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<Shift, "id">) }))),
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
    if (mode === "month") setAnchor((current) => addMonths(current, direction));
    else setAnchor((current) => addDays(current, mode === "week" ? direction * 7 : direction));
  }

  async function saveShift() {
    const person = people.find((item) => item.id === form.userId);
    if (!person) {
      setError("Choose a person.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await addDoc(collection(db, "shifts"), {
        userId: person.id,
        userName: person.displayName,
        date: form.date,
        start: form.start,
        end: form.end,
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

  async function reassign(shift: Shift, userId: string) {
    const person = people.find((item) => item.id === userId);
    if (!person) return;
    try {
      await updateDoc(doc(db, "shifts", shift.id), {
        userId: person.id,
        userName: person.displayName,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function removeShift(id: string) {
    try {
      await deleteDoc(doc(db, "shifts", id));
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function requestCoverage(shiftId: string, type: "swap" | "day_off") {
    setBusy(true);
    setError("");
    try {
      await call("requestShiftCoverage", { shiftId, type });
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

  const pendingIds = new Set(requests.filter((item) => item.status === "pending").map((item) => item.shiftId));
  const days = mode === "week" ? Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(anchor), index)) : mode === "day" ? [anchor] : [];

  return (
    <div className="stack">
      <div className="split">
        {(["day", "week", "month"] as const).map((item) => (
          <button key={item} type="button" className={mode === item ? "primary" : ""} onClick={() => setMode(item)}>
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>
      <div className="split">
        <button type="button" onClick={() => move(-1)}>
          Previous
        </button>
        <button type="button" onClick={() => setAnchor(todayISO(session.timezone))}>
          Today
        </button>
        <button type="button" onClick={() => move(1)}>
          Next
        </button>
      </div>
      <p className="meta">{formatDay(anchor)}</p>
      {manage ? (
        <button type="button" onClick={() => setShowForm((open) => !open)}>
          {showForm ? "Close form" : "Add shift"}
        </button>
      ) : null}
      {showForm ? (
        <section className="panel">
          <Field label="Person">
            <select value={form.userId} onChange={(event) => setForm({ ...form, userId: event.target.value })}>
              <option value="">Choose</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {withEmoji(person.displayName, person.emoji)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
          </Field>
          <Field label="Start">
            <input type="time" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} />
          </Field>
          <Field label="End">
            <input type="time" value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} />
          </Field>
          <button type="button" className="primary" disabled={busy} onClick={() => void saveShift()}>
            Save shift
          </button>
        </section>
      ) : null}

      {mode === "month" ? (
        <div className="month">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
            <span key={label} className="dow">
              {label}
            </span>
          ))}
          {monthGrid(anchor).map((cell) => {
            const count = shifts.filter((shift) => shift.date === cell.date).length;
            return (
              <button
                key={cell.date}
                type="button"
                className={cell.inMonth ? "day-cell" : "day-cell muted-cell"}
                onClick={() => {
                  setAnchor(cell.date);
                  setMode("day");
                }}
              >
                {Number(cell.date.slice(8))}
                {count > 0 ? <span className="count">{count}</span> : null}
              </button>
            );
          })}
        </div>
      ) : (
        days.map((date) => (
          <section key={date} className="panel">
            <h2>{formatDay(date)}</h2>
            {shifts.filter((shift) => shift.date === date).length === 0 ? <Empty>No shifts.</Empty> : null}
            <ul className="list">
              {shifts
                .filter((shift) => shift.date === date)
                .map((shift) => (
                  <li key={shift.id} className="card">
                    <strong>{withEmoji(shift.userName, people.find((person) => person.id === shift.userId)?.emoji)}</strong>
                    <p>
                      {formatClock(shift.start)} – {formatClock(shift.end)}
                      {people.find((person) => person.id === shift.userId)?.onShift ? " · On shift now" : ""}
                    </p>
                    {manage ? (
                      <Field label="Reassign">
                        <select value={shift.userId} onChange={(event) => void reassign(shift, event.target.value)}>
                          {people.map((person) => (
                            <option key={person.id} value={person.id}>
                              {withEmoji(person.displayName, person.emoji)}
                            </option>
                          ))}
                        </select>
                      </Field>
                    ) : null}
                    {manage ? (
                      <button type="button" onClick={() => void removeShift(shift.id)}>
                        Remove
                      </button>
                    ) : null}
                    {shift.userId === session.uid ? (
                      <div className="split">
                        <button type="button" disabled={busy || pendingIds.has(shift.id)} onClick={() => void requestCoverage(shift.id, "swap")}>
                          Request swap
                        </button>
                        <button type="button" disabled={busy || pendingIds.has(shift.id)} onClick={() => void requestCoverage(shift.id, "day_off")}>
                          Request day off
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}

      <section className="panel">
        <h2>Coverage requests</h2>
        {requests.length === 0 ? <Empty>No requests yet.</Empty> : null}
        <ul className="list">
          {requests.map((item) => (
            <li key={item.id} className="card">
              <strong>{item.type === "day_off" ? "Day off" : "Shift swap"}</strong>
              <p>
                {withEmoji(item.requesterName, people.find((person) => person.id === item.requesterId)?.emoji)} · {formatDay(item.shiftDate)} · {formatClock(item.shiftStart)} – {formatClock(item.shiftEnd)}
              </p>
              <p className="meta">
                {item.status}
                {item.acceptedByName
                  ? ` · ${withEmoji(item.acceptedByName, people.find((person) => person.id === item.acceptedBy)?.emoji)}`
                  : ""}
              </p>
              <ul className="history">
                {(item.history ?? []).map((entry, index) => (
                  <li key={`${entry.at}-${index}`}>
                    {entry.action} by {withEmoji(entry.name, people.find((person) => person.id === entry.uid)?.emoji)} · {formatIso(entry.at)}
                  </li>
                ))}
              </ul>
              {item.status === "pending" && item.requesterId !== session.uid ? (
                <button type="button" className="primary" disabled={busy} onClick={() => void accept(item.id)}>
                  Accept
                </button>
              ) : null}
              {item.status === "pending" && item.requesterId === session.uid ? (
                <button type="button" disabled={busy} onClick={() => void cancel(item.id)}>
                  Cancel request
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
