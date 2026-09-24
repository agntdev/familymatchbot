const CITY_ALIASES: Record<string, string> = {
  "мск": "москва",
  "санкт-петербург": "санкт петербург",
  "с-пб": "санкт петербург",
  "спб": "санкт петербург",
  "екб": "екатеринбург",
  "н новгород": "нижний новгород",
};

// Canonical launch cities. The table is intentionally explicit so a typo never
// silently becomes a location filter with unexpected results.
const CITY_LIST = [
  "москва", "санкт петербург", "новосибирск", "екатеринбург", "казань",
  "нижний новгород", "красноярск", "челябинск", "самара", "уфа", "ростов на дону",
  "краснодар", "омск", "воронеж", "пермь", "волгоград", "саратов", "тюмень",
  "иркутск", "барнаул", "владивосток", "махачкала", "хабаровск", "томск",
  "ташкент", "алматы", "астана", "бишкек", "киев", "минск", "баку", "ереван",
].map((city) => [city, city] as const);

function normalizeCity(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU")
    .normalize("NFD").replace(/[\u0300-\u036f]/gu, "")
    .replace(/[ё]/gu, "е").replace(/[.,]/gu, " ").replace(/\s+/gu, " ");
}

export function canonicalCity(value: string): string | undefined {
  const normalized = normalizeCity(value);
  const aliased = CITY_ALIASES[normalized] ?? normalized;
  const city = CITY_LIST.find(([key]) => key === aliased)?.[1];
  return city?.split(" ").map((part) => part.charAt(0).toLocaleUpperCase("ru-RU") + part.slice(1)).join(" ");
}
