import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { DomainStore, likesKey, matchesKey, now, profileKey, profileSummary, reportKey, userId, type Like, type Match, type Profile } from "../domain.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

registerMainMenuItem({ label: "Знакомства", data: "browse:start", order: 20 });
const composer = new Composer<Ctx>();
const back = inlineKeyboard([[inlineButton("⬅️ В меню", "menu:main")]]);

async function nextProfile(ctx: Ctx): Promise<void> {
  const store = new DomainStore(ctx); const ids = await store.get<number[]>("profiles:index") ?? [];
  const mine = userId(ctx); const my = await store.get<Profile>(profileKey(mine));
  for (const id of ids) {
    if (id === mine) continue;
    const p = await store.get<Profile>(profileKey(id));
    if (!p?.visibility || (my && (my.preferredAgeFrom && p.age < my.preferredAgeFrom || my.preferredAgeTo && p.age > my.preferredAgeTo))) continue;
    ctx.session.activeTargetId = id;
    await ctx.reply(profileSummary(p), { reply_markup: inlineKeyboard([[inlineButton("💚 Нравится", `browse:like:${id}`), inlineButton("Пропустить", `browse:pass:${id}`)], [inlineButton("Открыть профиль", `browse:view:${id}`), inlineButton("Пожаловаться", `browse:report:${id}`)], [inlineButton("⬅️ В меню", "menu:main")]]) });
    return;
  }
  await ctx.reply("Пока подходящих анкет нет — загляните позже.", { reply_markup: back });
}

composer.callbackQuery("browse:start", async (ctx) => { await ctx.answerCallbackQuery(); await nextProfile(ctx); });
composer.callbackQuery(/^browse:(like|pass):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); const action = ctx.match[1]; const target = Number(ctx.match[2]); const me = userId(ctx); const store = new DomainStore(ctx);
  if (action === "pass") { await ctx.editMessageText("Хорошо, покажу следующую анкету."); await nextProfile(ctx); return; }
  const ownLikes = await store.get<Like[]>(likesKey(me)) ?? []; if (!ownLikes.some((l) => l.to === target)) { ownLikes.push({ from: me, to: target, status: "pending", at: now() }); await store.set(likesKey(me), ownLikes); }
  const theirLikes = await store.get<Like[]>(likesKey(target)) ?? []; const mutual = theirLikes.some((l) => l.to === me && l.status !== "ignored");
  if (mutual) {
    const pair = [me, target].sort((a, b) => a - b); const match: Match = { id: `${pair[0]}-${pair[1]}`, a: pair[0], b: pair[1], active: true, at: now() };
    await store.set(`match:${match.id}`, match); for (const id of pair) { const ms = await store.get<string[]>(matchesKey(id)) ?? []; if (!ms.includes(match.id)) await store.set(matchesKey(id), [...ms, match.id]); }
    try { await ctx.api.sendMessage(target, "У вас взаимная симпатия. Можно начать разговор 💬"); } catch { /* recipient may have blocked the bot */ }
    await ctx.reply("Симпатия взаимна — можно начать разговор 💬", { reply_markup: inlineKeyboard([[inlineButton("Написать", `conversation:open:${match.id}`)], [inlineButton("⬅️ В меню", "menu:main")]]) });
  } else { await ctx.reply("Симпатия отправлена. Если она будет взаимной, вы сможете поговорить."); await nextProfile(ctx); }
});
composer.callbackQuery(/^browse:view:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); const p = await new DomainStore(ctx).get<Profile>(profileKey(Number(ctx.match[1]))); await ctx.reply(p ? profileSummary(p) : "Эта анкета больше недоступна.", { reply_markup: back }); });
composer.callbackQuery(/^browse:report:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.activeTargetId = Number(ctx.match[1]); ctx.session.step = "report"; await ctx.reply("Что вас насторожило?", { reply_markup: inlineKeyboard([[inlineButton("Спам", "report:reason:spam"), inlineButton("Фото", "report:reason:photos")], [inlineButton("Фальшивый профиль", "report:reason:fake"), inlineButton("Оскорбления", "report:reason:harassment")], [inlineButton("Другое", "report:reason:other")]]) }); });
composer.callbackQuery(/^report:reason:(.+)$/, async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.reportReason = ctx.match[1]; ctx.session.step = "report"; await ctx.reply("Если хотите, добавьте подробности одним сообщением.", { reply_markup: { force_reply: true, input_field_placeholder: "Опишите ситуацию" } }); });
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "report") { await next(); return; }
  const target = ctx.session.activeTargetId; const store = new DomainStore(ctx); const profile = target ? await store.get<Profile>(profileKey(target)) : undefined;
  if (!target || !profile) { ctx.session.step = "idle"; await ctx.reply("Эта анкета больше недоступна.", { reply_markup: back }); return; }
  const id = `${userId(ctx)}-${now()}`; const report = { id, reporter: userId(ctx), target, reason: ctx.session.reportReason ?? "other", details: ctx.message.text.trim(), snapshot: profile, at: now(), adminAction: "pending" };
  await store.set(reportKey(id), report); const admin = adminChatId(ctx); if (admin) { try { await ctx.api.sendMessage(admin, `Новая жалоба\nПричина: ${report.reason}\nПрофиль: ${profile.name}, ${profile.age}, ${profile.city}\nПодробности: ${report.details || "не указаны"}`); } catch { /* owner delivery is best effort */ } }
  ctx.session.step = "idle"; ctx.session.reportReason = undefined; await ctx.reply("Спасибо, что сообщили. Мы проверим профиль и позаботимся о безопасности.", { reply_markup: back });
});
export default composer;
