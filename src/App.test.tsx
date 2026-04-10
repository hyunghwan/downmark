import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { startWindowDraggingMock } = vi.hoisted(() => ({
  startWindowDraggingMock: vi.fn(async () => undefined),
}));

vi.mock("./features/runtime/tauri-runtime", async () => {
  const actual = await vi.importActual<typeof import("./features/runtime/tauri-runtime")>(
    "./features/runtime/tauri-runtime",
  );

  return {
    ...actual,
    startWindowDragging: startWindowDraggingMock,
  };
});

import App, { type AppDependencies, type DialogPort } from "./App";
import { MarkdownGateway } from "./features/documents/markdown-gateway";
import type {
  AppSettings,
  FileSession,
  FileStatusResponse,
  LoadedFile,
  PrepareImageAssetInput,
  PreparedImageAsset,
  SaveFileResult,
} from "./features/documents/types";
import {
  getSystemLocale,
  resolveLocaleFromPreference,
  type LanguagePreference,
} from "./features/i18n/locale";
import type { AppPlatform } from "./features/runtime/tauri-runtime";

type GatewayPort = AppDependencies["gateway"];
type ShellPort = AppDependencies["shell"];

type TestDependencies = AppDependencies & {
  gateway: FakeGateway;
  dialogs: DialogPort & {
    messages: Array<{ body: string; kind: "error" | "info" | "warning"; title: string }>;
    openFileMock: ReturnType<typeof vi.fn>;
    saveFileMock: ReturnType<typeof vi.fn>;
  };
  shell: FakeShell;
};

class FakeShell implements ShellPort {
  private readonly listeners = new Set<(paths: string[]) => void>();
  private readonly menuListeners = new Set<(action: string) => void>();

  constructor(private readonly initialPaths: string[] = []) {}

  async handleInitialOpen() {
    return [...this.initialPaths];
  }

  async handleSecondaryOpen(onPaths: (paths: string[]) => void) {
    this.listeners.add(onPaths);
    return () => {
      this.listeners.delete(onPaths);
    };
  }

  async handleMenuAction(onAction: (action: string) => void) {
    this.menuListeners.add(onAction);
    return () => {
      this.menuListeners.delete(onAction);
    };
  }

  async openRecent(path: string) {
    return [path];
  }

  emit(paths: string[]) {
    for (const listener of this.listeners) {
      listener(paths);
    }
  }

  emitMenuAction(action: string) {
    for (const listener of this.menuListeners) {
      listener(action);
    }
  }
}

class FakeGateway implements GatewayPort {
  private readonly markdownGateway = new MarkdownGateway();
  private readonly files = new Map<string, LoadedFile>();
  private fingerprintCounter = 0;

  preparedAssets: PreparedImageAsset[] = [];
  removedPaths: string[] = [];
  savedRequests: Array<{ path: string; markdown: string }> = [];
  settings: AppSettings;

  constructor(files: Array<{ markdown: string; path: string }>, settings?: AppSettings) {
    for (const file of files) {
      const loaded = this.createLoadedFile(file.path, file.markdown);
      this.files.set(file.path, loaded);
    }

    this.settings =
      settings ??
      ({
        documentZoomPercent: 100,
        languagePreference: "system",
        locale: resolveLocaleFromPreference("system", getSystemLocale()),
        recentFiles: files.map((file, index) => ({
          path: file.path,
          displayName:
            file.path.split("/")[file.path.split("/").length - 1] ?? file.path,
          lastOpenedMs: 1_700_000_000_000 + index,
        })),
      } satisfies AppSettings);
  }

  destroy() {
    this.markdownGateway.destroy();
  }

  toRich(markdown: string) {
    return this.markdownGateway.toRich(markdown);
  }

  fromRich(doc: import("@tiptap/core").JSONContent) {
    return this.markdownGateway.fromRich(doc);
  }

  normalize(markdown: string, policy: { newlineStyle: "lf" | "crlf" }) {
    return this.markdownGateway.normalize(markdown, policy);
  }

  async load(path: string) {
    const file = this.files.get(path);
    if (!file) {
      throw new Error(`Missing file: ${path}`);
    }

    return structuredClone(file);
  }

  async save(session: FileSession, pathOverride?: string) {
    const path = pathOverride ?? session.path;
    if (!path) {
      throw new Error("No file path is available for save.");
    }

    const loaded = this.createLoadedFile(path, session.canonicalMarkdown);
    this.files.set(path, loaded);
    this.savedRequests.push({ path, markdown: session.canonicalMarkdown });

    return {
      path,
      displayName: loaded.displayName,
      newlineStyle: loaded.newlineStyle,
      encoding: loaded.encoding,
      fingerprint: loaded.fingerprint,
    } satisfies SaveFileResult;
  }

  async checkFileStatus(path: string, session: FileSession) {
    const file = this.files.get(path);
    if (!file) {
      return {
        kind: "missing",
        fingerprint: null,
      } satisfies FileStatusResponse;
    }

    if (session.fingerprint?.sha256 === file.fingerprint.sha256) {
      return {
        kind: "unchanged",
        fingerprint: file.fingerprint,
      } satisfies FileStatusResponse;
    }

    return {
      kind: "modified",
      fingerprint: file.fingerprint,
    } satisfies FileStatusResponse;
  }

  async pathExists(path: string) {
    return this.files.has(path);
  }

  async prepareImageAsset(input: PrepareImageAssetInput) {
    const documentPath = input.documentPath;
    const documentDirectory = documentPath.replace(/[/\\][^/\\]+$/, "");
    const documentName = documentPath.split(/[\\/]/).pop() ?? documentPath;
    const documentStem = documentName.replace(/\.[^.]+$/, "");
    const nextIndex =
      this.preparedAssets.filter((asset) =>
        asset.absolutePath.includes(`${documentStem}-image-`),
      ).length + 1;
    const extension =
      "sourcePath" in input
        ? (input.sourcePath.split(".").pop() ?? "png")
        : input.mimeType.split("/").pop()?.replace("jpeg", "jpg") ?? "png";
    const fileName = `${documentStem}-image-${nextIndex}.${extension}`;
    const prepared = {
      relativePath: fileName.replace(/ /g, "%20"),
      absolutePath: `${documentDirectory}/${fileName}`,
      alt:
        "sourcePath" in input
          ? (input.sourcePath.split(/[\\/]/).pop() ?? fileName).replace(/\.[^.]+$/, "")
          : fileName.replace(/\.[^.]+$/, ""),
    } satisfies PreparedImageAsset;

    this.preparedAssets.push(prepared);
    return prepared;
  }

  async relocateLocalImageLinks(
    markdown: string,
    fromDocumentPath: string | null,
    toDocumentPath: string,
  ) {
    if (!fromDocumentPath || fromDocumentPath === toDocumentPath) {
      return markdown;
    }

    const fromStem = fromDocumentPath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "";

    return markdown.replace(
      /!\[[^\]]*]\(([^)\s]+)(?:\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'))?\)/g,
      (full, destination: string) => {
        const normalized = destination.startsWith("./")
          ? destination.slice(2)
          : destination;
        const decoded = normalized.replace(/%20/g, " ");
        if (
          decoded.includes("/") ||
          decoded.includes("\\") ||
          !decoded.startsWith(`${fromStem}-image-`)
        ) {
          return full;
        }

        const nextDocumentStem =
          toDocumentPath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "document";
        const nextIndex =
          this.preparedAssets.filter((asset) =>
            asset.absolutePath.includes(`${nextDocumentStem}-image-`),
          ).length + 1;
        const extension = decoded.split(".").pop() ?? "png";
        const nextRelativePath = `${nextDocumentStem}-image-${nextIndex}.${extension}`;
        const nextDirectory = toDocumentPath.replace(/[/\\][^/\\]+$/, "");

        this.preparedAssets.push({
          relativePath: nextRelativePath,
          absolutePath: `${nextDirectory}/${nextRelativePath}`,
          alt: decoded.replace(/\.[^.]+$/, ""),
        });

        return full.replace(destination, nextRelativePath);
      },
    );
  }

  async loadSettings() {
    return structuredClone(this.settings);
  }

  async recordRecentFile(path: string) {
    const existing = this.settings.recentFiles.filter((entry) => entry.path !== path);
    const file = this.files.get(path);

    this.settings = {
      ...this.settings,
      recentFiles: [
        {
          path,
          displayName:
            file?.displayName ??
            (path.split("/")[path.split("/").length - 1] ?? path),
          lastOpenedMs: Date.now(),
        },
        ...existing,
      ],
    };

    return structuredClone(this.settings);
  }

  async removeRecentFile(path: string) {
    this.removedPaths.push(path);
    this.settings = {
      ...this.settings,
      recentFiles: this.settings.recentFiles.filter((entry) => entry.path !== path),
    };

    return structuredClone(this.settings);
  }

  async setLanguagePreference(languagePreference: LanguagePreference) {
    this.settings = {
      ...this.settings,
      languagePreference,
      locale: resolveLocaleFromPreference(languagePreference, getSystemLocale()),
    };

    return structuredClone(this.settings);
  }

  async setDocumentZoomPercent(documentZoomPercent: number) {
    this.settings = {
      ...this.settings,
      documentZoomPercent,
    };

    return structuredClone(this.settings);
  }

  markModified(path: string, markdown: string) {
    const loaded = this.createLoadedFile(path, markdown);
    this.files.set(path, loaded);
  }

  private createLoadedFile(path: string, markdown: string): LoadedFile {
    this.fingerprintCounter += 1;

    return {
      path,
      displayName: path.split("/")[path.split("/").length - 1] ?? path,
      markdown,
      newlineStyle: "lf",
      encoding: "utf-8",
      fingerprint: {
        exists: true,
        modifiedMs: this.fingerprintCounter,
        size: markdown.length,
        sha256: `${path}:${this.fingerprintCounter}:${markdown.length}`,
      },
    };
  }
}

function createDialogs(overrides?: Partial<Record<"openFile" | "saveFile", string | null>>) {
  const messages: Array<{ body: string; kind: "error" | "info" | "warning"; title: string }> = [];
  const openFileMock = vi.fn(async () => overrides?.openFile ?? null);
  const saveFileMock = vi.fn(async (_defaultPath?: string) => overrides?.saveFile ?? null);

  return {
    messages,
    openFileMock,
    saveFileMock,
    async openFile(_filters) {
      return openFileMock();
    },
    async saveFile(defaultPath, _filters) {
      return saveFileMock(defaultPath);
    },
    async showMessage(body, options) {
      messages.push({ body, ...options });
    },
  } satisfies DialogPort & {
    messages: Array<{ body: string; kind: "error" | "info" | "warning"; title: string }>;
    openFileMock: ReturnType<typeof vi.fn>;
    saveFileMock: ReturnType<typeof vi.fn>;
  };
}

function renderApp(options?: {
  dialogOverrides?: Partial<Record<"openFile" | "saveFile", string | null>>;
  files?: Array<{ markdown: string; path: string }>;
  initialPaths?: string[];
  platform?: AppPlatform;
  pollIntervalMs?: number;
  promptForLink?: (prompt: string) => Promise<string | null>;
  requiresRestartOnLanguageChange?: boolean;
  settings?: AppSettings;
}) {
  const files =
    options?.files ??
    [
      {
        path: "/notes/current.md",
        markdown: "# Current\n\nBody",
      },
      {
        path: "/notes/next.md",
        markdown: "# Next\n\nBody",
      },
    ];

  const gateway = new FakeGateway(files, options?.settings);
  const shell = new FakeShell(options?.initialPaths ?? []);
  const dialogs = createDialogs(options?.dialogOverrides);
  const dependencies: TestDependencies = {
    gateway,
    shell,
    dialogs,
    fileStatusPollMs: options?.pollIntervalMs,
    platform: options?.platform ?? "other",
    promptForLink: options?.promptForLink ?? (async (_prompt) => null),
    requiresRestartOnLanguageChange: options?.requiresRestartOnLanguageChange,
  };

  render(<App dependencies={dependencies} />);

  return dependencies;
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });

  window.dispatchEvent(new Event("resize"));
}

function setNavigatorLanguage(language: string) {
  Object.defineProperty(window.navigator, "language", {
    configurable: true,
    value: language,
  });
}

function createImageFile(
  name: string,
  options?: { path?: string; type?: string },
) {
  const bytes = new TextEncoder().encode("image-bytes");
  const file = new File(["image-bytes"], name, {
    type: options?.type ?? "image/png",
  });

  Object.defineProperty(file, "arrayBuffer", {
    configurable: true,
    value: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });

  if (options?.path) {
    Object.defineProperty(file, "path", {
      configurable: true,
      value: options.path,
    });
  }

  return file;
}

async function waitForOpenFile(name: string) {
  await waitFor(() => {
    const documentTitle = screen.getByTitle(`/notes/${name}`);
    expect(documentTitle).toBeInTheDocument();
    expect(documentTitle).toHaveTextContent(name);
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  startWindowDraggingMock.mockClear();
  setNavigatorLanguage("en-US");
  setViewportWidth(1024);
});

describe("downmark app", () => {
  it("renders a single-column workspace and keeps metadata in the toolbar row", async () => {
    renderApp({
      initialPaths: ["/notes/current.md"],
    });

    await waitForOpenFile("current.md");

    expect(document.querySelector(".app-titlebar")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Recent files" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save As" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /switch to (light|dark) mode/i }),
    ).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Open recent files" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close window" })).not.toBeInTheDocument();
    const metadata = screen.getByLabelText("Document metadata");
    expect(metadata).toHaveTextContent("2 words · 15 chars");
    expect(metadata).toHaveTextContent("Saved");
    expect(within(metadata).getByRole("radio", { name: "Rich" })).toBeChecked();
  });

  it("renders a macOS overlay header with filename-only label beside native traffic lights", async () => {
    renderApp({
      initialPaths: ["/notes/current.md"],
      platform: "macos",
    });

    await waitFor(() => {
      expect(screen.getByTitle("/notes/current.md")).toHaveTextContent("current.md");
    });

    expect(screen.queryByText("/notes/current.md")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close window" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Minimize window" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zoom window" })).not.toBeInTheDocument();

    const header = document.querySelector(".workspace-header.is-custom-titlebar");
    const heading = header?.querySelector(".workspace-heading");
    const dragSpacer = header?.querySelector(".workspace-drag-spacer.is-custom-titlebar");
    expect(header).not.toBeNull();
    expect(heading).not.toBeNull();
    expect(heading?.children[0]).toBe(screen.getByRole("button", { name: "Open recent files" }));
    expect(heading?.children[1]).toBe(screen.getByTitle("/notes/current.md"));
    expect(dragSpacer).not.toBeNull();
    expect(screen.getByTitle("/notes/current.md")).toHaveAttribute("data-tauri-drag-region");
    expect(dragSpacer).toHaveAttribute("data-tauri-drag-region");
  });

  it("starts window dragging from non-interactive macOS header areas only", async () => {
    renderApp({
      initialPaths: ["/notes/current.md"],
      platform: "macos",
    });

    await waitForOpenFile("current.md");

    const header = document.querySelector(".workspace-header.is-custom-titlebar");
    expect(header).not.toBeNull();

    fireEvent.mouseDown(screen.getByTitle("/notes/current.md"), { button: 0 });
    expect(startWindowDraggingMock).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(screen.getByRole("button", { name: "Open recent files" }), {
      button: 0,
    });
    expect(startWindowDraggingMock).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(screen.getByRole("radio", { name: "Rich" }), { button: 0 });
    expect(startWindowDraggingMock).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(header as Element, { button: 0 });
    expect(startWindowDraggingMock).toHaveBeenCalledTimes(2);
  });

  it("uses the stored language override on first render", async () => {
    renderApp({
      initialPaths: ["/notes/current.md"],
      settings: {
        documentZoomPercent: 100,
        languagePreference: "ko",
        locale: "ko",
        recentFiles: [],
      },
    });

    await waitForOpenFile("current.md");

    expect(screen.getByRole("button", { name: "최근 파일 열기" })).toBeInTheDocument();
    expect(screen.getByLabelText("문서 메타데이터")).toHaveTextContent("저장됨");
    expect(screen.getByRole("radio", { name: "리치" })).toBeChecked();
    expect(
      screen.getByRole("textbox", { name: "리치 텍스트 편집기" }),
    ).toBeInTheDocument();
  });

  it("switches languages from the menu and restores system locale while preserving raw selection", async () => {
    setNavigatorLanguage("es-MX");
    const dependencies = renderApp({
      initialPaths: ["/notes/current.md"],
    });

    await waitForOpenFile("current.md");
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Abrir archivos recientes" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("radio", { name: "Plano" }));
    const textarea = (await screen.findByRole("textbox", {
      name: "Editor de markdown plano",
    })) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(4, 9);

    act(() => {
      dependencies.shell.emitMenuAction("set-language-ko");
    });

    const koreanTextarea = (await screen.findByRole("textbox", {
      name: "원문 마크다운 편집기",
    })) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "최근 파일 열기" })).toBeInTheDocument();
    });
    expect(screen.getByRole("radio", { name: "원문" })).toBeChecked();
    expect(koreanTextarea).toHaveValue("# Current\n\nBody");
    expect(koreanTextarea.selectionStart).toBe(4);
    expect(koreanTextarea.selectionEnd).toBe(9);

    act(() => {
      dependencies.shell.emitMenuAction("set-language-system");
    });

    const spanishTextarea = (await screen.findByRole("textbox", {
      name: "Editor de markdown plano",
    })) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Abrir archivos recientes" }),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("radio", { name: "Plano" })).toBeChecked();
    expect(spanishTextarea.selectionStart).toBe(4);
    expect(spanishTextarea.selectionEnd).toBe(9);
  });

  it("keeps the current screen visible and asks for a restart when language changes are deferred", async () => {
    const dependencies = renderApp({
      initialPaths: ["/notes/current.md"],
      requiresRestartOnLanguageChange: true,
    });

    await waitForOpenFile("current.md");
    expect(screen.getByRole("button", { name: "Open recent files" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Rich text editor" })).toBeInTheDocument();

    act(() => {
      dependencies.shell.emitMenuAction("set-language-ko");
    });

    await waitFor(() => {
      expect(dependencies.dialogs.messages).toContainEqual({
        body:
          "The language preference was saved. Relaunch downmark to finish applying it.",
        kind: "info",
        title: "Restart to apply language change",
      });
    });

    expect(screen.getByRole("button", { name: "Open recent files" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Rich text editor" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "최근 파일 열기" })).not.toBeInTheDocument();
    expect(dependencies.gateway.settings.languagePreference).toBe("ko");
  });

  it("renders raw markdown into the rich editor when switching modes", async () => {
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Raw" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("radio", { name: "Raw" }));

    const textarea = screen.getByRole("textbox", { name: "Raw markdown editor" });
    fireEvent.change(textarea, {
      target: {
        value: "# Heading\n\n- first\n- second\n\n`inline`\n\n---",
      },
    });

    await user.click(screen.getByRole("radio", { name: "Rich" }));

    const editor = await screen.findByRole("textbox", { name: "Rich text editor" });
    await waitFor(() => {
      expect(editor).toHaveFocus();
    });
    expect(within(editor).getByRole("heading", { level: 1, name: "Heading" })).toBeInTheDocument();
    expect(within(editor).getByText("inline", { selector: "code" })).toBeInTheDocument();
    expect(editor.querySelectorAll("li")).toHaveLength(2);
    expect(editor.querySelector("hr")).not.toBeNull();
  });

  it("serializes rich edits back into raw markdown", async () => {
    const user = userEvent.setup();
    renderApp();

    const richEditor = await screen.findByRole("textbox", { name: "Rich text editor" });
    await user.click(richEditor);
    await user.paste("Hello from rich");

    fireEvent.click(screen.getByRole("radio", { name: "Raw" }));

    const textarea = screen.getByRole("textbox", { name: "Raw markdown editor" });
    await waitFor(() => {
      expect(textarea).toHaveFocus();
    });
    expect(textarea).toHaveValue("Hello from rich");
  });

  it("preserves heading block formatting when switching back to raw", async () => {
    renderApp({
      files: [
        {
          path: "/notes/current.md",
          markdown: "# Title",
        },
      ],
      initialPaths: ["/notes/current.md"],
    });

    await waitForOpenFile("current.md");

    const richEditor = await screen.findByRole("textbox", { name: "Rich text editor" });
    expect(within(richEditor).getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Raw" }));

    const textarea = (await screen.findByRole("textbox", {
      name: "Raw markdown editor",
    })) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(textarea.value.trimEnd()).toBe("# Title");
    });
  });

  it("prompts before opening a new file when there are unsaved changes", async () => {
    const user = userEvent.setup();
    const dependencies = renderApp({
      dialogOverrides: {
        openFile: "/notes/next.md",
      },
    });
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Raw" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("radio", { name: "Raw" }));
    await screen.findByRole("textbox", { name: "Raw markdown editor" });

    fireEvent.change(screen.getByRole("textbox", { name: "Raw markdown editor" }), {
      target: {
        value: "# Draft\n\nChanged in raw",
      },
    });

    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    await waitFor(() => {
      expect(dependencies.dialogs.openFileMock).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByRole("alertdialog", { name: "Unsaved changes" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Don't Save" }));

    await waitForOpenFile("next.md");
    expect(screen.queryByRole("alertdialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
  });

  it("announces external modification while dirty and offers recovery actions", async () => {
    const user = userEvent.setup();
    const dependencies = renderApp({
      initialPaths: ["/notes/current.md"],
      pollIntervalMs: 10_000,
    });

    await waitForOpenFile("current.md");
    fireEvent.click(screen.getByRole("radio", { name: "Raw" }));
    await screen.findByRole("textbox", { name: "Raw markdown editor" });
    fireEvent.change(screen.getByRole("textbox", { name: "Raw markdown editor" }), {
      target: {
        value: "# Current\n\nDirty change",
      },
    });

    dependencies.gateway.markModified("/notes/current.md", "# Current\n\nChanged on disk");
    fireEvent.focus(window);

    await waitFor(() => {
      expect(
        screen.getByRole("alertdialog", { name: "File changed on disk" }),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Disk version changed while you still have unsaved edits.",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved");

    await user.click(screen.getByRole("button", { name: "Keep Mine" }));
    expect(screen.queryByRole("alertdialog", { name: "File changed on disk" })).not.toBeInTheDocument();
  });

  it("keeps recent hidden by default and opens it as an overlay drawer", async () => {
    const user = userEvent.setup();
    renderApp({
      initialPaths: ["/notes/current.md"],
    });

    await waitForOpenFile("current.md");

    const sidebarToggle = screen.getByRole("button", { name: "Open recent files" });
    expect(screen.queryByRole("dialog", { name: "Recent files" })).not.toBeInTheDocument();

    await user.click(sidebarToggle);

    const sidebar = await screen.findByRole("dialog", { name: "Recent files" });
    expect(sidebar).toBeInTheDocument();
    expect(within(sidebar).getByRole("button", { name: /current\.md/i })).toHaveClass("is-active");

    const scrim = document.querySelector(".sidebar-scrim");
    expect(scrim).not.toBeNull();
    await user.click(scrim as HTMLElement);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Recent files" })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(sidebarToggle).toHaveFocus();
    });
  });

  it("resets the editor viewport to the top when opening another document", async () => {
    const user = userEvent.setup();
    renderApp({
      files: [
        {
          path: "/notes/current.md",
          markdown: `# Current\n\n${"Current line\n".repeat(120)}`,
        },
        {
          path: "/notes/next.md",
          markdown: `# Next\n\n${"Next line\n".repeat(120)}`,
        },
      ],
      initialPaths: ["/notes/current.md"],
    });

    await waitForOpenFile("current.md");

    const viewport = document.querySelector(".editor-shell") as HTMLElement | null;
    expect(viewport).not.toBeNull();

    Object.defineProperty(viewport, "scrollHeight", {
      configurable: true,
      value: 1600,
    });
    Object.defineProperty(viewport, "clientHeight", {
      configurable: true,
      value: 400,
    });

    viewport!.scrollTop = 280;

    await user.click(screen.getByRole("button", { name: "Open recent files" }));

    const drawer = await screen.findByRole("dialog", { name: "Recent files" });
    await user.click(within(drawer).getByRole("button", { name: /next\.md/i }));

    const unsavedPrompt = screen.queryByRole("alertdialog", {
      name: "Unsaved changes",
    });
    if (unsavedPrompt) {
      await user.click(within(unsavedPrompt).getByRole("button", { name: "Don't Save" }));
    }

    await waitForOpenFile("next.md");
    await waitFor(() => {
      expect(viewport!.scrollTop).toBe(0);
    });
  });

  it("keeps raw mode, auto-grows the textarea, and resets to the top when opening another document", async () => {
    const user = userEvent.setup();
    renderApp({
      files: [
        {
          path: "/notes/current.md",
          markdown: `# Current\n\n${"Current line\n".repeat(120)}`,
        },
        {
          path: "/notes/next.md",
          markdown: `# Next\n\n${"Next line\n".repeat(120)}`,
        },
      ],
      initialPaths: ["/notes/current.md"],
    });

    await waitForOpenFile("current.md");
    fireEvent.click(screen.getByRole("radio", { name: "Raw" }));

    const viewport = document.querySelector(".editor-shell") as HTMLElement | null;
    expect(viewport).not.toBeNull();

    Object.defineProperty(viewport, "scrollHeight", {
      configurable: true,
      value: 1600,
    });
    Object.defineProperty(viewport, "clientHeight", {
      configurable: true,
      value: 400,
    });

    const restoreScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
    );

    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return 1600;
      },
    });

    try {
      window.dispatchEvent(new Event("resize"));

      const textarea = await screen.findByRole("textbox", {
        name: "Raw markdown editor",
      }) as HTMLTextAreaElement;

      await waitFor(() => {
        expect(textarea.style.height).toBe("1600px");
      });

      viewport!.scrollTop = 280;
      textarea.focus();
      textarea.setSelectionRange(20, 20);

      await user.click(screen.getByRole("button", { name: "Open recent files" }));
      const drawer = await screen.findByRole("dialog", { name: "Recent files" });
      await user.click(within(drawer).getByRole("button", { name: /next\.md/i }));

      const unsavedPrompt = screen.queryByRole("alertdialog", {
        name: "Unsaved changes",
      });
      if (unsavedPrompt) {
        await user.click(within(unsavedPrompt).getByRole("button", { name: "Don't Save" }));
      }

      await waitForOpenFile("next.md");
      expect(screen.getByRole("radio", { name: "Raw" })).toBeChecked();

      const nextTextarea = await screen.findByRole("textbox", {
        name: "Raw markdown editor",
      }) as HTMLTextAreaElement;

      await waitFor(() => {
        expect(viewport!.scrollTop).toBe(0);
      });
      await waitFor(() => {
        expect(nextTextarea.selectionStart).toBe(0);
      });
      expect(nextTextarea.selectionEnd).toBe(0);
    } finally {
      if (restoreScrollHeight) {
        Object.defineProperty(
          HTMLTextAreaElement.prototype,
          "scrollHeight",
          restoreScrollHeight,
        );
      } else {
        delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
      }
    }
  });

  it("removes missing recent files and closes the overlay with Escape", async () => {
    const user = userEvent.setup();
    setViewportWidth(700);
    const dependencies = renderApp({
      initialPaths: ["/notes/current.md"],
      settings: {
        documentZoomPercent: 100,
        languagePreference: "system",
        locale: "en",
        recentFiles: [
          {
            path: "/notes/current.md",
            displayName: "current.md",
            lastOpenedMs: 1,
          },
          {
            path: "/notes/missing.md",
            displayName: "missing.md",
            lastOpenedMs: 2,
          },
        ],
      },
    });

    await waitFor(() => {
      expect(dependencies.gateway.removedPaths).toContain("/notes/missing.md");
    });

    const richEditor = await screen.findByRole("textbox", { name: "Rich text editor" });
    await waitFor(() => {
      expect(richEditor).toHaveFocus();
    });

    const sidebarToggle = screen.getByRole("button", { name: "Open recent files" });
    await user.click(sidebarToggle);

    const sidebar = await screen.findByRole("dialog", { name: "Recent files" });
    expect(sidebar).toBeInTheDocument();
    expect(screen.queryByText("missing.md")).not.toBeInTheDocument();

    const currentRecent = within(sidebar).getByRole("button", { name: /current\.md/i });
    await waitFor(() => {
      expect(currentRecent).toHaveFocus();
    });

    fireEvent.keyDown(sidebar, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Recent files" })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(sidebarToggle).toHaveFocus();
    });
    expect(sidebarToggle).toHaveAttribute("aria-expanded", "false");
  });

  it("supports keyboard shortcuts for open, save, and save as", async () => {
    const dependencies = renderApp({
      initialPaths: ["/notes/current.md"],
      dialogOverrides: {
        openFile: "/notes/next.md",
        saveFile: "/notes/saved-as.md",
      },
    });

    await waitForOpenFile("current.md");

    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    await waitFor(() => {
      expect(dependencies.dialogs.openFileMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => {
      expect(dependencies.gateway.savedRequests).toHaveLength(1);
    });

    fireEvent.keyDown(window, { key: "S", ctrlKey: true, shiftKey: true });
    await waitFor(() => {
      expect(dependencies.dialogs.saveFileMock).toHaveBeenCalled();
    });
  });

  it("supports keyboard shortcuts for document zoom", async () => {
    const dependencies = renderApp({
      initialPaths: ["/notes/current.md"],
      settings: {
        documentZoomPercent: 120,
        languagePreference: "system",
        locale: resolveLocaleFromPreference("system", getSystemLocale()),
        recentFiles: [],
      },
    });

    await waitForOpenFile("current.md");

    const editorShell = document.querySelector(".editor-shell");
    expect(editorShell).toHaveAttribute("style", "--editor-zoom: 1.2;");

    fireEvent.keyDown(window, { key: "-", ctrlKey: true });
    await waitFor(() => {
      expect(dependencies.gateway.settings.documentZoomPercent).toBe(110);
    });
    await waitFor(() => {
      expect(editorShell).toHaveAttribute("style", "--editor-zoom: 1.1;");
    });

    fireEvent.keyDown(window, { key: "=", ctrlKey: true });
    await waitFor(() => {
      expect(dependencies.gateway.settings.documentZoomPercent).toBe(120);
    });

    fireEvent.keyDown(window, { key: "0", ctrlKey: true });
    await waitFor(() => {
      expect(dependencies.gateway.settings.documentZoomPercent).toBe(100);
    });
    await waitFor(() => {
      expect(editorShell).toHaveAttribute("style", "--editor-zoom: 1;");
    });
  });

  it("switches to raw mode through the shell menu bridge", async () => {
    const dependencies = renderApp({
      initialPaths: ["/notes/current.md"],
    });

    await waitForOpenFile("current.md");

    act(() => {
      dependencies.shell.emitMenuAction("set-raw-mode");
    });
    const textarea = (await screen.findByRole("textbox", {
      name: "Raw markdown editor",
    })) as HTMLTextAreaElement;
    expect(textarea).toHaveValue("# Current\n\nBody");
  });

  it("opens a fresh rich draft through the shell menu bridge", async () => {
    const dependencies = renderApp({
      initialPaths: ["/notes/current.md"],
    });

    await waitForOpenFile("current.md");

    act(() => {
      dependencies.shell.emitMenuAction("new-draft");
    });
    await waitFor(() => {
      expect(screen.getByText("Scratch note")).toBeInTheDocument();
    });
    expect(screen.getByRole("radio", { name: "Rich" })).toBeChecked();
    const richEditor = screen.getByRole("textbox", { name: "Rich text editor" });
    await waitFor(() => {
      expect(richEditor).toHaveFocus();
    });
    await waitFor(() => {
      expect(richEditor).not.toHaveTextContent(/\S/);
    });
  });

  it("opens a fresh raw draft at the top when requested from raw mode", async () => {
    const dependencies = renderApp({
      initialPaths: ["/notes/current.md"],
    });

    await waitForOpenFile("current.md");
    fireEvent.click(screen.getByRole("radio", { name: "Raw" }));

    const viewport = document.querySelector(".editor-shell") as HTMLElement | null;
    expect(viewport).not.toBeNull();

    Object.defineProperty(viewport, "scrollHeight", {
      configurable: true,
      value: 1600,
    });
    Object.defineProperty(viewport, "clientHeight", {
      configurable: true,
      value: 400,
    });

    const textarea = await screen.findByRole("textbox", {
      name: "Raw markdown editor",
    }) as HTMLTextAreaElement;
    viewport!.scrollTop = 220;
    textarea.focus();
    textarea.setSelectionRange(18, 18);

    act(() => {
      dependencies.shell.emitMenuAction("new-draft");
    });

    await waitFor(() => {
      expect(screen.getByText("Scratch note")).toBeInTheDocument();
    });
    expect(screen.getByRole("radio", { name: "Raw" })).toBeChecked();

    const draftTextarea = await screen.findByRole("textbox", {
      name: "Raw markdown editor",
    }) as HTMLTextAreaElement;

    await waitFor(() => {
      expect(viewport!.scrollTop).toBe(0);
    });
    await waitFor(() => {
      expect(draftTextarea.selectionStart).toBe(0);
    });
    expect(draftTextarea.selectionEnd).toBe(0);
    expect(draftTextarea).toHaveValue("");
  });

  it("renders markdown images and tables when switching from raw to rich", async () => {
    const user = userEvent.setup();
    renderApp();

    fireEvent.click(await screen.findByRole("radio", { name: "Raw" }));
    const textarea = screen.getByRole("textbox", { name: "Raw markdown editor" });
    fireEvent.change(textarea, {
      target: {
        value:
          "![diagram](diagram.png)\n\n| Name | Value |\n| --- | ---: |\n| Alpha | 1 |\n| Beta | 2 |",
      },
    });

    await user.click(screen.getByRole("radio", { name: "Rich" }));

    const editor = await screen.findByRole("textbox", { name: "Rich text editor" });
    await waitFor(() => {
      expect(editor.querySelector("img[src=\"diagram.png\"]")).not.toBeNull();
    });
    expect(within(editor).getByRole("table")).toBeInTheDocument();
    expect(within(editor).getByText("Alpha")).toBeInTheDocument();
    expect(within(editor).getByText("2")).toBeInTheDocument();
  });

  it("shows floating table actions and adds rows and columns from rich mode", async () => {
    const user = userEvent.setup();
    renderApp({
      files: [
        {
          path: "/notes/current.md",
          markdown:
            "| Name | Value |\n| --- | --- |\n| Alpha | 1 |\n| Beta | 2 |",
        },
      ],
      initialPaths: ["/notes/current.md"],
    });

    await waitForOpenFile("current.md");

    const editor = await screen.findByRole("textbox", { name: "Rich text editor" });
    await user.click(within(editor).getByText("Alpha"));

    const toolbar = await screen.findByRole("toolbar", { name: "Table actions" });
    const getTable = () => within(editor).getByRole("table");

    expect(getTable().querySelectorAll("tr")).toHaveLength(3);

    await user.click(within(toolbar).getByRole("button", { name: "Add Row Below" }));

    await waitFor(() => {
      expect(getTable().querySelectorAll("tr")).toHaveLength(4);
    });

    await user.click(within(toolbar).getByRole("button", { name: "Add Column Right" }));

    await waitFor(() => {
      const firstRow = getTable().querySelector("tr");
      expect(firstRow?.querySelectorAll("th, td")).toHaveLength(3);
    });
  });

  it("renders saved local markdown images with a resolved file URL in rich mode", async () => {
    renderApp({
      files: [
        {
          path: "/notes/current.md",
          markdown: "# Current\n\n![photo](current-image-1.png)",
        },
      ],
      initialPaths: ["/notes/current.md"],
    });

    await waitForOpenFile("current.md");

    const editor = await screen.findByRole("textbox", { name: "Rich text editor" });
    const image = within(editor).getByRole("img", { name: "photo" });

    await waitFor(() => {
      expect(image.getAttribute("src")).toBe("file:///notes/current-image-1.png");
    });
  });

  it("inserts a clipboard image into raw mode after saving an untitled document", async () => {
    renderApp({
      dialogOverrides: {
        saveFile: "/notes/draft.md",
      },
    });

    fireEvent.click(await screen.findByRole("radio", { name: "Raw" }));
    const textarea = (await screen.findByRole("textbox", {
      name: "Raw markdown editor",
    })) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(0, 0);

    fireEvent.paste(textarea, {
      clipboardData: {
        files: [createImageFile("screenshot.png")],
      },
    });

    await waitFor(() => {
      expect(textarea).toHaveValue("![screenshot](draft-image-1.png)");
    });
  });

  it("drops a local image into the rich editor as a relative markdown image", async () => {
    const dependencies = renderApp({
      initialPaths: ["/notes/current.md"],
    });

    await waitForOpenFile("current.md");

    const richEditor = await screen.findByRole("textbox", { name: "Rich text editor" });
    fireEvent.drop(richEditor, {
      clientX: 12,
      clientY: 12,
      dataTransfer: {
        files: [
          createImageFile("photo.png", {
            path: "/tmp/photo.png",
          }),
        ],
      },
    });

    await waitFor(() => {
      expect(dependencies.gateway.preparedAssets[0]?.relativePath).toBe("current-image-1.png");
    });

    fireEvent.click(screen.getByRole("radio", { name: "Raw" }));
    const textarea = (await screen.findByRole("textbox", {
      name: "Raw markdown editor",
    })) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(textarea.value.trimEnd()).toBe("# Current\n\nBody\n\n![photo](current-image-1.png)");
    });
  });

  it("rewrites generated local image links when saving as a new document", async () => {
    const dependencies = renderApp({
      dialogOverrides: {
        saveFile: "/notes/renamed.md",
      },
      files: [
        {
          path: "/notes/current.md",
          markdown: "# Current\n\n![photo](current-image-1.png)",
        },
      ],
      initialPaths: ["/notes/current.md"],
    });

    await waitForOpenFile("current.md");
    fireEvent.keyDown(window, { key: "S", ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      expect(
        dependencies.gateway.savedRequests.some(
          (request) =>
            request.path === "/notes/renamed.md" &&
            request.markdown.includes("renamed-image-1.png"),
        ),
      ).toBe(true);
    });

    fireEvent.click(screen.getByRole("radio", { name: "Raw" }));
    const textarea = (await screen.findByRole("textbox", {
      name: "Raw markdown editor",
    })) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(textarea.value.trimEnd()).toBe("# Current\n\n![photo](renamed-image-1.png)");
    });
  });
});
