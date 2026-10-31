// The VOICEVOX engine's on/off line in ⚙️ 聲音 → 日文: 「VOICEVOX：執行中（約 1.2 GB）［關閉］」 / 「已關閉［開啟］」 / 「啟動中…」.
// Talks to the dev server's /api/voicevox routes (server/voicevoxProcess.ts). After a change, the TTS status is fetched again,
// so the VOICEVOX option and its voices appear (or go) without a reload.
import { apiFetch } from '../game/apiFetch';
import { useEffect, useRef, useState } from 'react';
import { fetchTtsStatus } from '../game/cloudTts';

export type VoicevoxState = { running: boolean; starting: boolean; version?: string; pid?: number; memoryMB?: number };

type Answer = { ok: true; status: VoicevoxState } | { ok: false; message: string };

async function call(action: 'status' | 'start' | 'stop'): Promise<Answer> {
  try {
    const r = await apiFetch(`/api/voicevox/${action}`, {
      method: action === 'status' ? 'GET' : 'POST',
      // every POST to /api must be JSON (server/apiGuard.ts); these have no body
      headers: action === 'status' ? undefined : { 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    const j = (await r.json().catch(() => ({}))) as Partial<VoicevoxState> & { message?: string };
    if (!r.ok) return { ok: false, message: j.message ?? `錯誤（${r.status}）` };
    return { ok: true, status: j as VoicevoxState };
  } catch {
    return { ok: false, message: '連不上伺服器' };
  }
}

/** the status line with its switch; shown in the 日文 group */
export function VoicevoxSwitch() {
  const [st, setSt] = useState<VoicevoxState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const runningBefore = useRef<boolean | undefined>(undefined);

  // the first look, and again every 2 s while the engine is starting
  useEffect(() => {
    let alive = true;
    const look = async () => {
      const a = await call('status');
      if (alive && a.ok) setSt(a.status);
    };
    void look();
    if (!st?.starting) return () => { alive = false; };
    const id = setInterval(() => void look(), 2000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st?.starting]);

  // whenever the engine comes up or goes down, the voice list is fetched again (the VOICEVOX option depends on it)
  useEffect(() => {
    if (st === null) return;
    // the first answer too: the TTS status may have been read while the engine was still busy
    if (runningBefore.current !== st.running) void fetchTtsStatus();
    runningBefore.current = st.running;
  }, [st]);

  const act = async (action: 'start' | 'stop') => {
    setBusy(true);
    setErr('');
    const a = await call(action);
    setBusy(false);
    if (a.ok) setSt(a.status);
    else setErr(a.message);
  };

  const mem = st?.running && st.memoryMB ? `（約 ${(st.memoryMB / 1024).toFixed(1)} GB）` : '';
  let label = '檢查中…';
  let button: { text: string; onClick: () => void } | null = null;
  if (st?.starting) label = '啟動中…';
  else if (st?.running) {
    label = `執行中${mem}`;
    button = { text: '［關閉］', onClick: () => void act('stop') };
  } else if (st) {
    label = '已關閉';
    button = { text: '［開啟］', onClick: () => void act('start') };
  }

  return (
    <div className="as-row"><span>VOICEVOX：{label}{err && <small>{err}</small>}</span>
      {button && <button type="button" className="as-try" disabled={busy} onClick={button.onClick}>{button.text}</button>}
    </div>
  );
}
