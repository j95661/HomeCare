import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { errorText, isPermissionDenied } from "../api";
import { Empty, Field, Notice } from "../components";
import { db } from "../firebase";
import { canManageMeds } from "../roles";
import { useSession } from "../session";
import { VIEW_CHANGE } from "../viewAs";
import { MED_TIME_CHOICES, withMedTime, withoutMedTime } from "../medTimes";
import { formatClock } from "../time";
import type { Medication } from "../types";

const emptyForm = { name: "", dose: "", frequency: "Daily", times: ["08:00"], careNotes: "", active: true };

export function MedsScreen() {
  const session = useSession();
  const manage = canManageMeds(session.role);
  const [meds, setMeds] = useState<Medication[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [clock, setClock] = useState("08:00");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return onSnapshot(
      collection(db, "medications"),
      (snap) => setMeds(snap.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<Medication, "id">) }))),
      (err) => (isPermissionDenied(err) ? session.onDenied() : setError(errorText(err))),
    );
  }, [session]);

  function addTime(time: string) {
    const next = withMedTime(form.times, time);
    setForm({ ...form, times: next.times });
    setError(next.error);
  }

  function toggleTime(time: string) {
    if (form.times.includes(time)) {
      setForm({ ...form, times: withoutMedTime(form.times, time) });
      setError("");
      return;
    }
    addTime(time);
  }

  async function save() {
    if (session.viewingAs) {
      setError(VIEW_CHANGE);
      return;
    }
    if (!form.name.trim() || form.times.length === 0) {
      setError("Add a name and at least one time.");
      return;
    }
    const payload = {
      name: form.name.trim(),
      dose: form.dose.trim(),
      frequency: form.frequency.trim() || "Daily",
      times: form.times,
      careNotes: form.careNotes.trim(),
      active: form.active,
      updatedBy: session.uid,
      updatedAt: serverTimestamp(),
    };
    setBusy(true);
    setError("");
    try {
      if (editing) await updateDoc(doc(db, "medications", editing), payload);
      else await addDoc(collection(db, "medications"), payload);
      setForm(emptyForm);
      setClock("08:00");
      setEditing(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h2>Medications</h2>
      {!manage ? <p className="hint">Care notes and times are read only.</p> : null}
      {manage ? (
        <section className="panel">
          <Field label="Name">
            <input data-testid="med-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="Dose">
            <input value={form.dose} onChange={(event) => setForm({ ...form, dose: event.target.value })} />
          </Field>
          <div className="field">
            <span>Times</span>
            <div className="times" data-testid="med-time-choices">
              {MED_TIME_CHOICES.map((time) => (
                <button
                  key={time}
                  type="button"
                  className={form.times.includes(time) ? "primary" : ""}
                  data-testid="med-time-choice"
                  data-time={time}
                  aria-pressed={form.times.includes(time)}
                  onClick={() => toggleTime(time)}
                >
                  {formatClock(time)}
                </button>
              ))}
            </div>
            <div className="split">
              <input data-testid="med-time-clock" type="time" value={clock} onChange={(event) => setClock(event.target.value)} />
              <button type="button" data-testid="med-time-add" onClick={() => addTime(clock)}>
                Add time
              </button>
            </div>
            {form.times.length > 0 ? (
              <div className="times" data-testid="med-times-selected">
                {form.times.map((time) => (
                  <button key={time} type="button" data-testid="med-time-selected" data-time={time} onClick={() => toggleTime(time)}>
                    {formatClock(time)}
                  </button>
                ))}
              </div>
            ) : null}
            <p className="hint">Tap 8:00 AM, 8:00 PM, and the other times. Use the clock for a different time. Tap a chosen time to remove it.</p>
          </div>
          <Field label="Care notes">
            <textarea rows={3} value={form.careNotes} onChange={(event) => setForm({ ...form, careNotes: event.target.value })} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />
            Active
          </label>
          <button type="button" className="primary" data-testid="med-save" disabled={busy} onClick={() => void save()}>
            {editing ? "Save changes" : "Add medication"}
          </button>
        </section>
      ) : null}
      {meds.length === 0 ? <Empty>No medications yet.</Empty> : null}
      <ul className="list">
        {meds
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((med) => (
            <li key={med.id} className="card" data-testid="med-card" data-name={med.name}>
              <strong>{med.name}</strong>
              {!med.active ? <span className="badge">Inactive</span> : null}
              {med.dose ? <p>{med.dose}</p> : null}
              <p>{med.times.map((time) => formatClock(time)).join(", ")}</p>
              {med.careNotes ? <p>{med.careNotes}</p> : null}
              {manage ? (
                <div className="split">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(med.id);
                      setForm({
                        name: med.name,
                        dose: med.dose,
                        frequency: med.frequency,
                        times: med.times.slice().sort(),
                        careNotes: med.careNotes,
                        active: med.active,
                      });
                    }}
                  >
                    Edit
                  </button>
                  <button type="button" data-testid="med-remove" onClick={() => {
                    if (session.viewingAs) {
                      setError(VIEW_CHANGE);
                      return;
                    }
                    void deleteDoc(doc(db, "medications", med.id)).catch((err) => setError(errorText(err)));
                  }}>
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
