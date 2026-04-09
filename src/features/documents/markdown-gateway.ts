import { invoke } from "@tauri-apps/api/core";
import { Editor, type JSONContent } from "@tiptap/core";

import { createMarkdownExtensions } from "../editor/extensions";
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
    return invoke<FileStatusResponse>("check_file_status", {
      path,
      expectedFingerprint: session.fingerprint,
    });
  }

  async pathExists(path: string) {
    return invoke<boolean>("path_exists", { path });
  }

  async loadSettings() {
    return invoke<AppSettings>("load_settings");
  }

  async recordRecentFile(path: string) {
    return invoke<AppSettings>("record_recent_file", { path });
  }

  async removeRecentFile(path: string) {
    return invoke<AppSettings>("remove_recent_file", { path });
  }
}
