import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { DomainStore, now, profileKey, userId, profileSummary, type Profile } from "../domain.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

registerMainMenuItem({ label: "Мой профиль", data: "profile:manage", order: 30 });
const composer = new Composer<Ctx>();
composer.callbackQuery("profile:manage", async (ctx) => {
  await ctx.answerCallbackQuery(); const p = await new DomainStore(ctx).get<Profile>(profileKey(userId(ctx)));
  if (!p) { if (!await new DomainStore(ctx).available()) { await ctx.reply("View and edit your profile, visibility and preferences"); return; } await ctx.reply("У вас пока нет анкеты — создайте её за несколько шагов.", { reply_markup: inlineKeyboard([[inlineButton("Создать профиль", "profile:create:start")], [inlineButton("⬅️ В меню", "menu:main")]]) }); return; }
  await ctx.reply(profileSummary(p), { reply_markup: inlineKeyboard([[inlineButton("Изменить описание", "profile:edit:bio")], [inlineButton(p.visibility ? "Скрыть анкету" : "Показать анкету", "profile:visibility:toggle")], [inlineButton("⬅️ В меню", "menu:main")]]) });
});
composer.callbackQuery("profile:visibility:toggle", async (ctx) => { await ctx.answerCallbackQuery(); const store = new DomainStore(ctx); const p = await store.get<Profile>(profileKey(userId(ctx))); if (!p) { await ctx.reply("Сначала создайте анкету."); return; } p.visibility = !p.visibility; p.updatedAt = now(); await store.set(profileKey(p.userId), p); await ctx.editMessageText(p.visibility ? "Анкета снова видна другим пользователям." : "Анкета скрыта. Её не будут показывать в знакомствах.", { reply_markup: inlineKeyboard([[inlineButton("⬅️ В меню", "menu:main")]]) }); });
composer.callbackQuery("profile:edit:bio", async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.step = "edit_bio"; await ctx.reply("Напишите новое описание.", { reply_markup: { force_reply: true, input_field_placeholder: "Расскажите о себе" } }); });
composer.on("message:text", async (ctx, next) => { if (ctx.session.step !== "edit_bio") { await next(); return; } const text = ctx.message.text.trim(); if (text.length < 10 || text.length > 500) { await ctx.reply("Описание должно быть от 10 до 500 символов."); return; } const store = new DomainStore(ctx); const p = await store.get<Profile>(profileKey(userId(ctx))); if (p) { p.bio = text; p.updatedAt = now(); await store.set(profileKey(p.userId), p); } ctx.session.step = "idle"; await ctx.reply("Описание обновлено.", { reply_markup: inlineKeyboard([[inlineButton("Мой профиль", "profile:manage")]]) }); });
export default composer;
