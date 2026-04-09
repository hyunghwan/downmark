import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

const OPEN_REQUEST_EVENT = "downmark://open-paths";

interface OpenPathsPayload {
  paths: string[];
}

export class ShellIntegration {
  async handleInitialOpen() {
    return invoke<string[]>("get_initial_open_paths");
  }

  async handleSecondaryOpen(onPaths: (paths: string[]) => void) {
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
