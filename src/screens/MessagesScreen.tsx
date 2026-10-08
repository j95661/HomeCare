import { useEffect, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { call, errorText, isPermissionDenied } from "../api";
import { CareImage, PictureButton, PictureControls, careImagePath, uploadCareImage, usePictureDraft } from "../careImage";
import { EMOJI_CHOICES, withEmoji } from "../emoji";
import { messagePreview } from "../media";
import { insertText } from "../messageText";
import { Empty, Notice } from "../components";
import { db } from "../firebase";
import { canDeleteMessage, isAccountEnabled, isCareStaff } from "../roles";
import { useSession } from "../session";
import { formatStamp } from "../time";
import type { ChatMessage, Person, RouteState } from "../types";

function directThreadId(a: string, b: string): string {
  return a < b ? `direct_${a}_${b}` : `direct_${b}_${a}`;
}

type Props = {
  thread: string | null;
  go: (patch: Partial<RouteState>) => void;
};

export function MessagesScreen({ thread, go }: Props) {
  const session = useSession();
  const [people, setPeople] = useState<Person[]>([]);
  const [directs, setDirects] = useState<{ id: string; title: string; lastMessageText: string; participantIds: string[] }[]>([]);
  const [groupPreview, setGroupPreview] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const picture = usePictureDraft();
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const careStaff = isCareStaff(session.role);
  const admin = session.role === "super_admin" || session.role === "admin";
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cursor = useRef({ start: 0, end: 0 });

  useEffect(() => {
    const unsubs = [
      onSnapshot(
        collection(db, "users"),
        (snap) =>
          setPeople(
            snap.docs
              .map((item) => ({ id: item.id, ...(item.data() as Omit<Person, "id">) }))
              .filter((person) => person.active),
          ),
        (err) => (isPermissionDenied(err) ? session.onDenied() : setError(errorText(err))),
      ),
      onSnapshot(
        doc(db, "groupThread/main"),
        (snap) => setGroupPreview(String(snap.get("lastMessageText") || "")),
        (err) => (isPermissionDenied(err) ? session.onDenied() : setError(errorText(err))),
      ),
      onSnapshot(
        admin
          ? query(collection(db, "threads"), where("type", "==", "direct"), orderBy("lastMessageAt", "desc"))
          : query(
              collection(db, "threads"),
              where("type", "==", "direct"),
              where("participantIds", "array-contains", session.uid),
              orderBy("lastMessageAt", "desc"),
            ),
        (snap) =>
          setDirects(
            snap.docs.map((item) => ({
              id: item.id,
              title: String(item.get("title") || ""),
              lastMessageText: String(item.get("lastMessageText") || ""),
              participantIds: (item.get("participantIds") as string[]) || [],
            })),
          ),
        (err) => (isPermissionDenied(err) ? session.onDenied() : setError(errorText(err))),
      ),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [session, admin]);

  useEffect(() => {
    if (!thread) return;
    const path = thread === "group" ? collection(db, "groupThread/main/messages") : collection(db, `threads/${thread}/messages`);
    return onSnapshot(
      query(path, orderBy("createdAt", "asc")),
      (snap) => setMessages(snap.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<ChatMessage, "id">) }))),
      (err) => (isPermissionDenied(err) ? session.onDenied() : setError(errorText(err))),
    );
  }, [thread, session]);

  function labelFor(ids: string[]): string {
    const names = ids
      .filter((id) => id !== session.uid)
      .map((id) => {
        const person = people.find((item) => item.id === id);
        return person ? withEmoji(person.displayName, person.emoji) : "Teammate";
      });
    return names.length > 0 ? names.join(" · ") : "Direct message";
  }

  function canReach(person: Person): boolean {
    return person.id !== session.uid && person.active && isAccountEnabled(person) && person.awaitingGoogle !== true;
  }

  async function openDirect(other: Person) {
    const id = directThreadId(session.uid, other.id);
    const ref = doc(db, "threads", id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        type: "direct",
        participantIds: [session.uid, other.id].sort(),
        title: other.displayName,
        lastMessageText: "",
        lastMessageAt: serverTimestamp(),
        lastSenderId: "",
        lastSenderName: "",
      });
    }
    setPicking(false);
    go({ view: "messages", thread: id });
  }

  function rememberCursor() {
    const field = inputRef.current;
    if (!field) return;
    cursor.current = {
      start: field.selectionStart ?? text.length,
      end: field.selectionEnd ?? text.length,
    };
  }

  function insertEmoji(mark: string) {
    const { start, end } = cursor.current;
    const next = insertText(text, start, end, mark);
    setText(next.value);
    cursor.current = { start: next.cursor, end: next.cursor };
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      const field = inputRef.current;
      field?.focus();
      field?.setSelectionRange(next.cursor, next.cursor);
    });
  }

  async function send() {
    const value = text.trim();
    if ((!value && !picture.file) || !thread || busy) return;
    setBusy(true);
    setError("");
    try {
      const payload: {
        senderId: string;
        senderName: string;
        text: string;
        createdAt: ReturnType<typeof serverTimestamp>;
        imagePath?: string;
      } = {
        senderId: session.uid,
        senderName: session.displayName,
        text: value,
        createdAt: serverTimestamp(),
      };
      if (picture.file) {
        const folder = thread === "group" ? `messages/group/${session.uid}` : `messages/${thread}/${session.uid}`;
        payload.imagePath = careImagePath(folder, picture.file);
        await uploadCareImage(payload.imagePath, picture.file);
      }
      const preview = messagePreview(value, Boolean(payload.imagePath));
      const batch = writeBatch(db);
      if (thread === "group") {
        batch.set(doc(collection(db, "groupThread/main/messages")), payload);
        batch.update(doc(db, "groupThread/main"), {
          lastMessageText: preview,
          lastMessageAt: serverTimestamp(),
          lastSenderId: session.uid,
          lastSenderName: session.displayName,
        });
      } else {
        batch.set(doc(collection(db, `threads/${thread}/messages`)), payload);
        batch.update(doc(db, "threads", thread), {
          lastMessageText: preview,
          lastMessageAt: serverTimestamp(),
          lastSenderId: session.uid,
          lastSenderName: session.displayName,
        });
      }
      await batch.commit();
      setText("");
      picture.clear();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeMessage(messageId: string) {
    if (!thread) return;
    setBusy(true);
    setError("");
    try {
      await call("deleteMessage", { thread, messageId });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!thread) {
    return (
      <div className="stack">
        <button type="button" className="primary" data-testid="care-team" onClick={() => go({ view: "messages", thread: "group" })}>
          Care team
        </button>
        <p className="meta">{groupPreview || "Messages for care providers and team leads."}</p>
        <button type="button" data-testid="message-one-person" onClick={() => setPicking((open) => !open)}>
          Message one person
        </button>
        {picking ? (
          <ul className="list">
            {people.filter(canReach).map((person) => (
              <li key={person.id}>
                <button type="button" data-testid="message-person" onClick={() => void openDirect(person)}>
                  {withEmoji(person.displayName, person.emoji)}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <ul className="list">
          {directs.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => go({ view: "messages", thread: item.id })}>
                <strong>{labelFor(item.participantIds)}</strong>
                <span className="meta">{item.lastMessageText || "No messages yet"}</span>
              </button>
            </li>
          ))}
        </ul>
        {error ? <Notice>{error}</Notice> : null}
      </div>
    );
  }

  const directIds = directs.find((item) => item.id === thread)?.participantIds;
  const title = thread === "group" ? "Care team" : labelFor(directIds ?? thread.split("_").slice(1));
  const inDirect = thread !== "group" && (!directIds || directIds.includes(session.uid));
  const showComposer = thread === "group" ? careStaff : inDirect;

  return (
    <div className="stack">
      <button type="button" onClick={() => go({ view: "messages", thread: null })}>
        Back
      </button>
      <h2>{title}</h2>
      {messages.length === 0 ? <Empty>No messages yet.</Empty> : null}
      <ul className="list">
        {messages.map((message) => (
          <li key={message.id} className={message.senderId === session.uid ? "card mine" : "card"} data-testid="message-card">
            <strong>{withEmoji(message.senderName, people.find((person) => person.id === message.senderId)?.emoji)}</strong>
            {message.text ? <p className="message-body">{message.text}</p> : null}
            {message.imagePath ? <CareImage path={message.imagePath} /> : null}
            <p className="meta">{formatStamp(message.createdAt)}</p>
            {canDeleteMessage(session.role, session.uid, message.senderId) ? (
              <button type="button" data-testid="delete-message" disabled={busy} onClick={() => void removeMessage(message.id)}>
                Delete
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {thread === "group" && !careStaff ? (
        <p className="hint">Care team messages are for care providers and team leads. You can read them here.</p>
      ) : null}
      {showComposer ? (
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="field">
          <span>Message</span>
          <textarea
            ref={inputRef}
            data-testid="message-input"
            value={text}
            maxLength={2000}
            rows={3}
            autoComplete="off"
            autoCorrect="on"
            autoCapitalize="sentences"
            onPaste={picture.onPaste}
            onChange={(event) => {
              setText(event.target.value);
              cursor.current = {
                start: event.target.selectionStart ?? event.target.value.length,
                end: event.target.selectionEnd ?? event.target.value.length,
              };
            }}
            onSelect={rememberCursor}
            onKeyUp={rememberCursor}
            onClick={rememberCursor}
            onBlur={rememberCursor}
          />
        </label>
        {emojiOpen ? (
          <div className="emoji-grid" data-testid="message-emoji-grid">
            {EMOJI_CHOICES.map((item) => (
              <button
                key={item}
                type="button"
                className="emoji"
                data-testid="message-emoji-choice"
                data-emoji={item}
                onClick={() => insertEmoji(item)}
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}
        <PictureControls
          testId="message-picture"
          inputRef={picture.inputRef}
          preview={picture.preview}
          onChoose={picture.choose}
          onClear={picture.clear}
        />
        <div className="send-row with-picture">
          <button
            type="button"
            className="emoji-toggle"
            data-testid="message-emoji"
            aria-label="Insert emoji"
            aria-expanded={emojiOpen}
            onClick={() => setEmojiOpen((open) => !open)}
          >
            🌸
          </button>
          <PictureButton testId="message-picture" onOpen={() => picture.inputRef.current?.click()} />
          <button type="submit" className="primary" data-testid="message-send" disabled={busy || (!text.trim() && !picture.file)}>
            Send
          </button>
        </div>
      </form>
      ) : null}
      {picture.error ? <Notice>{picture.error}</Notice> : null}
      {error ? <Notice>{error}</Notice> : null}
    </div>
  );
}
