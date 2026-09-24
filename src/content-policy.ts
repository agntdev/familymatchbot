import { DomainStore, now } from "./domain.js";
import { adminChatId } from "./toolkit/index.js";
import type { Ctx } from "./bot.js";

export type ViolationCategory =
  | "profanity/insults"
  | "spam/advertising"
  | "sexual/obscene content"
  | "fraud/scam indicators"
  | "false or misleading data"
  | "meaningless filler";

export interface PolicyDecision {
  kind: "allowed" | "suggestion" | "explicit";
  category?: ViolationCategory;
  ruleId?: string;
  matchedText?: string;
  message?: string;
  confidenceScore: number;
  submittedText?: string;
}

export interface RegistrationBlockEvent {
  telegram_id: number;
  telegram_username: string | null;
  datetime_of_violation: number;
  detected_reason: { category: ViolationCategory; rule_id: string; matched_text: string };
  block_type: "temporary" | "permanent";
  block_start: number;
  block_end: number | null;
  attempts: number;
  duration_minutes: number;
}

export interface RegistrationState {
  permanent_block: boolean;
  attempts: number;
  last_block_end?: number | null;
}

const stateKey = (id: number) => `registration-state:${id}`;
const activeBlockKey = (id: number) => `registration-block:${id}`;
const historyKey = (id: number) => `registration-block-history:${id}`;
const auditKey = (id: string) => `registration-policy-audit:${id}`;
const auditIndexKey = () => "registration-policy-audit:index";

const rules: Array<{ category: ViolationCategory; id: string; expression: RegExp }> = [
  { category: "profanity/insults", id: "profanity-ru", expression: /(?<![\p{L}])(?:еб(?:ать|ан|лан|ло)|блядь|блядина|сука|хуй(?:ня|ло)?|пизд(?:а|ец|ёж)|мудак|идиот|дебил|тупиц(?:а|ы))(?![\p{L}])/iu },
  { category: "spam/advertising", id: "spam-link", expression: /(?:https?:\/\/|www\.|t\.me\/|\.com\b|\.ru\b)/iu },
  { category: "spam/advertising", id: "spam-phone", expression: /(?:\+?\d[\d ()-]{8,}\d)/u },
  { category: "spam/advertising", id: "spam-payment", expression: /(?:переведите|оплатите|скидк|заработок|инвестиц|реклама|продам|купите|крипт)/iu },
  { category: "sexual/obscene content", id: "obscene-sexual", expression: /(?:секс|порно|интим|гол(ая|ый)|эротик|нюдс)/iu },
  { category: "fraud/scam indicators", id: "scam-request", expression: /(?:вышлите деньги|одолжи деньги|дай код|код из смс|служба безопасности|гарантированн(?:ый|ая) доход)/iu },
  { category: "false or misleading data", id: "obvious-false-data", expression: /(?:мне\s+(?:1|2|3|4|5|6|7|8|9|10)\s+лет|я\s+бессмертн|живу\s+на\s+марсе)/iu },
  { category: "meaningless filler", id: "repeated-filler", expression: /^(.)\1{4,}$/u },
];

function normalize(value: string): string { return value.replace(/\s+/gu, " ").trim(); }

export function wordCount(value: string): number {
  return normalize(value).split(" ")
    .map((word) => word.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, ""))
    .filter(Boolean).length;
}

/** Conservative checks: uncertain or merely short text is returned as a suggestion. */
export function inspectProfileText(fields: Record<string, string | null | undefined>): PolicyDecision {
  for (const [field, raw] of Object.entries(fields)) {
    const value = normalize(raw ?? "");
    if (!value) continue;
    for (const rule of rules) {
      const match = value.match(rule.expression);
      if (match) {
        return { kind: "explicit", category: rule.category, ruleId: rule.id, matchedText: `${field}: ${match[0].slice(0, 80)}`, confidenceScore: 0.99, submittedText: value };
      }
    }
  }
  const bio = normalize(fields.bio ?? "");
  if (/(?<![\p{L}])(?:бля|сук|еб)(?![\p{L}])/iu.test(bio)) {
    return { kind: "suggestion", message: "Мы обнаружили возможное нарушение в тексте. Пожалуйста, отредактируйте анкету, чтобы она соответствовала правилам (без оскорблений, рекламы, спама и т.п.).", confidenceScore: 0.55, submittedText: bio };
  }
  return { kind: "allowed", confidenceScore: 0.98, submittedText: bio };
}

export async function registrationState(ctx: Ctx): Promise<RegistrationState> {
  return await new DomainStore(ctx).get<RegistrationState>(stateKey(ctx.from?.id ?? 0)) ?? { permanent_block: false, attempts: 0 };
}

export async function activeRegistrationBlock(ctx: Ctx): Promise<RegistrationBlockEvent | undefined> {
  const id = ctx.from?.id ?? 0;
  const store = new DomainStore(ctx);
  const state = await registrationState(ctx);
  if (state.permanent_block) return await store.get<RegistrationBlockEvent>(activeBlockKey(id));
  const block = await store.get<RegistrationBlockEvent>(activeBlockKey(id));
  if (block?.block_type === "temporary" && block.block_end !== null && block.block_end > now()) return block;
  return undefined;
}

function unblockText(end: number | null): string {
  if (end === null) return "навсегда";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(new Date(end));
}

export function blockMessage(event: RegistrationBlockEvent): string {
  return event.block_type === "permanent"
    ? `Создание анкет для вас заблокировано навсегда. Причина: ${event.detected_reason.category}.`
    : `Профиль не создан: обнаружено нарушение правил: ${event.detected_reason.category}. Временная блокировка до ${formatBlockEnd(event.block_end)} (10 минут).`;
}

function formatBlockEnd(end: number | null): string {
  if (end === null) return "навсегда";
  const parts = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(new Date(end));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("hour")}:${get("minute")}, ${get("day")}.${get("month")}.${get("year")}`;
}

export async function recordPolicyAudit(ctx: Ctx, action: string, decision: PolicyDecision): Promise<void> {
  const id = `${now()}-${ctx.from?.id ?? 0}-${action}`;
  const store = new DomainStore(ctx);
  await store.set(auditKey(id), { id, userId: ctx.from?.id ?? 0, action, submittedText: decision.submittedText ?? "", detectedReason: decision.category ?? null, confidenceScore: decision.confidenceScore, decision, at: now(), timestamp_utc: now() });
  const ids = await store.get<string[]>(auditIndexKey()) ?? [];
  if (!ids.includes(id)) await store.set(auditIndexKey(), [...ids, id]);
}

export async function enforceViolation(ctx: Ctx, decision: PolicyDecision): Promise<RegistrationBlockEvent | undefined> {
  if (decision.kind !== "explicit") return undefined;
  const id = ctx.from?.id ?? 0;
  const store = new DomainStore(ctx);
  const state = await registrationState(ctx);
  const history = await store.get<RegistrationBlockEvent[]>(historyKey(id)) ?? [];
  const permanent = state.permanent_block || history.some((event) => event.block_type === "temporary");
  const start = now();
  const event: RegistrationBlockEvent = {
    telegram_id: id,
    telegram_username: ctx.from?.username ? `@${ctx.from.username}` : null,
    datetime_of_violation: start,
    detected_reason: { category: decision.category!, rule_id: decision.ruleId!, matched_text: decision.matchedText! },
    block_type: permanent ? "permanent" : "temporary",
    block_start: start,
    block_end: permanent ? null : start + 10 * 60 * 1000,
    attempts: history.length + 1,
    duration_minutes: permanent ? 0 : 10,
  };
  await store.set(activeBlockKey(id), event);
  await store.set(historyKey(id), [...history, event]);
  await store.set(stateKey(id), { permanent_block: permanent, attempts: event.attempts, last_block_end: event.block_end });
  await recordPolicyAudit(ctx, permanent ? "permanent-block" : "temporary-block", decision);
  const admin = adminChatId(ctx);
  if (admin) {
    try {
      await ctx.api.sendMessage(admin, `Блок регистрации: ${event.telegram_id}${event.telegram_username ? ` ${event.telegram_username}` : ""}. Причина: ${event.detected_reason.category}. До: ${unblockText(event.block_end)}${event.block_end === null ? "" : " UTC"}.`);
    } catch { /* An unavailable owner must not break enforcement. */ }
  }
  return event;
}
