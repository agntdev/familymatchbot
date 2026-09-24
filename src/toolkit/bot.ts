import {
  Bot,
  session,
  type Context,
  type SessionFlavor,
  type StorageAdapter,
} from "grammy";
import { resolveSessionStorage } from "./session/redis.js";
import {
  installActivityReporter,
  type ReporterOptions,
  type TelemetryEnv,
} from "./telemetry/reporter.js";

/** Context for a toolkit bot carrying a typed session `S`. */
export type BotContext<S extends object = Record<string, unknown>> = Context & SessionFlavor<S>;

export interface CreateBotOptions<S extends object> {
  /** Initial session value for a new chat. */
  initial: () => S;
  /**
   * Session storage. When omitted, the toolkit auto-selects: Redis if
   * REDIS_URL is set in the environment (production), else in-memory
   * (development / no Redis). Pass an explicit adapter to override.
   */
  storage?: StorageAdapter<S>;
  /** Worker bindings; omitted on Node, where the reporter reads process.env. */
  telemetryEnv?: TelemetryEnv;
  /** Runtime-specific reporter behavior, such as per-update Worker flushing. */
  telemetryReporterOptions?: ReporterOptions;
  /** Called on any unhandled handler error; defaults to console.error. */
  onError?: (err: unknown) => void;
}

/**
 * createBot — the toolkit's curated entry point. Wraps grammY's Bot with the
 * default session middleware and an error boundary, so every generated bot
 * shares one opinionated structure: the Dev-stage codegen targets this API, and
 * the test harness (M0-10) replays Updates against bots built here.
 *
 * The BotFather token is injected at runtime (never baked); polling vs webhook
 * is chosen at deploy time (docs/pivot M1-7).
 */
export function createBot<S extends object>(
  token: string,
  opts: CreateBotOptions<S>,
): Bot<BotContext<S>> {
  const bot = new Bot<BotContext<S>>(token);
  // Telegram callback queries can expire while a slow storage/API operation is
  // running. A stale acknowledgement must not turn into an unhandled update
  // error. The same applies to harmless repeated edits of an unchanged menu.
  bot.use(async (ctx, next) => {
    const answer = ctx.answerCallbackQuery.bind(ctx);
    let acknowledgement: ReturnType<Context["answerCallbackQuery"]> | undefined;
    ctx.answerCallbackQuery = (textOrOptions?: string | Parameters<Context["answerCallbackQuery"]>[0]) => {
      acknowledgement ??= answer(textOrOptions as never).catch(() => true as never);
      return acknowledgement;
    };
    // A handler may perform several storage reads before it explicitly calls
    // answerCallbackQuery. Acknowledge first so Telegram never expires the
    // query while that work is in progress; later handler calls reuse it.
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    const edit = ctx.editMessageText.bind(ctx);
    ctx.editMessageText = (async (...args: Parameters<Context["editMessageText"]>) => {
      try {
        return await edit(...args);
      } catch (error: unknown) {
        if (error instanceof Error && /message is not modified/i.test(error.message)) return true as never;
        // A callback can be attached to a photo or media group. Telegram cannot
        // edit that message as text; keep the result visible in a new message.
        if (error instanceof Error && /there is no text in the message/i.test(error.message)) {
          try {
            return await ctx.reply(args[0] as string, args[1] as never) as never;
          } catch {
            return true as never;
          }
        }
        throw error;
      }
    }) as Context["editMessageText"];
    const safeEdit = async <T extends (...args: any[]) => Promise<any>>(method: T, args: Parameters<T>, fallback?: () => Promise<unknown>) => {
      try { return await method(...args); }
      catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (/message is not modified|query is too old|there is no text in the message|message to edit/i.test(message)) {
          if (/there is no text in the message|message to edit/i.test(message) && fallback) { try { return await fallback(); } catch { return true; } }
          return true;
        }
        throw error;
      }
    };
    const editCaption = ctx.editMessageCaption.bind(ctx);
    ctx.editMessageCaption = ((...args: Parameters<Context["editMessageCaption"]>) => safeEdit(editCaption, args)) as Context["editMessageCaption"];
    const editMedia = ctx.editMessageMedia.bind(ctx);
    ctx.editMessageMedia = ((...args: Parameters<Context["editMessageMedia"]>) => safeEdit(editMedia, args)) as Context["editMessageMedia"];
    await next();
  });
  bot.use(
    session<S, BotContext<S>>({
      initial: opts.initial,
      // Auto-select: explicit adapter → Redis (REDIS_URL) → in-memory.
      storage: resolveSessionStorage<S>(opts.storage),
    }),
  );
  // Telegram may deliver the same tap more than once, or a user may tap
  // rapidly. Keep the acknowledgement fast and prevent a second callback from
  // entering a write handler. Durable uniqueness remains in DomainStore keys.
  bot.use(async (ctx, next) => {
    const callback = ctx.callbackQuery;
    if (!callback?.data) return next();
    const at = Date.now();
    const session = ctx.session as S & { lastCallback?: { data: string; at: number } };
    const previous = session.lastCallback;
    if (previous?.data === callback.data && at - previous.at < 1500) {
      await ctx.answerCallbackQuery("Это действие уже выполнено.");
      await ctx.reply("Это действие уже выполнено. Откройте актуальный экран кнопкой ниже.");
      return;
    }
    session.lastCallback = { data: callback.data, at };
    await next();
  });
  // Active-user reporting (agnt-api migration 00069). No-op unless the platform
  // injected BOT_TELEMETRY_* at deploy — so dev, the test harness, and old bots
  // are byte-for-byte unchanged. Records salted user hashes only; best-effort.
  installActivityReporter(bot, opts.telemetryEnv, opts.telemetryReporterOptions);
  bot.catch((err) => {
    if (opts.onError) opts.onError(err);
    else console.error("[agntdev-bot] unhandled error:", err);
  });
  return bot;
}

/**
 * Publish the bot's slash-command menu to Telegram (the "/" list + Menu button),
 * so the few commands a button-first bot DOES expose are discoverable. A
 * button-first bot should publish only `/start` and `/help` (plus any rare
 * free-form-input command); everything else is reached by tapping a menu button.
 *
 * Call once at startup (see `src/index.ts`). No-ops harmlessly under the test
 * harness (the Bot API transport is faked there). `extra` appends bot-specific
 * commands beyond the `/start` + `/help` defaults.
 */
export async function setDefaultCommands<S extends object>(bot: Bot<BotContext<S>>): Promise<void> {
  const commands = [
    { command: "start", description: "Главное меню" },
    { command: "profile", description: "Моя анкета" },
    { command: "search", description: "Знакомства" },
    { command: "likes", description: "Мои лайки" },
    { command: "matches", description: "Взаимные симпатии" },
    { command: "messages", description: "Сообщения" },
    { command: "filters", description: "Фильтры поиска" },
    { command: "vip", description: "Возможности для серьёзных знакомств" },
    { command: "settings", description: "Настройки анкеты и безопасности" },
    { command: "help", description: "О «Никах» и безопасности" },
  ];
  try {
    await bot.api.setMyCommands(commands, { scope: { type: "default" }, language_code: "ru" });
  } catch {
    // Non-fatal: discoverability only. Never block startup on it.
  }
}
