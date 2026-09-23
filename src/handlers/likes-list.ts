import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { DomainStore, adminBlockedKey, canonicalMatchId, likeTo, likesKey, makeMatch, matchesKey, matchKey, now, profileKey, userId, type Like, type Match, type Profile } from "../domain.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { contactArea, notifyMutualMatch } from "../match-ui.js";
registerMainMenuItem({ label: "Вам понравились", data: "likes:list", order: 40 });
const composer = new Composer<Ctx>();

composer.callbackQuery("likes:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const store = new DomainStore(ctx);
  const mutualIds = await store.get<string[]>(matchesKey(userId(ctx))) ?? [];
  if (mutualIds.length) {
    await ctx.reply("💕 Взаимные симпатии", { reply_markup: inlineKeyboard([[inlineButton("Открыть сообщения", "conversations:list")], [inlineButton("⬅️ В меню", "menu:main")]]) });
    for (const matchId of mutualIds) {
      const match = await store.get<Match>(matchKey(matchId));
      if (!match?.active) continue;
      const target = match.user_a_id === userId(ctx) ? match.user_b_id : match.user_a_id;
      const profile = await store.get<Profile>(profileKey(target));
      if (!profile) continue;
      const contact = contactArea(profile, matchId);
      await ctx.reply(`${profile.name}, ${profile.age} — ${profile.city}\n\n${contact.text}`, { reply_markup: contact.markup });
    }
    return;
  }
  const ids = await store.get<number[]>("profiles:index") ?? [];
  for (const id of ids) {
    if (id === userId(ctx)) continue;
    const like = (await store.get<Like[]>(likesKey(id)) ?? []).find((x) => likeTo(x) === userId(ctx) && x.status === "pending");
    const profile = await store.get<Profile>(profileKey(id));
    if (like && profile && !(await store.get(adminBlockedKey(id))) && !(await store.get(adminBlockedKey(userId(ctx))))) { await ctx.reply(`${profile.name}, ${profile.age} — ${profile.city}\n\nВам поставили лайк.`, { reply_markup: inlineKeyboard([[inlineButton("Ответить взаимностью", `likes:accept:${id}`), inlineButton("Не сейчас", `likes:ignore:${id}`)]]) }); return; }
  }
  await ctx.reply("Пока вас никто не лайкнул — загляните позже.", { reply_markup: inlineKeyboard([[inlineButton("⬅️ В меню", "menu:main")]]) });
});

composer.callbackQuery(/^likes:(accept|ignore):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); const action = ctx.match[1]; const target = Number(ctx.match[2]); const me = userId(ctx); const store = new DomainStore(ctx);
  const targetLikes = await store.get<Like[]>(likesKey(target)) ?? []; const incoming = targetLikes.find((x) => likeTo(x) === me && x.status === "pending");
  if (!incoming) { await ctx.reply("Эта симпатия больше недоступна."); return; }
  if (await store.get(adminBlockedKey(me)) || await store.get(adminBlockedKey(target))) { await ctx.reply("Эта симпатия больше недоступна."); return; }
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
  if (!existing?.active) {
    await notifyMutualMatch(ctx, target, ownProfile, match.match_id);
    const message = contactArea(targetProfile, match.match_id);
    if (targetProfile.photos[0]) await ctx.replyWithPhoto(targetProfile.photos[0], { caption: `💕 У вас взаимная симпатия! Теперь вы можете связаться друг с другом в Telegram\n\n${message.text}`, reply_markup: message.markup });
    else await ctx.reply(`💕 У вас взаимная симпатия! Теперь вы можете связаться друг с другом в Telegram\n\n${message.text}`, { reply_markup: message.markup });
  }
});

composer.callbackQuery(/^likes:telegram:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const requester = userId(ctx);
  const target = Number(ctx.match[1]);
  const store = new DomainStore(ctx);
  const id = canonicalMatchId(requester, target);
  const match = await store.get<Match>(matchKey(id));
  if (!match?.active || !((match.user_a_id === requester && match.user_b_id === target) || (match.user_a_id === target && match.user_b_id === requester))) {
    await ctx.reply("Telegram доступен только после взаимной симпатии.");
    return;
  }
  const profile = await store.get<Profile>(profileKey(target));
  if (!profile) { await ctx.reply("Профиль собеседника больше недоступен."); return; }
  const contact = contactArea(profile, id);
  await ctx.reply(contact.text, { reply_markup: contact.markup });
});
export default composer;
