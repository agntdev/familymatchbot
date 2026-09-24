import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { DomainStore, normalizeTelegramUsername, now, photoCaption, profileIndexKey, profileKey, telegramUsernameKey, telegramUsernameOwnerKey, userId, type Profile } from "../domain.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { activeRegistrationBlock, blockMessage, enforceViolation, inspectProfileText, recordPolicyAudit, registrationState } from "../content-policy.js";
import { mainMenuFor } from "../main-menu.js";

registerMainMenuItem({ label: "📝 Создать анкету", data: "profile:create:start", order: 10 });
registerMainMenuItem({ label: "♻️ Восстановить анкету", data: "profile:restore", order: 10 });
const composer = new Composer<Ctx>();
const force = (placeholder: string) => ({ force_reply: true as const, input_field_placeholder: placeholder });
const menu = inlineKeyboard([[inlineButton("⬅️ В меню", "menu:main")]]);
const RULES_TEXT = "Правила «Никах»\n\nЗапрещены оскорбления и нецензурная лексика, спам, мошенничество, реклама, непристойный контент, ложные данные и бессмысленные или шуточные анкеты.\n\nПожалуйста, уважайте других участников и заполняйте анкету честно.";
const TELEGRAM_PRIVACY_NOTICE = "🔒 До взаимной симпатии ваш Telegram не видят другие пользователи. Он станет доступен только после взаимной симпатии.";
const rulesKeyboard = () => choose([[inlineButton("✅ Я ознакомлен(а) и согласен(на) с правилами", "profile:rules:accept")]]);

type Draft = NonNullable<Ctx["session"]["draft"]>;
function draft(ctx: Ctx): Draft { return (ctx.session.draft ??= { photos: [] }); }
function choose(rows: ReturnType<typeof inlineButton>[][]): ReturnType<typeof inlineKeyboard> { return inlineKeyboard(rows); }
function previewText(d: Draft): string {
  const telegram = d.telegramUsername ? `📱 Telegram: @${d.telegramUsername}` : "📱 Telegram: не указан";
  const nationality = d.nationality ? `\n🌍 Национальность: ${d.nationality}` : "";
  return `Проверьте профиль\n\n💛 ${d.name}, ${d.age}\n📍 ${d.city}\n💍 ${d.maritalStatus}${nationality}\n💼 ${d.profession}\n📏 ${d.height} см\n📷 Фото: ${d.photos?.length ?? 0}\n${telegram}\n\nО себе: ${d.bio}\n\nЦель знакомства: ${d.purpose}`;
}
function previewKeyboard(): ReturnType<typeof inlineKeyboard> {
  return choose([[inlineButton("Сохранить", "profile:create:save"), inlineButton("Изменить", "profile:create:edit")], [inlineButton("Отменить", "profile:create:cancel")]]);
}
function begin(ctx: Ctx, step: Ctx["session"]["step"]): void { ctx.session.step = step; ctx.session.expiresAt = now() + 15 * 60_000; }
const telegramPrompt = "Пожалуйста, укажите ваш Telegram username в формате @username";
const skipKeyboard = { keyboard: [[{ text: "Пропустить" }]], resize_keyboard: true, one_time_keyboard: true };

// Callback data is user-controlled. Do not rely on the visible button order
// to enforce the mandatory Rules gate.
composer.callbackQuery(/^profile:/, async (ctx, next) => {
  const data = ctx.callbackQuery.data;
  if (data === "profile:create:start" || data === "profile:rules:accept" || !ctx.session.draft?.photos || ctx.session.draft.rulesAccepted) {
    await next();
    return;
  }
  await ctx.answerCallbackQuery();
  begin(ctx, "rules");
  await ctx.reply(RULES_TEXT, { reply_markup: rulesKeyboard() });
});

composer.callbackQuery("profile:create:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  const blocked = await activeRegistrationBlock(ctx);
  const state = await registrationState(ctx);
  if (state.permanent_block) { await ctx.reply(blocked ? blockMessage(blocked) : "Создание анкет для вас заблокировано навсегда.", { reply_markup: await mainMenuFor(ctx) }); return; }
  if (blocked) { await ctx.reply(blockMessage(blocked), { reply_markup: await mainMenuFor(ctx) }); return; }
  const existing = await new DomainStore(ctx).get<Profile>(profileKey(userId(ctx)));
  if (existing) {
    const action = existing.status === "deleted"
      ? inlineButton("♻️ Восстановить анкету", "profile:restore")
      : inlineButton("Мой профиль", "profile:manage");
    await ctx.reply(existing.status === "deleted" ? "Анкета сохранена. Вы можете восстановить её без повторной регистрации." : "У вас уже есть профиль. Откройте «Мой профиль», чтобы изменить его.", { reply_markup: inlineKeyboard([[action], [inlineButton("⬅️ В меню", "menu:main")]]) });
    return;
  }
  ctx.session.draft = { photos: [] }; ctx.session.telegramPrivacyNoticeShown = false; begin(ctx, "rules");
  await ctx.reply(RULES_TEXT, { reply_markup: rulesKeyboard() });
});
composer.callbackQuery("profile:rules:accept", async (ctx) => { await ctx.answerCallbackQuery(); draft(ctx).rulesAccepted = true; begin(ctx, "consent"); await ctx.reply("Серьёзные отношения начинаются с уважения. Вы ищете партнёра для серьёзных отношений и семьи?", { reply_markup: choose([[inlineButton("Да, ищу", "profile:consent:yes"), inlineButton("Пока нет", "profile:consent:no")]]) }); });
composer.callbackQuery("profile:consent:yes", async (ctx) => { await ctx.answerCallbackQuery(); begin(ctx, "name"); await ctx.reply("Как вас зовут?", { reply_markup: force("Введите имя") }); });
composer.callbackQuery("profile:consent:no", async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.step = "idle"; ctx.session.draft = undefined; await ctx.editMessageText("Понимаю. Возвращайтесь, когда будете готовы к серьёзным отношениям.", { reply_markup: await mainMenuFor(ctx) }); });

composer.on("message:text", async (ctx, next) => {
  const text = ctx.message.text.trim(); const d = draft(ctx);
  if (ctx.session.step === "name") { if (text.length < 2 || text.length > 80) { await ctx.reply("Имя должно быть от 2 до 80 символов.", { reply_markup: force("Введите имя") }); return; } d.name = text; begin(ctx, "age"); await ctx.reply("Сколько вам лет? Нужен возраст от 18 до 99 лет.", { reply_markup: force("Введите возраст") }); return; }
  if (ctx.session.step === "age") { const age = Number(text); if (!Number.isInteger(age) || age < 18 || age > 99) { await ctx.reply("Укажите целый возраст от 18 до 99 лет.", { reply_markup: force("Введите возраст") }); return; } d.age = age; begin(ctx, "gender"); await ctx.reply("Как вы себя определяете?", { reply_markup: choose([[inlineButton("Женщина", "profile:gender:f"), inlineButton("Мужчина", "profile:gender:m")], [inlineButton("Другое", "profile:gender:other")]]) }); return; }
  if (ctx.session.step === "city") { d.city = text; begin(ctx, "marital"); await ctx.reply("Каков ваш семейный статус?", { reply_markup: choose([[inlineButton("Не был(а) в браке", "profile:marital:single"), inlineButton("В отношениях", "profile:marital:relationship")], [inlineButton("Разведён(а)", "profile:marital:divorced"), inlineButton("Вдовец или вдова", "profile:marital:widowed")]]) }); return; }
  if (ctx.session.step === "nationality" || ctx.session.step === "nationality_manual") { if (text.length < 1 || text.length > 100) { await ctx.reply("Укажите национальность не длиннее 100 символов.", { reply_markup: force("Введите национальность") }); return; } d.nationality = text; begin(ctx, "profession"); await ctx.reply("Чем вы занимаетесь?", { reply_markup: force("Напишите профессию") }); return; }
  if (["profession", "about", "purpose"].includes(ctx.session.step ?? "")) { const step = ctx.session.step; if (step === "profession") { if (text.length < 2 || text.length > 500) { await ctx.reply("Ответ должен быть от 2 до 500 символов. Попробуйте ещё раз.", { reply_markup: force("Введите ответ") }); return; } d.profession = text; } if (step === "about") { d.bio = text; } if (step === "purpose") { if (text.length < 2 || text.length > 500) { await ctx.reply("Ответ должен быть от 2 до 500 символов. Попробуйте ещё раз.", { reply_markup: force("Введите ответ") }); return; } d.purpose = text; } const nextStep = step === "profession" ? "height" : step === "about" ? "purpose" : "telegram"; begin(ctx, nextStep); if (nextStep === "height") await ctx.reply("Какой у вас рост в сантиметрах?", { reply_markup: force("Например, 170") }); else if (nextStep === "purpose") await ctx.reply("Что вы ищете в отношениях?", { reply_markup: force("Напишите коротко о цели") }); else await askTelegram(ctx); return; }
  if (ctx.session.step === "height") { const height = Number(text); if (!Number.isInteger(height) || height < 120 || height > 230) { await ctx.reply("Укажите рост от 120 до 230 сантиметров.", { reply_markup: force("Например, 170") }); return; } d.height = height; begin(ctx, "about"); await ctx.reply("📝 Расскажите о себе", { reply_markup: force("Напишите о себе") }); return; }
  if (ctx.session.step === "telegram_manual" && ctx.session.editField !== "telegram") {
    if (text === "Пропустить") { d.telegramUsername = null; await showPreview(ctx); return; }
    const username = normalizeTelegramUsername(text);
    if (!username) { await ctx.reply("Некорректный username. Используйте @ и от 5 до 32 латинских букв, цифр или _.", { reply_markup: force("@username") }); return; }
    const result = await reserveUsername(ctx, username);
    if (result === "conflict") { await ctx.reply("Этот username уже используется. Укажите другой username в формате @username.", { reply_markup: force("@username") }); return; }
    // Continue to preview when storage is temporarily unavailable; the final
    // publish step will report that it could not persist the profile.
    d.telegramUsername = username;
    d.usernameConfirmed = true;
    await showPreview(ctx);
    return;
  }
  if (ctx.session.step === "report") { await next(); return; }
  await next();
});

composer.callbackQuery(/^profile:gender:(f|m|other)$/, async (ctx) => { await ctx.answerCallbackQuery(); draft(ctx).gender = ctx.match[1]; begin(ctx, "city"); await ctx.reply("В каком городе вы живёте?", { reply_markup: force("Введите город") }); });
composer.callbackQuery(/^profile:marital:(single|relationship|divorced|widowed)$/, async (ctx) => { await ctx.answerCallbackQuery(); draft(ctx).maritalStatus = ({ single: "Не был(а) в браке", relationship: "В отношениях", divorced: "Разведён(а)", widowed: "Вдовец или вдова" } as Record<string, string>)[ctx.match[1]]; begin(ctx, "photos"); await ctx.reply("Пришлите от 1 до 6 фотографий. Можно отправлять их по одной."); });

const nationalityKeyboard = () => choose([
  [inlineButton("Россия", "profile:nationality:Россия"), inlineButton("Украина", "profile:nationality:Украина")],
  [inlineButton("Казахстан", "profile:nationality:Казахстан"), inlineButton("Узбекистан", "profile:nationality:Узбекистан")],
  [inlineButton("Кыргызстан", "profile:nationality:Кыргызстан"), inlineButton("Таджикистан", "profile:nationality:Таджикистан")],
  [inlineButton("Азербайджан", "profile:nationality:Азербайджан"), inlineButton("Армения", "profile:nationality:Армения")],
  [inlineButton("Беларусь", "profile:nationality:Беларусь"), inlineButton("Грузия", "profile:nationality:Грузия")],
  [inlineButton("Другая — указать", "profile:nationality:other")],
  [inlineButton("Ввести вручную", "profile:nationality:manual")],
]);

composer.callbackQuery(/^profile:nationality:(Россия|Украина|Казахстан|Узбекистан|Кыргызстан|Таджикистан|Азербайджан|Армения|Беларусь|Грузия)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  draft(ctx).nationality = ctx.match[1];
  begin(ctx, "profession");
  await ctx.reply("Чем вы занимаетесь?", { reply_markup: force("Напишите профессию") });
});
composer.callbackQuery("profile:nationality:other", async (ctx) => { await ctx.answerCallbackQuery(); begin(ctx, "nationality_manual"); await ctx.reply("Напишите вашу национальность — до 100 символов.", { reply_markup: force("Введите национальность") }); });
composer.callbackQuery("profile:nationality:manual", async (ctx) => { await ctx.answerCallbackQuery(); begin(ctx, "nationality_manual"); await ctx.reply("Напишите вашу национальность — до 100 символов.", { reply_markup: force("Введите национальность") }); });

async function askTelegram(ctx: Ctx): Promise<void> {
  if (!ctx.session.telegramPrivacyNoticeShown) {
    ctx.session.telegramPrivacyNoticeShown = true;
    await ctx.reply(TELEGRAM_PRIVACY_NOTICE);
  }
  const store = new DomainStore(ctx);
  const savedUsername = await store.get<string | null>(telegramUsernameKey(userId(ctx)));
  if (savedUsername) {
    draft(ctx).telegramUsername = savedUsername;
    draft(ctx).usernameConfirmed = true;
    await showPreview(ctx);
    return;
  }
  const username = ctx.from?.username;
  if (username && normalizeTelegramUsername(`@${username}`)) {
    draft(ctx).telegramUsername = normalizeTelegramUsername(`@${username}`);
    begin(ctx, "telegram");
    await ctx.reply(`📱 Telegram: @${draft(ctx).telegramUsername}`, { reply_markup: choose([[inlineButton("Подтвердить", "profile:telegram:confirm"), inlineButton("Изменить", "profile:telegram:change")]]) });
    return;
  }
  draft(ctx).telegramUsername = null;
  begin(ctx, "telegram_manual");
  await ctx.reply(telegramPrompt, { reply_markup: skipKeyboard });
}

async function reserveUsername(ctx: Ctx, value: string): Promise<"saved" | "conflict" | "unavailable"> {
  const id = userId(ctx);
  const store = new DomainStore(ctx);
  const ownerKey = telegramUsernameOwnerKey(value);
  const owner = await store.get<number>(ownerKey);
  if (owner !== undefined && owner !== id) {
    console.info("telegram username conflict", { username: value.toLowerCase(), owner, attemptedBy: id });
    return "conflict";
  }
  const ownerSaved = owner === id || await store.setIfAbsent(ownerKey, id);
  if (!ownerSaved) return "unavailable";
  const userSaved = await store.set(telegramUsernameKey(id), value);
  if (!userSaved) return "unavailable";
  console.info("telegram username saved", { userId: id, username: value.toLowerCase() });
  return "saved";
}

async function showPreview(ctx: Ctx): Promise<void> {
  begin(ctx, "preview");
  const d = draft(ctx);
  if (d.photos?.[0]) await ctx.replyWithPhoto(d.photos[0], { caption: photoCaption(previewText(d)), reply_markup: previewKeyboard() });
  else await ctx.reply(previewText(d), { reply_markup: previewKeyboard() });
}

composer.callbackQuery("profile:telegram:confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  const value = draft(ctx).telegramUsername;
  if (!value) { await ctx.reply(telegramPrompt, { reply_markup: force("@username") }); return; }
  const result = await reserveUsername(ctx, value);
  if (result === "conflict") { begin(ctx, "telegram_manual"); await ctx.reply("Этот username уже используется. Укажите другой username в формате @username.", { reply_markup: force("@username") }); return; }
  // The final publish step remains the durable checkpoint during an outage.
  draft(ctx).usernameConfirmed = true;
  await showPreview(ctx);
});
composer.callbackQuery("profile:telegram:change", async (ctx) => { await ctx.answerCallbackQuery(); begin(ctx, "telegram_manual"); if (!ctx.session.telegramPrivacyNoticeShown) { ctx.session.telegramPrivacyNoticeShown = true; await ctx.reply(TELEGRAM_PRIVACY_NOTICE); } await ctx.reply(telegramPrompt, { reply_markup: force("@username") }); });

composer.on("message:photo", async (ctx, next) => {
  if (ctx.session.step !== "photos" || !ctx.session.draft) { await next(); return; }
  const photo = ctx.message.photo.at(-1); if (!photo) { await ctx.reply("Не удалось получить фото. Отправьте его ещё раз."); return; }
  const photos = draft(ctx).photos ?? []; if (photos.length >= 6) { await ctx.reply("Можно добавить не больше 6 фотографий.", { reply_markup: choose([[inlineButton("Продолжить", "profile:photos:done")]]) }); return; }
  photos.push(photo.file_id); draft(ctx).photos = photos;
  await ctx.reply(`Фото добавлено: ${photos.length}/6.`, { reply_markup: choose([[inlineButton("Добавить ещё", "profile:photos:add")], [inlineButton("Готово", "profile:photos:done")]]) });
});
composer.callbackQuery("profile:photos:add", async (ctx) => { await ctx.answerCallbackQuery(); begin(ctx, "photos"); await ctx.reply("Пришлите следующую фотографию."); });
composer.callbackQuery("profile:photos:done", async (ctx) => { await ctx.answerCallbackQuery(); if ((draft(ctx).photos?.length ?? 0) < 1) { await ctx.reply("Добавьте хотя бы одну фотографию — так вас легче узнать."); return; } begin(ctx, "nationality"); await ctx.reply("Укажите вашу национальность.", { reply_markup: nationalityKeyboard() }); });

composer.callbackQuery("profile:create:edit", async (ctx) => { await ctx.answerCallbackQuery(); begin(ctx, "name"); await ctx.reply("Начнём с имени. Введите новое имя.", { reply_markup: force("Введите имя") }); });
composer.callbackQuery("profile:create:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  ctx.session.draft = undefined;
  const text = "Создание профиля отменено. Вы сможете вернуться к нему в любой момент.";
  const mainMenu = await mainMenuFor(ctx);
  if (ctx.callbackQuery.message?.text !== undefined) await ctx.editMessageText(text, { reply_markup: mainMenu });
  else await ctx.reply(text, { reply_markup: mainMenu });
});
composer.callbackQuery("profile:create:save", async (ctx) => {
  await ctx.answerCallbackQuery(); const d = draft(ctx);
  if (!d.rulesAccepted) { begin(ctx, "rules"); await ctx.reply(RULES_TEXT, { reply_markup: rulesKeyboard() }); return; }
  const blocked = await activeRegistrationBlock(ctx); if (blocked) { await ctx.reply(blockMessage(blocked), { reply_markup: await mainMenuFor(ctx) }); return; }
  const required = d.name && d.age && d.city && d.photos?.length && d.maritalStatus && d.nationality && d.profession && d.height && d.bio && d.purpose && d.telegramUsername !== undefined;
  if (!required) { await ctx.reply("Профиль ещё не заполнен. Вернитесь к изменению и добавьте все поля."); return; }
  const decision = inspectProfileText({ name: d.name, nationality: d.nationality, profession: d.profession, purpose: d.purpose });
  await recordPolicyAudit(ctx, decision.kind === "allowed" ? "allowed" : "allowed-with-suggestion", decision);
  if (decision.kind === "suggestion") { await ctx.reply(decision.message!, { reply_markup: previewKeyboard() }); return; }
  if (decision.kind === "explicit") { const event = await enforceViolation(ctx, decision); ctx.session.step = "idle"; ctx.session.draft = undefined; await ctx.reply(blockMessage(event!), { reply_markup: await mainMenuFor(ctx) }); return; }
  const timestamp = now(); const telegramUsername = d.telegramUsername ?? null; const usernameConfirmed = telegramUsername !== null && d.usernameConfirmed === true; const profile: Profile = { userId: userId(ctx), name: d.name!, age: d.age!, gender: d.gender ?? "other", city: d.city!, photos: d.photos!, bio: d.bio!, maritalStatus: d.maritalStatus!, nationality: d.nationality!, profession: d.profession!, height: d.height!, purpose: d.purpose!, relationshipIntent: "serious", visibility: true, isComplete: true, status: "active", telegramUsername, telegramUsernameConfirmed: usernameConfirmed, telegram_username: telegramUsername, telegram_username_confirmed: usernameConfirmed, showTelegramOnMatch: false, show_telegram_on_match: false, createdAt: timestamp, updatedAt: timestamp };
  const store = new DomainStore(ctx);
  // The profile key is the per-Telegram-ID uniqueness boundary. Never replace
  // a deleted or active record with a newly submitted registration.
  const existing = await store.get<Profile>(profileKey(profile.userId));
  if (existing) {
    await ctx.reply(existing.status === "deleted" ? "Анкета уже сохранена. Восстановите её из главного меню." : "У вас уже есть профиль. Откройте «Мой профиль», чтобы изменить его.", { reply_markup: await mainMenuFor(ctx) });
    return;
  }
  const saved = await store.setIfAbsent(profileKey(profile.userId), profile);
  const ids = await store.get<number[]>(profileIndexKey()) ?? [];
  if (saved && !ids.includes(profile.userId)) await store.set(profileIndexKey(), [...ids, profile.userId]);
  if (!saved) {
    await ctx.reply(d.telegramUsername ? "Ошибка: не удалось сохранить Telegram. Попробуйте ещё раз." : "Профиль готов, но хранилище пока недоступно. Попробуйте сохранить ещё раз позже.", { reply_markup: d.telegramUsername ? previewKeyboard() : menu });
    return;
  }
  const admin = adminChatId(ctx); if (admin) { try { await ctx.api.sendMessage(admin, `Новая анкета: ${profile.name}, ${profile.age}, ${profile.city}`); } catch { /* delivery is best effort */ } }
  ctx.session.step = "idle"; ctx.session.draft = undefined;
  await ctx.reply("Профиль сохранён и опубликован. Желаю вам добрых знакомств.", { reply_markup: await mainMenuFor(ctx) });
});

composer.callbackQuery("profile:restore", async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = userId(ctx);
  const store = new DomainStore(ctx);
  const profile = await store.get<Profile>(profileKey(id));
  if (!profile) {
    await ctx.reply("Сохранённой анкеты нет. Создайте новую анкету.", { reply_markup: await mainMenuFor(ctx) });
    return;
  }
  if (profile.status !== "deleted") {
    await ctx.reply("Ваша анкета уже активна.", { reply_markup: await mainMenuFor(ctx) });
    return;
  }
  profile.status = "active";
  profile.visibility = true;
  profile.isComplete = true;
  profile.updatedAt = now();
  if (!(await store.set(profileKey(id), profile))) {
    await ctx.reply("Не получилось восстановить анкету. Попробуйте ещё раз через минуту.");
    return;
  }
  const ids = await store.get<number[]>(profileIndexKey()) ?? [];
  if (!ids.includes(id)) await store.set(profileIndexKey(), [...ids, id]);
  ctx.session.step = "idle";
  ctx.session.draft = undefined;
  await ctx.reply("Анкета восстановлена — она снова видна в знакомствах.", { reply_markup: await mainMenuFor(ctx) });
});
export default composer;
