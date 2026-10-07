import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { call, errorText, isPermissionDenied } from "../api";
import { Empty, Field, Notice } from "../components";
import { db } from "../firebase";
import { enablePush } from "../push";
import { isStandaloneDisplay, pushSubscribeBlock } from "../pwa";
import { canDeleteActivities, canManageGuides, canReviewLogs, isSuperAdmin, roleLabel } from "../roles";
import { EMOJI_CHOICES, useEmojiMap, withEmoji } from "../emoji";
import { applyTheme, COLOR_SCHEMES } from "../themes";
import { useSession } from "../session";
import { formatStamp } from "../time";
import type { Activity, Guide, GuideStep, Invite, MedLog, Person, Role, RouteState } from "../types";

export function ActivitiesScreen() {
  const session = useSession();
  const [items, setItems] = useState<Activity[]>([]);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    return onSnapshot(
      collection(db, "activities"),
      (snap) => setItems(snap.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<Activity, "id">) }))),
      (err) => {
        if (isPermissionDenied(err)) session.onDenied();
        else setError(errorText(err));
      },
    );
  }, [session]);

  async function save() {
    if (!title.trim()) return;
    setError("");
    try {
      if (editing) {
        await updateDoc(doc(db, "activities", editing), {
          title: title.trim(),
          details: details.trim(),
          updatedBy: session.uid,
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, "activities"), {
          title: title.trim(),
          details: details.trim(),
          createdBy: session.uid,
          updatedBy: session.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setTitle("");
      setDetails("");
      setEditing(null);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <div className="stack">
      <h2>Things to do with Andrew</h2>
      <section className="panel">
        <Field label="Idea">
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="Details">
          <textarea rows={3} value={details} onChange={(event) => setDetails(event.target.value)} />
        </Field>
        <button type="button" className="primary" onClick={() => void save()}>
          {editing ? "Update idea" : "Add idea"}
        </button>
      </section>
      {items.length === 0 ? <Empty>No ideas yet.</Empty> : null}
      <ul className="list">
        {items.map((item) => (
          <li key={item.id} className="card">
            <strong>{item.title}</strong>
            <p>{item.details}</p>
            <div className="split">
              <button
                type="button"
                onClick={() => {
                  setEditing(item.id);
                  setTitle(item.title);
                  setDetails(item.details);
                }}
              >
                Update
              </button>
              {canDeleteActivities(session.role) ? (
                <button type="button" onClick={() => void deleteDoc(doc(db, "activities", item.id)).catch((err) => setError(errorText(err)))}>
                  Remove
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {error ? <Notice>{error}</Notice> : null}
    </div>
  );
}

export function GuidesScreen({ guideId, go }: { guideId: string | null; go: (patch: Partial<RouteState>) => void }) {
  const session = useSession();
  const manage = canManageGuides(session.role);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [steps, setSteps] = useState<GuideStep[]>([{ title: "", detail: "" }]);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    return onSnapshot(
      collection(db, "guides"),
      (snap) =>
        setGuides(
          snap.docs.map((item) => ({
            id: item.id,
            title: String(item.get("title") || ""),
            summary: String(item.get("summary") || ""),
            steps: (item.get("steps") as GuideStep[]) || [],
          })),
        ),
      (err) => {
        if (isPermissionDenied(err)) session.onDenied();
        else setError(errorText(err));
      },
    );
  }, [session]);

  const current = guides.find((guide) => guide.id === guideId);

  async function save() {
    const cleanSteps = steps.filter((step) => step.title.trim());
    if (!title.trim()) {
      setError("Add a title.");
      return;
    }
    const payload = {
      title: title.trim(),
      summary: summary.trim(),
      steps: cleanSteps.map((step) => ({ title: step.title.trim(), detail: step.detail.trim() })),
      updatedBy: session.uid,
      updatedAt: serverTimestamp(),
    };
    setError("");
    try {
      if (editing) await updateDoc(doc(db, "guides", editing), payload);
      else await addDoc(collection(db, "guides"), payload);
      setTitle("");
      setSummary("");
      setSteps([{ title: "", detail: "" }]);
      setEditing(null);
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (current && !editing) {
    return (
      <div className="stack">
        <button type="button" onClick={() => go({ view: "guides", guide: null })}>
          All guides
        </button>
        <h2>{current.title}</h2>
        {current.summary ? <p>{current.summary}</p> : null}
        <ol className="steps">
          {current.steps.map((step, index) => (
            <li key={`${step.title}-${index}`}>
              <strong>{step.title}</strong>
              {step.detail ? <p>{step.detail}</p> : null}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="stack">
      <h2>How-to guides</h2>
      {manage ? (
        <section className="panel">
          <Field label="Title">
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Summary">
            <input value={summary} onChange={(event) => setSummary(event.target.value)} />
          </Field>
          {steps.map((step, index) => (
            <div key={index} className="card">
              <Field label={`Step ${index + 1}`}>
                <input
                  value={step.title}
                  onChange={(event) => setSteps(steps.map((item, i) => (i === index ? { ...item, title: event.target.value } : item)))}
                />
              </Field>
              <Field label="Detail">
                <textarea
                  rows={2}
                  value={step.detail}
                  onChange={(event) => setSteps(steps.map((item, i) => (i === index ? { ...item, detail: event.target.value } : item)))}
                />
              </Field>
            </div>
          ))}
          <button type="button" onClick={() => setSteps([...steps, { title: "", detail: "" }])}>
            Add step
          </button>
          <button type="button" className="primary" onClick={() => void save()}>
            {editing ? "Save guide" : "Add guide"}
          </button>
        </section>
      ) : null}
      {guides.length === 0 ? <Empty>No guides yet.</Empty> : null}
      <ul className="list">
        {guides.map((guide) => (
          <li key={guide.id} className="card">
            <button type="button" onClick={() => go({ view: "guides", guide: guide.id })}>
              {guide.title}
            </button>
            {guide.summary ? <p>{guide.summary}</p> : null}
            {manage ? (
              <div className="split">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(guide.id);
                    setTitle(guide.title);
                    setSummary(guide.summary);
                    setSteps(guide.steps.length ? guide.steps : [{ title: "", detail: "" }]);
                  }}
                >
                  Edit
                </button>
                <button type="button" onClick={() => void deleteDoc(doc(db, "guides", guide.id)).catch((err) => setError(errorText(err)))}>
                  Remove
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? <Notice>{error}</Notice> : null}
    </div>
  );
}

export function MedLogScreen() {
  const session = useSession();
  const emoji = useEmojiMap();
  const [logs, setLogs] = useState<MedLog[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canReviewLogs(session.role)) return;
    return onSnapshot(
      query(collection(db, "medicationLogs"), orderBy("createdAt", "desc")),
      (snap) => setLogs(snap.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<MedLog, "id">) })).slice(0, 100)),
      (err) => {
        if (isPermissionDenied(err)) session.onDenied();
        else setError(errorText(err));
      },
    );
  }, [session]);

  if (!canReviewLogs(session.role)) return <Notice>You cannot review the full medication log.</Notice>;

  return (
    <div className="stack">
      <h2>Medication log</h2>
      {logs.length === 0 ? <Empty>No responses yet.</Empty> : null}
      <ul className="list">
        {logs.map((log) => (
          <li key={log.id} className="card">
            <strong>
              {log.medicationName} · {log.action}
            </strong>
            <p>
              {withEmoji(log.userName, emoji.get(log.userId))} · {log.day} · {log.scheduledTime}
              {log.dose ? ` · ${log.dose}` : ""}
            </p>
            {log.note ? <p>{log.note}</p> : null}
            <p className="meta">{formatStamp(log.createdAt)}</p>
          </li>
        ))}
      </ul>
      {error ? <Notice>{error}</Notice> : null}
    </div>
  );
}

function signInLabel(signIn?: string): string {
  if (signIn === "google") return "Gmail";
  if (signIn === "email_otp") return "Email code";
  return "Password";
}

export function PeopleScreen() {
  const session = useSession();
  const [people, setPeople] = useState<Person[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [signIn, setSignIn] = useState<"google" | "email_otp">("google");
  const [role, setRole] = useState<Role>("care_provider");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return onSnapshot(
      collection(db, "users"),
      (snap) => setPeople(snap.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<Person, "id">) }))),
      (err) => {
        if (isPermissionDenied(err)) session.onDenied();
        else setError(errorText(err));
      },
    );
  }, [session]);

  useEffect(() => {
    if (!isSuperAdmin(session.role)) return;
    return onSnapshot(
      collection(db, "invites"),
      (snap) => setInvites(snap.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<Invite, "id">) }))),
      (err) => {
        if (isPermissionDenied(err)) session.onDenied();
        else setError(errorText(err));
      },
    );
  }, [session]);

  async function createAccount() {
    setBusy(true);
    setError("");
    try {
      await call("createUserAccount", { displayName, email, role, signIn });
      setDisplayName("");
      setEmail("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function savePerson(person: Person, nextName: string, nextRole: Role) {
    setError("");
    try {
      await call("updateUserAccount", { uid: person.id, displayName: nextName, role: nextRole });
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function removeInvite(address: string) {
    setBusy(true);
    setError("");
    try {
      await call("removeInvite", { email: address });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(uid: string) {
    setBusy(true);
    setError("");
    try {
      await call("revokeUserAccount", { uid });
      setConfirmId(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!isSuperAdmin(session.role)) return <Notice>Only the super admin can manage accounts.</Notice>;

  return (
    <div className="stack">
      <h2>People</h2>
      <section className="panel">
        <Field label="Name">
          <input data-testid="people-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </Field>
        <Field label="Email">
          <input data-testid="people-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" />
        </Field>
        <fieldset className="schemes">
          <legend>Sign-in</legend>
          <button type="button" className={signIn === "google" ? "primary" : ""} data-testid="signin-google" onClick={() => setSignIn("google")}>
            Gmail
          </button>
          <button type="button" className={signIn === "email_otp" ? "primary" : ""} data-testid="signin-email" onClick={() => setSignIn("email_otp")}>
            Email code
          </button>
        </fieldset>
        <p className="hint">
          {signIn === "google"
            ? "They sign in with Gmail. No password is set."
            : "They sign in with a 6-digit code emailed to them. No password is set."}
        </p>
        <Field label="Role">
          <select data-testid="people-role" value={role} onChange={(event) => setRole(event.target.value as Role)}>
            <option value="admin">Admin</option>
            <option value="team_lead">Team lead</option>
            <option value="care_provider">Care provider</option>
          </select>
        </Field>
        <button type="button" className="primary" data-testid="people-create" disabled={busy} onClick={() => void createAccount()}>
          Add person
        </button>
      </section>
      {invites.length > 0 ? (
        <ul className="list">
          {invites.map((invite) => (
            <li key={invite.id} className="card" data-testid="pending-invite">
              <strong>{invite.displayName}</strong>
              <p className="meta">
                {invite.email} · {roleLabel(invite.role)} · Waiting to sign in with Gmail
              </p>
              <button type="button" disabled={busy} onClick={() => void removeInvite(invite.email || invite.id)}>
                Remove invite
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="list">
        {people.map((person) => (
          <PersonRow
            key={person.id}
            person={person}
            confirm={confirmId === person.id}
            busy={busy}
            onSave={savePerson}
            onAskRevoke={() => setConfirmId(person.id)}
            onRevoke={() => void revoke(person.id)}
          />
        ))}
      </ul>
      {error ? <Notice>{error}</Notice> : null}
    </div>
  );
}

function PersonRow({
  person,
  confirm,
  busy,
  onSave,
  onAskRevoke,
  onRevoke,
}: {
  person: Person;
  confirm: boolean;
  busy: boolean;
  onSave: (person: Person, name: string, role: Role) => Promise<void>;
  onAskRevoke: () => void;
  onRevoke: () => void;
}) {
  const [name, setName] = useState(person.displayName);
  const [role, setRole] = useState<Role>(person.role);
  const locked = person.protected || person.role === "super_admin";
  return (
    <li className="card">
      <strong>{withEmoji(person.displayName, person.emoji)}</strong>
      <p className="meta">
        {person.email} · {roleLabel(person.role)} · {signInLabel(person.signIn)}
        {!person.active ? " · Revoked" : ""}
        {locked ? " · Protected" : ""}
      </p>
      {person.active && !locked ? (
        <>
          <Field label="Name">
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Role">
            <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
              <option value="admin">Admin</option>
              <option value="team_lead">Team lead</option>
              <option value="care_provider">Care provider</option>
            </select>
          </Field>
          <button type="button" onClick={() => void onSave(person, name, role)}>
            Save
          </button>
          {confirm ? (
            <button type="button" className="danger" disabled={busy} onClick={onRevoke}>
              Confirm revoke
            </button>
          ) : (
            <button type="button" onClick={onAskRevoke}>
              Revoke
            </button>
          )}
        </>
      ) : null}
    </li>
  );
}

export function SettingsScreen() {
  const session = useSession();
  const [days, setDays] = useState(String(session.passwordMaxAgeDays));
  const [timezone, setTimezone] = useState(session.timezone);
  const [snooze, setSnooze] = useState(String(session.snoozeMinutes));
  const [scheme, setScheme] = useState(session.colorScheme || "forest");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    return onSnapshot(
      doc(db, "settings/app"),
      (snap) => {
        setDays(String(snap.get("passwordMaxAgeDays") ?? session.passwordMaxAgeDays));
        setTimezone(String(snap.get("timezone") ?? session.timezone));
        setSnooze(String(snap.get("snoozeMinutes") ?? session.snoozeMinutes));
        setScheme(String(snap.get("colorScheme") || session.colorScheme || "forest"));
        setEmail(String(snap.get("superAdminEmail") ?? ""));
      },
      (err) => setError(isPermissionDenied(err) ? "" : errorText(err)),
    );
  }, [session.passwordMaxAgeDays, session.snoozeMinutes, session.timezone, session.colorScheme]);

  useEffect(() => {
    applyTheme(scheme);
  }, [scheme]);

  async function save() {
    setSaved(false);
    setError("");
    try {
      await call("updateAppSettings", {
        passwordMaxAgeDays: Number(days),
        timezone,
        snoozeMinutes: Number(snooze),
        colorScheme: scheme,
      });
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (!isSuperAdmin(session.role)) return <Notice>Only the super admin can change settings.</Notice>;

  return (
    <div className="stack">
      <h2>Settings</h2>
      <p className="meta">Super admin: {email}</p>
      <Field label="Password refresh (days)">
        <input inputMode="numeric" value={days} onChange={(event) => setDays(event.target.value)} />
      </Field>
      <Field label="Timezone">
        <input value={timezone} onChange={(event) => setTimezone(event.target.value)} />
      </Field>
      <Field label="Snooze minutes">
        <input inputMode="numeric" value={snooze} onChange={(event) => setSnooze(event.target.value)} />
      </Field>
      <fieldset className="schemes">
        <legend>Color scheme</legend>
        {COLOR_SCHEMES.map((item) => (
          <button
            key={item.id}
            type="button"
            data-testid={`scheme-${item.id}`}
            className={scheme === item.id ? "primary" : ""}
            onClick={() => setScheme(item.id)}
          >
            <span className="swatch" style={{ background: item.accent }} />
            {item.label}
          </button>
        ))}
      </fieldset>
      <button type="button" className="primary" onClick={() => void save()}>
        Save settings
      </button>
      {saved ? <Notice tone="info">Saved.</Notice> : null}
      {error ? <Notice>{error}</Notice> : null}
    </div>
  );
}

function EmojiPicker() {
  const session = useSession();
  const [choice, setChoice] = useState(session.emoji);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setChoice(session.emoji);
  }, [session.emoji]);

  async function save(next: string) {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await session.setEmoji(next);
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Your emoji</h2>
      <p className="hint">Teammates see this next to your name. Pick one, or paste your own.</p>
      <div className="emoji-grid">
        {EMOJI_CHOICES.map((item) => (
          <button
            key={item}
            type="button"
            className={choice === item ? "emoji primary" : "emoji"}
            data-testid="emoji-choice"
            data-emoji={item}
            aria-pressed={choice === item}
            onClick={() => {
              setChoice(item);
              setSaved(false);
            }}
          >
            {item}
          </button>
        ))}
      </div>
      <Field label="Emoji">
        <input
          data-testid="emoji-input"
          value={choice}
          onChange={(event) => {
            setChoice(event.target.value);
            setSaved(false);
          }}
          maxLength={16}
          autoComplete="off"
        />
      </Field>
      <button type="button" className="primary" data-testid="emoji-save" disabled={busy} onClick={() => void save(choice)}>
        Save emoji
      </button>
      {session.emoji ? (
        <button type="button" disabled={busy} onClick={() => void save("")}>
          Remove emoji
        </button>
      ) : null}
      {saved ? <Notice tone="info">Saved.</Notice> : null}
      {error ? <Notice>{error}</Notice> : null}
    </section>
  );
}

export function MoreScreen({ go, onSignOut }: { go: (patch: Partial<RouteState>) => void; onSignOut: () => void }) {
  const session = useSession();
  const [error, setError] = useState("");
  const [installEvent, setInstallEvent] = useState<(Event & { prompt: () => Promise<void> }) | null>(null);
  const block = pushSubscribeBlock({
    standalone: isStandaloneDisplay(),
    pushSupported: typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window,
    vapidConfigured: Boolean(import.meta.env.VITE_FIREBASE_VAPID_KEY),
  });

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as Event & { prompt: () => Promise<void> });
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const links: { view: RouteState["view"]; label: string; show: boolean }[] = [
    { view: "meds", label: "Medications", show: true },
    { view: "activities", label: "Activities", show: true },
    { view: "guides", label: "Guides", show: true },
    { view: "medlog", label: "Med log", show: canReviewLogs(session.role) },
    { view: "people", label: "People", show: isSuperAdmin(session.role) },
    { view: "settings", label: "Settings", show: isSuperAdmin(session.role) },
  ];

  return (
    <div className="stack">
      <h2>More</h2>
      <p className="meta" data-testid="my-name">
        {withEmoji(session.displayName, session.emoji)} · {roleLabel(session.role)}
      </p>
      <EmojiPicker />
      {links
        .filter((link) => link.show)
        .map((link) => (
          <button key={link.view} type="button" onClick={() => go({ view: link.view, thread: null, guide: null, med: null, time: null })}>
            {link.label}
          </button>
        ))}
      {installEvent ? (
        <button type="button" className="primary" onClick={() => void installEvent.prompt()}>
          Add to Home Screen
        </button>
      ) : (
        <p className="hint">
          iPhone: tap Share, then Add to Home Screen. Open HammondCare from that icon. Push needs iOS 16.4 or later.
          Android: use the browser menu, then Install app or Add to Home Screen.
        </p>
      )}
      <button
        type="button"
        data-testid="enable-push"
        onClick={() => {
          void enablePush().catch((err) => {
            const message = errorText(err);
            if (block && message === block) return;
            setError(message);
          });
        }}
      >
        Enable notifications
      </button>
      <p className="hint" data-testid="push-help">
        {block ?? "Notifications can be turned on from this installed app."}
      </p>
      <button type="button" onClick={onSignOut}>
        Sign out
      </button>
      {error ? <Notice>{error}</Notice> : null}
    </div>
  );
}
