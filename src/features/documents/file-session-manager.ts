import type { JSONContent } from "@tiptap/core";

import {
  EMPTY_RICH_DOC,
  type ConflictKind,
  type EditorMode,
  type FileSession,
  type LoadedFile,
  type SaveFileResult,
} from "./types";

function computeDirty(markdown: string, savedMarkdown: string) {
  return markdown !== savedMarkdown;
}

export function createDraftSession(mode: EditorMode = "rich"): FileSession {
  return {
    path: null,
    displayName: "Untitled",
    canonicalMarkdown: "",
    savedMarkdown: "",
    richDoc: EMPTY_RICH_DOC,
    richVersion: 0,
    mode,
    dirty: false,
    newlineStyle: "lf",
    encoding: "utf-8",
    fingerprint: null,
    conflictKind: "none",
    lastError: null,
  };
}

export function openFileSession(
  file: LoadedFile,
  richDoc: JSONContent,
  mode: EditorMode = "rich",
): FileSession {
  return {
    path: file.path,
    displayName: file.displayName,
    canonicalMarkdown: file.markdown,
    savedMarkdown: file.markdown,
    richDoc,
    richVersion: Date.now(),
    mode,
    dirty: false,
    newlineStyle: file.newlineStyle,
    encoding: file.encoding,
    fingerprint: file.fingerprint,
    conflictKind: "none",
    lastError: null,
  };
}

export function replaceRawMarkdown(session: FileSession, markdown: string): FileSession {
  return {
    ...session,
    canonicalMarkdown: markdown,
    dirty: computeDirty(markdown, session.savedMarkdown),
    conflictKind: session.conflictKind === "save-failed" ? "none" : session.conflictKind,
    lastError: null,
  };
}

export function replaceRichDoc(
  session: FileSession,
  richDoc: JSONContent,
  canonicalMarkdown: string,
): FileSession {
  return {
    ...session,
    richDoc,
    canonicalMarkdown,
    dirty: computeDirty(canonicalMarkdown, session.savedMarkdown),
    conflictKind: "none",
    lastError: null,
  };
}

export function syncRichFromMarkdown(
  session: FileSession,
  richDoc: JSONContent,
  mode: EditorMode = "rich",
): FileSession {
  return {
    ...session,
    mode,
    richDoc,
    richVersion: session.richVersion + 1,
    conflictKind: "none",
    lastError: null,
  };
}

export function switchMode(session: FileSession, mode: EditorMode): FileSession {
  return {
    ...session,
    mode,
  };
}

export function markSaved(session: FileSession, result: SaveFileResult): FileSession {
  return {
    ...session,
    path: result.path,
    displayName: result.displayName,
    savedMarkdown: session.canonicalMarkdown,
    dirty: false,
    newlineStyle: result.newlineStyle,
    encoding: result.encoding,
    fingerprint: result.fingerprint,
    conflictKind: "none",
    lastError: null,
  };
}

export function applyReloadedDocument(
  session: FileSession,
  file: LoadedFile,
  richDoc: JSONContent,
): FileSession {
  return {
    ...openFileSession(file, richDoc, session.mode),
    richVersion: session.richVersion + 1,
  };
}

export function markConflict(
  session: FileSession,
  conflictKind: ConflictKind,
  message?: string,
): FileSession {
  return {
    ...session,
    conflictKind,
    lastError: message ?? null,
  };
}

export function clearConflict(session: FileSession): FileSession {
  return {
    ...session,
    conflictKind: "none",
    lastError: null,
  };
}
