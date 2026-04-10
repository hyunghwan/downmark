import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App, { type AppDependencies, type DialogPort } from "./App";
import { MarkdownGateway } from "./features/documents/markdown-gateway";
import type {
  AppSettings,
  FileSession,
  FileStatusResponse,
  LoadedFile,
  SaveFileResult,
} from "./features/documents/types";

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

  async loadSettings() {
    return structuredClone(this.settings);
  }

  async recordRecentFile(path: string) {
    const existing = this.settings.recentFiles.filter((entry) => entry.path !== path);
    const file = this.files.get(path);

    this.settings = {
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
      recentFiles: this.settings.recentFiles.filter((entry) => entry.path !== path),
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
  const saveFileMock = vi.fn(async () => overrides?.saveFile ?? null);

  return {
    messages,
    openFileMock,
    saveFileMock,
    openFile: openFileMock,
    saveFile: saveFileMock,
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
  pollIntervalMs?: number;
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
    promptForLink: async () => null,
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

async function waitForOpenFile(name: string) {
  await waitFor(() => {
    expect(screen.getByRole("heading", { level: 1, name })).toBeInTheDocument();
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  setViewportWidth(1024);
});

describe("downmark app", () => {
  it("renders raw markdown into the rich editor when switching modes", async () => {
    const user = userEvent.setup();
    renderApp();

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
    renderApp({
      dialogOverrides: {
        openFile: "/notes/next.md",
      },
    });

    fireEvent.click(screen.getByRole("radio", { name: "Raw" }));
    await screen.findByRole("textbox", { name: "Raw markdown editor" });

    fireEvent.change(screen.getByRole("textbox", { name: "Raw markdown editor" }), {
      target: {
        value: "# Draft\n\nChanged in raw",
      },
    });

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(await screen.findByRole("alertdialog", { name: "Unsaved changes" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Don't Save" }));

    await waitForOpenFile("next.md");
    expect(screen.queryByRole("alertdialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
  });

  it("announces external modification while dirty and offers recovery actions", async () => {
    const user = userEvent.setup();
    const dependencies = renderApp({
      dialogOverrides: {
        openFile: "/notes/current.md",
      },
      pollIntervalMs: 10_000,
    });

    await user.click(screen.getByRole("button", { name: "Open" }));
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

  it("shows the recent sidebar by default on desktop and supports collapse/reopen", async () => {
    const user = userEvent.setup();
    renderApp({
      initialPaths: ["/notes/current.md"],
    });

    await waitForOpenFile("current.md");

    expect(
      screen.getByRole("complementary", { name: "Recent files" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /current\.md/i })).toHaveClass("is-active");

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(
      screen.queryByRole("complementary", { name: "Recent files" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open recent files" }));
    expect(
      await screen.findByRole("complementary", { name: "Recent files" }),
    ).toBeInTheDocument();
  });

  it("removes missing recent files and closes the mobile overlay with Escape", async () => {
    const user = userEvent.setup();
    setViewportWidth(700);
    const dependencies = renderApp({
      initialPaths: ["/notes/current.md"],
      settings: {
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

  it("switches to raw mode through the shell menu bridge", async () => {
    const dependencies = renderApp({
      initialPaths: ["/notes/current.md"],
    });

    await waitForOpenFile("current.md");

    act(() => {
      dependencies.shell.emitMenuAction("set-raw-mode");
    });
    const textarea = await screen.findByRole("textbox", { name: "Raw markdown editor" });
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
      expect(screen.getByRole("heading", { level: 1, name: "Untitled" })).toBeInTheDocument();
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
});
