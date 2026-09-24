import type { Ctx } from "./bot.js";

export interface Profile {
  userId: number;
  name: string;
  age: number;
  gender: string;
  city: string;
  photos: string[];
  bio: string;
  maritalStatus: string;
  /** Optional nationality; legacy profiles may not have this field. */
  nationality?: string | null;
  profession: string;
  height: number;
  purpose: string;
  childrenPreference?: string;
  religionValues?: string;
  smokingDrinking?: string;
  relationshipIntent: "serious";
  preferredAgeFrom?: number;
  preferredAgeTo?: number;
  preferredGender?: string;
  /** Optional contact sharing, disabled unless the user explicitly opts in. */
  telegramUsername: string | null;
  /** True only after the user explicitly confirms this stored username. */
  telegramUsernameConfirmed?: boolean;
  showTelegramOnMatch: boolean;
  telegram_username?: string | null;
  telegram_username_confirmed?: boolean;
  show_telegram_on_match?: boolean;
  blockedUserIds?: number[];
  visibility: boolean;
  vip?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type SearchGender = "m" | "f" | "other" | "any";
export type SearchRelationshipStatus = "single" | "relationship" | "divorced" | "widowed" | "any";

/** Persistent discovery preferences. Undefined age/city means any value. */
export interface SearchFilters {
  gender: SearchGender;
  ageFrom?: number;
  ageTo?: number;
  city?: string;
  relationshipStatus: SearchRelationshipStatus;
  updatedAt: number;
}

/** A durable like. The long names mirror the domain contract; the short aliases
 * are retained when reading profiles created by the first scaffold revision. */
export interface Like {
  from_user_id: number;
  to_user_id: number;
  created_at: number;
  status: "pending" | "ignored" | "matched";
  from?: number;
  to?: number;
  at?: number;
}
export interface Match {
  match_id: string;
  user_a_id: number;
  user_b_id: number;
  created_at: number;
  active: boolean;
  id?: string;
  a?: number;
  b?: number;
  at?: number;
}
export interface Message {
  id: string;
  matchId: string;
  from: number;
  to: number;
  text: string;
  sentAt: number;
  readAt?: number;
  delivered: boolean;
  // Canonical names used by the messaging contract. The short names remain
  // supported so records written by the starter revision stay readable.
  sender_id?: number;
  recipient_id?: number;
  created_at?: number;
  read?: boolean;
}
export interface Report { id: string; reporter: number; target: number; reason: string; details?: string; snapshot: Profile; at: number }

let clock: () => number = () => Date.now();
export const now = (): number => clock();
/** Test/runtime seam for expiry and cutoff decisions. */
export function setClock(next: () => number): () => void {
  const previous = clock;
  clock = next;
  return () => { clock = previous; };
}

export function messageEventKey(matchId: string, updateId: number, sender: number): string {
  return `message-event:${matchId}:${sender}:${updateId}`;
}

type D1 = { prepare(sql: string): { bind(...args: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<{ meta?: { changes?: number }}>; all<T>(): Promise<{ results: T[] }> } } };
type Redis = { get(key: string): Promise<string | null>; set(key: string, value: string, ...args: string[]): Promise<unknown>; del(key: string): Promise<unknown> };
type EnvCtx = unknown;

function envOf(ctx: EnvCtx): Record<string, unknown> {
  const runtime = ctx as { env?: Record<string, unknown> };
  return runtime?.env ?? (typeof process === "undefined" ? {} : process.env as unknown as Record<string, unknown>);
}

/** Small JSON repository. Workers use D1; Node production uses the toolkit's Redis path. */
export class DomainStore {
  private redisPromise?: Promise<Redis | undefined>;
  constructor(private readonly ctx: EnvCtx) {}
  async available(): Promise<boolean> { return Boolean(this.d1() || await this.redis()); }

  private d1(): D1 | undefined {
    const db = envOf(this.ctx).DB;
    return db && typeof (db as D1).prepare === "function" ? db as D1 : undefined;
  }

  private async redis(): Promise<Redis | undefined> {
    const url = envOf(this.ctx).REDIS_URL;
    if (typeof url !== "string" || !url) return undefined;
    this.redisPromise ??= (async () => {
      try {
        const { createRequire } = await import("node:module");
        const required = createRequire(import.meta.url)("ioredis");
        const RedisCtor = required.default ?? required.Redis ?? required;
        return new RedisCtor(url, { maxRetriesPerRequest: null }) as Redis;
      } catch { return undefined; }
    })();
    return this.redisPromise;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const db = this.d1();
    if (db) {
      await db.prepare("CREATE TABLE IF NOT EXISTS bot_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)").bind().run();
      const row = await db.prepare("SELECT value FROM bot_state WHERE key = ?").bind(key).first<{ value: string }>();
      return row ? JSON.parse(row.value) as T : undefined;
    }
    const redis = await this.redis();
    if (!redis) return undefined;
    const value = await redis.get(`seriousmatch:${key}`);
    return value ? JSON.parse(value) as T : undefined;
  }

  async set<T>(key: string, value: T): Promise<boolean> {
    const encoded = JSON.stringify(value);
    const db = this.d1();
    if (db) {
      await db.prepare("CREATE TABLE IF NOT EXISTS bot_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)").bind().run();
      await db.prepare("INSERT INTO bot_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key, encoded).run();
      return true;
    }
    const redis = await this.redis();
    if (!redis) return false;
    await redis.set(`seriousmatch:${key}`, encoded);
    return true;
  }

  /** Insert-only write used for likes and canonical matches. It maps to the
   * store's uniqueness primitive so concurrent callbacks cannot create a
   * second record or emit a second first-match notification. */
  async setIfAbsent<T>(key: string, value: T): Promise<boolean> {
    const encoded = JSON.stringify(value);
    const db = this.d1();
    if (db) {
      await db.prepare("CREATE TABLE IF NOT EXISTS bot_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)").bind().run();
      const result = await db.prepare("INSERT OR IGNORE INTO bot_state(key,value) VALUES(?,?)").bind(key, encoded).run();
      return (result.meta?.changes ?? 0) > 0;
    }
    const redis = await this.redis();
    if (!redis) return false;
    const result = await redis.set(`seriousmatch:${key}`, encoded, "NX");
    return result === "OK";
  }

  async delete(key: string): Promise<boolean> {
    const db = this.d1();
    if (db) { await db.prepare("DELETE FROM bot_state WHERE key = ?").bind(key).run(); return true; }
    const redis = await this.redis();
    if (!redis) return false;
    await redis.del(`seriousmatch:${key}`); return true;
  }
}

export function userId(ctx: { from?: { id: number } }): number { return ctx.from?.id ?? 0; }
export function profileKey(id: number): string { return `profile:${id}`; }
/** Durable username records let registration reserve a name before publishing. */
export function telegramUsernameKey(id: number): string { return `telegram-username:${id}`; }
export function telegramUsernameOwnerKey(username: string): string {
  return `telegram-username-owner:${username.toLowerCase()}`;
}
export function searchFiltersKey(id: number): string { return `search-filters:${id}`; }
export function likesKey(id: number): string { return `likes:${id}`; }
export function likeKey(from: number, to: number): string { return `like:${from}:${to}`; }
export function likeIndexKey(from: number): string { return `likes:index:${from}`; }
export function skipsKey(id: number): string { return `skips:${id}`; }
/** Durable discovery actions. A candidate is assessed once it is liked or passed. */
export function viewedKey(id: number): string { return `viewed:${id}`; }
export function viewedActionKey(viewer: number, candidate: number): string { return `viewed:${viewer}:${candidate}`; }
export function matchesKey(id: number): string { return `matches:${id}`; }
export function messagesKey(id: string): string { return `messages:${id}`; }
export function blockKey(blocker: number, blocked: number): string { return `block:${blocker}:${blocked}`; }
export function blocksKey(blocker: number): string { return `blocks:${blocker}`; }
export function adminBlockedKey(id: number): string { return `admin-blocked:${id}`; }
export function adminBlockedIndexKey(): string { return "admin-blocked:index"; }
export function reportsIndexKey(): string { return "reports:index"; }
export function auditIndexKey(): string { return "admin-audit:index"; }
export function auditKey(id: string): string { return `admin-audit:${id}`; }
export function profileSummary(p: Profile): string {
  const photoLine = p.photos.length > 1 ? `\n📷 Фото: ${p.photos.length}` : "";
  const nationalityLine = p.nationality ? `\n🌍 Национальность: ${p.nationality}` : "";
  const text = `💛 ${p.name}, ${p.age}\n📍 ${p.city}\n💍 ${p.maritalStatus}${nationalityLine}\n💼 ${p.profession}\n📏 ${p.height} см${photoLine}\n\nО себе: ${p.bio}\n\nЦель знакомства: ${p.purpose}`;
  return text.length <= 1000 ? text : `${text.slice(0, 997)}…`;
}

/** Telegram limits photo captions to 1,024 Unicode characters. */
export function photoCaption(value: string): string {
  const characters = Array.from(value);
  return characters.length <= 1024
    ? value
    : `${characters.slice(0, 1023).join("")}…`;
}

export function profileIndexKey(): string { return "profiles:index"; }
export function reportKey(id: string): string { return `report:${id}`; }
export function matchKey(id: string): string { return `match:${id}`; }
export function canonicalMatchId(a: number, b: number): string {
  const pair = [a, b].sort((x, y) => x - y);
  return `${pair[0]}-${pair[1]}`;
}
export function eventsKey(): string { return "events:index"; }

/** Existing profiles may predate the Telegram privacy fields. */
export function withTelegramDefaults(profile: Profile): Profile {
  return {
    ...profile,
    telegramUsername: profile.telegramUsername || profile.telegram_username || null,
    telegramUsernameConfirmed: profile.telegramUsernameConfirmed === true || profile.telegram_username_confirmed === true,
    showTelegramOnMatch: profile.showTelegramOnMatch === true || profile.show_telegram_on_match === true,
  };
}

export function validTelegramUsername(value: string): boolean {
  return /^[A-Za-z0-9_]{5,32}$/.test(value);
}

/** Accept the public @ form and return the canonical username used by Telegram URLs. */
export function normalizeTelegramUsername(value: string): string | null {
  const trimmed = value.trim();
  if (!/^@[A-Za-z0-9_]{5,32}$/.test(trimmed)) return null;
  return trimmed.slice(1);
}

export function likeFrom(value: Like): number { return value.from_user_id ?? value.from ?? 0; }
export function likeTo(value: Like): number { return value.to_user_id ?? value.to ?? 0; }
export function matchA(value: Match): number { return value.user_a_id ?? value.a ?? 0; }
export function matchB(value: Match): number { return value.user_b_id ?? value.b ?? 0; }

export function makeLike(from: number, to: number, at = now()): Like {
  return { from_user_id: from, to_user_id: to, created_at: at, status: "pending" };
}

export function makeMatch(a: number, b: number, at = now()): Match {
  const pair = [a, b].sort((x, y) => x - y);
  return { match_id: `${pair[0]}-${pair[1]}`, user_a_id: pair[0], user_b_id: pair[1], created_at: at, active: true };
}
