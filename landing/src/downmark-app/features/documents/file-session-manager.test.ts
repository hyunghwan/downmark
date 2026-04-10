import { describe, expect, it } from "vitest";

import {
  applyReloadedDocument,
  createDraftSession,
  markConflict,
  markSaved,
  openFileSession,
  replaceRawMarkdown,
  replaceRichDoc,
  syncRichFromMarkdown,
} from "./file-session-manager";
import { EMPTY_RICH_DOC, type LoadedFile, type SaveFileResult } from "./types";

const loadedFile: LoadedFile = {
  path: "/tmp/demo.md",
  displayName: "demo.md",
  markdown: "# Hello\n\n- item",
  newlineStyle: "lf",
  encoding: "utf-8",
  fingerprint: {
    exists: true,
    modifiedMs: 1,
    size: 10,
    sha256: "abc",
  },
};

const savedResult: SaveFileResult = {
  path: loadedFile.path,
  displayName: loadedFile.displayName,
  newlineStyle: "lf",
  encoding: "utf-8",
  fingerprint: {
    exists: true,
    modifiedMs: 2,
    size: 11,
    sha256: "def",
  },
};

describe("file session manager", () => {
  it("creates a clean draft session", () => {
    const session = createDraftSession();

    expect(session.displayName).toBe("Untitled");
    expect(session.dirty).toBe(false);
    expect(session.mode).toBe("rich");
  });

  it("opens a file and marks raw edits dirty", () => {
    const session = openFileSession(loadedFile, EMPTY_RICH_DOC);
    const edited = replaceRawMarkdown(session, `${loadedFile.markdown}\n- second`);

    expect(session.dirty).toBe(false);
    expect(edited.dirty).toBe(true);
    expect(edited.canonicalMarkdown).toContain("second");
  });

  it("applies rich updates without losing markdown source of truth", () => {
    const session = openFileSession(loadedFile, EMPTY_RICH_DOC);
    const updated = replaceRichDoc(session, EMPTY_RICH_DOC, "# Hello\n\n> quote");

    expect(updated.canonicalMarkdown).toContain("> quote");
    expect(updated.dirty).toBe(true);
  });

  it("clears dirty state after save", () => {
    const session = replaceRawMarkdown(
      openFileSession(loadedFile, EMPTY_RICH_DOC),
      "# Hello\n\nUpdated",
    );
    const saved = markSaved(session, savedResult);

    expect(saved.dirty).toBe(false);
    expect(saved.savedMarkdown).toBe("# Hello\n\nUpdated");
    expect(saved.fingerprint?.sha256).toBe("def");
  });

  it("bumps rich version when syncing from canonical markdown", () => {
    const session = replaceRawMarkdown(createDraftSession("raw"), "## Fresh");
    const synced = syncRichFromMarkdown(session, EMPTY_RICH_DOC, "rich");

    expect(synced.mode).toBe("rich");
    expect(synced.richVersion).toBeGreaterThan(session.richVersion);
  });

  it("keeps conflict markers when a file is reloaded from disk", () => {
    const session = markConflict(
      openFileSession(loadedFile, EMPTY_RICH_DOC),
      "externally-modified",
      "Changed on disk",
    );
    const reloaded = applyReloadedDocument(session, loadedFile, EMPTY_RICH_DOC);

    expect(reloaded.conflictKind).toBe("none");
    expect(reloaded.dirty).toBe(false);
  });
});
