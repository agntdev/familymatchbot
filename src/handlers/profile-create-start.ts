import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { DomainStore, now, profileKey, userId, type Profile } from "../domain.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

registerMainMenuItem({ label: "Создать профиль", data: "profile:create:start", order: 10 });
const composer = new Composer<Ctx>();
const force = (placeholder: string) => ({ force_reply: true as const, input_field_placeholder: placeholder });
const menu = inlineKeyboard([[inlineButton("⬅️ В меню", "menu:main")]]);

composer.callbackQuery("profile:create:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "consent";
  ctx.session.draft = { photos: [] };
  await ctx.reply("Begin the guided profile creation wizard", { reply_markup: inlineKeyboard([[inlineButton("Да, ищу", "profile:consent:yes"), inlineButton("Нет", "profile:consent:no")]]) });
});

composer.callbackQuery("profile:consent:yes", async (ctx) => {
  await ctx.answerCallbackQuery(); ctx.session.step = "name";
  await ctx.reply("Как вас зовут?", { reply_markup: force("Введите имя") });
});
composer.callbackQuery("profile:consent:no", async (ctx) => {
  await ctx.answerCallbackQuery(); ctx.session.step = "idle";
  await ctx.editMessageText("Понимаю. Профиль можно создать, когда вы будете готовы к серьёзным отношениям.", { reply_markup: menu });
});

composer.on("message:text", async (ctx, next) => {
  const step = ctx.session.step;
  const text = ctx.message.text.trim();
  if (step === "name") {
    if (text.length < 2 || text.length > 80) { await ctx.reply("Имя должно быть от 2 до 80 символов. Попробуйте ещё раз.", { reply_markup: force("Введите имя") }); return; }
    ctx.session.draft = { ...(ctx.session.draft ?? {}), name: text }; ctx.session.step = "age";
    await ctx.reply("Сколько вам лет? Нужен возраст от 18 лет.", { reply_markup: force("Введите возраст") }); return;
  }
  if (step === "age") {
    const age = Number(text);
    if (!Number.isInteger(age) || age < 18 || age > 120) { await ctx.reply("Для участия нужен возраст от 18 лет. Введите число ещё раз.", { reply_markup: force("Введите возраст") }); return; }
    ctx.session.draft = { ...(ctx.session.draft ?? {}), age }; ctx.session.step = "gender";
    await ctx.reply("Как вы себя определяете?", { reply_markup: inlineKeyboard([[inlineButton("Женщина", "profile:gender:f"), inlineButton("Мужчина", "profile:gender:m")], [inlineButton("Другое", "profile:gender:other")]]) }); return;
  }
  if (step === "city") {
    if (text.length < 2 || text.length > 80) { await ctx.reply("Не удалось распознать город. Напишите его ещё раз.", { reply_markup: force("Введите город") }); return; }
    ctx.session.draft = { ...(ctx.session.draft ?? {}), city: text }; ctx.session.step = "photos";
    await ctx.reply("Отправьте от 1 до 6 фотографий. Можно прислать их сообщениями по одной."); return;
  }
  if (step === "bio") {
    if (text.length < 10 || text.length > 500) { await ctx.reply("Расскажите о себе в 10–500 символах.", { reply_markup: force("Напишите коротко о себе") }); return; }
    ctx.session.draft = { ...(ctx.session.draft ?? {}), bio: text }; ctx.session.step = "preferences";
    await ctx.reply("Какой возраст партнёра вам подходит?", { reply_markup: inlineKeyboard([[inlineButton("18–30", "profile:pref:18:30"), inlineButton("25–40", "profile:pref:25:40")], [inlineButton("30–50", "profile:pref:30:50"), inlineButton("Любой", "profile:pref:any")]]) }); return;
  }
  if (step === "report") {
    const target = ctx.session.activeTargetId;
    const store = new DomainStore(ctx);
    const profile = target ? await store.get<Profile>(profileKey(target)) : undefined;
    if (target && profile) {
      const id = `${userId(ctx)}-${now()}`;
      await store.set(`report:${id}`, { id, reporter: userId(ctx), target, reason: ctx.session.reportReason ?? "Другое", details: text, snapshot: profile, at: now() });
      const admin = adminChatId(ctx);
      if (admin) { try { await ctx.api.sendMessage(admin, `Новая жалоба\nПричина: ${ctx.session.reportReason ?? "Другое"}\nПрофиль: ${profile.name}, ${profile.age}, ${profile.city}`); } catch { /* a blocked owner must not break the reporter's flow */ } }
    }
    ctx.session.step = "idle"; await ctx.reply("Спасибо, что сообщили. Мы проверим профиль и примем меры.", { reply_markup: menu }); return;
  }
  if (step === "message") {
    await next(); return;
  }
  await next();
});

composer.callbackQuery(/^profile:gender:(f|m|other)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); const gender = ctx.match[1];
  ctx.session.draft = { ...(ctx.session.draft ?? {}), gender }; ctx.session.step = "city";
  await ctx.reply("В каком городе вы живёте?", { reply_markup: force("Введите город") });
});

composer.on("message:photo", async (ctx) => {
  if (ctx.session.step !== "photos") return;
  const photo = ctx.message.photo.at(-1);
  if (!photo) { await ctx.reply("Не удалось получить фото. Отправьте его ещё раз."); return; }
  const photos = [...(ctx.session.draft?.photos ?? []), photo.file_id].slice(0, 6);
  ctx.session.draft = { ...(ctx.session.draft ?? {}), photos };
  if (photos.length === 1) await ctx.reply("Фото получено. Добавьте ещё или нажмите «Готово».", { reply_markup: inlineKeyboard([[inlineButton("Готово", "profile:photos:done")]]) });
  else if (photos.length < 6) await ctx.reply(`Фото ${photos.length}/6 получено. Добавьте ещё или нажмите «Готово».`, { reply_markup: inlineKeyboard([[inlineButton("Готово", "profile:photos:done")]]) });
});

composer.callbackQuery("profile:photos:done", async (ctx) => {
  await ctx.answerCallbackQuery();
  if ((ctx.session.draft?.photos?.length ?? 0) < 1) { await ctx.reply("Нужна хотя бы одна фотография, чтобы продолжить."); return; }
  ctx.session.step = "bio"; await ctx.reply("Напишите несколько слов о себе.", { reply_markup: force("Напишите коротко о себе") });
});

composer.callbackQuery(/^profile:pref:(\d+):(\d+|any)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); const [, from, to] = ctx.match;
  ctx.session.draft = { ...(ctx.session.draft ?? {}), preferredAgeFrom: to === "any" ? 18 : Number(from), preferredAgeTo: to === "any" ? 120 : Number(to), preferredGender: "any" };
  ctx.session.step = "preview"; const d = ctx.session.draft;
  await ctx.reply(`Проверьте профиль:\n\n${d?.name}, ${d?.age} — ${d?.city}\n\n${d?.bio}`, { reply_markup: inlineKeyboard([[inlineButton("Опубликовать", "profile:publish"), inlineButton("Изменить", "profile:create:start")]]) });
});

composer.callbackQuery("profile:publish", async (ctx) => {
  await ctx.answerCallbackQuery(); const d = ctx.session.draft;
  if (!d?.name || !d.age || !d.gender || !d.city || !d.bio || !(d.photos?.length)) { await ctx.reply("Профиль ещё не заполнен. Давайте начнём заново."); return; }
  const profile: Profile = { userId: userId(ctx), name: d.name, age: d.age, gender: d.gender, city: d.city, photos: d.photos, bio: d.bio, relationshipIntent: "serious", preferredAgeFrom: d.preferredAgeFrom, preferredAgeTo: d.preferredAgeTo, preferredGender: d.preferredGender, visibility: true, createdAt: now(), updatedAt: now() };
  const store = new DomainStore(ctx);
  const saved = await store.set(profileKey(profile.userId), profile);
  const index = await store.get<number[]>("profiles:index") ?? [];
  if (!index.includes(profile.userId)) await store.set("profiles:index", [...index, profile.userId]);
  const admin = adminChatId(ctx);
  if (admin) { try { await ctx.api.sendMessage(admin, `Новая анкета: ${profile.name}, ${profile.age}, ${profile.city}`); } catch { /* delivery is best effort */ } }
  ctx.session.step = "idle"; ctx.session.draft = undefined;
  await ctx.reply(saved ? "Готово — ваша анкета опубликована. Теперь можно знакомиться." : "Готово — анкета опубликована в этом сеансе. Хранилище пока не подключено.", { reply_markup: menu });
});

export default composer;
