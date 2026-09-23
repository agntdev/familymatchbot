import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { DomainStore, likesKey, matchesKey, now, profileKey, userId, type Like, type Match, type Profile } from "../domain.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
registerMainMenuItem({ label: "Вам понравились", data: "likes:list", order: 40 });
const composer = new Composer<Ctx>();

composer.callbackQuery("likes:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const store = new DomainStore(ctx);
  if (!await store.available()) { await ctx.reply("See people who liked you; accept to create a match or ignore"); return; }
  const ids = await store.get<number[]>("profiles:index") ?? [];
  for (const id of ids) {
    if (id === userId(ctx)) continue;
    const like = (await store.get<Like[]>(likesKey(id)) ?? []).find((x) => x.to === userId(ctx) && x.status === "pending");
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
  const own = await store.get<Like[]>(likesKey(me)) ?? []; const reciprocal = own.find((x) => x.to === target && x.status !== "ignored");
  if (!reciprocal) { await ctx.reply("Симпатия принята. Матч появится, когда человек ответит взаимностью."); return; }
  reciprocal.status = "matched"; await store.set(likesKey(me), own); const pair = [me, target].sort((a, b) => a - b); const match: Match = { id: `${pair[0]}-${pair[1]}`, a: pair[0], b: pair[1], active: true, at: now() }; await store.set(`match:${match.id}`, match); for (const id of pair) { const list = await store.get<string[]>(matchesKey(id)) ?? []; if (!list.includes(match.id)) await store.set(matchesKey(id), [...list, match.id]); }
  try { await ctx.api.sendMessage(target, "Симпатия взаимна — можно начать разговор 💬"); } catch { /* recipient may have blocked the bot */ }
  await ctx.reply("Симпатия взаимна — у вас новый матч 💬", { reply_markup: inlineKeyboard([[inlineButton("Написать", `conversation:open:${match.id}`)]]) });
});
export default composer;
