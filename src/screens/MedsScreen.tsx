import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { errorText, isPermissionDenied } from "../api";
import { Empty, Field, Notice } from "../components";
import { db } from "../firebase";
import { canEditMedications } from "../roles";
import { useSession } from "../session";
import { VIEW_CHANGE } from "../viewAs";
import { MED_TIME_CHOICES, withMedTime, withoutMedTime } from "../medTimes";
import { formatClock } from "../time";
import { CollapseSection } from "./ExtraScreens";
import type { Medication } from "../types";

const emptyForm = { name: "", dose: "", frequency: "Daily", times: ["08:00"], careNotes: "", active: true };

type MedForm = typeof emptyForm;

function medicationCount(count: number): string {
  if (count === 0) return "None yet";
  if (count === 1) return "1 medication";
  return `${count} medications`;
}

function medTimes(med: Medication): string[] {
  return Array.isArray(med.times) ? med.times : [];
}

export function MedsScreen() {
  const session = useSession();
  const manage = canEditMedications(session.role);
  const [meds, setMeds] = useState<Medication[]>([]);
  const [form, setForm] = useState<MedForm>(emptyForm);
  const [clock, setClock] = useState("08:00");
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [existingOpen, setExistingOpen] = useState(false);
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

  function resetForm() {
    setForm(emptyForm);
    setClock("08:00");
    setEditing(null);
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
      resetForm();
      setAdding(false);
      setExistingOpen(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function beginEdit(med: Medication) {
    setAdding(false);
    setExistingOpen(true);
    setEditing(med.id);
    setError("");
    setForm({
      name: med.name,
      dose: med.dose,
      frequency: med.frequency,
      times: medTimes(med).slice().sort(),
      careNotes: med.careNotes,
      active: med.active,
    });
  }

  const sorted = meds.slice().sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  function formFields() {
    return (
      <>
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
      </>
    );
  }

  function medicationList(editable: boolean) {
    if (sorted.length === 0) return <Empty>No medications yet.</Empty>;
    return (
      <ul className="list">
        {sorted.map((med) => {
          const times = medTimes(med);
          const openEditor = editable && editing === med.id;
          return (
            <li key={med.id} className="card" data-testid="med-card" data-name={med.name}>
              {openEditor ? (
                <>
                  {formFields()}
                  <button type="button" className="primary" data-testid="med-save" disabled={busy} onClick={() => void save()}>
                    Save changes
                  </button>
                </>
              ) : (
                <>
                  <strong>{med.name}</strong>
                  {!med.active ? <span className="badge">Inactive</span> : null}
                  {med.dose ? <p>{med.dose}</p> : null}
                  {times.length > 0 ? <p>{times.map((time) => formatClock(time)).join(", ")}</p> : null}
                  {med.careNotes ? <p>{med.careNotes}</p> : null}
                  {editable ? (
                    <div className="split">
                      <button type="button" data-testid="med-edit" onClick={() => beginEdit(med)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        data-testid="med-remove"
                        onClick={() => {
                          if (session.viewingAs) {
                            setError(VIEW_CHANGE);
                            return;
                          }
                          void deleteDoc(doc(db, "medications", med.id)).catch((err) => setError(errorText(err)));
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="stack">
      <h2>Medications</h2>
      {manage ? (
        <>
          <CollapseSection
            title="New"
            summary=""
            testId="meds-new-toggle"
            open={adding}
            onToggle={() => {
              if (adding) {
                setAdding(false);
                return;
              }
              resetForm();
              setError("");
              setAdding(true);
            }}
          >
            {formFields()}
            <button type="button" className="primary" data-testid="med-save" disabled={busy} onClick={() => void save()}>
              Add medication
            </button>
          </CollapseSection>
          <CollapseSection
            title="Existing"
            summary={medicationCount(sorted.length)}
            testId="meds-existing-toggle"
            open={existingOpen}
            onToggle={() => setExistingOpen((open) => !open)}
          >
            {medicationList(true)}
          </CollapseSection>
        </>
      ) : (
        <>
          <p className="hint">Care notes and times are read only.</p>
          {medicationList(false)}
        </>
      )}
      {error ? <Notice>{error}</Notice> : null}
    </div>
  );
}
