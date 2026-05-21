// OS keychain integration with file fallback.
//
// Pattern A — uses keytar across macOS Keychain, Windows Credential Manager,
// and Linux Secret Service. When the keychain isn't available (locked-down
// Linux containers without libsecret, or restricted CI environments), falls
// back to an AES-256-GCM-encrypted file at `~/.config/sekura/auth.json`
// with mode 0600 so the auth flow never hard-blocks on keychain access.

import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import type { AccessTokenBundle } from "./oauth.js";

const SERVICE = "sekura.ai";
const ACCOUNT = "default";
const FALLBACK_DIR = join(homedir(), ".config", "sekura");
const FALLBACK_FILE = join(FALLBACK_DIR, "auth.json");
const KEY_FILE = join(FALLBACK_DIR, "auth.key");

const scryptAsync = promisify(scrypt);

export async function storeToken(token: AccessTokenBundle): Promise<void> {
  const serialized = JSON.stringify(token);
  try {
    const { default: keytar } = await import("keytar");
    await keytar.setPassword(SERVICE, ACCOUNT, serialized);
    return;
  } catch (err) {
    // Keychain unavailable — fall back to AES-GCM-encrypted file.
    await storeTokenToFile(serialized);
  }
}

export async function loadToken(): Promise<AccessTokenBundle | null> {
  try {
    const { default: keytar } = await import("keytar");
    const raw = await keytar.getPassword(SERVICE, ACCOUNT);
    if (raw) return JSON.parse(raw);
  } catch {
    /* fall through to file */
  }
  return loadTokenFromFile();
}

export async function clearToken(): Promise<void> {
  try {
    const { default: keytar } = await import("keytar");
    await keytar.deletePassword(SERVICE, ACCOUNT);
  } catch {
    /* ignore */
  }
  if (existsSync(FALLBACK_FILE)) {
    await writeFile(FALLBACK_FILE, "", { mode: 0o600 });
  }
}

// ── AES-GCM file fallback ─────────────────────────────────────────────────

async function getOrCreateFileKey(): Promise<Buffer> {
  await mkdir(FALLBACK_DIR, { recursive: true, mode: 0o700 });
  if (existsSync(KEY_FILE)) {
    return Buffer.from(await readFile(KEY_FILE, "utf8"), "hex");
  }
  const salt = randomBytes(16);
  const password = `${homedir()}-${process.platform}-${process.arch}`;
  const key = (await scryptAsync(password, salt, 32)) as Buffer;
  // The salt is mixed back into the key file so we can re-derive on read.
  const stored = Buffer.concat([salt, key]).toString("hex");
  await writeFile(KEY_FILE, stored, { mode: 0o600 });
  await chmod(KEY_FILE, 0o600);
  return key;
}

async function storeTokenToFile(plaintext: string): Promise<void> {
  const key = await getOrCreateFileKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob = JSON.stringify({
    v: 1,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ct: ct.toString("hex"),
  });
  await mkdir(FALLBACK_DIR, { recursive: true, mode: 0o700 });
  await writeFile(FALLBACK_FILE, blob, { mode: 0o600 });
  await chmod(FALLBACK_FILE, 0o600);
}

async function loadTokenFromFile(): Promise<AccessTokenBundle | null> {
  if (!existsSync(FALLBACK_FILE)) return null;
  try {
    const blob = JSON.parse(await readFile(FALLBACK_FILE, "utf8")) as {
      v: number;
      iv: string;
      tag: string;
      ct: string;
    };
    const key = await getOrCreateFileKey();
    const iv = Buffer.from(blob.iv, "hex");
    const tag = Buffer.from(blob.tag, "hex");
    const ct = Buffer.from(blob.ct, "hex");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    return JSON.parse(pt) as AccessTokenBundle;
  } catch {
    return null;
  }
}
