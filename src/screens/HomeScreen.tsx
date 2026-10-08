import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { call, errorText, isPermissionDenied } from "../api";
import { useEmojiMap, withEmoji } from "../emoji";
import { beep } from "../audio";
import { Empty, Field, Modal, Notice } from "../components";
import { useSession } from "../session";
import { db } from "../firebase";
import { exceptionFromData, exceptionLabel, resolveDay, templateFromData, type ShiftException, type ShiftTemplate } from "../schedule";
import { formatClock, formatDay, formatStamp, todayISO, zonedParts } from "../time";
import type { Handover, Medication, MedLog, RouteState } from "../types";

type Props = {
  route: RouteState;
  go: (patch: Partial<RouteState>) => void;
};

export function HomeScreen({ route, go }: Props) {
  const session = useSession();
  const emoji = useEmojiMap();
  const [notes, setNotes] = useState<Handover[]>([]);
  const [meds, setMeds] = useState<Medication[]>([]);
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [exceptions, setExceptions] = useState<ShiftException[]>([]);
  const [logs, setLogs] = useState<MedLog[]>([]);
  const [body, setBody] = useState("");
  const [noteText, setNoteText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<{ id: string; time: string } | null>(
    route.med && route.time ? { id: route.med, time: route.time } : null,
  );
  const day = todayISO(session.timezone);

  useEffect(() => {
    if (route.med && route.time) setPrompt({ id: route.med, time: route.time });
  }, [route.med, route.time]);

  useEffect(() => {
    const unsubs = [
      onSnapshot(
        query(collection(db, "handoverNotes"), orderBy("createdAt", "desc"), limit(5)),
        (snap) => setNotes(snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Handover, "id">) }))),
        (err) => (isPermissionDenied(err) ? session.onDenied() : setError(errorText(err))),
      ),
      onSnapshot(
        query(collection(db, "medications"), where("active", "==", true)),
        (snap) => setMeds(snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Medication, "id">) }))),
        (err) => (isPermissionDenied(err) ? session.onDenied() : setError(errorText(err))),
      ),
      onSnapshot(
        collection(db, "shiftTemplates"),
        (snap) => setTemplates(snap.docs.map((item) => templateFromData(item.id, item.data() as Record<string, unknown>))),
        (err) => (isPermissionDenied(err) ? session.onDenied() : setError(errorText(err))),
      ),
      onSnapshot(
        query(collection(db, "shiftExceptions"), where("date", "==", day)),
        (snap) => setExceptions(snap.docs.map((item) => exceptionFromData(item.id, item.data() as Record<string, unknown>))),
        (err) => (isPermissionDenied(err) ? session.onDenied() : setError(errorText(err))),
      ),
      onSnapshot(
        query(collection(db, "medicationLogs"), where("userId", "==", session.uid), where("day", "==", day)),
        (snap) => setLogs(snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<MedLog, "id">) }))),
        (err) => (isPermissionDenied(err) ? session.onDenied() : setError(errorText(err))),
      ),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [day, session]);

  useEffect(() => {
    if (!session.onShift) return;
    const tick = () => {
      const current = zonedParts(new Date(), session.timezone).time;
      const due = meds.find((med) => med.times.includes(current));
      if (!due) return;
      const answered = logs.some(
        (log) => log.medicationId === due.id && log.scheduledTime === current && log.action !== "snooze",
      );
      if (answered) return;
      const key = `${due.id}:${day}:${current}`;
      if (sessionStorage.getItem(`homecare-alarm:${key}`)) return;
      sessionStorage.setItem(`homecare-alarm:${key}`, "1");
      beep();
      setPrompt({ id: due.id, time: current });
    };
    tick();
    const id = window.setInterval(tick, 15000);
    return () => window.clearInterval(id);
  }, [meds, logs, session.onShift, session.timezone, day]);

  async function postNote() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError("");
    try {
      await addDoc(collection(db, "handoverNotes"), {
        body: text,
        authorId: session.uid,
        authorName: session.displayName,
        createdAt: serverTimestamp(),
      });
      setBody("");
    } catch (err) {
      if (isPermissionDenied(err)) session.onDenied();
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function respond(action: "given" | "declined" | "missed" | "snooze") {
    if (!prompt) return;
    setBusy(true);
    setError("");
    try {
      await call("logMedicationResponse", {
        medicationId: prompt.id,
        scheduledTime: prompt.time,
        action,
        note: noteText,
      });
      setPrompt(null);
      setNoteText("");
      go({ med: null, time: null });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const promptMed = meds.find((med) => med.id === prompt?.id);
  const shifts = resolveDay(day, templates, exceptions);

  return (
    <div className="stack">
      <section className="panel">
        <h2>Handover notes</h2>
        <Field label="What happened this shift?">
          <textarea
            data-testid="handover-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            maxLength={4000}
          />
        </Field>
        <button type="button" className="primary" data-testid="handover-submit" disabled={busy} onClick={() => void postNote()}>
          Post note
        </button>
        {notes.length === 0 ? <Empty>No notes yet.</Empty> : null}
        <ul className="list">
          {notes.map((note, index) => (
            <li key={note.id} className={index === 0 ? "card pinned" : "card"}>
              {index === 0 ? <span className="badge">Pinned</span> : null}
              <p>{note.body}</p>
              <p className="meta">
                {withEmoji(note.authorName, emoji.get(note.authorId))} · {formatStamp(note.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Today's medications</h2>
        {!session.onShift ? <p className="hint">Tap the shift status in the corner to respond and hear reminders.</p> : null}
        {meds.length === 0 ? <Empty>No medications yet.</Empty> : null}
        <ul className="list">
          {meds
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((med) => (
              <li key={med.id} className="card">
                <strong>{med.name}</strong>
                <p>
                  {[med.dose, med.frequency].filter(Boolean).join(" · ")}
                </p>
                {med.careNotes ? <p>{med.careNotes}</p> : null}
                <div className="times">
                  {med.times.map((time) => (
                    <button
                      key={time}
                      type="button"
                      disabled={!session.onShift}
                      onClick={() => setPrompt({ id: med.id, time })}
                    >
                      {formatClock(time)}
                    </button>
                  ))}
                </div>
              </li>
            ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Today's schedule</h2>
        <p className="meta">{formatDay(day)}</p>
        {shifts.length === 0 ? <Empty>No shifts today.</Empty> : null}
        <ul className="list">
          {shifts.map((shift) => (
            <li
              key={shift.id}
              className={shift.source === "exception" ? "card exception" : "card"}
              data-testid="today-shift"
              data-source={shift.source}
              data-user={shift.userName}
            >
              {shift.source === "exception" ? (
                <span className="badge" data-testid="exception-badge">
                  {exceptionLabel(shift.kind)}
                </span>
              ) : null}
              <strong>{withEmoji(shift.userName, emoji.get(shift.userId))}</strong>
              <p>
                {formatClock(shift.start)} – {formatClock(shift.end)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {error ? <Notice>{error}</Notice> : null}

      {prompt && promptMed ? (
        <Modal title={`${promptMed.name} · ${formatClock(prompt.time)}`}>
          <p>{promptMed.dose ? `${promptMed.dose}. ` : ""}{promptMed.careNotes}</p>
          <Field label="Note (optional)">
            <input value={noteText} onChange={(event) => setNoteText(event.target.value)} maxLength={500} />
          </Field>
          <div className="split">
            <button type="button" className="primary" data-testid="action-given" disabled={busy} onClick={() => void respond("given")}>
              Given
            </button>
            <button type="button" data-testid="action-declined" disabled={busy} onClick={() => void respond("declined")}>
              Declined
            </button>
            <button type="button" data-testid="action-missed" disabled={busy} onClick={() => void respond("missed")}>
              Missed
            </button>
            <button type="button" data-testid="action-snooze" disabled={busy} onClick={() => void respond("snooze")}>
              Snooze
            </button>
          </div>
          <button type="button" onClick={() => setPrompt(null)}>
            Close
          </button>
        </Modal>
      ) : null}
    </div>
  );
}
