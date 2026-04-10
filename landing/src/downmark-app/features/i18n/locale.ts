export type SupportedLocale = "en" | "ko" | "es";
export type LanguagePreference = "system" | SupportedLocale;

export function resolveSupportedLocale(
  rawLocale: string | null | undefined,
): SupportedLocale {
  if (!rawLocale) {
    return "en";
  }

  const normalized = rawLocale.trim().toLowerCase();
  const primaryTag = normalized.split(/[-_]/, 1)[0];

  if (primaryTag === "ko") {
    return "ko";
  }

  if (primaryTag === "es") {
    return "es";
  }

  return "en";
}

export function resolveLocaleFromPreference(
  preference: LanguagePreference,
  systemLocale: string | null | undefined,
): SupportedLocale {
  return preference === "system"
    ? resolveSupportedLocale(systemLocale)
    : preference;
}

export function getSystemLocale() {
  if (typeof navigator === "undefined") {
    return "en-US";
  }

  return navigator.language;
}

export function getIntlLocale(locale: SupportedLocale) {
  switch (locale) {
    case "ko":
      return "ko-KR";
    case "es":
      return "es-ES";
    default:
      return "en-US";
  }
}
