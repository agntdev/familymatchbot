import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  DomainStore,
  eventsKey,
  canonicalMatchId,
  likeTo,
  likesKey,
  likeIndexKey,
  likeKey,
  makeLike,
  makeMatch,
  matchA,
  matchB,
  matchesKey,
  matchKey,
  now,
  profileIndexKey,
  profileKey,
  reportKey,
  skipsKey,
  userId,
  type Like,
  type Match,
  type Profile,
} from "../domain.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

registerMainMenuItem({ label: "Знакомства", data: "browse:start", order: 20 });
const composer = new Composer<Ctx>();
const back = inlineKeyboard([[inlineButton("⬅️ В меню", "menu:main")]]);

function actionKeyboard(target: number, includeReport = false) {
  const rows = [[
    inlineButton("❤️ Нравится", `browse:like:${target}`),
    inlineButton("❌ Пропустить", `browse:pass:${target}`),
    inlineButton("👤 Подробнее", `browse:view:${target}`),
  ]];
  if (includeReport) rows.push([inlineButton("Пожаловаться", `browse:report:${target}`)]);
  rows.push([inlineButton("⬅️ В меню", "menu:main")]);
  return inlineKeyboard(rows);
}

function cardText(profile: Profile): string {
  return `${profile.name}, ${profile.age}\n📍 ${profile.city}\n\n${profile.bio}`;
}

function fullProfileText(profile: Profile): string {
  const optional = [
    profile.childrenPreference ? `Дети: ${profile.childrenPreference}` : "",
    profile.religionValues ? `Ценности: ${profile.religionValues}` : "",
    profile.smokingDrinking ? `Курение и алкоголь: ${profile.smokingDrinking}` : "",
  ].filter(Boolean);
  return `${profile.name}, ${profile.age}\n📍 ${profile.city}\n\n` +
    `Семейный статус: ${profile.maritalStatus}\n` +
    `Образование: ${profile.education}\n` +
    `Профессия: ${profile.profession}\n` +
    `Рост: ${profile.height} см\n` +
    (optional.length ? `${optional.join("\n")}\n` : "") +
    `\nО себе:\n${profile.bio}\n\nЦель знакомства:\n${profile.purpose}`;
}

async function recordEvent(ctx: Ctx, type: "view" | "like" | "skip", target: number): Promise<void> {
  const store = new DomainStore(ctx);
  const at = now();
  const id = `${type}:${userId(ctx)}:${target}:${at}`;
  const index = await store.get<string[]>(eventsKey()) ?? [];
  if (!index.includes(id)) {
    await store.set(`event:${id}`, { id, type, actor: userId(ctx), target, at });
    await store.set(eventsKey(), [...index, id]);
  }
}

function ageMatches(viewer: Profile | undefined, candidate: Profile): boolean {
  if (!viewer) return true;
  if (viewer.preferredAgeFrom !== undefined && candidate.age < viewer.preferredAgeFrom) return false;
  if (viewer.preferredAgeTo !== undefined && candidate.age > viewer.preferredAgeTo) return false;
  if (viewer.preferredGender && viewer.preferredGender !== "any" && candidate.gender !== viewer.preferredGender) return false;
  return true;
}

async function excluded(store: DomainStore, viewer: number, candidate: number): Promise<boolean> {
  const viewerProfile = await store.get<Profile>(profileKey(viewer));
  if (viewerProfile?.blockedUserIds?.includes(candidate)) return true;
  const ownLikes = await store.get<Like[]>(likesKey(viewer)) ?? [];
  if (ownLikes.some((like) => likeTo(like) === candidate && like.status !== "ignored")) return true;
  const skipped = await store.get<number[]>(skipsKey(viewer)) ?? [];
  if (skipped.includes(candidate)) return true;
  const theirSkips = await store.get<number[]>(skipsKey(candidate)) ?? [];
  if (theirSkips.includes(viewer)) return true;
  const matchIds = await store.get<string[]>(matchesKey(viewer)) ?? [];
  for (const id of matchIds) {
    const match = await store.get<Match>(matchKey(id));
    if (match?.active && ((matchA(match) === viewer && matchB(match) === candidate) || (matchA(match) === candidate && matchB(match) === viewer))) return true;
  }
  const candidateProfile = await store.get<Profile>(profileKey(candidate));
  return candidateProfile?.blockedUserIds?.includes(viewer) === true;
}

async function sendCard(ctx: Ctx, profile: Profile): Promise<void> {
  await recordEvent(ctx, "view", profile.userId);
  ctx.session.activeTargetId = profile.userId;
  if (profile.photos[0]) {
    await ctx.replyWithPhoto(profile.photos[0], { caption: cardText(profile), reply_markup: actionKeyboard(profile.userId) });
  } else {
    await ctx.reply(cardText(profile), { reply_markup: actionKeyboard(profile.userId) });
  }
}

async function nextProfile(ctx: Ctx): Promise<void> {
  const store = new DomainStore(ctx);
  const ids = await store.get<number[]>(profileIndexKey()) ?? [];
  const mine = userId(ctx);
  const viewer = await store.get<Profile>(profileKey(mine));
  for (const id of ids) {
    if (id === mine) continue;
    const profile = await store.get<Profile>(profileKey(id));
    if (!profile?.visibility || !ageMatches(viewer, profile) || await excluded(store, mine, id)) continue;
    await sendCard(ctx, profile);
    return;
  }
  await ctx.reply("Пока подходящих анкет нет — загляните позже.", { reply_markup: back });
}

async function ensureTarget(ctx: Ctx, target: number): Promise<Profile | undefined> {
  const profile = await new DomainStore(ctx).get<Profile>(profileKey(target));
  if (!profile || !profile.visibility || target === userId(ctx)) return undefined;
  return profile;
}

async function createMatch(ctx: Ctx, target: number): Promise<Match | undefined> {
  const store = new DomainStore(ctx);
  const me = userId(ctx);
  if (me === target) return undefined;
  const mine = await store.get<Profile>(profileKey(me));
  const theirs = await store.get<Profile>(profileKey(target));
  if (!mine || !theirs || !mine.visibility || !theirs.visibility) return undefined;
  if (mine.blockedUserIds?.includes(target) || theirs.blockedUserIds?.includes(me)) return undefined;
  const theirLikes = await store.get<Like[]>(likesKey(target)) ?? [];
  if (!theirLikes.some((like) => likeTo(like) === me && like.status !== "ignored")) return undefined;
  const ownLikes = await store.get<Like[]>(likesKey(me)) ?? [];
  for (const like of ownLikes) if (likeTo(like) === target) like.status = "matched";
  for (const like of theirLikes) if (likeTo(like) === me) like.status = "matched";
  await store.set(likesKey(me), ownLikes);
  await store.set(likesKey(target), theirLikes);
  const id = canonicalMatchId(me, target);
  const existing = await store.get<Match>(matchKey(id));
  if (existing?.active) return undefined;
  const match = makeMatch(me, target, now());
  if (!(await store.setIfAbsent(matchKey(match.match_id), match))) return undefined;
  const pair = [match.user_a_id, match.user_b_id];
  for (const id of pair) {
    const matches = await store.get<string[]>(matchesKey(id)) ?? [];
    if (!matches.includes(match.match_id)) await store.set(matchesKey(id), [...matches, match.match_id]);
  }
  return match;
}

function matchText(profile: Profile): string {
  return `Взаимная симпатия 💛\n${profile.name}, ${profile.age}\n📍 ${profile.city}\n\nМожно начать спокойный разговор.`;
}

async function notifyMatch(ctx: Ctx, recipient: number, matchedProfile: Profile): Promise<void> {
  const text = matchText(matchedProfile);
  const reply_markup = inlineKeyboard([[inlineButton("💬 Написать сообщение", `conversation:open:${canonicalMatchId(userId(ctx), recipient)}`)]]);
  try {
    if (matchedProfile.photos[0]) await ctx.api.sendPhoto(recipient, matchedProfile.photos[0], { caption: text, reply_markup });
    else await ctx.api.sendMessage(recipient, text, { reply_markup });
  } catch { /* A blocked or deleted account must not break the match. */ }
}

composer.callbackQuery("browse:start", async (ctx) => { await ctx.answerCallbackQuery(); await nextProfile(ctx); });

composer.callbackQuery(/^browse:(like|pass):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const action = ctx.match[1] as "like" | "pass";
  const target = Number(ctx.match[2]);
  const profile = await ensureTarget(ctx, target);
  if (!profile) { await ctx.reply("Эта анкета больше недоступна.", { reply_markup: back }); return; }
  const store = new DomainStore(ctx);
  const me = userId(ctx);
  if (action === "pass") {
    const skipped = await store.get<number[]>(skipsKey(me)) ?? [];
    if (!skipped.includes(target)) await store.set(skipsKey(me), [...skipped, target]);
    await recordEvent(ctx, "skip", target);
    await nextProfile(ctx);
    return;
  }
  const ownLikes = await store.get<Like[]>(likesKey(me)) ?? [];
  if (!ownLikes.some((like) => likeTo(like) === target)) {
    const newLike = makeLike(me, target, now());
    const inserted = await store.setIfAbsent(likeKey(me, target), newLike);
    if (inserted || !(await store.available())) {
      ownLikes.push(newLike);
      await store.set(likesKey(me), ownLikes);
    }
    const index = await store.get<number[]>(likeIndexKey(me)) ?? [];
    if (!index.includes(target)) await store.set(likeIndexKey(me), [...index, target]);
  }
  await recordEvent(ctx, "like", target);
  const match = await createMatch(ctx, target);
  if (match) {
    const mine = await store.get<Profile>(profileKey(me));
    if (mine) await notifyMatch(ctx, me, profile);
    await notifyMatch(ctx, target, mine ?? profile);
  }
  await nextProfile(ctx);
});

composer.callbackQuery(/^browse:view:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const target = Number(ctx.match[1]);
  const profile = await ensureTarget(ctx, target);
  if (!profile) { await ctx.reply("Эта анкета больше недоступна.", { reply_markup: back }); return; }
  await recordEvent(ctx, "view", target);
  if (profile.photos.length === 0) {
    await ctx.reply(fullProfileText(profile), { reply_markup: actionKeyboard(target, true) });
    return;
  }
  await ctx.replyWithPhoto(profile.photos[0], { caption: fullProfileText(profile), reply_markup: actionKeyboard(target, true) });
  for (const photo of profile.photos.slice(1)) await ctx.replyWithPhoto(photo);
});

composer.callbackQuery(/^browse:report:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.activeTargetId = Number(ctx.match[1]);
  ctx.session.step = "report";
  await ctx.reply("Что вас насторожило?", { reply_markup: inlineKeyboard([
    [inlineButton("Спам", "report:reason:spam"), inlineButton("Фото", "report:reason:photos")],
    [inlineButton("Фальшивый профиль", "report:reason:fake"), inlineButton("Оскорбления", "report:reason:harassment")],
    [inlineButton("Другое", "report:reason:other")],
  ]) });
});

composer.callbackQuery(/^report:reason:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.reportReason = ctx.match[1];
  ctx.session.step = "report";
  await ctx.reply("Если хотите, добавьте подробности одним сообщением.", { reply_markup: { force_reply: true, input_field_placeholder: "Опишите ситуацию" } });
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "report") { await next(); return; }
  const target = ctx.session.activeTargetId;
  const store = new DomainStore(ctx);
  const profile = target ? await store.get<Profile>(profileKey(target)) : undefined;
  if (!target || !profile) { ctx.session.step = "idle"; await ctx.reply("Эта анкета больше недоступна.", { reply_markup: back }); return; }
  const id = `${userId(ctx)}-${now()}`;
  const report = { id, reporter: userId(ctx), target, reason: ctx.session.reportReason ?? "other", details: ctx.message.text.trim(), snapshot: profile, at: now(), adminAction: "pending" };
  await store.set(reportKey(id), report);
  const admin = adminChatId(ctx);
  if (admin) {
    try { await ctx.api.sendMessage(admin, `Новая жалоба\nПричина: ${report.reason}\nПрофиль: ${profile.name}, ${profile.age}, ${profile.city}\nПодробности: ${report.details || "не указаны"}`); } catch { /* Owner delivery is best effort. */ }
  }
  ctx.session.step = "idle";
  ctx.session.reportReason = undefined;
  await ctx.reply("Спасибо, что сообщили. Мы проверим профиль и позаботимся о безопасности.", { reply_markup: back });
});

export default composer;
