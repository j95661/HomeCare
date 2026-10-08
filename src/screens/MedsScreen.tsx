import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { errorText, isPermissionDenied } from "../api";
import { Empty, Field, Notice } from "../components";
import { db } from "../firebase";
import { canManageMeds } from "../roles";
import { useSession } from "../session";
import { VIEW_CHANGE } from "../viewAs";
import { formatClock } from "../time";
import type { Medication } from "../types";

const emptyForm = { name: "", dose: "", frequency: "Daily", times: "08:00", careNotes: "", active: true };

export function MedsScreen() {
  const session = useSession();
  const manage = canManageMeds(session.role);
  const [meds, setMeds] = useState<Medication[]>([]);
  const [form, setForm] = useState(emptyForm);
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

  function parseTimes(value: string): string[] | null {
    const times = value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (times.length === 0 || times.some((time) => !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time))) return null;
    return times;
  }

  async function save() {
    if (session.viewingAs) {
      setError(VIEW_CHANGE);
      return;
    }
    const times = parseTimes(form.times);
    if (!form.name.trim() || !form.frequency.trim() || !times) {
      setError("Add a name, how often, and times like 08:00, 20:00.");
      return;
    }
    const payload = {
      name: form.name.trim(),
      dose: form.dose.trim(),
      frequency: form.frequency.trim(),
      times,
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
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="Dose">
            <input value={form.dose} onChange={(event) => setForm({ ...form, dose: event.target.value })} />
          </Field>
          <Field label="How often">
            <input value={form.frequency} onChange={(event) => setForm({ ...form, frequency: event.target.value })} />
          </Field>
          <Field label="Times">
            <input value={form.times} onChange={(event) => setForm({ ...form, times: event.target.value })} placeholder="08:00, 20:00" />
          </Field>
          <Field label="Care notes">
            <textarea rows={3} value={form.careNotes} onChange={(event) => setForm({ ...form, careNotes: event.target.value })} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />
            Active
          </label>
          <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
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
            <li key={med.id} className="card">
              <strong>{med.name}</strong>
              {!med.active ? <span className="badge">Inactive</span> : null}
              <p>{[med.dose, med.frequency].filter(Boolean).join(" · ")}</p>
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
                        times: med.times.join(", "),
                        careNotes: med.careNotes,
                        active: med.active,
                      });
                    }}
                  >
                    Edit
                  </button>
                  <button type="button" onClick={() => {
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
