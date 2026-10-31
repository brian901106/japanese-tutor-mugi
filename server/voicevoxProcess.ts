// VOICEVOX ENGINE on/off from the phone (the dev server's /api/voicevox routes, mounted by ttsPlugin in server/tts.ts):
//   GET  /api/voicevox/status → { running, starting, version?, pid?, memoryMB? }
//   POST /api/voicevox/start  → the status; spawns the fixed command `<engine folder>\run.exe --host 127.0.0.1 --port 50021`
//   POST /api/voicevox/stop   → the status; ends only the process listening on 127.0.0.1:50021, and only when its executable
//                               is that same run.exe (checked by path, then killed by PID). Never by image name.
// The engine folder is VOICEVOX_DIR when that variable is set. Otherwise it is the project's own voicevox_engine/ folder:
// the run.exe there, or in one sub-folder of it (the download script may unpack into one). Nothing else is searched:
// never the working folder (process.cwd()) and never a relative path.
// Every route is same-origin only. No request body or query is ever passed to the engine: the arguments are constants.
import { execFile as nodeExecFile, spawn as nodeSpawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VOICEVOX_PORT = 50021;
/** the engine's own arguments: fixed, never taken from a request */
export const VOICEVOX_ARGS = ['--host', '127.0.0.1', '--port', String(VOICEVOX_PORT)] as const;
/** a start gives up waiting for /version after this long */
export const VOICEVOX_START_WAIT_MS = 60_000;
/** the memory reading (a PowerShell query) is kept this long */
export const VOICEVOX_PROCESS_TTL_MS = 5_000;
/** the default engine folder, directly under the project root */
export const VOICEVOX_DIR_NAME = 'voicevox_engine';
/** the project root: the folder above server/ (never process.cwd()) */
export const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));

export type VoicevoxStatus = { running: boolean; starting: boolean; version?: string; pid?: number; memoryMB?: number };
export type VoicevoxProcInfo = { pid: number; path: string | null; workingSetMB: number };

/** a refusal or failure that maps to an HTTP status and a short message (Chinese, shown in the settings sheet) */
export class VoicevoxError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** everything the process control touches, injectable for the tests (no real process is started or killed there) */
export type VoicevoxProcessDeps = {
  /** VOICEVOX_DIR from the process environment, resolved; '' when it is not set (then the default folder is used) */
  dir: () => string;
  /** the project root: the default engine folder is <root>/voicevox_engine */
  root: string;
  /** the names of the sub-folders of a folder ([] when it cannot be read) */
  subfolders: (folder: string) => string[];
  /** the engine's address (VOICEVOX_URL, default http://127.0.0.1:50021) */
  base: () => string;
  fetch: typeof fetch;
  /** starts the engine detached and hidden; the returned object only needs error/unref */
  spawn: (exe: string, args: readonly string[], cwd: string) => { on(ev: 'error', fn: (e: Error) => void): unknown; unref(): void };
  exists: (path: string) => boolean;
  /** the process listening on 127.0.0.1:50021 (PID, executable path, working set), or null when nothing listens there */
  portOwner: () => Promise<VoicevoxProcInfo | null>;
  /** ends one process by PID (never by name) */
  kill: (pid: number) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (msg: string) => void;
  /** the same-origin guard of the dev server (server/tts.ts sameOriginRequest) */
  sameOrigin: (headers: { origin?: string; host?: string; 'sec-fetch-site'?: string; socket?: { remoteAddress?: string | undefined } | null }) => boolean;
};

/** the engine's executable name on this platform */
export const engineExeName = (): string => (process.platform === 'win32' ? 'run.exe' : 'run');

/** the executable in an engine folder */
export const voicevoxExe = (dir: string): string => join(dir, engineExeName());

/**
 * the engine executable in a folder: directly in it, or else in one of its sub-folders (the shallowest match wins;
 * sub-folders are tried in name order). Null when there is none.
 */
export function findEngineExe(folder: string, deps: Pick<VoicevoxProcessDeps, 'exists' | 'subfolders'>): string | null {
  const levels = [folder, ...deps.subfolders(folder).map((s) => join(folder, s))];
  for (const level of levels) {
    const exe = voicevoxExe(level);
    if (deps.exists(exe)) return exe;
  }
  return null;
}

/** run PowerShell with a fixed script (the only inputs are the constant port and a PID that was checked to be a number) */
function powershell(script: string, timeoutMs = 5000): Promise<string> {
  return new Promise((ok, fail) => {
    nodeExecFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: timeoutMs, windowsHide: true }, (err, out) => {
      if (err) fail(err);
      else ok(String(out));
    });
  });
}

/** the real deps (Windows): PowerShell for the port owner and the process path, node's spawn and kill for the rest */
export function defaultVoicevoxDeps(sameOrigin: VoicevoxProcessDeps['sameOrigin'], root: string = PROJECT_ROOT): VoicevoxProcessDeps {
  return {
    dir: () => {
      const d = process.env.VOICEVOX_DIR?.trim();
      return d ? resolve(d) : '';
    },
    root,
    subfolders: (folder) => {
      try {
        return readdirSync(folder, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
          .sort();
      } catch {
        return [];
      }
    },
    base: () => (process.env.VOICEVOX_URL?.trim() || `http://127.0.0.1:${VOICEVOX_PORT}`).replace(/\/+$/, ''),
    fetch: (u, i) => fetch(u, i),
    spawn: (exe, args, cwd) => nodeSpawn(exe, [...args], { cwd, detached: true, windowsHide: true, stdio: 'ignore' }),
    exists: (p) => existsSync(p),
    // one PowerShell call: the owner of the port, then its executable path and working set (the port number is a constant)
    portOwner: async () => {
      const out = await powershell(`$c = Get-NetTCPConnection -LocalPort ${VOICEVOX_PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; if ($p) { [pscustomobject]@{ pid = $p.Id; path = $p.Path; ws = $p.WorkingSet64 } | ConvertTo-Json -Compress } }`);
      const t = out.trim();
      if (!t) return null;
      const j = JSON.parse(t) as { pid: number; path: string | null; ws: number };
      if (!Number.isInteger(j.pid) || j.pid <= 0) return null;
      return { pid: j.pid, path: j.path ?? null, workingSetMB: Math.round(j.ws / 1024 / 1024) };
    },
    kill: (pid) => process.kill(pid),
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (m) => console.log(m),
    sameOrigin,
  };
}

export function createVoicevoxProcess(deps: VoicevoxProcessDeps) {
  let starting = false;
  let startDeadline = 0;
  let cachedProc: { at: number; owner: VoicevoxProcInfo | null } | undefined;

  /**
   * the engine executable this app uses: VOICEVOX_DIR's run.exe when the variable is set (it may be missing; start says so),
   * else the one in the default folder <root>/voicevox_engine (null when there is none)
   */
  function engineExe(): string | null {
    const dir = deps.dir();
    if (dir) return voicevoxExe(dir);
    return findEngineExe(join(deps.root, VOICEVOX_DIR_NAME), deps);
  }

  /** the engine answers /version (short timeout) */
  async function isUp(): Promise<string | null> {
    try {
      const r = await deps.fetch(`${deps.base()}/version`, { signal: AbortSignal.timeout(800) });
      if (!r.ok) return null;
      const v = await r.json().catch(() => null);
      return typeof v === 'string' ? v : '';
    } catch {
      return null;
    }
  }

  /** the PID and memory of the engine on the port (cached a few seconds: each reading starts PowerShell) */
  async function proc(): Promise<VoicevoxProcInfo | null> {
    const t = deps.now();
    if (cachedProc && t - cachedProc.at < VOICEVOX_PROCESS_TTL_MS) return cachedProc.owner;
    let owner: VoicevoxProcInfo | null = null;
    try {
      owner = await deps.portOwner();
    } catch {
      /* PowerShell unavailable: the engine still counts as running, just without a PID or memory */
    }
    cachedProc = { at: t, owner };
    return owner;
  }

  async function status(): Promise<VoicevoxStatus> {
    const version = await isUp();
    if (version === null) {
      return { running: false, starting };
    }
    const owner = await proc();
    const s: VoicevoxStatus = { running: true, starting: false, version };
    if (owner) {
      s.pid = owner.pid;
      s.memoryMB = owner.workingSetMB;
    }
    return s;
  }

  async function start(): Promise<VoicevoxStatus> {
    if (await isUp() !== null) return status(); // already answering: a no-op
    if (starting) return { running: false, starting: true };
    const exe = engineExe();
    if (!exe) {
      throw new VoicevoxError(404, 'no_engine', '找不到 VOICEVOX 引擎：請把引擎放在專案資料夾的 voicevox_engine/（或執行 scripts/get-voicevox），或設定環境變數 VOICEVOX_DIR，再重新啟動開發伺服器');
    }
    if (deps.dir() && !deps.exists(exe)) {
      throw new VoicevoxError(404, 'not_found', `找不到 VOICEVOX ENGINE：${exe}（請確認環境變數 VOICEVOX_DIR 指向的資料夾）`);
    }
    // the port is not free (another program holds it): a start would only fail
    if (await deps.portOwner().catch(() => null) !== null) {
      throw new VoicevoxError(409, 'port_busy', `port ${VOICEVOX_PORT} 已被其他程式占用，不是 VOICEVOX，無法啟動`);
    }
    const dir = resolve(exe, '..');
    const child = deps.spawn(exe, VOICEVOX_ARGS, dir);
    child.on('error', (e) => {
      deps.log(`[voicevox] start failed: ${e.message}`);
      starting = false;
    });
    child.unref();
    starting = true;
    startDeadline = deps.now() + VOICEVOX_START_WAIT_MS;
    deps.log(`[voicevox] starting ${exe}`);
    // the wait runs in the background: the answer comes back at once with starting: true
    void (async () => {
      while (starting) {
        await deps.sleep(1000);
        if (await isUp() !== null) {
          starting = false;
          cachedProc = undefined;
          deps.log('[voicevox] ready');
          return;
        }
        if (deps.now() > startDeadline) {
          starting = false;
          deps.log('[voicevox] did not answer within 60 s');
        }
      }
    })();
    return { running: false, starting: true };
  }

  async function stop(): Promise<VoicevoxStatus> {
    starting = false;
    if (await isUp() === null) return { running: false, starting: false };
    // the owner's PID and path come from one query; the PID checked here is the one killed
    const owner = await deps.portOwner();
    if (!owner) throw new VoicevoxError(409, 'no_pid', 'VOICEVOX 正在回應，但找不到占用 port 的程式，無法關閉');
    const exe = engineExe();
    if (!exe) throw new VoicevoxError(409, 'no_engine', '找不到 VOICEVOX 引擎資料夾，無法確認占用 port 的程式是否為 VOICEVOX，已拒絕關閉');
    const want = resolve(exe).toLowerCase();
    const got = owner.path ? resolve(owner.path).toLowerCase() : null;
    if (got !== want) {
      throw new VoicevoxError(409, 'foreign_process', `port ${VOICEVOX_PORT} 上的程式不是 VOICEVOX 的 ${engineExeName()}（PID ${owner.pid}），已拒絕關閉`);
    }
    deps.log(`[voicevox] stopping PID ${owner.pid}`);
    deps.kill(owner.pid);
    // wait until it stops answering (a few seconds at most)
    for (let i = 0; i < 10; i++) {
      await deps.sleep(500);
      if (await isUp() === null) break;
    }
    cachedProc = undefined;
    return status();
  }

  return { status, start, stop };
}

const send = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

/** the route handler for /api/voicevox (mounted by ttsPlugin); anything else is a 404 */
export function voicevoxRoute(ctl: ReturnType<typeof createVoicevoxProcess>, deps: Pick<VoicevoxProcessDeps, 'sameOrigin'>) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = (req.url ?? '/').split('?')[0].replace(/\/$/, '');
    if (!deps.sameOrigin({ origin: req.headers.origin, host: req.headers.host, 'sec-fetch-site': req.headers['sec-fetch-site'] as string | undefined, socket: req.socket })) {
      return send(res, 403, { error: 'forbidden', message: '只能從這個伺服器的頁面操作' });
    }
    try {
      if (req.method === 'GET' && url === '/status') return send(res, 200, await ctl.status());
      if (req.method === 'POST' && url === '/start') return send(res, 200, await ctl.start());
      if (req.method === 'POST' && url === '/stop') return send(res, 200, await ctl.stop());
      return send(res, 404, { error: 'not_found', message: '沒有這個 API' });
    } catch (e) {
      if (e instanceof VoicevoxError) return send(res, e.status, { error: e.code, message: e.message });
      console.warn('[voicevox]', e instanceof Error ? e.message : e);
      return send(res, 500, { error: 'server', message: 'VOICEVOX 操作失敗' });
    }
  };
}
