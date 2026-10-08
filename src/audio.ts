let ctx: AudioContext | null = null;

export function unlockAudio(): void {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  ctx = ctx ?? new Ctx();
  if (ctx.state === "suspended") void ctx.resume();
}

export function beep(): void {
  unlockAudio();
  if (!ctx) return;
  const now = ctx.currentTime;
  [0, 0.28].forEach((offset) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.09, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.22);
    osc.connect(gain);
    gain.connect(ctx!.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.24);
  });
}
