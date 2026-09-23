import type { Ctx } from "../bot.js";

type Kv = { get(key: string, type?: "json"): Promise<unknown>; put(key: string, value: string): Promise<void>; delete?(key: string): Promise<void> };
type D1 = { prepare(sql: string): { bind(...args: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<unknown> } } };

function kv(ctx: Ctx): Kv | undefined {
  const env = (ctx as Ctx & { env?: Record<string, unknown> }).env;
  const candidate = env?.SERIOUS_MATCH_KV ?? env?.KV;
  return candidate && typeof candidate === "object" ? candidate as Kv : undefined;
}
function d1(ctx: Ctx): D1 | undefined {
  const env = ctx.env;
  return env?.DB && typeof env.DB === "object" && "prepare" in env.DB ? env.DB as D1 : undefined;
}

/** Domain persistence. Production Workers use the injected KV binding; the
 * tokenless harness uses the isolated session only so dialog replays remain
 * deterministic without pretending to be a production database. */
export async function read<T>(ctx: Ctx, key: string): Promise<T | undefined> {
  const database = d1(ctx);
  if (database) { await database.prepare("CREATE TABLE IF NOT EXISTS serious_match_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)").bind().run(); const row = await database.prepare("SELECT value FROM serious_match_kv WHERE key = ?").bind(key).first<{ value: string }>(); return row ? JSON.parse(row.value) as T : undefined; }
  const binding = kv(ctx);
  if (binding) return await binding.get(key, "json") as T | undefined;
  return ctx.session.store?.[key] as T | undefined;
}

export async function write<T>(ctx: Ctx, key: string, value: T): Promise<void> {
  const database = d1(ctx);
  if (database) { await database.prepare("CREATE TABLE IF NOT EXISTS serious_match_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)").bind().run(); await database.prepare("INSERT INTO serious_match_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, JSON.stringify(value)).run(); return; }
  const binding = kv(ctx);
  if (binding) { await binding.put(key, JSON.stringify(value)); return; }
  ctx.session.store ??= {};
  ctx.session.store[key] = value;
}

export async function remove(ctx: Ctx, key: string): Promise<void> {
  const database = d1(ctx);
  if (database) { await database.prepare("CREATE TABLE IF NOT EXISTS serious_match_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)").bind().run(); await database.prepare("DELETE FROM serious_match_kv WHERE key = ?").bind(key).run(); return; }
  const binding = kv(ctx);
  if (binding?.delete) { await binding.delete(key); return; }
  if (ctx.session.store) delete ctx.session.store[key];
}

export function userId(ctx: Ctx): string { return String(ctx.from?.id ?? ctx.chat?.id ?? ""); }
export function profileKey(id: string): string { return `profile:${id}`; }
export function likesKey(id: string): string { return `likes:${id}`; }
export function matchesKey(id: string): string { return `matches:${id}`; }
export function messagesKey(id: string): string { return `messages:${id}`; }
export function reportsKey(id: string): string { return `reports:${id}`; }
export function indexKey(): string { return "profile:index"; }

export interface Profile {
  userId: string; name: string; age: number; gender: string; city: string;
  photos: string[]; bio: string; serious: true; visibility: boolean;
  religion?: string; lifestyle?: string; preferredAge?: string; preferredGender?: string;
  createdAt: number; updatedAt: number;
}
export interface Like { from: string; to: string; status: "pending" | "ignored" | "matched"; at: number; }
export interface Match { id: string; a: string; b: string; active: boolean; at: number; }
export interface ChatMessage { id: string; from: string; to: string; text: string; at: number; read: boolean; }

export function now(): number { return Date.now(); }
export function matchId(a: string, b: string): string { return [a, b].sort().join(":"); }

export async function profiles(ctx: Ctx): Promise<Profile[]> {
  const ids = await read<string[]>(ctx, indexKey()) ?? [];
  const result: Profile[] = [];
  for (const id of ids) { const p = await read<Profile>(ctx, profileKey(id)); if (p) result.push(p); }
  return result;
}

export async function saveProfile(ctx: Ctx, profile: Profile): Promise<void> {
  await write(ctx, profileKey(profile.userId), profile);
  const ids = await read<string[]>(ctx, indexKey()) ?? [];
  if (!ids.includes(profile.userId)) await write(ctx, indexKey(), [...ids, profile.userId]);
}
