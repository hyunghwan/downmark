import type { JSONContent } from "@tiptap/core";

import type {
  LanguagePreference,
  SupportedLocale,
} from "../i18n/locale";

export type EditorMode = "rich" | "raw";
export type NewlineStyle = "lf" | "crlf";
export type ConflictKind =
  | "none"
  | "externally-modified"
  | "missing"
  | "save-failed"
  | "stale-write";

export interface FileFingerprint {
  exists: boolean;
  modifiedMs: number | null;
  size: number;
  sha256: string;
}

export interface LoadedFile {
  path: string;
  displayName: string;
  markdown: string;
  newlineStyle: NewlineStyle;
  encoding: string;
  fingerprint: FileFingerprint;
}

export interface SaveFileResult {
  path: string;
  displayName: string;
  newlineStyle: NewlineStyle;
  encoding: string;
  fingerprint: FileFingerprint;
}

export interface FileStatusResponse {
  kind: "unchanged" | "modified" | "missing";
  fingerprint: FileFingerprint | null;
}

export interface PreparedImageAsset {
  relativePath: string;
  absolutePath: string;
  alt: string;
}

export type PrepareImageAssetInput =
  | {
      documentPath: string;
      sourcePath: string;
    }
  | {
      documentPath: string;
      bytes: Uint8Array;
      mimeType: string;
    };

export interface RecentFile {
  path: string;
  displayName: string;
  lastOpenedMs: number;
}

export interface AppSettings {
  documentZoomPercent: number;
  recentFiles: RecentFile[];
  languagePreference: LanguagePreference;
  locale: SupportedLocale;
}

export interface FileSession {
  path: string | null;
  displayName: string;
  canonicalMarkdown: string;
  savedMarkdown: string;
  richDoc: JSONContent;
  richVersion: number;
  mode: EditorMode;
  dirty: boolean;
  newlineStyle: NewlineStyle;
  encoding: string;
  fingerprint: FileFingerprint | null;
  conflictKind: ConflictKind;
  lastError: string | null;
}

export interface SavePolicy {
  newlineStyle: NewlineStyle;
}

export const EMPTY_RICH_DOC: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

export const DEFAULT_DOCUMENT_ZOOM_PERCENT = 100;
