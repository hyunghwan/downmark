import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { hasTauriRuntime } from "../runtime/tauri-runtime";

const MENU_ACTION_EVENT = "downmark://menu-action";

interface MenuActionPayload {
  action: string;
}

export class ShellIntegration {
  async getCurrentWindowLaunchPath() {
    if (!hasTauriRuntime()) {
      return null;
    }

    return invoke<string | null>("get_current_window_launch_path");
  }

  async newDraftWindow() {
    if (!hasTauriRuntime()) {
      return;
    }

    await invoke("new_draft_window");
  }

  async openPathInNewWindow(path: string) {
    if (!hasTauriRuntime()) {
      return;
    }

    await invoke("open_path_in_new_window", { path });
  }

  async syncCurrentWindowPath(path: string | null) {
    if (!hasTauriRuntime()) {
      return;
    }

    await invoke("sync_current_window_path", { path });
  }

  async handleMenuAction(onAction: (action: string) => void) {
    if (!hasTauriRuntime()) {
      return (() => {}) as UnlistenFn;
    }

    return getCurrentWindow().listen<MenuActionPayload>(
      MENU_ACTION_EVENT,
      (event: { payload: MenuActionPayload }) => {
        onAction(event.payload.action);
      },
    );
  }
}
