import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { DomainStore, canonicalMatchId, likeTo, likesKey, makeMatch, matchesKey, matchKey, now, profileKey, userId, type Like, type Match, type Profile } from "../domain.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
registerMainMenuItem({ label: "Вам понравились", data: "likes:list", order: 40 });
const composer = new Composer<Ctx>();

composer.callbackQuery("likes:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const store = new DomainStore(ctx);
  const ids = await store.get<number[]>("profiles:index") ?? [];
  for (const id of ids) {
    if (id === userId(ctx)) continue;
    const like = (await store.get<Like[]>(likesKey(id)) ?? []).find((x) => likeTo(x) === userId(ctx) && x.status === "pending");
    const profile = await store.get<Profile>(profileKey(id));
    if (like && profile) { await ctx.reply(`${profile.name}, ${profile.age} — ${profile.city}\n\nВам поставили лайк.`, { reply_markup: inlineKeyboard([[inlineButton("Ответить взаимностью", `likes:accept:${id}`), inlineButton("Не сейчас", `likes:ignore:${id}`)]]) }); return; }
  }
  await ctx.reply("Пока вас никто не лайкнул — загляните позже.", { reply_markup: inlineKeyboard([[inlineButton("⬅️ В меню", "menu:main")]]) });
});

composer.callbackQuery(/^likes:(accept|ignore):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); const action = ctx.match[1]; const target = Number(ctx.match[2]); const me = userId(ctx); const store = new DomainStore(ctx);
  const targetLikes = await store.get<Like[]>(likesKey(target)) ?? []; const incoming = targetLikes.find((x) => x.to === me && x.status === "pending");
  if (!incoming) { await ctx.reply("Эта симпатия больше недоступна."); return; }
  incoming.status = action === "ignore" ? "ignored" : "matched"; await store.set(likesKey(target), targetLikes);
  if (action === "ignore") { await ctx.editMessageText("Хорошо, эту симпатию убрали из списка."); return; }
  const ownProfile = await store.get<Profile>(profileKey(me));
  const targetProfile = await store.get<Profile>(profileKey(target));
  if (!ownProfile || !targetProfile || !ownProfile.visibility || !targetProfile.visibility || ownProfile.blockedUserIds?.includes(target) || targetProfile.blockedUserIds?.includes(me)) {
    await ctx.reply("Эта анкета больше недоступна.");
    return;
  }
  const own = await store.get<Like[]>(likesKey(me)) ?? []; const reciprocal = own.find((x) => likeTo(x) === target && x.status !== "ignored");
  if (!reciprocal) { await ctx.reply("Симпатия принята. Матч появится, когда человек ответит взаимностью."); return; }
  reciprocal.status = "matched"; await store.set(likesKey(me), own);
  const id = canonicalMatchId(me, target);
  const existing = await store.get<Match>(matchKey(id));
  const match = existing?.active ? existing : makeMatch(me, target, now());
  if (!existing?.active) {
    const created = await store.setIfAbsent(matchKey(match.match_id), match);
    if (!created && await store.available()) return;
    for (const participant of [match.user_a_id, match.user_b_id]) {
      const list = await store.get<string[]>(matchesKey(participant)) ?? [];
      if (!list.includes(match.match_id)) await store.set(matchesKey(participant), [...list, match.match_id]);
    }
  }
  const textFor = (p: Profile) => `Взаимная симпатия 💛\n${p.name}, ${p.age}\n📍 ${p.city}\n\nМожно начать спокойный разговор.`;
  const markup = inlineKeyboard([[inlineButton("💬 Написать сообщение", `conversation:open:${match.match_id}`)]]);
  try { if (ownProfile.photos[0]) await ctx.api.sendPhoto(target, ownProfile.photos[0], { caption: textFor(ownProfile), reply_markup: markup }); else await ctx.api.sendMessage(target, textFor(ownProfile), { reply_markup: markup }); } catch { /* recipient may have blocked the bot */ }
  if (!existing?.active) {
    if (ownProfile.photos[0]) await ctx.replyWithPhoto(ownProfile.photos[0], { caption: textFor(targetProfile), reply_markup: markup });
    else await ctx.reply(textFor(targetProfile), { reply_markup: markup });
  }
});
export default composer;
