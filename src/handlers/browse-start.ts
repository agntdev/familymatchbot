import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { indexKey, likesKey, matchId, matchesKey, now, profiles, read, reportsKey, userId, write, type Like, type Match, type Profile } from "../domain/store.js";

registerMainMenuItem({ label: "Смотреть анкеты", data: "browse:start", order: 20 });
const composer = new Composer<Ctx>();

composer.callbackQuery("browse:start", async (ctx) => { await ctx.answerCallbackQuery(); await showNext(ctx); });
composer.callbackQuery(/^browse:(like|pass):(.+)$/, async (ctx) => { await ctx.answerCallbackQuery(); const [, action, target] = ctx.match; if (action === "pass") { ctx.session.queue = (ctx.session.queue ?? []).filter((id) => id !== target); await showNext(ctx); return; } await like(ctx, target); });
composer.callbackQuery(/^browse:view:(.+)$/, async (ctx) => { await ctx.answerCallbackQuery(); const p = await read<Profile>(ctx, `profile:${ctx.match[1]}`); if (p) await ctx.reply(`${p.name}, ${p.age}, ${p.city}\n\n${p.bio}`, { reply_markup: inlineKeyboard([[inlineButton("Нравится", `browse:like:${p.userId}`), inlineButton("Пропустить", `browse:pass:${p.userId}`)], [inlineButton("Пожаловаться", `browse:report:${p.userId}`)]]) }); });
composer.callbackQuery(/^browse:report:(.+)$/, async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.reportTarget = ctx.match[1]; await ctx.reply("Что вас насторожило?", { reply_markup: inlineKeyboard([[inlineButton("Спам", "report:reason:spam"), inlineButton("Неподходящие фото", "report:reason:photos")], [inlineButton("Фальшивый профиль", "report:reason:fake"), inlineButton("Оскорбления", "report:reason:harassment")], [inlineButton("Другое", "report:reason:other")]]) }); });
composer.callbackQuery(/^report:reason:(.+)$/, async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.reportReason = ctx.match[1]; await submitReport(ctx, ""); });

async function showNext(ctx: Ctx): Promise<void> {
  const me = userId(ctx); const own = await read<Profile>(ctx, `profile:${me}`);
  if (!own) { await ctx.reply("Сначала создайте анкету — так подбор будет точнее.", { reply_markup: inlineKeyboard([[inlineButton("Создать профиль", "profile:create:start")]]) }); return; }
  let queue = ctx.session.queue ?? []; const all = await profiles(ctx);
  if (!queue.length) queue = all.filter((p) => p.userId !== me && p.visibility && p.age >= 18 && p.city.toLocaleLowerCase() === own.city.toLocaleLowerCase()).map((p) => p.userId);
  const target = queue[0]; ctx.session.queue = queue;
  if (!target) { await ctx.reply("Пока подходящих анкет нет — загляните позже.", { reply_markup: inlineKeyboard([[inlineButton("⬅️ В меню", "menu:main")]]) }); return; }
  const p = await read<Profile>(ctx, `profile:${target}`); if (!p) { ctx.session.queue = queue.slice(1); await showNext(ctx); return; }
  await ctx.reply(`${p.name}, ${p.age}, ${p.city}\n\n${p.bio}`, { reply_markup: inlineKeyboard([[inlineButton("Нравится", `browse:like:${p.userId}`), inlineButton("Пропустить", `browse:pass:${p.userId}`)], [inlineButton("Подробнее", `browse:view:${p.userId}`), inlineButton("Пожаловаться", `browse:report:${p.userId}`)]]) });
}
async function like(ctx: Ctx, target: string): Promise<void> {
  const me = userId(ctx); const outgoing: Like = { from: me, to: target, status: "pending", at: now() }; await write(ctx, `like:${me}:${target}`, outgoing); const incomingList = await read<Like[]>(ctx, likesKey(target)) ?? []; if (!incomingList.some((x) => x.from === me)) await write(ctx, likesKey(target), [...incomingList, outgoing]);
  const incoming = await read<Like>(ctx, `like:${target}:${me}`); ctx.session.queue = (ctx.session.queue ?? []).filter((id) => id !== target);
  if (incoming && incoming.status !== "ignored") { outgoing.status = "matched"; incoming.status = "matched"; await write(ctx, `like:${me}:${target}`, outgoing); await write(ctx, `like:${target}:${me}`, incoming); const match: Match = { id: matchId(me, target), a: me, b: target, active: true, at: now() }; await write(ctx, `${matchesKey(me)}:${target}`, match); await write(ctx, `${matchesKey(target)}:${me}`, match); const mine = await read<string[]>(ctx, matchesKey(me)) ?? []; if (!mine.includes(target)) await write(ctx, matchesKey(me), [...mine, target]); await ctx.reply("Это взаимная симпатия. Теперь можно начать разговор.", { reply_markup: inlineKeyboard([[inlineButton("Написать", `conversation:open:${target}`), inlineButton("Ещё анкеты", "browse:start")]]) }); try { await ctx.api.sendMessage(Number(target), "У вас взаимная симпатия. Откройте раздел «Сообщения», чтобы познакомиться."); } catch { /* the recipient may have blocked the bot */ } } else { await ctx.reply("Симпатия сохранена. Если человек ответит взаимностью, вы сможете написать друг другу.", { reply_markup: inlineKeyboard([[inlineButton("Следующая анкета", "browse:start")]]) }); }
}
async function submitReport(ctx: Ctx, details: string): Promise<void> { const target = ctx.session.reportTarget; const reason = ctx.session.reportReason; if (!target || !reason) return; const p = await read<Profile>(ctx, `profile:${target}`); const report = { reporter: userId(ctx), target, reason, details, snapshot: p ? { name: p.name, age: p.age, city: p.city, bio: p.bio } : undefined, at: now() }; const key = `report:${userId(ctx)}:${target}:${report.at}`; await write(ctx, key, report); const reportIndex = await read<string[]>(ctx, reportsKey("index")) ?? []; await write(ctx, reportsKey("index"), [...reportIndex, key]); const owner = adminChatId(ctx); if (owner) { try { await ctx.api.sendMessage(owner, `Сообщение о безопасности\nПричина: ${reason}\nПрофиль: ${p?.name ?? "удалён"}\nГород: ${p?.city ?? "—"}`); } catch { /* best effort */ } } ctx.session.reportTarget = undefined; ctx.session.reportReason = undefined; await ctx.reply("Спасибо, что сообщили. Мы проверим анкету и позаботимся о безопасности.", { reply_markup: inlineKeyboard([[inlineButton("Вернуться к анкетам", "browse:start")]]) }); }
export default composer;
