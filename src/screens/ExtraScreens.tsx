import { useEffect, useState, type ReactNode } from "react";
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
import { canClearUserEmoji, canDeleteActivities, canManageGuides, canManageMeds, canReviewLogs, isAccountEnabled, isSuperAdmin, roleLabel } from "../roles";
import { nameInitial, PROFILE_EMOJI, useEmojiMap, withEmoji } from "../emoji";
import { applyTheme, COLOR_CHART, COLOR_SCHEMES, parseCustomColor, resolveColorScheme } from "../themes";
import { useSession } from "../session";
import { isShiftPeriod, PERIOD_HOURS, SHIFT_PERIODS, type ShiftPeriod } from "../shiftPeriod";
import { formatClock, formatStamp } from "../time";
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
  const [period, setPeriod] = useState<ShiftPeriod>("morning");
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
            period: isShiftPeriod(String(item.get("period") || "")) ? (String(item.get("period")) as ShiftPeriod) : "",
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
      period,
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
      setPeriod("morning");
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
        {current.period ? <p className="meta">{PERIOD_HOURS[current.period].label}</p> : null}
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
          <fieldset className="schemes" data-testid="guide-periods">
            <legend>When it should be done</legend>
            <p className="hint">It shows under To-do for anyone whose shift covers that part of the day.</p>
            {SHIFT_PERIODS.map((item) => (
              <button
                key={item}
                type="button"
                data-testid={`guide-period-${item}`}
                className={period === item ? "primary" : ""}
                aria-pressed={period === item}
                onClick={() => setPeriod(item)}
              >
                {PERIOD_HOURS[item].label} · {formatClock(PERIOD_HOURS[item].start)} – {formatClock(PERIOD_HOURS[item].end)}
              </button>
            ))}
          </fieldset>
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
          <button type="button" className="primary" data-testid="guide-save" onClick={() => void save()}>
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
            {guide.period ? <p className="meta">{PERIOD_HOURS[guide.period].label}</p> : null}
            {guide.summary ? <p>{guide.summary}</p> : null}
            {manage ? (
              <div className="split">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(guide.id);
                    setTitle(guide.title);
                    setSummary(guide.summary);
                    setPeriod(guide.period || "morning");
                    setSteps(guide.steps.length ? guide.steps : [{ title: "", detail: "" }]);
                  }}
                >
                  Edit
                </button>
                {canManageMeds(session.role) ? (
                  <button type="button" onClick={() => void deleteDoc(doc(db, "guides", guide.id)).catch((err) => setError(errorText(err)))}>
                    Remove
                  </button>
                ) : null}
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
  const [enableNow, setEnableNow] = useState(false);
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
      const result = await call<{ enabled: boolean; emailError?: string }>("createUserAccount", {
        displayName,
        email,
        role,
        signIn,
        enableNow,
      });
      setDisplayName("");
      setEmail("");
      setEnableNow(false);
      if (result.emailError) setError(result.emailError);
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

  async function clearEmoji(uid: string) {
    setBusy(true);
    setError("");
    try {
      await call("clearUserEmoji", { uid });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function enable(uid: string) {
    setBusy(true);
    setError("");
    try {
      await call("enableUserAccount", { uid });
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

  if (!canManageMeds(session.role)) return <Notice>Only an admin can clear an emoji.</Notice>;
  const manageAccounts = isSuperAdmin(session.role);

  return (
    <div className="stack">
      <h2>People</h2>
      {manageAccounts ? null : <p className="hint">Clear a teammate's emoji if it should come off their name. They can pick a new one.</p>}
      {manageAccounts ? (
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
            ? "After you enable them, they sign in with Gmail. No password is set."
            : "After you enable them, they sign in with a 6-digit code. No password is set."}
        </p>
        <fieldset className="schemes">
          <legend>Invitation</legend>
          <button type="button" className={enableNow ? "" : "primary"} data-testid="invite-later" onClick={() => setEnableNow(false)}>
            Add without notifying
          </button>
          <button type="button" className={enableNow ? "primary" : ""} data-testid="enable-now" onClick={() => setEnableNow(true)}>
            Enable now
          </button>
        </fieldset>
        <p className="hint">They stay on the roster so you can set shifts. Enable sends the HammondCare link. Until then they are not emailed.</p>
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
      ) : null}
      {manageAccounts && invites.some((invite) => !invite.rosterUid) ? (
        <ul className="list">
          {invites.filter((invite) => !invite.rosterUid).map((invite) => (
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
            onClearEmoji={() => void clearEmoji(person.id)}
            onEnable={() => void enable(person.id)}
            onRemoveInvite={() => void removeInvite(person.email)}
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
  onClearEmoji,
  onEnable,
  onRemoveInvite,
}: {
  person: Person;
  confirm: boolean;
  busy: boolean;
  onSave: (person: Person, name: string, role: Role) => Promise<void>;
  onAskRevoke: () => void;
  onRevoke: () => void;
  onClearEmoji: () => void;
  onEnable: () => void;
  onRemoveInvite: () => void;
}) {
  const session = useSession();
  const [name, setName] = useState(person.displayName);
  const [role, setRole] = useState<Role>(person.role);
  const locked = person.protected || person.role === "super_admin";
  const manageAccounts = isSuperAdmin(session.role);
  const showClear = Boolean(person.emoji) && canClearUserEmoji(session.role, session.uid, person.id);
  return (
    <li className="card" data-testid="person-row">
      <strong>{withEmoji(person.displayName, person.emoji)}</strong>
      <p className="meta">
        {person.email} · {roleLabel(person.role)} · {signInLabel(person.signIn)}
        {!person.active ? " · Revoked" : ""}
        {person.active && !isAccountEnabled(person) ? " · Not enabled" : ""}
        {person.awaitingGoogle ? " · Waiting for Gmail" : ""}
        {locked ? " · Protected" : ""}
      </p>
      {manageAccounts && person.active && !isAccountEnabled(person) ? (
        <button type="button" className="primary" data-testid="enable-person" disabled={busy} onClick={onEnable}>
          Enable
        </button>
      ) : null}
      {manageAccounts && person.awaitingGoogle ? (
        <button type="button" data-testid="remove-invite" disabled={busy} onClick={onRemoveInvite}>
          Remove invite
        </button>
      ) : null}
      {showClear ? (
        <button type="button" data-testid="clear-emoji" disabled={busy} onClick={onClearEmoji}>
          Clear emoji
        </button>
      ) : null}
      {manageAccounts && person.active && !locked ? (
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
  const [scheme, setScheme] = useState(resolveColorScheme(session.colorScheme));
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
        setScheme(resolveColorScheme(String(snap.get("colorScheme") || session.colorScheme || "")));
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
        <legend>Team color scheme</legend>
        <p className="hint">People who have not picked their own scheme see this one.</p>
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

function CollapseSection({
  title,
  summary,
  testId,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: ReactNode;
  testId: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <button type="button" className="collapse-toggle" data-testid={testId} aria-expanded={open} onClick={onToggle}>
        <span className="collapse-title">{title}</span>
        <span className="collapse-summary">
          {summary}
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        </span>
      </button>
      {open ? <div className="collapse-body stack">{children}</div> : null}
    </section>
  );
}

function schemeSummary(personal: string, teamId: string): { label: string; accent: string } {
  const team = COLOR_SCHEMES.find((item) => item.id === teamId);
  const teamAccent = team?.accent ?? "#7a2948";
  if (!personal) return { label: team ? `Team · ${team.label}` : "Team default", accent: teamAccent };
  const named = COLOR_SCHEMES.find((item) => item.id === personal);
  if (named) return { label: named.label, accent: named.accent };
  const custom = parseCustomColor(personal);
  if (custom) return { label: custom, accent: custom };
  return { label: team?.label ?? "Rose", accent: teamAccent };
}

function SchemePicker() {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(session.personalColorScheme || "team");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const teamLabel = COLOR_SCHEMES.find((item) => item.id === session.colorScheme)?.label || "Rose";
  const summary = schemeSummary(session.personalColorScheme, session.colorScheme);

  useEffect(() => {
    setChoice(session.personalColorScheme || "team");
  }, [session.personalColorScheme]);

  useEffect(() => {
    if (!open) {
      applyTheme(session.personalColorScheme || resolveColorScheme(session.colorScheme));
      return;
    }
    applyTheme(choice === "team" ? resolveColorScheme(session.colorScheme) : choice);
  }, [open, choice, session.colorScheme, session.personalColorScheme]);

  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await session.setColorScheme(choice === "team" ? "" : choice);
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CollapseSection
      title="Your color scheme"
      testId="theme-toggle"
      open={open}
      onToggle={() => {
        setOpen((current) => {
          if (current) setChoice(session.personalColorScheme || "team");
          return !current;
        });
        setSaved(false);
        setError("");
      }}
      summary={
        <>
          <span className="swatch" style={{ background: summary.accent }} />
          {summary.label}
        </>
      }
    >
      <p className="hint">This changes the colors on your screen only. Pick a named scheme, a chart color, or any shade.</p>
      <fieldset className="schemes">
        <legend>Color scheme</legend>
        <button
          type="button"
          data-testid="personal-scheme-team"
          className={choice === "team" ? "primary" : ""}
          onClick={() => {
            setChoice("team");
            setSaved(false);
          }}
        >
          <span className="swatch" style={{ background: COLOR_SCHEMES.find((item) => item.id === session.colorScheme)?.accent ?? "#7a2948" }} />
          Team default ({teamLabel})
        </button>
        {COLOR_SCHEMES.map((item) => (
          <button
            key={item.id}
            type="button"
            data-testid={`personal-scheme-${item.id}`}
            className={choice === item.id ? "primary" : ""}
            onClick={() => {
              setChoice(item.id);
              setSaved(false);
            }}
          >
            <span className="swatch" style={{ background: item.accent }} />
            {item.label}
          </button>
        ))}
      </fieldset>
      <fieldset className="color-chart" data-testid="color-chart">
        <legend>Color chart</legend>
        {COLOR_CHART.map((hex) => (
          <button
            key={hex}
            type="button"
            data-testid="color-chart-swatch"
            data-color={hex}
            aria-label={hex}
            aria-pressed={choice === `custom:${hex}`}
            style={{ background: hex }}
            onClick={() => {
              setChoice(`custom:${hex}`);
              setSaved(false);
            }}
          />
        ))}
      </fieldset>
      <Field label="Any color">
        <input
          type="color"
          data-testid="color-chart-input"
          value={parseCustomColor(choice) ?? "#7a2948"}
          onChange={(event) => {
            setChoice(`custom:${event.target.value.toLowerCase()}`);
            setSaved(false);
          }}
        />
      </Field>
      <button type="button" className="primary" data-testid="scheme-save" disabled={busy} onClick={() => void save()}>
        Save color scheme
      </button>
      {saved ? <Notice tone="info">Saved.</Notice> : null}
      {error ? <Notice>{error}</Notice> : null}
    </CollapseSection>
  );
}

function EmojiPicker() {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const current = session.emoji && PROFILE_EMOJI.includes(session.emoji as (typeof PROFILE_EMOJI)[number]) ? session.emoji : "";

  async function choose(next: string) {
    if (busy || next === current) return;
    setBusy(true);
    setError("");
    try {
      await session.setEmoji(next);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CollapseSection
      title="Your emoji"
      testId="emoji-toggle"
      open={open}
      onToggle={() => setOpen((currentOpen) => !currentOpen)}
      summary={<span className="collapse-mark">{current || nameInitial(session.displayName)}</span>}
    >
      <p className="hint">Tap once. It shows next to your name. Leave it as your initial if you prefer.</p>
      <div className="emoji-grid choices">
        <button
          type="button"
          className={current ? "emoji" : "emoji primary"}
          data-testid="emoji-initial"
          aria-pressed={!current}
          disabled={busy}
          onClick={() => void choose("")}
        >
          {nameInitial(session.displayName)}
        </button>
        {PROFILE_EMOJI.map((item) => (
          <button
            key={item}
            type="button"
            className={current === item ? "emoji primary" : "emoji"}
            data-testid="emoji-choice"
            data-emoji={item}
            aria-pressed={current === item}
            disabled={busy}
            onClick={() => void choose(item)}
          >
            {item}
          </button>
        ))}
      </div>
      {error ? <Notice>{error}</Notice> : null}
    </CollapseSection>
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
    { view: "people", label: "People", show: canManageMeds(session.role) },
    { view: "settings", label: "Settings", show: isSuperAdmin(session.role) },
  ];

  return (
    <div className="stack">
      <h2>More</h2>
      <p className="meta" data-testid="my-name">
        {withEmoji(session.displayName, session.emoji)} · {roleLabel(session.role)}
      </p>
      <SchemePicker />
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
