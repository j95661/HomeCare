import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from "firebase/auth";
import { collection, doc, onSnapshot, query, runTransaction, where } from "firebase/firestore";
import { authError, call, errorText } from "./api";
import { auth, db } from "./firebase";
import { syncMeds } from "./medSync";
import { useQueuedMedActions } from "./medQueue";
import { isReachabilityError, readCachedSession, shouldRestoreCachedSession, writeCachedSession } from "./offline";
import { Field, Notice } from "./components";
import { CalendarScreen } from "./screens/CalendarScreen";
import { CoverageScreen } from "./screens/CoverageScreen";
import { ActivitiesScreen, GuidesScreen, MedLogScreen, MoreScreen, PeopleScreen, SettingsScreen } from "./screens/ExtraScreens";
import { HomeScreen } from "./screens/HomeScreen";
import { MedsScreen } from "./screens/MedsScreen";
import { MessagesScreen } from "./screens/MessagesScreen";
import { SessionProvider, type SessionValue } from "./session";
import { nameMark } from "./emoji";
import { groupSeenKey, nextMessageAlert } from "./messagesAlert";
import { canManageSchedule, roleLabel } from "./roles";
import { canViewAsEmployee, displaySession, isViewRole, setViewOnly, VIEW_CHANGE, type ViewIdentity } from "./viewAs";
import { exceptionFromData, isDuringShift, planShiftSync, resolveDay, templateFromData, type ShiftException, type ShiftTemplate } from "./schedule";
import { useAccountBackground } from "./background";
import { applyTheme, DEFAULT_COLOR_SCHEME, resolveColorScheme } from "./themes";
import { swipeAxis, swipeStartsOnControl, tabInDirection } from "./tabSwipe";
import { todayISO, zonedParts } from "./time";
import type { Role, RouteState, Session, ViewName } from "./types";

type Gate =
  | { kind: "loading" }
  | { kind: "signedOut"; notice?: string }
  | { kind: "error"; message: string }
  | { kind: "otp"; email: string }
  | { kind: "password"; email: string; days: number }
  | { kind: "app"; session: Session };

type SessionPayload = {
  active: boolean;
  otpVerified: boolean;
  role: Role;
  displayName: string;
  email: string;
  emoji: string;
  onShift: boolean;
  passwordChangeRequired: boolean;
  passwordMaxAgeDays: number;
  timezone: string;
  snoozeMinutes: number;
  colorScheme: string;
  personalColorScheme: string;
  backgroundImage: string;
};

const VIEWS = new Set<ViewName>([
  "home",
  "calendar",
  "messages",
  "more",
  "coverage",
  "meds",
  "medlog",
  "activities",
  "guides",
  "people",
  "settings",
]);

function readRoute(): RouteState {
  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get("view") || "home";
  return {
    view: VIEWS.has(viewParam as ViewName) ? (viewParam as ViewName) : "home",
    thread: params.get("thread"),
    guide: params.get("guide"),
    med: params.get("med"),
    time: params.get("time"),
  };
}

function writeRoute(next: RouteState) {
  const params = new URLSearchParams();
  if (next.view !== "home") params.set("view", next.view);
  if (next.thread) params.set("thread", next.thread);
  if (next.guide) params.set("guide", next.guide);
  if (next.med) params.set("med", next.med);
  if (next.time) params.set("time", next.time);
  const qs = params.toString();
  window.history.pushState(next, "", qs ? `/?${qs}` : "/");
}

export function App() {
  const [gate, setGate] = useState<Gate>({ kind: "loading" });
  const [route, setRoute] = useState<RouteState>(() => readRoute());
  const [shiftDay, setShiftDay] = useState<string | null>(null);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [shiftError, setShiftError] = useState("");
  const [viewId, setViewId] = useState<string | null>(null);
  const [viewPerson, setViewPerson] = useState<ViewIdentity | null>(null);
  const [messagesUnread, setMessagesUnread] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [syncMessage, setSyncMessage] = useState("");
  const skipSignOut = useRef(false);
  const viewIdRef = useRef<string | null>(null);
  const loadRef = useRef<(user: User) => Promise<void>>(async () => {});
  const scheduledRef = useRef(false);
  const scheduleReadyRef = useRef(false);
  const appRef = useRef<HTMLDivElement>(null);
  const routeRef = useRef(route);
  const goRef = useRef<(patch: Partial<RouteState>) => void>(() => {});
  routeRef.current = route;

  const load = useCallback(async (user: User) => {
    const onlineNow = typeof navigator === "undefined" ? true : navigator.onLine;
    if (!onlineNow) {
      const cached = readCachedSession(localStorage, user.uid);
      if (cached) {
        setGate((current) => (current.kind === "app" ? current : { kind: "app", session: cached }));
        return;
      }
    }
    try {
      const google = user.providerData.some((provider) => provider.providerId === "google.com");
      if (google) {
        try {
          await call("acceptGoogleSignIn");
        } catch (error) {
          const googleOnline = typeof navigator === "undefined" ? true : navigator.onLine;
          if (!shouldRestoreCachedSession(error, googleOnline)) {
            await signOut(auth);
            setGate({ kind: "signedOut", notice: errorText(error) });
            return;
          }
        }
      }
      const state = await call<SessionPayload>("getSessionState");
      if (!state.active) {
        await signOut(auth);
        setGate({ kind: "signedOut", notice: "This account has been revoked." });
        return;
      }
      if (!state.otpVerified) {
        setGate({ kind: "otp", email: state.email || user.email || "" });
        return;
      }
      if (state.passwordChangeRequired) {
        setGate({ kind: "password", email: state.email || user.email || "", days: state.passwordMaxAgeDays });
        return;
      }
      setGate({
        kind: "app",
        session: {
          uid: user.uid,
          email: state.email || user.email || "",
          role: state.role,
          displayName: state.displayName,
          emoji: state.emoji || "",
          onShift: state.onShift,
          timezone: state.timezone,
          snoozeMinutes: state.snoozeMinutes,
          passwordMaxAgeDays: state.passwordMaxAgeDays,
          colorScheme: resolveColorScheme(state.colorScheme || ""),
          personalColorScheme: state.personalColorScheme || "",
          backgroundImage: "",
        },
      });
    } catch (error) {
      const stillOnline = typeof navigator === "undefined" ? true : navigator.onLine;
      if (shouldRestoreCachedSession(error, stillOnline)) {
        const cached = readCachedSession(localStorage, user.uid);
        setGate((current) => {
          if (current.kind === "app") return current;
          if (cached) return { kind: "app", session: cached };
          return { kind: "error", message: errorText(error) };
        });
        return;
      }
      setGate({ kind: "error", message: errorText(error) });
    }
  }, []);

  loadRef.current = load;
  viewIdRef.current = viewId;

  useEffect(() => {
    if (!viewId || gate.kind !== "app") {
      setViewPerson(null);
      return;
    }
    return onSnapshot(doc(db, "users", viewId), (snap) => {
      const role = snap.get("role");
      if (!snap.exists() || snap.get("active") !== true || !isViewRole(role)) {
        setViewId(null);
        return;
      }
      setViewPerson({
        uid: viewId,
        displayName: String(snap.get("displayName") || "Employee"),
        role,
        emoji: String(snap.get("emoji") || ""),
        onShift: snap.get("onShift") === true,
        colorScheme: String(snap.get("colorScheme") || ""),
      });
    });
  }, [viewId, gate.kind]);

  useEffect(() => {
    setViewOnly(Boolean(viewPerson));
    return () => setViewOnly(false);
  }, [viewPerson]);

  const viewerId = viewPerson?.uid || (gate.kind === "app" ? gate.session.uid : "");
  const onCareTeam = route.view === "messages" && (!route.thread || route.thread === "group");
  useEffect(() => {
    if (!viewerId) {
      setMessagesUnread(false);
      return;
    }
    return onSnapshot(doc(db, "groupThread/main"), (snap) => {
      const at = snap.get("lastMessageAt");
      const latestAt = typeof at?.toMillis === "function" ? at.toMillis() : 0;
      const seenAt = Number(localStorage.getItem(groupSeenKey(viewerId)) || 0);
      const next = nextMessageAlert({
        latestAt,
        senderId: String(snap.get("lastSenderId") || ""),
        viewerId,
        seenAt,
        onMessages: onCareTeam,
      });
      if (next.seenAt !== seenAt) localStorage.setItem(groupSeenKey(viewerId), String(next.seenAt));
      setMessagesUnread(next.unread);
    });
  }, [viewerId, onCareTeam]);

  useEffect(() => {
    void getRedirectResult(auth).catch((error) => {
      setGate((current) => (current.kind === "signedOut" ? { kind: "signedOut", notice: authError(error) } : current));
    });
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      if (!user) {
        if (skipSignOut.current) return;
        setViewId(null);
        setViewPerson(null);
        setGate({ kind: "signedOut" });
        return;
      }
      skipSignOut.current = false;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        const cached = readCachedSession(localStorage, user.uid);
        if (cached) {
          setGate({ kind: "app", session: cached });
          return;
        }
      }
      setGate({ kind: "loading" });
      void load(user);
    });
  }, [load]);

  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const personalScheme = viewPerson
    ? viewPerson.colorScheme
    : gate.kind === "app"
      ? gate.session.personalColorScheme
      : "";
  const editingAppearance = gate.kind === "app" && !viewPerson && (route.view === "more" || route.view === "settings");

  useEffect(() => {
    if (gate.kind !== "app") {
      applyTheme(DEFAULT_COLOR_SCHEME);
      return;
    }
    applyTheme(personalScheme || gate.session.colorScheme || DEFAULT_COLOR_SCHEME);
    return onSnapshot(doc(db, "settings/app"), (snap) => {
      const team = resolveColorScheme(String(snap.get("colorScheme") || ""));
      setGate((current) =>
        current.kind === "app" && current.session.colorScheme !== team
          ? { kind: "app", session: { ...current.session, colorScheme: team } }
          : current,
      );
      if (editingAppearance) return;
      applyTheme(personalScheme || team);
    }, (error) => {
      if (isReachabilityError(error)) return;
    });
  }, [gate.kind, gate.kind === "app" ? gate.session.colorScheme : "", personalScheme, editingAppearance]);

  useEffect(() => {
    if (gate.kind !== "app") return;
    writeCachedSession(localStorage, gate.session);
  }, [gate]);

  useEffect(() => {
    if (gate.kind !== "app") return;
    const id = window.setInterval(() => {
      const user = auth.currentUser;
      if (user) void load(user);
    }, 60000);
    return () => window.clearInterval(id);
  }, [gate.kind, load]);

  const setColorScheme = useCallback(async (colorScheme: string) => {
    if (viewIdRef.current) throw new Error(VIEW_CHANGE);
    const result = await call<{ colorScheme: string }>("setMyColorScheme", { colorScheme });
    setGate((current) =>
      current.kind === "app"
        ? { kind: "app", session: { ...current.session, personalColorScheme: result.colorScheme } }
        : current,
    );
  }, []);

  const setEmoji = useCallback(async (emoji: string) => {
    if (viewIdRef.current) throw new Error(VIEW_CHANGE);
    const result = await call<{ emoji: string }>("setMyEmoji", { emoji });
    setGate((current) =>
      current.kind === "app" ? { kind: "app", session: { ...current.session, emoji: result.emoji } } : current,
    );
  }, []);

  const onDenied = useCallback(() => {
    const user = auth.currentUser;
    if (!user) return;
    void (async () => {
      try {
        const state = await call<SessionPayload>("getSessionState");
        if (!state.active) {
          await signOut(auth);
          setGate({ kind: "signedOut", notice: "This account has been revoked." });
          return;
        }
        if (!state.otpVerified) {
          setGate({ kind: "otp", email: state.email || user.email || "" });
          return;
        }
        if (state.passwordChangeRequired) {
          setGate({
            kind: "password",
            email: state.email || user.email || "",
            days: state.passwordMaxAgeDays,
          });
        }
      } catch (error) {
        const onlineNow = typeof navigator === "undefined" ? true : navigator.onLine;
        if (shouldRestoreCachedSession(error, onlineNow)) return;
        setGate({ kind: "error", message: errorText(error) });
      }
    })();
  }, []);

  const switchTo = useCallback((person: ViewIdentity) => {
    setShiftError("");
    setViewPerson(person);
    setViewId(person.uid);
    const next: RouteState = { view: "home", thread: null, guide: null, med: null, time: null };
    writeRoute(next);
    setRoute(next);
  }, []);

  const switchBack = useCallback(() => {
    setShiftError("");
    setViewPerson(null);
    setViewId(null);
    const next: RouteState = { view: "people", thread: null, guide: null, med: null, time: null };
    writeRoute(next);
    setRoute(next);
  }, []);

  const sessionValue: SessionValue | null = useMemo(() => {
    if (gate.kind !== "app") return null;
    const shown = displaySession(gate.session, viewPerson);
    return {
      ...shown,
      setEmoji,
      setColorScheme,
      onDenied,
      canSwitchView: canViewAsEmployee(gate.session.role),
      accountUid: gate.session.uid,
      switchTo,
      switchBack,
    };
  }, [gate, viewPerson, setEmoji, setColorScheme, onDenied, switchTo, switchBack]);

  const appUid = gate.kind === "app" ? gate.session.uid : "";
  const queuedMeds = useQueuedMedActions(viewPerson ? "" : appUid);
  const appTimezone = gate.kind === "app" ? gate.session.timezone : "";
  const accountBackground = gate.kind === "app" ? gate.session.backgroundImage : "";
  useAccountBackground(accountBackground);

  useEffect(() => {
    if (!appUid) return;
    return onSnapshot(doc(db, "users", appUid), (snap) => {
      const path = String(snap.get("backgroundImage") || "");
      setGate((current) => {
        if (current.kind !== "app" || current.session.backgroundImage === path) return current;
        return { kind: "app", session: { ...current.session, backgroundImage: path } };
      });
    });
  }, [appUid]);

  useEffect(() => {
    if (!appUid) {
      setShiftDay(null);
      return;
    }
    const tick = () => setShiftDay(todayISO(appTimezone));
    tick();
    const id = window.setInterval(tick, 15000);
    return () => window.clearInterval(id);
  }, [appUid, appTimezone]);

  useEffect(() => {
    if (!appUid || !shiftDay) return;
    const uid = appUid;
    const timezone = appTimezone;
    const userRef = doc(db, "users", uid);
    let templates: ShiftTemplate[] = [];
    let exceptions: ShiftException[] = [];
    let templatesReady = false;
    let exceptionsReady = false;
    let cancelled = false;

    const sync = async () => {
      if (cancelled || !templatesReady || !exceptionsReady) return;
      const zoned = zonedParts(new Date(), timezone);
      if (zoned.date !== shiftDay) return;
      const scheduled = isDuringShift(zoned.time, resolveDay(zoned.date, templates, exceptions), uid);
      scheduledRef.current = scheduled;
      scheduleReadyRef.current = true;
      try {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(userRef);
          if (!snap.exists()) return;
          const onShift = snap.get("onShift") === true;
          const shiftHold = snap.get("shiftHold") === true;
          const plan = planShiftSync({ onShift, shiftHold, scheduled });
          if (!plan.write) return;
          const patch: { onShift?: boolean; shiftHold?: boolean } = {};
          if (plan.onShift !== onShift) patch.onShift = plan.onShift;
          if (plan.shiftHold !== shiftHold) patch.shiftHold = plan.shiftHold;
          if (Object.keys(patch).length === 0) return;
          tx.update(userRef, patch);
        });
      } catch {
        // The next tick retries. A manual tap uses its own transaction.
      }
    };

    const unsubUser = onSnapshot(userRef, (snap) => {
      const onShift = snap.get("onShift") === true;
      setGate((current) =>
        current.kind === "app" && current.session.uid === uid && current.session.onShift !== onShift
          ? { kind: "app", session: { ...current.session, onShift } }
          : current,
      );
    });
    const unsubTemplates = onSnapshot(collection(db, "shiftTemplates"), (snap) => {
      templates = snap.docs.map((item) => templateFromData(item.id, item.data() as Record<string, unknown>));
      templatesReady = true;
      void sync();
    });
    const unsubExceptions = onSnapshot(
      query(collection(db, "shiftExceptions"), where("date", "==", shiftDay)),
      (snap) => {
        exceptions = snap.docs.map((item) => exceptionFromData(item.id, item.data() as Record<string, unknown>));
        exceptionsReady = true;
        void sync();
      },
    );
    const id = window.setInterval(() => void sync(), 15000);
    return () => {
      cancelled = true;
      scheduleReadyRef.current = false;
      window.clearInterval(id);
      unsubUser();
      unsubTemplates();
      unsubExceptions();
    };
  }, [appUid, appTimezone, shiftDay]);

  const sawOffline = useRef(false);
  useEffect(() => {
    if (!online) {
      sawOffline.current = true;
      return;
    }
    if (!sawOffline.current || gate.kind !== "app") return;
    sawOffline.current = false;
    const user = auth.currentUser;
    if (user) void load(user);
  }, [online, gate.kind, load]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    if (!appUid || viewPerson) return;
    let cancelled = false;
    const run = () => {
      void syncMeds(appUid).then((result) => {
        if (cancelled) return;
        if (result.keptMessage) setSyncMessage(`${result.keptMessage} The action is still saved on this device.`);
        else if (!result.retry) setSyncMessage("");
      });
    };
    run();
    window.addEventListener("online", run);
    return () => {
      cancelled = true;
      window.removeEventListener("online", run);
    };
  }, [appUid, viewPerson]);

  const toggleShift = useCallback(async () => {
    const user = auth.currentUser;
    if (!user || gate.kind !== "app" || shiftBusy) return;
    const previous = gate.session.onShift;
    const next = !previous;
    setShiftBusy(true);
    setShiftError("");
    setGate((current) =>
      current.kind === "app" ? { kind: "app", session: { ...current.session, onShift: next } } : current,
    );
    try {
      const userRef = doc(db, "users", user.uid);
      const scheduled = scheduledRef.current;
      const known = scheduleReadyRef.current;
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(userRef);
        const desired = snap.get("onShift") !== true;
        const shiftHold = known ? desired !== scheduled : true;
        tx.update(userRef, { onShift: desired, shiftHold });
      });
    } catch (error) {
      setShiftError(isReachabilityError(error) ? "Shift changes sync when you reconnect." : errorText(error));
      setGate((current) =>
        current.kind === "app" ? { kind: "app", session: { ...current.session, onShift: previous } } : current,
      );
    } finally {
      setShiftBusy(false);
    }
  }, [gate, shiftBusy]);

  useEffect(() => {
    const root = appRef.current;
    if (!root) return;
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let swiped = false;

    function onStart(event: TouchEvent) {
      swiped = false;
      if (gate.kind !== "app" || event.touches.length !== 1) {
        tracking = false;
        return;
      }
      const touch = event.touches[0];
      if (touch.clientX < 28 || touch.clientX > window.innerWidth - 28 || swipeStartsOnControl(event.target)) {
        tracking = false;
        return;
      }
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
    }

    function onEnd(event: TouchEvent) {
      if (!tracking) return;
      tracking = false;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const axis = swipeAxis(touch.clientX - startX, touch.clientY - startY);
      if (!axis) return;
      const current = routeRef.current;
      if (current.view === "messages" && current.thread && axis === "right") {
        event.preventDefault();
        swiped = true;
        goRef.current({ view: "messages", thread: null });
        return;
      }
      const view = tabInDirection(current.view, axis);
      if (!view) return;
      event.preventDefault();
      swiped = true;
      goRef.current({ view, thread: null, guide: null, med: null, time: null });
    }

    function onClick(event: MouseEvent) {
      if (!swiped) return;
      swiped = false;
      event.preventDefault();
      event.stopPropagation();
    }

    function onCancel() {
      tracking = false;
    }

    root.addEventListener("touchstart", onStart, { passive: true });
    root.addEventListener("touchend", onEnd);
    root.addEventListener("touchcancel", onCancel);
    root.addEventListener("click", onClick, true);
    return () => {
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", onCancel);
      root.removeEventListener("click", onClick, true);
    };
  }, [gate.kind]);

  function go(patch: Partial<RouteState>) {
    const next: RouteState = {
      view: patch.view ?? route.view,
      thread: patch.thread === undefined ? route.thread : patch.thread,
      guide: patch.guide === undefined ? route.guide : patch.guide,
      med: patch.med === undefined ? route.med : patch.med,
      time: patch.time === undefined ? route.time : patch.time,
    };
    writeRoute(next);
    setRoute(next);
  }
  goRef.current = go;

  return (
    <div className="app" ref={appRef}>
      <header className="top">
        <div className="brand-block">
          <strong className="brand">HammondCare</strong>
          {gate.kind === "app" && canManageSchedule((viewPerson ?? gate.session).role) ? (
            <p className="brand-role" data-testid="header-role">
              {roleLabel((viewPerson ?? gate.session).role)}
            </p>
          ) : null}
        </div>
        {gate.kind === "app" ? (
          <button
            type="button"
            className={(viewPerson ?? gate.session).onShift ? "shift-status on" : "shift-status off"}
            data-testid="shift-status"
            data-on={(viewPerson ?? gate.session).onShift ? "true" : "false"}
            data-viewing={viewPerson ? "true" : "false"}
            aria-pressed={(viewPerson ?? gate.session).onShift}
            disabled={shiftBusy}
            onClick={() => {
              if (viewPerson) {
                setShiftError(VIEW_CHANGE);
                return;
              }
              void toggleShift();
            }}
          >
            {nameMark((viewPerson ?? gate.session).displayName, (viewPerson ?? gate.session).emoji)}{" "}
            {(viewPerson ?? gate.session).onShift ? "On shift" : "Off shift"}
          </button>
        ) : null}
      </header>
      <main className="main">
        {online ? null : (
          <p className="offline-banner" data-testid="offline-banner" role="status">
            Offline. Medication actions stay on this device and sync when you reconnect.
            {queuedMeds.length > 0 ? ` ${queuedMeds.length} waiting to sync.` : ""}
          </p>
        )}
        {syncMessage ? (
          <p className="notice" data-testid="med-sync-status" role="status">
            {syncMessage}
          </p>
        ) : null}
        {gate.kind === "loading" ? <p className="hint">Loading…</p> : null}
        {gate.kind === "error" ? (
          <div className="stack">
            <Notice>{gate.message}</Notice>
            <button type="button" onClick={() => auth.currentUser && void load(auth.currentUser)}>
              Try again
            </button>
          </div>
        ) : null}
        {gate.kind === "signedOut" ? <LoginScreen notice={gate.notice} /> : null}
        {gate.kind === "otp" ? <OtpScreen email={gate.email} onDone={() => auth.currentUser && void load(auth.currentUser)} /> : null}
        {gate.kind === "password" ? (
          <PasswordScreen
            email={gate.email}
            days={gate.days}
            onDone={async (newPassword) => {
              skipSignOut.current = true;
              await signInWithEmailAndPassword(auth, gate.email, newPassword);
            }}
          />
        ) : null}
        {gate.kind === "app" && sessionValue ? (
          <SessionProvider value={sessionValue}>
            {viewPerson ? (
              <div className="view-as" data-testid="view-as-banner">
                <p>Viewing as {viewPerson.displayName}</p>
                <button type="button" data-testid="view-as-back" onClick={switchBack}>
                  Switch back
                </button>
              </div>
            ) : null}
            {shiftError ? <Notice>{shiftError}</Notice> : null}
            {route.view !== "home" && route.view !== "calendar" && route.view !== "messages" && route.view !== "more" ? (
              <button type="button" onClick={() => go({ view: "more", guide: null, thread: null, med: null, time: null })}>
                Back
              </button>
            ) : null}
            {route.view === "home" ? <HomeScreen route={route} go={go} /> : null}
            {route.view === "calendar" ? <CalendarScreen /> : null}
            {route.view === "messages" ? <MessagesScreen thread={route.thread} go={go} /> : null}
            {route.view === "more" ? <MoreScreen go={go} onSignOut={() => void signOut(auth)} /> : null}
            {route.view === "coverage" ? <CoverageScreen /> : null}
            {route.view === "meds" ? <MedsScreen /> : null}
            {route.view === "activities" ? <ActivitiesScreen /> : null}
            {route.view === "guides" ? <GuidesScreen guideId={route.guide} go={go} /> : null}
            {route.view === "medlog" ? <MedLogScreen /> : null}
            {route.view === "people" ? <PeopleScreen /> : null}
            {route.view === "settings" ? <SettingsScreen /> : null}
          </SessionProvider>
        ) : null}
      </main>
      {gate.kind === "app" ? (
        <nav className="nav">
          <button type="button" data-testid="nav-home" className={route.view === "home" ? "primary" : ""} onClick={() => go({ view: "home", thread: null, guide: null })}>
            Home
          </button>
          <button type="button" data-testid="nav-calendar" className={route.view === "calendar" ? "primary" : ""} onClick={() => go({ view: "calendar", thread: null, guide: null })}>
            Calendar
          </button>
          <button
            type="button"
            data-testid="nav-messages"
            data-unread={messagesUnread ? "true" : "false"}
            className={route.view === "messages" ? "primary" : ""}
            onClick={() => go({ view: "messages", guide: null })}
          >
            Messages
            {messagesUnread ? <span className="nav-dot" data-testid="messages-unread" /> : null}
          </button>
          <button type="button" data-testid="nav-more" className={route.view === "more" ? "primary" : ""} onClick={() => go({ view: "more", thread: null, guide: null })}>
            More
          </button>
        </nav>
      ) : null}
    </div>
  );
}

function prefersGoogleRedirect(): boolean {
  const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true);
  return mobile || standalone;
}

function LoginScreen({ notice }: { notice?: string }) {
  const [panel, setPanel] = useState<"choose" | "code" | "password">("choose");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function signInWithGmail() {
    setBusy(true);
    setError("");
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      if (prefersGoogleRedirect()) await signInWithRedirect(auth, provider);
      else await signInWithPopup(auth, provider);
    } catch (err) {
      setError(authError(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await call<{ sent: boolean; devCode?: string }>("requestSignInCode", { email: email.trim() });
      setCodeSent(true);
      setDevCode(result.devCode || "");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await call<{ token: string }>("verifySignInCode", { email: email.trim(), code });
      await signInWithCustomToken(auth, result.token);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setError(authError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h1>Sign in</h1>
      {notice ? <Notice>{notice}</Notice> : null}
      {panel === "choose" ? (
        <>
          <button className="primary" type="button" data-testid="login-gmail" disabled={busy} onClick={() => void signInWithGmail()}>
            Sign in with Gmail
          </button>
          <button type="button" data-testid="login-code" onClick={() => { setPanel("code"); setError(""); }}>
            Email code
          </button>
          <button type="button" data-testid="login-password-mode" onClick={() => { setPanel("password"); setError(""); }}>
            Password
          </button>
          <p className="hint">New people use Gmail or an email code. The super admin uses a password.</p>
        </>
      ) : null}
      {panel === "code" ? (
        <form className="stack" onSubmit={(event) => void (codeSent ? verifyCode(event) : sendCode(event))}>
          <Field label="Email">
            <input data-testid="login-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </Field>
          {codeSent ? (
            <>
              <p className="hint">A 6-digit code was sent to {email.trim()}.</p>
              {devCode ? (
                <p className="notice" data-testid="dev-otp">
                  Emulator code: {devCode}
                </p>
              ) : null}
              <Field label="6-digit code">
                <input data-testid="otp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} required />
              </Field>
            </>
          ) : null}
          {error ? <Notice>{error}</Notice> : null}
          <button className="primary" data-testid="login-submit" disabled={busy} type="submit">
            {codeSent ? "Verify code" : "Send code"}
          </button>
          {codeSent ? (
            <button type="button" disabled={busy} onClick={() => void sendCode()}>
              Send a new code
            </button>
          ) : null}
          <button type="button" onClick={() => { setPanel("choose"); setError(""); setCodeSent(false); }}>
            Back
          </button>
        </form>
      ) : null}
      {panel === "password" ? (
        <form className="stack" onSubmit={(event) => void submitPassword(event)}>
          <Field label="Email">
            <input data-testid="login-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </Field>
          <Field label="Password">
            <input data-testid="login-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </Field>
          {error ? <Notice>{error}</Notice> : null}
          <button className="primary" data-testid="login-submit" disabled={busy} type="submit">
            Sign in
          </button>
          <button type="button" onClick={() => { setPanel("choose"); setError(""); }}>
            Back
          </button>
        </form>
      ) : null}
      {panel === "choose" && error ? <Notice>{error}</Notice> : null}
    </div>
  );
}

function OtpScreen({ email, onDone }: { email: string; onDone: () => void }) {
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("Sending a code…");
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  async function send() {
    setError("");
    try {
      const result = await call<{ sent: boolean; devCode?: string }>("requestEmailOtp");
      setInfo(`A 6-digit code was sent to ${email}.`);
      if (result.devCode) setDevCode(result.devCode);
    } catch (err) {
      setInfo("");
      setError(errorText(err));
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void send();
  }, []);

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await call("verifyEmailOtp", { code });
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void verify(event)}>
      <h1>Check your email</h1>
      {info ? <p className="hint">{info}</p> : null}
      {devCode ? (
        <p className="notice" data-testid="dev-otp">
          Emulator code: {devCode}
        </p>
      ) : null}
      <Field label="6-digit code">
        <input
          data-testid="otp-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          required
        />
      </Field>
      {error ? <Notice>{error}</Notice> : null}
      <button className="primary" data-testid="otp-submit" disabled={busy} type="submit">
        Verify code
      </button>
      <button type="button" onClick={() => void send()}>
        Send a new code
      </button>
    </form>
  );
}

function PasswordScreen({ email, days, onDone }: { email: string; days: number; onDone: (password: string) => Promise<void> }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirm) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await call("changePassword", { currentPassword, newPassword });
      await onDone(newPassword);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void submit(event)}>
      <h1>Update password</h1>
      <p className="hint">Passwords must be changed every {days} days. This is for {email}.</p>
      <Field label="Current password">
        <input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
      </Field>
      <Field label="New password">
        <input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
      </Field>
      <Field label="Confirm new password">
        <input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
      </Field>
      {error ? <Notice>{error}</Notice> : null}
      <button className="primary" disabled={busy} type="submit">
        Update password
      </button>
    </form>
  );
}
