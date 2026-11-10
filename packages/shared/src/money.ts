const LOCALES: Record<string, string> = {
  es: "es-ES",
  ca: "ca-ES",
  en: "en-GB",
  fr: "fr-FR",
  it: "it-IT",
  de: "de-DE",
};

export function formatMoney(cents: number, language = "es", currency = "EUR"): string {
  return new Intl.NumberFormat(LOCALES[language] ?? "es-ES", {
    style: "currency",
    currency,
  }).format(cents / 100);
}
