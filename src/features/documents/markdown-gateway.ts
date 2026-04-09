import { invoke } from "@tauri-apps/api/core";
import { Editor, type JSONContent } from "@tiptap/core";

import { createMarkdownExtensions } from "../editor/extensions";
import { hasTauriRuntime } from "../runtime/tauri-runtime";
import type {
  AppSettings,
  FileSession,
  FileStatusResponse,
  LoadedFile,
  SaveFileResult,
  SavePolicy,
} from "./types";

function normalizeToLf(markdown: string) {
  return markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export class MarkdownGateway {
  private readonly editor: Editor;
  private browserSettings: AppSettings = { recentFiles: [] };

  constructor() {
    this.editor = new Editor({
      extensions: createMarkdownExtensions(),
      content: "",
      contentType: "markdown",
      editable: false,
      element: document.createElement("div"),
    });
  }

  destroy() {
    this.editor.destroy();
  }

  async load(path: string) {
    if (!hasTauriRuntime()) {
      throw new Error("Opening files is only available in the desktop app.");
    }

    const file = await invoke<LoadedFile>("open_file", { path });
    return {
      ...file,
      markdown: normalizeToLf(file.markdown),
    };
  }

  toRich(markdown: string) {
    return this.editor.markdown!.parse(normalizeToLf(markdown)) as JSONContent;
  }

  fromRich(doc: JSONContent) {
    return this.editor.markdown!.serialize(doc);
  }

  normalize(markdown: string, policy: SavePolicy) {
    const canonical = normalizeToLf(markdown);
    return policy.newlineStyle === "crlf"
      ? canonical.replace(/\n/g, "\r\n")
      : canonical;
  }

  async save(session: FileSession, pathOverride?: string) {
    if (!hasTauriRuntime()) {
      throw new Error("Saving files is only available in the desktop app.");
    }

    const path = pathOverride ?? session.path;
    if (!path) {
      throw new Error("No file path is available for save.");
    }

    return invoke<SaveFileResult>("save_file", {
      request: {
        path,
        markdown: normalizeToLf(session.canonicalMarkdown),
        newlineStyle: session.newlineStyle,
        expectedFingerprint: pathOverride ? null : session.fingerprint,
      },
    });
  }

  async checkFileStatus(path: string, session: FileSession) {
    if (!hasTauriRuntime()) {
      return {
        kind: "unchanged",
        fingerprint: session.fingerprint,
      } satisfies FileStatusResponse;
    }

    return invoke<FileStatusResponse>("check_file_status", {
      path,
      expectedFingerprint: session.fingerprint,
    });
  }

  async pathExists(path: string) {
    if (!hasTauriRuntime()) {
      return this.browserSettings.recentFiles.some((entry) => entry.path === path);
    }

    return invoke<boolean>("path_exists", { path });
  }

  async loadSettings() {
    if (!hasTauriRuntime()) {
      return structuredClone(this.browserSettings);
    }

    return invoke<AppSettings>("load_settings");
  }

  async recordRecentFile(path: string) {
    if (!hasTauriRuntime()) {
      const displayName = path.split("/").pop() ?? path;
      this.browserSettings = {
        recentFiles: [
          {
            path,
            displayName,
            lastOpenedMs: Date.now(),
          },
          ...this.browserSettings.recentFiles.filter((entry) => entry.path !== path),
        ].slice(0, 12),
      };

      return structuredClone(this.browserSettings);
    }

    return invoke<AppSettings>("record_recent_file", { path });
  }

  async removeRecentFile(path: string) {
    if (!hasTauriRuntime()) {
      this.browserSettings = {
        recentFiles: this.browserSettings.recentFiles.filter(
          (entry) => entry.path !== path,
        ),
      };

      return structuredClone(this.browserSettings);
    }

    return invoke<AppSettings>("remove_recent_file", { path });
  }
}
