import { useEffect, useRef, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { call, errorText, isPermissionDenied } from "../api";
import { CareImage, PictureButton, PictureControls, careImagePath, uploadCareImage, usePictureDraft } from "../careImage";
import { useEmojiMap, withEmoji } from "../emoji";
import { beep } from "../audio";
import { Empty, Field, Modal, Notice } from "../components";
import { useSession } from "../session";
import { db } from "../firebase";
import { exceptionFromData, exceptionLabel, resolveDay, templateFromData, type ShiftException, type ShiftTemplate } from "../schedule";
import { messagePreview } from "../media";
import { isShiftPeriod, PERIOD_HOURS, periodsForShifts, type ShiftPeriod } from "../shiftPeriod";
import { homeMedicationFocus } from "../homeMed";
import { formatClock, formatDay, formatStamp, todayISO, zonedParts } from "../time";
import type { Guide, GuideStep, Handover, Medication, MedLog, RouteState } from "../types";

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
  const [guides, setGuides] = useState<Guide[]>([]);
  const [logs, setLogs] = useState<MedLog[]>([]);
  const [careNotice, setCareNotice] = useState<{
    id: string;
    text: string;
    senderId: string;
    senderName: string;
    imagePath: string;
    at?: { toDate: () => Date };
  } | null>(null);
  const [readNoticeId, setReadNoticeId] = useState("");
  const [noticeOpen, setNoticeOpen] = useState(false);
  const noticeHide = useRef("");
  const [body, setBody] = useState("");
  const picture = usePictureDraft();
  const [noteText, setNoteText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<{ id: string; time: string } | null>(
    route.med && route.time ? { id: route.med, time: route.time } : null,
  );
  const [clock, setClock] = useState(() => zonedParts(new Date(), session.timezone).time);
  const day = todayISO(session.timezone);

  useEffect(() => {
    if (route.med && route.time) setPrompt({ id: route.med, time: route.time });
  }, [route.med, route.time]);

  useEffect(() => {
    const tick = () => setClock(zonedParts(new Date(), session.timezone).time);
    tick();
    const id = window.setInterval(tick, 15000);
    return () => window.clearInterval(id);
  }, [session.timezone]);

  useEffect(() => {
    const unsubs = [
      onSnapshot(
        doc(db, "groupThread/main"),
        (snap) => {
          const id = String(snap.get("noticeMessageId") || "");
          if (!id) {
            setCareNotice(null);
            return;
          }
          const at = snap.get("noticeAt");
          setCareNotice({
            id,
            text: String(snap.get("noticeText") || ""),
            senderId: String(snap.get("noticeSenderId") || ""),
            senderName: String(snap.get("noticeSenderName") || ""),
            imagePath: String(snap.get("noticeImagePath") || ""),
            at: at && typeof at.toDate === "function" ? (at as { toDate: () => Date }) : undefined,
          });
        },
        (err) => (isPermissionDenied(err) ? session.onDenied() : setError(errorText(err))),
      ),
      onSnapshot(
        doc(db, "groupThread/main/noticeReads", session.uid),
        (snap) => setReadNoticeId(snap.exists() ? String(snap.get("noticeMessageId") || "") : ""),
        (err) => (isPermissionDenied(err) ? session.onDenied() : setError(errorText(err))),
      ),
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
        collection(db, "guides"),
        (snap) =>
          setGuides(
            snap.docs.map((item) => ({
              id: item.id,
              title: String(item.get("title") || ""),
              summary: String(item.get("summary") || ""),
              period: isShiftPeriod(String(item.get("period") || "")) ? (String(item.get("period")) as ShiftPeriod) : "",
              steps: (item.get("steps") as GuideStep[]) || [],
            })),
          ),
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

  const noticeUnread = Boolean(careNotice && careNotice.id !== readNoticeId);

  useEffect(() => {
    if (careNotice && noticeUnread && noticeHide.current !== careNotice.id) setNoticeOpen(true);
  }, [careNotice, noticeUnread]);

  async function toggleNotice() {
    if (noticeOpen && careNotice && noticeUnread) {
      noticeHide.current = careNotice.id;
      setNoticeOpen(false);
      try {
        await setDoc(doc(db, "groupThread/main/noticeReads", session.uid), {
          noticeMessageId: careNotice.id,
          readAt: serverTimestamp(),
        });
      } catch (err) {
        noticeHide.current = "";
        setNoticeOpen(true);
        if (isPermissionDenied(err)) session.onDenied();
        else setError(errorText(err));
      }
      return;
    }
    setNoticeOpen((open) => !open);
  }

  async function postNote() {
    const text = body.trim();
    if (!text && !picture.file) return;
    setBusy(true);
    setError("");
    try {
      const note: {
        body: string;
        authorId: string;
        authorName: string;
        createdAt: ReturnType<typeof serverTimestamp>;
        imagePath?: string;
      } = {
        body: text,
        authorId: session.uid,
        authorName: session.displayName,
        createdAt: serverTimestamp(),
      };
      if (picture.file) {
        const path = careImagePath(`handover/${session.uid}`, picture.file);
        await uploadCareImage(path, picture.file);
        note.imagePath = path;
      }
      await addDoc(collection(db, "handoverNotes"), note);
      setBody("");
      picture.clear();
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
  const medFocus = homeMedicationFocus(meds, logs, clock);
  const shifts = resolveDay(day, templates, exceptions);
  const myShifts = shifts.filter((shift) => shift.userId === session.uid && shift.kind !== "day_off");
  const todoPeriods = periodsForShifts(myShifts);
  const todos = guides
    .filter((guide): guide is Guide & { period: ShiftPeriod } => guide.period !== "" && todoPeriods.includes(guide.period))
    .sort((a, b) => todoPeriods.indexOf(a.period) - todoPeriods.indexOf(b.period) || a.title.localeCompare(b.title));

  return (
    <div className="stack">
      <section className="panel" data-testid="notice" data-read={noticeUnread ? "false" : "true"}>
        <button
          type="button"
          className="collapse-toggle"
          data-testid="notice-toggle"
          aria-expanded={noticeOpen}
          onClick={() => void toggleNotice()}
        >
          <span className="collapse-title">Notice</span>
          <span className="collapse-summary">
            <span className="notice-summary">
              {careNotice ? messagePreview(careNotice.text, Boolean(careNotice.imagePath)) : "No notice."}
            </span>
            <span aria-hidden="true">{noticeOpen ? "▾" : "▸"}</span>
          </span>
        </button>
        {noticeOpen && careNotice ? (
          <div className="collapse-body" data-testid="notice-body">
            {careNotice.text ? <p className="message-body">{careNotice.text}</p> : null}
            {careNotice.imagePath ? <CareImage path={careNotice.imagePath} /> : null}
            <p className="meta">
              {withEmoji(careNotice.senderName, emoji.get(careNotice.senderId))} · {formatStamp(careNotice.at)}
            </p>
          </div>
        ) : null}
        {noticeOpen && !careNotice ? <p className="empty">No notice.</p> : null}
      </section>

      <section className="panel attach">
        <h2>Handover notes</h2>
        <Field label="What happened this shift?">
          <textarea
            data-testid="handover-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onPaste={picture.onPaste}
            rows={3}
            maxLength={4000}
            autoCorrect="on"
            autoCapitalize="sentences"
          />
        </Field>
        <PictureControls
          testId="handover-picture"
          inputRef={picture.inputRef}
          preview={picture.preview}
          onChoose={picture.choose}
          onClear={picture.clear}
        />
        <div className="send-row note-row">
          <PictureButton testId="handover-picture" onOpen={() => picture.inputRef.current?.click()} />
          <button
            type="button"
            className="primary"
            data-testid="handover-submit"
            disabled={busy || (!body.trim() && !picture.file)}
            onClick={() => void postNote()}
          >
            Post note
          </button>
        </div>
        {notes.length === 0 ? <Empty>No notes yet.</Empty> : null}
        <ul className="list">
          {notes.map((note, index) => (
            <li key={note.id} className={index === 0 ? "card pinned" : "card"}>
              {index === 0 ? <span className="badge">Pinned</span> : null}
              {note.body ? <p className="message-body">{note.body}</p> : null}
              {note.imagePath ? <CareImage path={note.imagePath} /> : null}
              <p className="meta">
                {withEmoji(note.authorName, emoji.get(note.authorId))} · {formatStamp(note.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" data-testid="todo">
        <h2>To-do</h2>
        {myShifts.length === 0 ? <Empty>No shift today.</Empty> : null}
        {myShifts.length > 0 && todos.length === 0 ? <Empty>Nothing to do for this shift.</Empty> : null}
        <ul className="list">
          {todos.map((guide) => (
            <li key={guide.id} className="card" data-testid="todo-guide" data-period={guide.period}>
              <button type="button" onClick={() => go({ view: "guides", guide: guide.id })}>
                {guide.title}
              </button>
              <p className="meta">{guide.period ? PERIOD_HOURS[guide.period].label : ""}</p>
              {guide.summary ? <p>{guide.summary}</p> : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" data-testid="medications">
        <h2>Medications</h2>
        {!session.onShift ? <p className="hint">Tap the shift status in the corner to respond and hear reminders.</p> : null}
        {meds.length === 0 ? <Empty>No medications yet.</Empty> : null}
        {meds.length > 0 && medFocus.length === 0 ? <Empty>Nothing else today.</Empty> : null}
        <ul className="list">
          {medFocus.map((item) => (
            <li key={`${item.id}:${item.time}`} className="card" data-testid="home-med" data-status={item.status}>
              <p className="meta">{item.status === "due" ? "Due" : "Up next"}</p>
              <button
                type="button"
                disabled={!session.onShift}
                onClick={() => setPrompt({ id: item.id, time: item.time })}
              >
                {item.name}
              </button>
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

      {picture.error ? <Notice>{picture.error}</Notice> : null}
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
