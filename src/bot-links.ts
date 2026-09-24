/** Canonical links for this bot itself. User profile links are built elsewhere. */
export const BOT_USERNAME = "nikahzkvi";
export const BOT_MENTION = `@${BOT_USERNAME}`;
export const BOT_WEB_URL = `https://t.me/${BOT_USERNAME}`;
export const BOT_TELEGRAM_URL = `tg://resolve?domain=${BOT_USERNAME}`;

export interface BotLinks {
  username: string;
  mention: string;
  web: string;
  telegram: string;
}

/**
 * Keep self-link generation in one place. An invalid runtime override is
 * treated as unavailable instead of producing a broken Telegram button.
 */
export function getBotLinks(username = BOT_USERNAME): BotLinks | undefined {
  const normalized = username.trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{5,32}$/.test(normalized)) return undefined;
  return {
    username: normalized,
    mention: `@${normalized}`,
    web: `https://t.me/${normalized}`,
    telegram: `tg://resolve?domain=${normalized}`,
  };
}

/** Build a Telegram deep link while preserving the caller's start payload. */
export function botStartLink(payload: string): string {
  return `${BOT_WEB_URL}?start=${encodeURIComponent(payload)}`;
}
