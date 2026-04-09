import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { hasTauriRuntime } from "../runtime/tauri-runtime";

const OPEN_REQUEST_EVENT = "downmark://open-paths";

interface OpenPathsPayload {
  paths: string[];
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

  async openRecent(path: string) {
    return [path];
  }
}
