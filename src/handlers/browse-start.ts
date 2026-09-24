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
  isDiscoverable,
  reportKey,
  reportsIndexKey,
  adminBlockedKey,
  skipsKey,
  viewedActionKey,
  viewedKey,
  userId,
  photoCaption,
  profileStatus,
  type Like,
  type Match,
  type Profile,
} from "../domain.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { notifyMutualMatch } from "../match-ui.js";
import { botStartLink } from "../bot-links.js";

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
  rows.push([inlineButton("🔎 Изменить поиск", "search:open")]);
  rows.push([inlineButton("⬅️ В меню", "menu:main")]);
  return inlineKeyboard(rows);
}

function cardText(profile: Profile): string {
  const statusText = profileStatus(profile);
  const status = statusText ? `\n\n💬 ${statusText}` : "";
  return `${profile.name}, ${profile.age}${status}\n📍 ${profile.city}\n\n${profile.bio}`;
}

function fullProfileText(profile: Profile): string {
  const optional = [
    profile.childrenPreference ? `Дети: ${profile.childrenPreference}` : "",
    profile.religionValues ? `Ценности: ${profile.religionValues}` : "",
    profile.smokingDrinking ? `Курение и алкоголь: ${profile.smokingDrinking}` : "",
  ].filter(Boolean);
  const statusText = profileStatus(profile);
  const status = statusText ? `\n💬 ${statusText}` : "";
  return `${profile.name}, ${profile.age}${status}\n📍 ${profile.city}\n\n` +
    `Семейный статус: ${profile.maritalStatus}\n` +
    (profile.nationality ? `Национальность: ${profile.nationality}\n` : "") +
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

/** Mark an assessment durably and idempotently, with an explicit index for bounded reads. */
async function markAssessed(store: DomainStore, viewer: number, candidate: number, at = now()): Promise<void> {
  await store.setIfAbsent(viewedActionKey(viewer, candidate), { viewer, candidate, at });
  const viewed = await store.get<number[]>(viewedKey(viewer)) ?? [];
  if (!viewed.includes(candidate)) await store.set(viewedKey(viewer), [...viewed, candidate]);
}

function ageMatches(viewer: Profile | undefined, candidate: Profile): boolean {
  if (!viewer) return true;
  if (viewer.preferredAgeFrom !== undefined && candidate.age < viewer.preferredAgeFrom) return false;
  if (viewer.preferredAgeTo !== undefined && candidate.age > viewer.preferredAgeTo) return false;
  if (viewer.preferredGender && viewer.preferredGender !== "any" && candidate.gender !== viewer.preferredGender) return false;
  return true;
}

async function excluded(store: DomainStore, viewer: number, candidate: number): Promise<boolean> {
  if (await store.get(adminBlockedKey(viewer)) || await store.get(adminBlockedKey(candidate))) return true;
  const viewerProfile = await store.get<Profile>(profileKey(viewer));
  if (viewerProfile?.blockedUserIds?.includes(candidate)) return true;
  const ownLikes = await store.get<Like[]>(likesKey(viewer)) ?? [];
  if (ownLikes.some((like) => likeTo(like) === candidate && like.status !== "ignored")) return true;
  const skipped = await store.get<number[]>(skipsKey(viewer)) ?? [];
  if (skipped.includes(candidate)) return true;
  const viewed = await store.get<number[]>(viewedKey(viewer)) ?? [];
  if (viewed.includes(candidate)) return true;
  const theirSkips = await store.get<number[]>(skipsKey(candidate)) ?? [];
  if (theirSkips.includes(viewer)) return true;
  const matchIds = await store.get<string[]>(matchesKey(viewer)) ?? [];
  for (const id of matchIds) {
    const match = await store.get<Match>(matchKey(id));
    if (match?.active && ((matchA(match) === viewer && matchB(match) === candidate) || (matchA(match) === candidate && matchB(match) === viewer))) return true;
  }
  const candidateProfile = await store.get<Profile>(profileKey(candidate));
  return !candidateProfile || !isDiscoverable(candidateProfile) || candidateProfile.blockedUserIds?.includes(viewer) === true;
}

async function sendCard(ctx: Ctx, profile: Profile): Promise<void> {
  await recordEvent(ctx, "view", profile.userId);
  ctx.session.activeTargetId = profile.userId;
  if (profile.photos[0]) {
    await ctx.replyWithPhoto(profile.photos[0], { caption: photoCaption(cardText(profile)), reply_markup: actionKeyboard(profile.userId) });
  } else {
    await ctx.reply(cardText(profile), { reply_markup: actionKeyboard(profile.userId) });
  }
}

function isPhotoMessage(message: unknown): boolean {
  return typeof message === "object" && message !== null && "photo" in message;
}

/** Replace the tapped card in place so an action never appends a duplicate card. */
async function replaceCard(ctx: Ctx, profile: Profile | undefined): Promise<void> {
  const message = ctx.callbackQuery?.message;
  const text = profile ? cardText(profile) : "Новых анкет пока нет";
  const markup = profile
    ? actionKeyboard(profile.userId)
    : inlineKeyboard([
      [inlineButton("🔎 Изменить поиск", "search:open")],
      [inlineButton("Расширить поиск", "search:clear")],
      [inlineButton("⬅️ В меню", "menu:main")],
    ]);
  if (isPhotoMessage(message)) {
    if (profile?.photos[0]) {
      await ctx.editMessageMedia({ type: "photo", media: profile.photos[0], caption: photoCaption(text) }, { reply_markup: markup });
    } else {
      await ctx.editMessageCaption({ caption: photoCaption(text), reply_markup: markup });
    }
    return;
  }
  await ctx.editMessageText(text, { reply_markup: markup });
}

export async function browseProfiles(ctx: Ctx, replaceCurrent = false): Promise<void> {
  const store = new DomainStore(ctx);
  const ids = await store.get<number[]>(profileIndexKey()) ?? [];
  const mine = userId(ctx);
  const viewer = await store.get<Profile>(profileKey(mine));
  for (const id of ids) {
    if (id === mine) continue;
    const profile = await store.get<Profile>(profileKey(id));
    // Dating is intentionally permissive here. Saved city/description/username
    // data must never make a real, photo-bearing profile disappear from the
    // deck. Age and gender preferences on the viewer still define suitability;
    // safety, visibility, and prior actions are applied by `excluded`.
    if (!profile || !isDiscoverable(profile) || !Array.isArray(profile.photos) || profile.photos.length === 0 || !profile.photos[0] || !ageMatches(viewer, profile) || await excluded(store, mine, id)) continue;
    if (replaceCurrent) await replaceCard(ctx, profile);
    else await sendCard(ctx, profile);
    return;
  }
  if (replaceCurrent) await replaceCard(ctx, undefined);
  else await ctx.reply("Новых анкет пока нет", { reply_markup: inlineKeyboard([[inlineButton("🔎 Изменить поиск", "search:open")], [inlineButton("Расширить поиск", "search:clear")], [inlineButton("⬅️ В меню", "menu:main")]]) });
}

async function ensureTarget(ctx: Ctx, target: number): Promise<Profile | undefined> {
  const store = new DomainStore(ctx);
  if (await store.get(adminBlockedKey(target)) || await store.get(adminBlockedKey(userId(ctx)))) return undefined;
  const profile = await store.get<Profile>(profileKey(target));
  if (!isDiscoverable(profile) || target === userId(ctx)) return undefined;
  return profile;
}

async function createMatch(ctx: Ctx, target: number): Promise<Match | undefined> {
  const store = new DomainStore(ctx);
  const me = userId(ctx);
  if (me === target) return undefined;
  const mine = await store.get<Profile>(profileKey(me));
  const theirs = await store.get<Profile>(profileKey(target));
  if (!mine || !theirs || !isDiscoverable(mine) || !isDiscoverable(theirs)) return undefined;
  if (mine.blockedUserIds?.includes(target) || theirs.blockedUserIds?.includes(me)) return undefined;
  const theirLikes = await store.get<Like[]>(likesKey(target)) ?? [];
  const theirCanonicalLike = await store.get<Like>(likeKey(target, me));
  if (theirCanonicalLike && !theirLikes.some((like) => likeTo(like) === me)) theirLikes.push(theirCanonicalLike);
  if (!theirLikes.some((like) => likeTo(like) === me && like.status !== "ignored")) return undefined;
  const ownLikes = await store.get<Like[]>(likesKey(me)) ?? [];
  const ownCanonicalLike = await store.get<Like>(likeKey(me, target));
  if (ownCanonicalLike && !ownLikes.some((like) => likeTo(like) === target)) ownLikes.push(ownCanonicalLike);
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

composer.callbackQuery("browse:start", async (ctx) => { await ctx.answerCallbackQuery(); await browseProfiles(ctx); });

composer.callbackQuery(/^browse:(like|pass):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const action = ctx.match[1] as "like" | "pass";
  const target = Number(ctx.match[2]);
  const profile = await ensureTarget(ctx, target);
  if (!profile) { await ctx.reply("Эта анкета больше недоступна.", { reply_markup: back }); return; }
  const store = new DomainStore(ctx);
  const me = userId(ctx);
  const ownProfile = await store.get<Profile>(profileKey(me));
  if (action === "like" && !ownProfile) {
    await ctx.reply("Сначала создайте профиль — так людям будет проще узнать вас.", { reply_markup: inlineKeyboard([[inlineButton("Создать профиль", "profile:create:start")], [inlineButton("⬅️ В меню", "menu:main")]]) });
    return;
  }
  if (action === "pass") {
    const skipped = await store.get<number[]>(skipsKey(me)) ?? [];
    if (!skipped.includes(target)) await store.set(skipsKey(me), [...skipped, target]);
    await markAssessed(store, me, target);
    await recordEvent(ctx, "skip", target);
    await browseProfiles(ctx, true);
    return;
  }
  const ownLikes = await store.get<Like[]>(likesKey(me)) ?? [];
  const newLike = makeLike(me, target, now());
  // The pair key is the canonical Like record and is the idempotency boundary.
  // The per-user array remains as a compatibility/index projection for older
  // records and the incoming-likes screen.
  const previousCanonical = await store.get<Like>(likeKey(me, target));
  if (previousCanonical?.status === "ignored") await store.set(likeKey(me, target), newLike);
  else await store.setIfAbsent(likeKey(me, target), newLike);
  const canonical = await store.get<Like>(likeKey(me, target));
  const projected = ownLikes.find((like) => likeTo(like) === target);
  if (projected?.status === "ignored") Object.assign(projected, canonical ?? newLike);
  else if (!projected) ownLikes.push(canonical ?? newLike);
  await store.set(likesKey(me), ownLikes);
  const index = await store.get<number[]>(likeIndexKey(me)) ?? [];
  if (!index.includes(target)) await store.set(likeIndexKey(me), [...index, target]);
  await markAssessed(store, me, target, newLike.created_at);
  await recordEvent(ctx, "like", target);
  const match = await createMatch(ctx, target);
  if (match) {
    const mine = await store.get<Profile>(profileKey(me));
    if (mine) await notifyMutualMatch(ctx, me, profile, match.match_id);
    await notifyMutualMatch(ctx, target, mine ?? profile, match.match_id);
  }
  await browseProfiles(ctx, true);
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
  await ctx.replyWithPhoto(profile.photos[0], { caption: photoCaption(fullProfileText(profile)), reply_markup: actionKeyboard(target, true) });
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
  const reportIds = await store.get<string[]>(reportsIndexKey()) ?? [];
  if (!reportIds.includes(id)) await store.set(reportsIndexKey(), [...reportIds, id]);
  const admin = adminChatId(ctx);
  if (admin) {
    try { await ctx.api.sendMessage(admin, `Новая жалоба\nПричина: ${report.reason}\nПрофиль: ${profile.name}, ${profile.age}, ${profile.city}\nПодробности: ${report.details || "не указаны"}\nБот: ${botStartLink("ref123")}`); } catch { /* Owner delivery is best effort. */ }
  }
  ctx.session.step = "idle";
  ctx.session.reportReason = undefined;
  await ctx.reply("Спасибо, что сообщили. Мы проверим профиль и позаботимся о безопасности.", { reply_markup: back });
});

export default composer;
