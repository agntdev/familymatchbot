import { describe, expect, it } from "vitest";
import { botStartLink, getBotLinks } from "../src/bot-links.js";
import { photoCaption } from "../src/domain.js";

describe("bot links and Telegram media limits", () => {
  it("uses the current bot username and preserves encoded start payloads", () => {
    expect(getBotLinks()?.web).toBe("https://t.me/nikahvzk");
    expect(botStartLink("ref 123/семья")).toBe("https://t.me/nikahvzk?start=ref%20123%2F%D1%81%D0%B5%D0%BC%D1%8C%D1%8F");
  });

  it("keeps photo captions below Telegram's limit without splitting emoji", () => {
    const caption = photoCaption("🙂".repeat(600));
    expect(caption.length).toBeLessThanOrEqual(800);
    expect(caption.endsWith("…")).toBe(true);
    expect(() => JSON.stringify(caption)).not.toThrow();
  });
});
