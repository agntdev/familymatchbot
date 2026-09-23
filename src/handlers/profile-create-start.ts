import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { now, saveProfile, userId, type Profile } from "../domain/store.js";

registerMainMenuItem({ label: "Создать профиль", data: "profile:create:start", order: 10 });
const composer = new Composer<Ctx>();
const force = (placeholder: string) => ({ force_reply: true as const, input_field_placeholder: placeholder });

composer.callbackQuery("profile:create:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "profile:consent";
  ctx.session.draft = {};
  await ctx.reply("Здесь знакомятся для серьёзных отношений и семьи. Вам уже исполнилось 18 лет и вы ищете серьёзные отношения?", {
    reply_markup: inlineKeyboard([[inlineButton("Да, продолжить", "profile:consent:yes"), inlineButton("Нет", "profile:consent:no")]]),
  });
});

composer.callbackQuery("profile:consent:no", async (ctx) => {
  await ctx.answerCallbackQuery(); ctx.session.step = undefined; ctx.session.draft = undefined;
  await ctx.reply("Понимаю. Вернитесь, когда будете готовы искать серьёзные отношения.");
});
composer.callbackQuery("profile:consent:yes", async (ctx) => {
  await ctx.answerCallbackQuery(); ctx.session.step = "profile:name";
  await ctx.reply("Как вас зовут? Напишите имя.", { reply_markup: force("Ваше имя") });
});

composer.callbackQuery(/^profile:gender:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const gender = ctx.match[1]; ctx.session.draft ??= {}; ctx.session.draft.gender = gender;
  ctx.session.step = "profile:city";
  await ctx.reply("В каком городе вы живёте?", { reply_markup: force("Ваш город") });
});
composer.callbackQuery(/^profile:prefgender:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); ctx.session.draft ??= {}; ctx.session.draft.preferredGender = ctx.match[1];
  ctx.session.step = "profile:preview"; await preview(ctx);
});
composer.callbackQuery("profile:publish", async (ctx) => {
  await ctx.answerCallbackQuery();
  const d = ctx.session.draft ?? {}; const id = userId(ctx);
  const profile: Profile = { userId: id, name: String(d.name), age: Number(d.age), gender: String(d.gender), city: String(d.city), photos: (d.photos as string[]) ?? [], bio: String(d.bio), serious: true, visibility: true, preferredAge: String(d.preferredAge ?? ""), preferredGender: String(d.preferredGender ?? "Любой"), createdAt: now(), updatedAt: now() };
  await saveProfile(ctx, profile); ctx.session.step = undefined; ctx.session.draft = undefined;
  await ctx.reply("Профиль опубликован. Теперь вас смогут увидеть подходящие люди.", { reply_markup: inlineKeyboard([[inlineButton("Смотреть анкеты", "browse:start"), inlineButton("Мой профиль", "profile:manage")]]) });
  const owner = adminChatId(ctx); if (owner) { try { await ctx.api.sendMessage(owner, `Новая анкета: ${profile.name}, ${profile.age}, ${profile.city}.`); } catch { /* delivery is best effort */ } }
});
composer.callbackQuery("profile:publish:edit", async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.step = "profile:name"; await ctx.reply("Что изменим? Начнём с имени.", { reply_markup: force("Ваше имя") }); });

composer.on("message:photo", async (ctx) => {
  if (ctx.session.step !== "profile:photos") return;
  const photos = (ctx.session.draft?.photos as string[] | undefined) ?? [];
  const photo = ctx.message.photo.at(-1); if (!photo) { await ctx.reply("Не удалось получить фото. Отправьте его ещё раз."); return; }
  if (photos.length >= 6) { await ctx.reply("Можно добавить не больше 6 фото."); return; }
  photos.push(photo.file_id); ctx.session.draft ??= {}; ctx.session.draft.photos = photos;
  await ctx.reply(photos.length < 1 ? "Нужно хотя бы одно фото." : `Фото добавлено: ${photos.length}. Отправьте ещё или нажмите «Готово».`, { reply_markup: inlineKeyboard([[inlineButton("Готово", "profile:photos:done")]]) });
});
composer.callbackQuery("profile:photos:done", async (ctx) => {
  await ctx.answerCallbackQuery(); const photos = (ctx.session.draft?.photos as string[] | undefined) ?? [];
  if (!photos.length) { await ctx.reply("Добавьте хотя бы одно фото — так вас легче узнать."); return; }
  ctx.session.step = "profile:bio"; await ctx.reply("Расскажите немного о себе — коротко и искренне.", { reply_markup: force("Ваш рассказ") });
});

composer.on("message:text", async (ctx, next) => {
  const step = ctx.session.step; const text = ctx.message.text.trim(); ctx.session.draft ??= {};
  if (!step || !step.startsWith("profile:")) return next();
  if (step === "profile:name") { if (!text) { await ctx.reply("Имя не может быть пустым. Напишите его ещё раз."); return; } ctx.session.draft.name = text; ctx.session.step = "profile:age"; await ctx.reply("Сколько вам лет? В SeriousMatch могут участвовать только взрослые 18+.", { reply_markup: force("Ваш возраст") }); return; }
  if (step === "profile:age") { const age = Number(text); if (!Number.isInteger(age) || age < 18 || age > 100) { await ctx.reply("Укажите целое число от 18 до 100."); return; } ctx.session.draft.age = age; ctx.session.step = "profile:gender"; await ctx.reply("Как вы себя определяете?", { reply_markup: inlineKeyboard([[inlineButton("Женщина", "profile:gender:woman"), inlineButton("Мужчина", "profile:gender:man")], [inlineButton("Другое", "profile:gender:other")]]) }); return; }
  if (step === "profile:city") { if (text.length < 2) { await ctx.reply("Напишите город чуть подробнее."); return; } ctx.session.draft.city = text; ctx.session.step = "profile:photos"; ctx.session.draft.photos = []; await ctx.reply("Пришлите 1–6 фотографий. Лучше начать с 1–3, а когда закончите — нажмите «Готово»."); return; }
  if (step === "profile:bio") { if (text.length < 10) { await ctx.reply("Добавьте пару предложений — так будет проще начать разговор."); return; } ctx.session.draft.bio = text; ctx.session.step = "profile:preferences"; await ctx.reply("Какой возраст партнёра вам подходит?", { reply_markup: inlineKeyboard([[inlineButton("18–30", "profile:prefage:18-30"), inlineButton("31–45", "profile:prefage:31-45")], [inlineButton("46+", "profile:prefage:46-plus"), inlineButton("Любой", "profile:prefage:any")]]) }); return; }
  if (step === "profile:preferences") { await ctx.reply("Выберите возраст кнопкой выше."); return; }
  return next();
});
composer.callbackQuery(/^profile:prefage:(.+)$/, async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.draft ??= {}; ctx.session.draft.preferredAge = ctx.match[1]; ctx.session.step = "profile:preview"; await ctx.reply("Какой пол партнёра вам подходит?", { reply_markup: inlineKeyboard([[inlineButton("Женщина", "profile:prefgender:woman"), inlineButton("Мужчина", "profile:prefgender:man")], [inlineButton("Любой", "profile:prefgender:any")]]) }); });

async function preview(ctx: Ctx): Promise<void> {
  const d = ctx.session.draft ?? {}; await ctx.reply(`Проверьте анкету:\n${String(d.name)}, ${String(d.age)}\n${String(d.city)}\n\n${String(d.bio)}`, { reply_markup: inlineKeyboard([[inlineButton("Опубликовать", "profile:publish"), inlineButton("Изменить", "profile:publish:edit")]]) });
}

export default composer;
