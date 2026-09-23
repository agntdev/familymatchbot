import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { DomainStore, matchesKey, profileIndexKey, profileKey, searchFiltersKey, userId, withTelegramDefaults, now, type Profile } from "../domain.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
registerMainMenuItem({ label: "Настройки", data: "settings:open", order: 60 });
const composer = new Composer<Ctx>();
composer.callbackQuery("settings:open", async (ctx) => { await ctx.answerCallbackQuery(); const p = await new DomainStore(ctx).get<Profile>(profileKey(userId(ctx))); const enabled = p ? withTelegramDefaults(p).showTelegramOnMatch : false; await ctx.reply("Настройте видимость профиля и удалите данные, когда захотите.", { reply_markup: inlineKeyboard([[inlineButton("Мой профиль", "profile:manage")], [inlineButton(`Показывать мой Telegram при взаимной симпатии: ${enabled ? "Да" : "Нет"}`, "settings:telegram:toggle")], [inlineButton("Удалить аккаунт", "settings:delete")], [inlineButton("⬅️ В меню", "menu:main")]]) }); });
composer.callbackQuery("settings:telegram:toggle", async (ctx) => { await ctx.answerCallbackQuery(); const store = new DomainStore(ctx); const stored = await store.get<Profile>(profileKey(userId(ctx))); if (!stored) { await ctx.reply("Сначала создайте профиль."); return; } const p = withTelegramDefaults(stored); p.showTelegramOnMatch = !p.showTelegramOnMatch; p.show_telegram_on_match = p.showTelegramOnMatch; p.updatedAt = now(); await store.set(profileKey(p.userId), p); await ctx.reply(`Показывать мой Telegram при взаимной симпатии: ${p.showTelegramOnMatch ? "Да" : "Нет"}`, { reply_markup: inlineKeyboard([[inlineButton("Настройки", "settings:open")]]) }); });
composer.callbackQuery("settings:delete", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("Удалить анкету и сообщения без возможности восстановления?", { reply_markup: inlineKeyboard([[inlineButton("Удалить всё", "settings:delete:yes"), inlineButton("Оставить", "settings:open")]]) }); });
composer.callbackQuery("settings:delete:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = userId(ctx);
  const store = new DomainStore(ctx);
  const profile = await store.get<Profile>(profileKey(id));
  const ids = await store.get<number[]>(profileIndexKey()) ?? [];
  const matchIds = await store.get<string[]>(matchesKey(id)) ?? [];
  for (const candidate of ids) {
    if (candidate === id) continue;
    const likes = await store.get<Array<{ from_user_id?: number; to_user_id?: number; from?: number; to?: number }>>(`likes:${candidate}`) ?? [];
    await store.set(`likes:${candidate}`, likes.filter((like) => (like.to_user_id ?? like.to) !== id && (like.from_user_id ?? like.from) !== id));
  }
  for (const matchId of matchIds) {
    const match = await store.get<{ user_a_id?: number; user_b_id?: number }>(`match:${matchId}`);
    const other = match && (match.user_a_id === id ? match.user_b_id : match.user_a_id);
    if (other) {
      const otherMatches = await store.get<string[]>(matchesKey(other)) ?? [];
      await store.set(matchesKey(other), otherMatches.filter((value) => value !== matchId));
      try { await ctx.api.sendMessage(other, "Пользователь удалил профиль. Этот разговор больше недоступен."); } catch { /* blocked users are safe to ignore */ }
    }
    await store.delete(`messages:${matchId}`);
    await store.delete(`match:${matchId}`);
  }
  await store.delete(profileKey(id));
  await store.delete(searchFiltersKey(id));
  await store.delete(`likes:${id}`);
  await store.delete(matchesKey(id));
  await store.set(profileIndexKey(), ids.filter((candidate) => candidate !== id));
  const admin = adminChatId(ctx);
  if (admin) { try { await ctx.api.sendMessage(admin, `Пользователь удалил аккаунт${profile ? `: ${profile.name}` : ""}.`); } catch { /* best effort */ } }
  await ctx.reply("Ваш аккаунт удалён. Спасибо за доверие.", { reply_markup: inlineKeyboard([[inlineButton("В меню", "menu:main")]]) });
});
export default composer;
