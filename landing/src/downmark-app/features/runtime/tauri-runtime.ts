import { getCurrentWindow } from "@tauri-apps/api/window";

export function hasTauriRuntime() {
  return (
    typeof window !== "undefined" &&
    typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ ===
      "object"
  );
}

export type AppPlatform = "macos" | "other";

export async function startWindowDragging() {
  if (!hasTauriRuntime()) {
    return;
  }

  await getCurrentWindow().startDragging();
}

export function resolveAppPlatform(): AppPlatform {
  if (typeof window === "undefined") {
    return "other";
  }

  const navigatorWithUserAgentData = window.navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };
  const platform =
    navigatorWithUserAgentData.userAgentData?.platform ?? window.navigator.platform ?? "";

  return /mac/i.test(platform) ? "macos" : "other";
}
