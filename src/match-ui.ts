import type { Ctx } from "./bot.js";
import { canonicalMatchId, withTelegramDefaults, type Profile } from "./domain.js";
import { inlineButton, inlineKeyboard, urlButton } from "./toolkit/index.js";

export const MUTUAL_MATCH_TEXT = "💕 У вас взаимная симпатия!";

/**
 * Contact details are deliberately derived from the profile being revealed,
 * never from the viewer. This keeps the permission check directional: A sees
 * B's username only when B opted in, and vice versa.
 */
export function contactArea(profile: Profile, matchId: string): { text: string; markup: ReturnType<typeof inlineKeyboard> } {
  const partner = withTelegramDefaults(profile);
  if (partner.telegramUsername) {
    return {
      text: `📱 Telegram: @${partner.telegramUsername}`,
      markup: inlineKeyboard([
        [urlButton("💬 Открыть Telegram", `tg://resolve?domain=${partner.telegramUsername}`)],
        [urlButton("Открыть в браузере", `https://t.me/${partner.telegramUsername}`)],
      ]),
    };
  }
  return {
    text: "📱 Telegram: не указан",
    markup: inlineKeyboard([]),
  };
}

export function mutualMessage(profile: Profile, matchId: string): { text: string; markup: ReturnType<typeof inlineKeyboard> } {
  const contact = contactArea(profile, matchId);
  return { text: MUTUAL_MATCH_TEXT, markup: inlineKeyboard([]) };
}

export async function notifyMutualMatch(ctx: Ctx, recipient: number, matchedProfile: Profile, matchId = canonicalMatchId(recipient, ctx.from?.id ?? recipient)): Promise<void> {
  const message = mutualMessage(matchedProfile, matchId);
  try {
    await ctx.api.sendMessage(recipient, message.text);
    const contact = contactArea(matchedProfile, matchId);
    await ctx.api.sendMessage(recipient, contact.text, { reply_markup: contact.markup });
  } catch {
    // A participant may have blocked or deleted the bot. The match remains
    // usable through the other participant's chat and internal messaging.
  }
}
