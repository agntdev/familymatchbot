import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  DomainStore, adminBlockedIndexKey, adminBlockedKey, auditIndexKey, auditKey,
  likeTo, likesKey, matchA, matchB, matchKey, matchesKey, messagesKey, now,
  profileIndexKey, profileKey, reportKey, reportsIndexKey, userId,
  type Like, type Match, type Message, type Profile,
} from "../domain.js";
import { adminChatId, inlineButton, inlineKeyboard, isOwner } from "../toolkit/index.js";

const composer = new Composer<Ctx>();
const DAY = 24 * 60 * 60 * 1000;
const MONTH = 30 * DAY;
const back = inlineKeyboard([[inlineButton("⬅️ К панели", "admin:open")]]);

function owner(ctx: Ctx): boolean { return isOwner(ctx); }
function idText(id: number): string { return String(id); }
function pageButtons(prefix: string, page: number, more: boolean) {
  const row = [] as ReturnType<typeof inlineButton>[];
  if (page > 0) row.push(inlineButton("Назад", `${prefix}:${page - 1}`));
  if (more) row.push(inlineButton("Дальше", `${prefix}:${page + 1}`));
  return row.length ? [row] : [];
}
function panelKeyboard() {
  return inlineKeyboard([
    [inlineButton("Пользователи", "admin:users:0"), inlineButton("Новые", "admin:new:0")],
    [inlineButton("Активные", "admin:active:0"), inlineButton("VIP", "admin:vips:0")],
    [inlineButton("Лайки", "admin:likes:0"), inlineButton("Матчи", "admin:matches:0")],
    [inlineButton("Сообщения", "admin:messages:0"), inlineButton("Жалобы", "admin:complaints:0")],
    [inlineButton("Найти пользователя", "admin:user:search")],
  ]);
}
async function profiles(store: DomainStore): Promise<Profile[]> {
  const ids = await store.get<number[]>(profileIndexKey()) ?? [];
  const result: Profile[] = [];
  for (const id of ids) { const profile = await store.get<Profile>(profileKey(id)); if (profile) result.push(profile); }
  return result;
}
async function audit(ctx: Ctx, action: string, target: number): Promise<void> {
  const store = new DomainStore(ctx); const at = now(); const id = `${at}-${userId(ctx)}-${target}-${action}`;
  await store.set(auditKey(id), { id, action, targetUserId: target, adminId: userId(ctx), at });
  const index = await store.get<string[]>(auditIndexKey()) ?? [];
  if (!index.includes(id)) await store.set(auditIndexKey(), [...index, id]);
}
async function pageProfiles(ctx: Ctx, title: string, list: Profile[], page: number, prefix: string): Promise<void> {
  const start = Math.max(0, page) * 5; const shown = list.slice(start, start + 5);
  const lines = shown.map((p) => `${p.name}, ${p.age} · ${p.city} · ID ${p.userId}`).join("\n");
  const rows = shown.map((p) => [inlineButton(`${p.name} · ${p.userId}`, `admin:user:view:${p.userId}`)]);
  rows.push([inlineButton("Найти пользователя", "admin:user:search")]);
  rows.push(...pageButtons(prefix, Math.max(0, page), start + 5 < list.length));
  rows.push([inlineButton("⬅️ К панели", "admin:open")]);
  await ctx.reply(`${title}\n\n${lines || "Пока здесь нет пользователей."}`, { reply_markup: inlineKeyboard(rows) });
}
async function userDetail(ctx: Ctx, id: number): Promise<void> {
  const store = new DomainStore(ctx); const p = await store.get<Profile>(profileKey(id));
  if (!p) { await ctx.reply("Пользователь не найден.", { reply_markup: back }); return; }
  const all = await profiles(store); let likes = 0; let matches = 0; let messages = 0;
  for (const profile of all) {
    likes += (await store.get<Like[]>(likesKey(profile.userId)) ?? []).filter((x) => likeTo(x) === id).length;
    for (const matchId of await store.get<string[]>(matchesKey(profile.userId)) ?? []) {
      const match = await store.get<Match>(matchKey(matchId));
      if (match?.active && matchA(match) === id || match?.active && matchB(match) === id) matches++;
    }
  }
  const matchIds = [...new Set(await store.get<string[]>(matchesKey(id)) ?? [])];
  for (const matchId of matchIds) messages += (await store.get<Message[]>(messagesKey(matchId)) ?? []).length;
  const blocked = Boolean(await store.get(adminBlockedKey(id)));
  await audit(ctx, "view_user", id);
  matches = matchIds.length;
  await ctx.reply(`Пользователь ${id}\n${p.name}, ${p.age} · ${p.city}\nРегистрация: ${new Date(p.createdAt).toLocaleDateString("ru-RU")}\nПоследняя активность: ${new Date(p.updatedAt).toLocaleDateString("ru-RU")}\nVIP: ${p.vip ? "да" : "нет"}\nЛайков: ${likes}\nМатчей: ${matches}\nСообщений: ${messages}`, { reply_markup: inlineKeyboard([
    [inlineButton("Открыть профиль", `admin:profile:view:${id}`)],
    [inlineButton(blocked ? "Разблокировать" : "Заблокировать", `admin:user:${blocked ? "unblock" : "block"}:${id}`), inlineButton(p.vip ? "Снять VIP" : "Назначить VIP", `admin:user:vip:${id}`)],
    [inlineButton("⬅️ К панели", "admin:open")],
  ]) });
}
async function complaintList(ctx: Ctx, page: number): Promise<void> {
  const store = new DomainStore(ctx); const ids = await store.get<string[]>(reportsIndexKey()) ?? [];
  const reports: Array<{ id: string; reporter: number; target: number; reason: string; details?: string; at: number; adminAction?: string }> = [];
  for (const id of ids) { const report = await store.get<typeof reports[number]>(reportKey(id)); if (report && report.adminAction !== "resolved") reports.push(report); }
  const start = Math.max(0, page) * 5; const shown = reports.slice(start, start + 5);
  const text = shown.map((r) => `Жалоба\nОт: ${r.reporter} · На: ${r.target}\nВремя: ${new Date(r.at).toLocaleString("ru-RU")}\nТекст: ${r.details || r.reason}`).join("\n\n") || "Новых жалоб нет.";
  const rows: ReturnType<typeof inlineButton>[][] = [];
  for (const r of shown) rows.push([inlineButton(`Жалоба ${r.target}`, `admin:report:view:${r.id}`)]);
  rows.push(...pageButtons("admin:complaints", Math.max(0, page), start + 5 < reports.length)); rows.push([inlineButton("⬅️ К панели", "admin:open")]);
  await ctx.reply(text, { reply_markup: inlineKeyboard(rows) });
}

composer.command("admin", async (ctx) => {
  if (!owner(ctx)) return;
  const store = new DomainStore(ctx); const list = await profiles(store); const cutoffDay = now() - DAY; const cutoffMonth = now() - MONTH;
  let likes = 0; let matches = 0; let messages = 0;
  for (const p of list) {
    likes += (await store.get<Like[]>(likesKey(p.userId)) ?? []).length;
    for (const id of await store.get<string[]>(matchesKey(p.userId)) ?? []) { const m = await store.get<Match>(matchKey(id)); if (m?.active && matchA(m) === p.userId) matches++; }
  }
  const matchIds = new Set<string>(); for (const p of list) for (const id of await store.get<string[]>(matchesKey(p.userId)) ?? []) matchIds.add(id);
  for (const id of matchIds) messages += (await store.get<Message[]>(messagesKey(id)) ?? []).length;
  const recent = list.filter((p) => p.createdAt >= cutoffDay).length; const active = list.filter((p) => p.updatedAt >= cutoffMonth).length; const vip = list.filter((p) => p.vip).length;
  await ctx.reply(`Панель владельца\n\nВсего пользователей: ${list.length}\nНовые за 24 часа: ${recent}\nАктивные за 30 дней: ${active}\nВсего лайков: ${likes}\nВзаимных матчей: ${matches}\nСообщений: ${messages}\nVIP-пользователей: ${vip}`, { reply_markup: panelKeyboard() });
});
composer.callbackQuery("admin:open", async (ctx) => { if (!owner(ctx)) return; await ctx.answerCallbackQuery(); await ctx.reply("Откройте нужный раздел панели.", { reply_markup: panelKeyboard() }); });
composer.callbackQuery(/^admin:(users|new|active|vips):(\d+)$/, async (ctx) => {
  if (!owner(ctx)) return; await ctx.answerCallbackQuery(); const store = new DomainStore(ctx); const list = await profiles(store); const kind = ctx.match[1]; const cutoff = now() - (kind === "new" ? DAY : MONTH); const filtered = kind === "new" ? list.filter((p) => p.createdAt >= cutoff) : kind === "active" ? list.filter((p) => p.updatedAt >= cutoff) : kind === "vips" ? list.filter((p) => p.vip) : list; await pageProfiles(ctx, kind === "users" ? "Все пользователи" : kind === "new" ? "Новые регистрации" : kind === "active" ? "Активные профили" : "VIP-пользователи", filtered, Number(ctx.match[2]), `admin:${kind}`);
});
composer.callbackQuery(/^admin:(likes|matches|messages):(\d+)$/, async (ctx) => {
  if (!owner(ctx)) return; await ctx.answerCallbackQuery(); const store = new DomainStore(ctx); const list = await profiles(store); const kind = ctx.match[1]; const ids = new Set<number>();
  for (const p of list) { if (kind === "likes" && (await store.get<Like[]>(likesKey(p.userId)) ?? []).length) ids.add(p.userId); if (kind === "matches" && (await store.get<string[]>(matchesKey(p.userId)) ?? []).length) ids.add(p.userId); if (kind === "messages") for (const matchId of await store.get<string[]>(matchesKey(p.userId)) ?? []) if ((await store.get<Message[]>(messagesKey(matchId)) ?? []).length) ids.add(p.userId); }
  await pageProfiles(ctx, kind === "likes" ? "Пользователи с лайками" : kind === "matches" ? "Участники матчей" : "Участники переписки", list.filter((p) => ids.has(p.userId)), Number(ctx.match[2]), `admin:${kind}`);
});
composer.callbackQuery(/^admin:complaints:(\d+)$/, async (ctx) => { if (!owner(ctx)) return; await ctx.answerCallbackQuery(); await complaintList(ctx, Number(ctx.match[1])); });
composer.callbackQuery("admin:user:search", async (ctx) => { if (!owner(ctx)) return; await ctx.answerCallbackQuery(); ctx.session.step = "admin_search"; await ctx.reply("Введите Telegram ID пользователя.", { reply_markup: { force_reply: true, input_field_placeholder: "Например, 123456789" } }); });
composer.on("message:text", async (ctx, next) => { if (ctx.session.step !== "admin_search" || !owner(ctx)) { await next(); return; } const id = Number(ctx.message.text.trim()); ctx.session.step = "idle"; if (!Number.isSafeInteger(id) || id <= 0) { await ctx.reply("Нужен числовой Telegram ID.", { reply_markup: back }); return; } await userDetail(ctx, id); });
composer.callbackQuery(/^admin:user:view:(\d+)$/, async (ctx) => { if (!owner(ctx)) return; await ctx.answerCallbackQuery(); await userDetail(ctx, Number(ctx.match[1])); });
composer.callbackQuery(/^admin:profile:view:(\d+)$/, async (ctx) => { if (!owner(ctx)) return; await ctx.answerCallbackQuery(); const p = await new DomainStore(ctx).get<Profile>(profileKey(Number(ctx.match[1]))); await ctx.reply(p ? `${p.name}, ${p.age}\n📍 ${p.city}\n\n${p.bio}` : "Профиль не найден.", { reply_markup: back }); });
composer.callbackQuery(/^admin:user:(block|unblock):(\d+)$/, async (ctx) => { if (!owner(ctx)) return; await ctx.answerCallbackQuery(); const id = Number(ctx.match[2]); const store = new DomainStore(ctx); if (ctx.match[1] === "block") { await store.set(adminBlockedKey(id), { userId: id, blockedAt: now() }); const ids = await store.get<number[]>(adminBlockedIndexKey()) ?? []; if (!ids.includes(id)) await store.set(adminBlockedIndexKey(), [...ids, id]); } else await store.delete(adminBlockedKey(id)); await audit(ctx, ctx.match[1], id); await ctx.reply(ctx.match[1] === "block" ? "Пользователь заблокирован и скрыт из знакомств." : "Пользователь разблокирован.", { reply_markup: inlineKeyboard([[inlineButton("Открыть пользователя", `admin:user:view:${id}`)], [inlineButton("⬅️ К панели", "admin:open")]]) }); });
composer.callbackQuery(/^admin:user:vip:(\d+)$/, async (ctx) => { if (!owner(ctx)) return; await ctx.answerCallbackQuery(); const id = Number(ctx.match[1]); const store = new DomainStore(ctx); const p = await store.get<Profile>(profileKey(id)); if (!p) { await ctx.reply("Пользователь не найден.", { reply_markup: back }); return; } p.vip = !p.vip; p.updatedAt = now(); await store.set(profileKey(id), p); await audit(ctx, p.vip ? "vip_on" : "vip_off", id); await userDetail(ctx, id); });
composer.callbackQuery(/^admin:report:view:(.+)$/, async (ctx) => { if (!owner(ctx)) return; await ctx.answerCallbackQuery(); const store = new DomainStore(ctx); const r = await store.get<{ id: string; reporter: number; target: number; reason: string; details?: string; at: number; adminAction?: string }>(reportKey(ctx.match[1])); if (!r) { await ctx.reply("Жалоба уже недоступна.", { reply_markup: back }); return; } await audit(ctx, "view_report", r.target); const blocked = Boolean(await store.get(adminBlockedKey(r.target))); await ctx.reply(`Жалоба\nОт: ${r.reporter}\nНа: ${r.target}\nВремя: ${new Date(r.at).toLocaleString("ru-RU")}\nПричина: ${r.reason}\nТекст: ${r.details || "не указан"}`, { reply_markup: inlineKeyboard([[inlineButton("Открыть профиль", `admin:profile:view:${r.target}`)], [inlineButton(blocked ? "Разблокировать" : "Заблокировать", `admin:user:${blocked ? "unblock" : "block"}:${r.target}`)], [inlineButton("Отметить решённой", `admin:report:resolve:${r.id}`)], [inlineButton("⬅️ К жалобам", "admin:complaints:0")]]) }); });
composer.callbackQuery(/^admin:report:resolve:(.+)$/, async (ctx) => { if (!owner(ctx)) return; await ctx.answerCallbackQuery(); const store = new DomainStore(ctx); const r = await store.get<Record<string, unknown> & { target?: number }>(reportKey(ctx.match[1])); if (!r) { await ctx.reply("Жалоба уже недоступна.", { reply_markup: back }); return; } r.adminAction = "resolved"; await store.set(reportKey(ctx.match[1]), r); await audit(ctx, "resolve_report", Number(r.target ?? 0)); await ctx.reply("Жалоба отмечена как решённая.", { reply_markup: inlineKeyboard([[inlineButton("К жалобам", "admin:complaints:0")], [inlineButton("К панели", "admin:open")]]) }); });

export default composer;
