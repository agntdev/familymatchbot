import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { DomainStore, profileKey, userId, withTelegramDefaults, now, type Profile } from "../domain.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
registerMainMenuItem({ label: "Настройки", data: "settings:open", order: 60 });
const composer = new Composer<Ctx>();
async function showSettings(ctx: Ctx): Promise<void> { const p = await new DomainStore(ctx).get<Profile>(profileKey(userId(ctx))); const enabled = p ? withTelegramDefaults(p).showTelegramOnMatch : false; await ctx.reply("Настройте видимость профиля и удалите данные, когда захотите.", { reply_markup: inlineKeyboard([[inlineButton("Мой профиль", "profile:manage")], [inlineButton(`Показывать мой Telegram при взаимной симпатии: ${enabled ? "Да" : "Нет"}`, "settings:telegram:toggle")], [inlineButton("Удалить аккаунт", "settings:delete")], [inlineButton("⬅️ В меню", "menu:main")]]) }); }
composer.callbackQuery("settings:open", async (ctx) => { await ctx.answerCallbackQuery(); await showSettings(ctx); });
composer.callbackQuery("menu:settings", async (ctx) => { await ctx.answerCallbackQuery(); await showSettings(ctx); });
composer.callbackQuery("settings:telegram:toggle", async (ctx) => { await ctx.answerCallbackQuery(); const store = new DomainStore(ctx); const stored = await store.get<Profile>(profileKey(userId(ctx))); if (!stored) { await ctx.reply("Сначала создайте профиль."); return; } const p = withTelegramDefaults(stored); p.showTelegramOnMatch = !p.showTelegramOnMatch; p.show_telegram_on_match = p.showTelegramOnMatch; p.updatedAt = now(); await store.set(profileKey(p.userId), p); await ctx.reply(`Показывать мой Telegram при взаимной симпатии: ${p.showTelegramOnMatch ? "Да" : "Нет"}`, { reply_markup: inlineKeyboard([[inlineButton("Настройки", "settings:open")]]) }); });
composer.callbackQuery("settings:delete", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("Скрыть анкету? Данные сохранятся, и вы сможете восстановить её позже.", { reply_markup: inlineKeyboard([[inlineButton("Скрыть анкету", "settings:delete:yes"), inlineButton("Оставить", "settings:open")]]) }); });
composer.callbackQuery("settings:delete:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = userId(ctx);
  const store = new DomainStore(ctx);
  const profile = await store.get<Profile>(profileKey(id));
  if (profile) {
    if (profile.status && !["draft", "active", "hidden", "deleted"].includes(profile.status)) profile.userStatus = profile.status;
    profile.status = "hidden";
    profile.accountStatus = "hidden";
    profile.visibility = false;
    profile.isComplete = true;
    profile.updatedAt = now();
    await store.set(profileKey(id), profile);
  }
  const admin = adminChatId(ctx);
  if (admin) { try { await ctx.api.sendMessage(admin, `Пользователь удалил аккаунт${profile ? `: ${profile.name}` : ""}.`); } catch { /* best effort */ } }
  await ctx.reply("Профиль скрыт. Ваши данные сохранены — вы сможете восстановить анкету из главного меню.", { reply_markup: inlineKeyboard([[inlineButton("В меню", "menu:main")]]) });
});
export default composer;
