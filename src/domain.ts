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
  education: string;
  profession: string;
  height: number;
  purpose: string;
  relationshipIntent: "serious";
  preferredAgeFrom?: number;
  preferredAgeTo?: number;
  preferredGender?: string;
  visibility: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Like { from: number; to: number; status: "pending" | "ignored" | "matched"; at: number }
export interface Match { id: string; a: number; b: number; active: boolean; at: number }
export interface Message { id: string; matchId: string; from: number; to: number; text: string; sentAt: number; readAt?: number; delivered: boolean }
export interface Report { id: string; reporter: number; target: number; reason: string; details?: string; snapshot: Profile; at: number }

export const now = (): number => Date.now();

type D1 = { prepare(sql: string): { bind(...args: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }> } } };
type Redis = { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<unknown>; del(key: string): Promise<unknown> };
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
export function likesKey(id: number): string { return `likes:${id}`; }
export function matchesKey(id: number): string { return `matches:${id}`; }
export function messagesKey(id: string): string { return `messages:${id}`; }
export function profileSummary(p: Profile): string {
  const photoLine = p.photos.length > 1 ? `\n📷 Фото: ${p.photos.length}` : "";
  return `💛 ${p.name}, ${p.age}\n📍 ${p.city}\n💍 ${p.maritalStatus}\n🎓 ${p.education}\n💼 ${p.profession}\n📏 ${p.height} см${photoLine}\n\nО себе: ${p.bio}\n\nЦель знакомства: ${p.purpose}`;
}

export function profileIndexKey(): string { return "profiles:index"; }
export function reportKey(id: string): string { return `report:${id}`; }
export function matchKey(id: string): string { return `match:${id}`; }
