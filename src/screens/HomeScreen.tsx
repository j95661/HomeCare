import { useEffect, useMemo, useRef, useState } from "react";
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
  setDoc,
  where,
} from "firebase/firestore";
import { call, errorText, isPermissionDenied } from "../api";
import { CareImage, PictureButton, PictureControls, careImagePath, uploadCareImage, usePictureDraft } from "../careImage";
import { useEmojiMap, withEmoji } from "../emoji";
import { beep } from "../audio";
import { Empty, Field, Modal, Notice } from "../components";
import { useSession } from "../session";
import { VIEW_CHANGE } from "../viewAs";
import { db } from "../firebase";
import { exceptionFromData, exceptionLabel, isAwayKind, resolveDay, showBoardNotice, templateFromData, type ResolvedShift, type ShiftException, type ShiftTemplate } from "../schedule";
import { messagePreview } from "../media";
import { isShiftPeriod, PERIOD_HOURS, periodsForShifts, type ShiftPeriod } from "../shiftPeriod";
import { isTodaysHandover } from "../handover";
import { homeMedicationFocus } from "../homeMed";
import { enqueueMedAction, mergeMedicationLogs, newMedActionId, normalizeQueuedAction, useQueuedMedActions } from "../medQueue";
import { syncMeds } from "../medSync";
import { isReachabilityError } from "../offline";
import { canDeleteHandover, canManageSchedule, isCareStaff } from "../roles";
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
    kind: string;
    requestId: string;
    coverageType: string;
  } | null>(null);
  const [coverageRequest, setCoverageRequest] = useState({ status: "", requesterId: "" });
  const [roster, setRoster] = useState<{ id: string; displayName: string }[]>([]);
  const [dayAssignee, setDayAssignee] = useState<Record<string, string>>({});
  const [readNoticeId, setReadNoticeId] = useState("");
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
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
  const queued = useQueuedMedActions(session.viewingAs ? "" : session.accountUid);
  const visibleLogs = useMemo(
    () => (session.viewingAs ? logs : mergeMedicationLogs(logs, queued, meds, session.displayName, day)),
    [session.viewingAs, logs, queued, meds, session.displayName, day],
  );

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
          const kind = String(snap.get("noticeKind") || "");
          if (!id || (kind === "coverage" && !isCareStaff(session.role))) {
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
            kind,
            requestId: String(snap.get("noticeRequestId") || ""),
            coverageType: String(snap.get("noticeCoverageType") || ""),
          });
        },
        (err) => {
          if (isReachabilityError(err)) return;
          if (isPermissionDenied(err)) session.onDenied();
          else setError(errorText(err));
        },
      ),
      onSnapshot(
        doc(db, "groupThread/main/noticeReads", session.uid),
        (snap) => setReadNoticeId(snap.exists() ? String(snap.get("noticeMessageId") || "") : ""),
        (err) => {
          if (isReachabilityError(err)) return;
          if (isPermissionDenied(err)) session.onDenied();
          else setError(errorText(err));
        },
      ),
      onSnapshot(
        query(collection(db, "handoverNotes"), orderBy("createdAt", "desc"), limit(40)),
        (snap) => setNotes(snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Handover, "id">) }))),
        (err) => {
          if (isReachabilityError(err)) return;
          if (isPermissionDenied(err)) session.onDenied();
          else setError(errorText(err));
        },
      ),
      onSnapshot(
        query(collection(db, "medications"), where("active", "==", true)),
        (snap) => setMeds(snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Medication, "id">) }))),
        (err) => {
          if (isReachabilityError(err)) return;
          if (isPermissionDenied(err)) session.onDenied();
          else setError(errorText(err));
        },
      ),
      onSnapshot(
        collection(db, "shiftTemplates"),
        (snap) => setTemplates(snap.docs.map((item) => templateFromData(item.id, item.data() as Record<string, unknown>))),
        (err) => {
          if (isReachabilityError(err)) return;
          if (isPermissionDenied(err)) session.onDenied();
          else setError(errorText(err));
        },
      ),
      onSnapshot(
        query(collection(db, "shiftExceptions"), where("date", "==", day)),
        (snap) => setExceptions(snap.docs.map((item) => exceptionFromData(item.id, item.data() as Record<string, unknown>))),
        (err) => {
          if (isReachabilityError(err)) return;
          if (isPermissionDenied(err)) session.onDenied();
          else setError(errorText(err));
        },
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
        (err) => {
          if (isReachabilityError(err)) return;
          if (isPermissionDenied(err)) session.onDenied();
          else setError(errorText(err));
        },
      ),
      onSnapshot(
        query(collection(db, "medicationLogs"), where("userId", "==", session.uid), where("day", "==", day)),
        (snap) => setLogs(snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<MedLog, "id">) }))),
        (err) => {
          if (isReachabilityError(err)) return;
          if (isPermissionDenied(err)) session.onDenied();
          else setError(errorText(err));
        },
      ),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [day, session]);

  useEffect(() => {
    if (!session.onShift || session.viewingAs) return;
    const tick = () => {
      const current = zonedParts(new Date(), session.timezone).time;
      const due = meds.find((med) => med.times.includes(current));
      if (!due) return;
      const answered = visibleLogs.some(
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
  }, [meds, visibleLogs, session.onShift, session.viewingAs, session.timezone, day]);

  useEffect(() => {
    if (!canManageSchedule(session.role)) {
      setRoster([]);
      return;
    }
    return onSnapshot(
      collection(db, "users"),
      (snap) => {
        setRoster(
          snap.docs
            .filter((item) => item.get("active") !== false)
            .map((item) => ({ id: item.id, displayName: String(item.get("displayName") || "") }))
            .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id)),
        );
      },
      (err) => {
        if (isReachabilityError(err)) return;
        if (isPermissionDenied(err)) session.onDenied();
        else setError(errorText(err));
      },
    );
  }, [session]);

  useEffect(() => {
    if (!careNotice?.requestId) {
      setCoverageRequest({ status: "", requesterId: "" });
      return;
    }
    return onSnapshot(doc(db, "shiftRequests", careNotice.requestId), (snap) => {
      setCoverageRequest(
        snap.exists()
          ? { status: String(snap.get("status") || ""), requesterId: String(snap.get("requesterId") || "") }
          : { status: "", requesterId: "" },
      );
    });
  }, [careNotice?.requestId]);

  const boardNotice = showBoardNotice(careNotice, coverageRequest.status) ? careNotice : null;
  const noticeUnread = Boolean(boardNotice && boardNotice.id !== readNoticeId);

  async function acceptNotice() {
    if (!careNotice?.requestId) return;
    setBusy(true);
    setError("");
    try {
      await call("acceptShiftRequest", { id: careNotice.requestId });
    } catch (err) {
      if (isPermissionDenied(err)) session.onDenied();
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancelNotice() {
    if (!careNotice?.requestId) return;
    setBusy(true);
    setError("");
    try {
      await call("cancelShiftRequest", { id: careNotice.requestId });
    } catch (err) {
      if (isPermissionDenied(err)) session.onDenied();
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (boardNotice && noticeUnread && noticeHide.current !== boardNotice.id) setNoticeOpen(true);
  }, [boardNotice, noticeUnread]);

  async function toggleNotice() {
    if (session.viewingAs) {
      if (noticeOpen && boardNotice) noticeHide.current = boardNotice.id;
      setNoticeOpen((open) => !open);
      return;
    }
    if (noticeOpen && boardNotice && noticeUnread) {
      noticeHide.current = boardNotice.id;
      setNoticeOpen(false);
      try {
        await setDoc(doc(db, "groupThread/main/noticeReads", session.uid), {
          noticeMessageId: boardNotice.id,
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
    if (session.viewingAs) {
      setError(VIEW_CHANGE);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const note: {
        body: string;
        authorId: string;
        authorName: string;
        createdAt: ReturnType<typeof serverTimestamp>;
        day: string;
        imagePath?: string;
      } = {
        body: text,
        authorId: session.uid,
        authorName: session.displayName,
        createdAt: serverTimestamp(),
        day,
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
    if (session.viewingAs) {
      setError(VIEW_CHANGE);
      return;
    }
    const saved = normalizeQueuedAction({
      actionId: newMedActionId(),
      userId: session.accountUid,
      medicationId: prompt.id,
      scheduledTime: prompt.time,
      action,
      note: noteText,
      actedAt: Date.now(),
    });
    if (!saved) {
      setError("That medication action could not be saved on this device.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await enqueueMedAction(saved);
      sessionStorage.setItem(`homecare-alarm:${prompt.id}:${day}:${prompt.time}`, "1");
      setPrompt(null);
      setNoteText("");
      go({ med: null, time: null });
      const result = await syncMeds(session.accountUid);
      if (result.keptMessage) setError(`${result.keptMessage} The action is still saved on this device.`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const todayNotes = notes.filter((note) => isTodaysHandover(note, day, session.timezone));
  const canDeleteNote = canDeleteHandover(session.role);

  async function removeNote(id: string) {
    if (session.viewingAs) {
      setError(VIEW_CHANGE);
      return;
    }
    setError("");
    try {
      await deleteDoc(doc(db, "handoverNotes", id));
    } catch (err) {
      if (isPermissionDenied(err)) session.onDenied();
      else setError(errorText(err));
    }
  }

  async function giveToday(shift: ResolvedShift, assigneeId: string) {
    if (session.viewingAs) {
      setError(VIEW_CHANGE);
      return;
    }
    if (!assigneeId) return;
    setBusy(true);
    setError("");
    try {
      await call("assignShiftSwap", { templateId: shift.templateId, date: shift.date, assigneeId });
      setDayAssignee((current) => ({ ...current, [shift.id]: "" }));
    } catch (err) {
      if (isPermissionDenied(err)) session.onDenied();
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const promptMed = meds.find((med) => med.id === prompt?.id);
  const medFocus = homeMedicationFocus(meds, visibleLogs, clock);
  const shifts = resolveDay(day, templates, exceptions);
  const myShifts = shifts.filter((shift) => shift.userId === session.uid && !isAwayKind(shift.kind));
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
              {boardNotice ? messagePreview(boardNotice.text, Boolean(boardNotice.imagePath)) : "No notice."}
            </span>
            <span aria-hidden="true">{noticeOpen ? "▾" : "▸"}</span>
          </span>
        </button>
        {noticeOpen && boardNotice ? (
          <div className="collapse-body" data-testid="notice-body">
            {boardNotice.text ? <p className="message-body">{boardNotice.text}</p> : null}
            {boardNotice.imagePath ? <CareImage path={boardNotice.imagePath} /> : null}
            <p className="meta">
              {withEmoji(boardNotice.senderName, emoji.get(boardNotice.senderId))} · {formatStamp(boardNotice.at)}
            </p>
            {boardNotice.kind === "coverage" &&
            coverageRequest.status === "pending" &&
            isCareStaff(session.role) &&
            boardNotice.senderId !== session.uid ? (
              <button type="button" className="primary" data-testid="notice-accept" disabled={busy} onClick={() => void acceptNotice()}>
                {boardNotice.coverageType === "swap" ? "Accept swap" : "I can cover this"}
              </button>
            ) : null}
            {boardNotice.kind === "coverage" &&
            (coverageRequest.status === "pending" || coverageRequest.status === "awaiting_admin") &&
            coverageRequest.requesterId === session.uid ? (
              <button type="button" data-testid="notice-cancel" disabled={busy} onClick={() => void cancelNotice()}>
                Cancel request
              </button>
            ) : null}
          </div>
        ) : null}
        {noticeOpen && !boardNotice ? <p className="empty">No notice.</p> : null}
      </section>

      <section className="panel attach" data-testid="handover" data-open={notesOpen ? "true" : "false"}>
        <button
          type="button"
          className="collapse-toggle"
          data-testid="handover-toggle"
          aria-expanded={notesOpen}
          onClick={() => setNotesOpen((open) => !open)}
        >
          <span className="collapse-title handover-title">Handover notes</span>
          <span className="collapse-summary">
            <span className="notice-summary">
              {todayNotes[0] ? messagePreview(todayNotes[0].body, Boolean(todayNotes[0].imagePath)) : "No notes yet today."}
            </span>
            <span aria-hidden="true">{notesOpen ? "▾" : "▸"}</span>
          </span>
        </button>
        {notesOpen ? (
          <div className="collapse-body" data-testid="handover-panel">
            <p className="hint">Today's notes. Earlier days stay saved for a later review.</p>
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
            {todayNotes.length === 0 ? <Empty>No notes yet today.</Empty> : null}
            <ul className="list">
              {todayNotes.map((note, index) => (
                <li key={note.id} className={index === 0 ? "card pinned" : "card"} data-testid="handover-note">
                  {index === 0 ? <span className="badge">Pinned</span> : null}
                  {note.body ? <p className="message-body">{note.body}</p> : null}
                  {note.imagePath ? <CareImage path={note.imagePath} /> : null}
                  <p className="meta">
                    {withEmoji(note.authorName, emoji.get(note.authorId))} · {formatStamp(note.createdAt)}
                  </p>
                  {canDeleteNote ? (
                    <button type="button" data-testid="handover-delete" onClick={() => void removeNote(note.id)}>
                      Delete
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
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

      {session.onShift && medFocus.length > 0 ? (
        <section className="panel" data-testid="medications">
          <h2>Medications</h2>
          <p data-testid="home-med-time">{formatClock(medFocus[0].time)}</p>
          <ul className="list">
            {medFocus.map((item) => {
              const med = meds.find((row) => row.id === item.id);
              return (
                <li key={`${item.id}:${item.time}`} data-testid="home-med" data-status={item.status}>
                  <button type="button" onClick={() => setPrompt({ id: item.id, time: item.time })}>
                    {item.name}
                  </button>
                  {med?.careNotes ? <p data-testid="home-med-notes">{med.careNotes}</p> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

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
              {canManageSchedule(session.role) && !session.viewingAs && shift.source === "exception" && shift.kind === "swap" ? (
                <TodaySwapAction
                  shift={shift}
                  weekly={templates.find((item) => item.id === shift.templateId)}
                  roster={roster}
                  assigneeId={dayAssignee[shift.id] || ""}
                  busy={busy}
                  onAssignee={(assigneeId) => setDayAssignee((current) => ({ ...current, [shift.id]: assigneeId }))}
                  onGive={() => void giveToday(shift, dayAssignee[shift.id] || "")}
                />
              ) : null}
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

function TodaySwapAction({
  shift,
  weekly,
  roster,
  assigneeId,
  busy,
  onAssignee,
  onGive,
}: {
  shift: ResolvedShift;
  weekly?: ShiftTemplate;
  roster: { id: string; displayName: string }[];
  assigneeId: string;
  busy: boolean;
  onAssignee: (assigneeId: string) => void;
  onGive: () => void;
}) {
  const choices = roster.filter((person) => person.id !== shift.userId);
  if (weekly && weekly.userId !== shift.userId && !choices.some((person) => person.id === weekly.userId)) {
    choices.unshift({ id: weekly.userId, displayName: weekly.userName });
  }
  const ordered = [...choices].sort(
    (a, b) => Number(b.id === weekly?.userId) - Number(a.id === weekly?.userId) || a.displayName.localeCompare(b.displayName),
  );
  return (
    <div className="stack" data-testid="today-swap-action">
      {weekly && weekly.userId !== shift.userId ? <p className="meta">Weekly schedule: {weekly.userName}</p> : null}
      <Field label="Give this day to">
        <select data-testid="today-swap-with" value={assigneeId} onChange={(event) => onAssignee(event.target.value)}>
          <option value="">Choose</option>
          {ordered.map((person) => (
            <option key={person.id} value={person.id}>
              {weekly && person.id === weekly.userId ? `${person.displayName} (weekly schedule)` : person.displayName}
            </option>
          ))}
        </select>
      </Field>
      <button type="button" className="primary" data-testid="today-swap-save" disabled={busy || !assigneeId} onClick={onGive}>
        Give this day
      </button>
    </div>
  );
}
