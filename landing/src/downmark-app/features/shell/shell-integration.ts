import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { hasTauriRuntime } from "../runtime/tauri-runtime";

const OPEN_REQUEST_EVENT = "downmark://open-paths";
const MENU_ACTION_EVENT = "downmark://menu-action";

interface OpenPathsPayload {
  paths: string[];
}

interface MenuActionPayload {
  action: string;
}

export class ShellIntegration {
  async handleInitialOpen() {
    if (!hasTauriRuntime()) {
      return [];
    }

    return invoke<string[]>("get_initial_open_paths");
  }

  async handleSecondaryOpen(onPaths: (paths: string[]) => void) {
    if (!hasTauriRuntime()) {
      return (() => {}) as UnlistenFn;
    }

    return listen<OpenPathsPayload>(
      OPEN_REQUEST_EVENT,
      (event: { payload: OpenPathsPayload }) => {
        onPaths(event.payload.paths);
      },
    ) as Promise<UnlistenFn>;
  }

  async handleMenuAction(onAction: (action: string) => void) {
    if (!hasTauriRuntime()) {
      return (() => {}) as UnlistenFn;
    }

    return listen<MenuActionPayload>(
      MENU_ACTION_EVENT,
      (event: { payload: MenuActionPayload }) => {
        onAction(event.payload.action);
      },
    ) as Promise<UnlistenFn>;
  }

  async openRecent(path: string) {
    return [path];
  }
}
