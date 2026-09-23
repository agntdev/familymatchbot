import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { profileKey, read, remove, userId, type Profile } from "../domain/store.js";

registerMainMenuItem({ label: "Настройки", data: "settings:open", order: 70 });
const composer = new Composer<Ctx>();
composer.callbackQuery("settings:open", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("Здесь можно скрыть анкету или удалить данные.", { reply_markup: inlineKeyboard([[inlineButton("Скрыть или показать", "profile:visibility")], [inlineButton("Удалить аккаунт", "settings:delete")], [inlineButton("⬅️ В меню", "menu:main")]]) }); });
composer.callbackQuery("settings:delete", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("Удалить анкету и личные данные? Это действие нельзя отменить.", { reply_markup: inlineKeyboard([[inlineButton("Да, удалить", "settings:delete:confirm"), inlineButton("Оставить всё", "settings:open")]]) }); });
composer.callbackQuery("settings:delete:confirm", async (ctx) => { await ctx.answerCallbackQuery(); const id = userId(ctx); const p = await read<Profile>(ctx, profileKey(id)); await remove(ctx, profileKey(id)); await remove(ctx, `likes:${id}`); await remove(ctx, `matches:${id}`); await remove(ctx, `messages:${id}`); const owner = adminChatId(ctx); if (owner) { try { await ctx.api.sendMessage(owner, `Пользователь удалил аккаунт: ${id}`); } catch { /* best effort */ } } await ctx.reply(p ? "Анкета и личные данные удалены." : "У вас не было созданной анкеты.", { reply_markup: inlineKeyboard([[inlineButton("Открыть меню", "menu:main")]]) }); });
export default composer;
