import { invoke } from "@tauri-apps/api/core";
import { Editor, type JSONContent } from "@tiptap/core";

import { createMarkdownExtensions } from "../editor/extensions";
import {
  getSystemLocale,
  resolveLocaleFromPreference,
  type LanguagePreference,
} from "../i18n/locale";
import { hasTauriRuntime } from "../runtime/tauri-runtime";
import type {
  AppSettings,
  FileSession,
  FileStatusResponse,
  LoadedFile,
  PrepareImageAssetInput,
  PreparedImageAsset,
  SaveFileResult,
  SavePolicy,
} from "./types";
import { DEFAULT_DOCUMENT_ZOOM_PERCENT as DEFAULT_ZOOM_PERCENT } from "./types";

function normalizeToLf(markdown: string) {
  return markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

const MARKDOWN_IMAGE_PATTERN =
  /!\[[^\]]*]\(([^)\s]+)(?:\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'))?\)/g;
const URL_SCHEME_PATTERN = /^[a-z][a-z\d+\-.]*:/i;

function getPathSeparator(path: string) {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

function getParentPath(path: string) {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return lastSlash >= 0 ? path.slice(0, lastSlash) : "";
}

function getFileName(path: string) {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
}

function getFileStem(path: string) {
  const fileName = getFileName(path);
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
}

function joinPath(parent: string, child: string) {
  if (!parent) {
    return child;
  }

  const separator = getPathSeparator(parent);
  return parent.endsWith("/") || parent.endsWith("\\")
    ? `${parent}${child}`
    : `${parent}${separator}${child}`;
}

function decodeRelativePath(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function isRemoteImageDestination(destination: string) {
  return URL_SCHEME_PATTERN.test(destination) || destination.startsWith("//");
}

function isGeneratedSiblingImage(destination: string, documentStem: string) {
  if (!destination) {
    return false;
  }

  const normalized = destination.startsWith("./") ? destination.slice(2) : destination;
  if (
    normalized.startsWith("../") ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    isRemoteImageDestination(normalized)
  ) {
    return false;
  }

  const decoded = decodeRelativePath(normalized);
  return getFileStem(decoded).startsWith(`${documentStem}-image-`);
}

export class MarkdownGateway {
  private readonly editor: Editor;
  private browserSettings: AppSettings = {
    documentZoomPercent: DEFAULT_ZOOM_PERCENT,
    recentFiles: [],
    languagePreference: "system",
    locale: resolveLocaleFromPreference("system", getSystemLocale()),
  };

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
        ...this.browserSettings,
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
        ...this.browserSettings,
        recentFiles: this.browserSettings.recentFiles.filter(
          (entry) => entry.path !== path,
        ),
      };

      return structuredClone(this.browserSettings);
    }

    return invoke<AppSettings>("remove_recent_file", { path });
  }

  async setLanguagePreference(languagePreference: LanguagePreference) {
    if (!hasTauriRuntime()) {
      this.browserSettings = {
        ...this.browserSettings,
        languagePreference,
        locale: resolveLocaleFromPreference(languagePreference, getSystemLocale()),
      };

      return structuredClone(this.browserSettings);
    }

    return invoke<AppSettings>("set_language_preference", {
      languagePreference,
    });
  }

  async setDocumentZoomPercent(documentZoomPercent: number) {
    if (!hasTauriRuntime()) {
      this.browserSettings = {
        ...this.browserSettings,
        documentZoomPercent,
      };

      return structuredClone(this.browserSettings);
    }

    return invoke<AppSettings>("set_document_zoom_percent", {
      documentZoomPercent,
    });
  }

  async prepareImageAsset(input: PrepareImageAssetInput) {
    if (!hasTauriRuntime()) {
      throw new Error("Image assets are only available in the desktop app.");
    }

    const request =
      "sourcePath" in input
        ? {
            documentPath: input.documentPath,
            sourcePath: input.sourcePath,
          }
        : {
            documentPath: input.documentPath,
            bytes: Array.from(input.bytes),
            mimeType: input.mimeType,
          };

    return invoke<PreparedImageAsset>("prepare_image_asset", { request });
  }

  async relocateLocalImageLinks(
    markdown: string,
    fromDocumentPath: string | null,
    toDocumentPath: string,
  ) {
    if (!fromDocumentPath || fromDocumentPath === toDocumentPath) {
      return markdown;
    }

    const fromDocumentStem = getFileStem(fromDocumentPath);
    const fromDocumentDirectory = getParentPath(fromDocumentPath);
    const matches = Array.from(markdown.matchAll(MARKDOWN_IMAGE_PATTERN));
    if (matches.length === 0) {
      return markdown;
    }

    const replacements = new Map<string, string>();

    for (const match of matches) {
      const destination = match[1];
      if (!destination || !isGeneratedSiblingImage(destination, fromDocumentStem)) {
        continue;
      }

      const normalized = destination.startsWith("./")
        ? destination.slice(2)
        : destination;
      const cacheKey = decodeRelativePath(normalized);
      if (replacements.has(cacheKey)) {
        continue;
      }

      const sourcePath = joinPath(fromDocumentDirectory, cacheKey);
      const prepared = await this.prepareImageAsset({
        documentPath: toDocumentPath,
        sourcePath,
      });
      replacements.set(cacheKey, prepared.relativePath);
    }

    if (replacements.size === 0) {
      return markdown;
    }

    return markdown.replace(MARKDOWN_IMAGE_PATTERN, (full, destination: string) => {
      const normalized = destination.startsWith("./")
        ? destination.slice(2)
        : destination;
      const replacement = replacements.get(decodeRelativePath(normalized));
      return replacement ? full.replace(destination, replacement) : full;
    });
  }
}
