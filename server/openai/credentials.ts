// The ChatGPT sign-in is stored on this PC only, in the user's data folder (MUGI_DATA_DIR, else ~/.mugi-tutor):
//   credentials.json  the account (tokens included), AES-256-GCM encrypted when a protector is available
//   master.key        the 32-byte key of credentials.json, protected by the protector (Windows: DPAPI, CurrentUser)
// Without a protector (not Windows) the file is plain JSON, and the folder and file are 0700 / 0600.
// Windows: the folder is restricted to the current user with icacls, and the DPAPI call runs through the System32
// PowerShell with the data on stdin (the plain key never touches a file). Both are injected in the tests.
// The file format is versioned (v: 1). A file that cannot be read is an error that stops the server; it is never overwritten.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const CREDENTIALS_VERSION = 1;
export const CREDENTIALS_FILE = 'credentials.json';
export const MASTER_KEY_FILE = 'master.key';
const UNREADABLE = '無法解開登入資料；請刪除 credentials.json 與 master.key 後重新登入。';
const UNREADABLE_FILE = '登入資料無法讀取；請先備份 credentials.json，再修復或移除檔案。';

/** a signed-in ChatGPT account (one at most: the app serves one person on this PC) */
export type Account = {
  client_id: string;
  subject: string;
  email: string;
  name: string;
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  scopes: string[];
  /** when the access token stops being valid (ms since the epoch) */
  expiresAt: number;
};

export type CredentialsData = { v: typeof CREDENTIALS_VERSION; hostId: string; account: Account | null };

export type Protector = { protect(data: Buffer): Buffer; unprotect(data: Buffer): Buffer };

export type CredentialStore = {
  data: CredentialsData;
  /** writes the whole data (atomically); encrypted when the store has a key */
  save(): void;
};

/** the data folder: MUGI_DATA_DIR, else ~/.mugi-tutor */
export function dataDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const set = (env.MUGI_DATA_DIR ?? '').trim();
  return set || path.join(os.homedir(), '.mugi-tutor');
}

const system32 = (...name: string[]) => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', ...name);

/** Windows DPAPI (CurrentUser): the bytes go in base64 on stdin, the result comes back on stdout */
function dpapi(op: 'Protect' | 'Unprotect', data: Buffer): Buffer {
  const out = execFileSync(system32('WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command',
    'Add-Type -AssemblyName System.Security; $d = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); ' +
    `[Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${op}($d, $null, 'CurrentUser')))`],
  { input: data.toString('base64'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  return Buffer.from(out.trim(), 'base64');
}

export const dpapiProtector: Protector = {
  protect: (data) => dpapi('Protect', data),
  unprotect: (data) => dpapi('Unprotect', data),
};

/** the protector of this platform: DPAPI on Windows, none elsewhere */
export function defaultProtector(): Protector | null {
  return process.platform === 'win32' ? dpapiProtector : null;
}

/** the folder is readable and writable by the current user only */
export function restrictDirectory(directory: string): void {
  if (process.platform === 'win32') {
    const sid = execFileSync(system32('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' }).match(/S-1-[0-9-]+/)?.[0];
    if (!sid) throw new Error('無法確認 Windows 使用者，停止保存登入資料。');
    execFileSync(system32('icacls.exe'), [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { stdio: 'pipe' });
  } else {
    fs.chmodSync(directory, 0o700);
  }
}

/** writes a temporary file next to the target, then renames it over the target (a crash never leaves half a file) */
function writeAtomic(filename: string, content: string): void {
  const temp = `${filename}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, content, { mode: 0o600 });
  fs.renameSync(temp, filename);
}

function freshData(): CredentialsData {
  return { v: CREDENTIALS_VERSION, hostId: `urn:uuid:${randomUUID()}`, account: null };
}

/**
 * Opens (creating when new) the credential store of `directory`. Throws, and writes nothing, when the existing files cannot
 * be read: an unreadable credentials file or key is reported, never replaced.
 */
export function openCredentialStore(opts: {
  directory: string;
  protector: Protector | null;
  restrict?: (directory: string) => void;
}): CredentialStore {
  const { directory, protector } = opts;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  (opts.restrict ?? restrictDirectory)(directory);
  const filename = path.join(directory, CREDENTIALS_FILE);
  const keyFile = path.join(directory, MASTER_KEY_FILE);

  let stored: Record<string, unknown> | null = null;
  try {
    stored = JSON.parse(fs.readFileSync(filename, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(UNREADABLE_FILE);
  }
  const encrypted = stored?.enc === 'aes-256-gcm';

  // the master key is opened once, at startup; a file that is encrypted without a usable key stops here
  let key: Buffer | null = null;
  if (protector) {
    if (fs.existsSync(keyFile)) {
      try {
        key = protector.unprotect(Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64'));
      } catch {
        throw new Error(UNREADABLE);
      }
      if (key.length !== 32) throw new Error(UNREADABLE);
    } else if (encrypted) {
      throw new Error(UNREADABLE);
    } else {
      key = randomBytes(32);
      writeAtomic(keyFile, protector.protect(key).toString('base64'));
    }
  } else if (encrypted) {
    throw new Error(UNREADABLE);
  }

  let data: CredentialsData;
  if (encrypted) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key as Buffer, Buffer.from(stored?.iv as string, 'base64'));
      decipher.setAuthTag(Buffer.from(stored?.tag as string, 'base64'));
      const plain = Buffer.concat([decipher.update(Buffer.from(stored?.data as string, 'base64')), decipher.final()]);
      data = JSON.parse(plain.toString('utf8')) as CredentialsData;
    } catch {
      throw new Error(UNREADABLE);
    }
  } else {
    data = stored && stored.v === CREDENTIALS_VERSION ? (stored as unknown as CredentialsData) : freshData();
  }

  const save = (): void => {
    const plain = JSON.stringify(data, null, 2);
    if (!key) {
      writeAtomic(filename, plain);
      return;
    }
    // every save uses a new 12-byte IV (AES-256-GCM over the whole data)
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    writeAtomic(filename, JSON.stringify({
      v: CREDENTIALS_VERSION,
      enc: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: body.toString('base64'),
    }));
  };
  // an older plain file is rewritten encrypted at once (and a new store is written)
  save();
  return { data, save };
}
