import { useEffect, useState } from "react";
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
import { errorText, isPermissionDenied } from "../api";
import { Empty, Notice } from "../components";
import { db } from "../firebase";
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
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);

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
        query(
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
  }, [session]);

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
    const other = ids.find((id) => id !== session.uid);
    return people.find((person) => person.id === other)?.displayName || "Direct message";
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

  async function send() {
    const value = text.trim();
    if (!value || !thread) return;
    const batch = writeBatch(db);
    if (thread === "group") {
      const ref = doc(collection(db, "groupThread/main/messages"));
      batch.set(ref, {
        senderId: session.uid,
        senderName: session.displayName,
        text: value,
        createdAt: serverTimestamp(),
      });
      batch.update(doc(db, "groupThread/main"), {
        lastMessageText: value.slice(0, 140),
        lastMessageAt: serverTimestamp(),
        lastSenderId: session.uid,
        lastSenderName: session.displayName,
      });
    } else {
      const ref = doc(collection(db, `threads/${thread}/messages`));
      batch.set(ref, {
        senderId: session.uid,
        senderName: session.displayName,
        text: value,
        createdAt: serverTimestamp(),
      });
      batch.update(doc(db, "threads", thread), {
        lastMessageText: value.slice(0, 140),
        lastMessageAt: serverTimestamp(),
        lastSenderId: session.uid,
        lastSenderName: session.displayName,
      });
    }
    try {
      await batch.commit();
      setText("");
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (!thread) {
    return (
      <div className="stack">
        <button type="button" className="primary" onClick={() => go({ view: "messages", thread: "group" })}>
          Everyone
        </button>
        <p className="meta">{groupPreview || "Group thread for the whole care team."}</p>
        <button type="button" onClick={() => setPicking((open) => !open)}>
          New message
        </button>
        {picking ? (
          <ul className="list">
            {people
              .filter((person) => person.id !== session.uid)
              .map((person) => (
                <li key={person.id}>
                  <button type="button" onClick={() => void openDirect(person)}>
                    {person.displayName}
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

  const title = thread === "group" ? "Everyone" : labelFor(directs.find((item) => item.id === thread)?.participantIds ?? thread.split("_").slice(1));

  return (
    <div className="stack">
      <button type="button" onClick={() => go({ view: "messages", thread: null })}>
        Back
      </button>
      <h2>{title}</h2>
      {messages.length === 0 ? <Empty>No messages yet.</Empty> : null}
      <ul className="list">
        {messages.map((message) => (
          <li key={message.id} className={message.senderId === session.uid ? "card mine" : "card"}>
            <strong>{message.senderName}</strong>
            <p>{message.text}</p>
            <p className="meta">{formatStamp(message.createdAt)}</p>
          </li>
        ))}
      </ul>
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="field">
          <span>Message</span>
          <input value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} />
        </label>
        <button type="submit" className="primary">
          Send
        </button>
      </form>
      {error ? <Notice>{error}</Notice> : null}
    </div>
  );
}
