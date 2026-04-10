import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { message, open, save } from "@tauri-apps/plugin-dialog";

import { PromptDialog } from "./components/PromptDialog";
import {
  applyReloadedDocument,
  createDraftSession,
  markConflict,
  markSaved,
  openFileSession,
  replaceRawMarkdown,
  replaceRichDoc,
  switchMode,
  syncRichFromMarkdown,
} from "./features/documents/file-session-manager";
import { MarkdownGateway } from "./features/documents/markdown-gateway";
import type { AppSettings, EditorMode, FileSession } from "./features/documents/types";
import { ModeToggle } from "./features/editor/ModeToggle";
import { RawEditorSurface } from "./features/editor/RawEditorSurface";
import {
  RichEditorAdapter,
  type RichEditorAdapterHandle,
} from "./features/editor/RichEditorAdapter";
import { hasTauriRuntime } from "./features/runtime/tauri-runtime";
import { ShellIntegration } from "./features/shell/shell-integration";

type DeferredAction = { kind: "open-path"; path: string } | { kind: "new-draft" };
type PromptState =
  | { kind: "none" }
  | { kind: "unsaved"; action: DeferredAction }
  | { kind: "external-modified" };
type DialogResult = string | string[] | null;
type EditorFocusTarget = "raw" | "rich" | null;
type SessionUpdate = FileSession | ((current: FileSession) => FileSession);

export interface DialogPort {
  openFile: () => Promise<DialogResult>;
  saveFile: (defaultPath: string) => Promise<DialogResult>;
  showMessage: (
    body: string,
    options: { title: string; kind: "error" | "info" | "warning" },
  ) => Promise<void>;
}

export interface AppDependencies {
  gateway: Pick<
    MarkdownGateway,
    | "checkFileStatus"
    | "fromRich"
    | "load"
    | "loadSettings"
    | "normalize"
    | "pathExists"
    | "recordRecentFile"
    | "removeRecentFile"
    | "save"
    | "toRich"
  > & { destroy?: () => void };
  shell: Pick<
    ShellIntegration,
    "handleInitialOpen" | "handleMenuAction" | "handleSecondaryOpen" | "openRecent"
  >;
  dialogs: DialogPort;
  fileStatusPollMs?: number;
  promptForLink: () => Promise<string | null>;
}

interface AppProps {
  dependencies?: AppDependencies;
}

const MARKDOWN_FILTERS = [
  {
    name: "Markdown",
    extensions: ["md", "markdown", "mdown"],
  },
];
const MOBILE_SIDEBAR_MAX_WIDTH = 760;
const MAC_WINDOW_CONTROLS_RESERVED_WIDTH = 110;
const EMPTY_SETTINGS: AppSettings = { recentFiles: [] };

interface ScrollSnapshot {
  ratio: number;
}

interface RawSelectionSnapshot {
  direction: "backward" | "forward" | "none";
  end: number;
  start: number;
}

interface RichSelectionSnapshot {
  from: number;
  to: number;
}

interface SurfaceRestoreState {
  mode: EditorMode;
  rawSelection: RawSelectionSnapshot | null;
  richSelection: RichSelectionSnapshot | null;
  scroll: ScrollSnapshot | null;
}

interface DownmarkTestBridge {
  applyRichCommand: (commandId: string) => Promise<boolean>;
  applySlashCommand: (commandId: string) => Promise<boolean>;
  getRawValue: () => string;
  getRichHtml: () => string;
  insertRichText: (text: string) => Promise<boolean>;
  selectAllRichText: () => Promise<boolean>;
  setMode: (mode: EditorMode) => Promise<void>;
  setRawValue: (value: string) => Promise<void>;
}

declare global {
  interface Window {
    __DOWNMARK_TEST__?: DownmarkTestBridge;
  }
}

function isStringPath(value: string | string[] | null): value is string {
  return typeof value === "string";
}

function formatLastOpened(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function isMobileViewport() {
  return window.innerWidth <= MOBILE_SIDEBAR_MAX_WIDTH;
}

function isMacWindowPlatform() {
  return /mac/i.test(navigator.userAgent) || /mac/i.test(navigator.platform);
}

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="titlebar-toggle-icon"
      fill="none"
      viewBox="0 0 16 16"
    >
      <rect
        height="11"
        rx="2.25"
        stroke="currentColor"
        strokeWidth="1.25"
        width="13"
        x="1.5"
        y="2.5"
      />
      <path d="M5.5 3.5v9" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" />
      {collapsed ? (
        <path
          d="M8.25 8h2.5M9.75 6.25L11.5 8l-1.75 1.75"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.25"
        />
      ) : (
        <path
          d="M10.75 8h-2.5M9.25 6.25L7.5 8l1.75 1.75"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.25"
        />
      )}
    </svg>
  );
}

export function createDefaultAppDependencies(): AppDependencies {
  const gateway = new MarkdownGateway();
  const shell = new ShellIntegration();
  const desktopRuntime = hasTauriRuntime();

  return {
    gateway,
    shell,
    dialogs: desktopRuntime
      ? {
          openFile() {
            return open({
              multiple: false,
              filters: MARKDOWN_FILTERS,
            });
          },
          saveFile(defaultPath: string) {
            return save({
              defaultPath,
              filters: MARKDOWN_FILTERS,
            });
          },
          async showMessage(body, options) {
            await message(body, options);
          },
        }
      : {
          async openFile() {
            return null;
          },
          async saveFile() {
            return null;
          },
          async showMessage(body, options) {
            console.info(`${options.title}: ${body}`);
          },
        },
    async promptForLink() {
      const href = window.prompt("Enter a URL");
      return href?.trim() ? href.trim() : null;
    },
  };
}

function App({ dependencies }: AppProps) {
  const [appDependencies] = useState(
    () => dependencies ?? createDefaultAppDependencies(),
  );
  const { dialogs, gateway, promptForLink, shell } = appDependencies;
  const pollIntervalMs = appDependencies.fileStatusPollMs ?? 3000;

  const [session, setSession] = useState<FileSession>(() => createDraftSession());
  const [settings, setSettings] = useState<AppSettings>(EMPTY_SETTINGS);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [promptState, setPromptState] = useState<PromptState>({ kind: "none" });
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(() => isMobileViewport());
  const [isMacWindow] = useState(() => isMacWindowPlatform());
  const [focusTarget, setFocusTarget] = useState<EditorFocusTarget>(null);

  const sessionRef = useRef(session);
  const promptStateRef = useRef(promptState);
  const editorViewportRef = useRef<HTMLElement | null>(null);
  const rawEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const richEditorRef = useRef<RichEditorAdapterHandle | null>(null);
  const sidebarReturnFocusRef = useRef<HTMLElement | null>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement | null>(null);
  const sidebarRefreshButtonRef = useRef<HTMLButtonElement | null>(null);
  const recentItemRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const mobileSidebarWasOpenRef = useRef(false);
  const shouldRestoreSidebarFocusRef = useRef(false);
  const rawSelectionRef = useRef<RawSelectionSnapshot | null>(null);
  const richSelectionRef = useRef<RichSelectionSnapshot | null>(null);
  const pendingSurfaceRestoreRef = useRef<SurfaceRestoreState | null>(null);
  const sidebarVisible = mobileViewport ? mobileSidebarOpen : !desktopSidebarCollapsed;

  sessionRef.current = session;
  promptStateRef.current = promptState;

  useEffect(() => {
    return () => {
      gateway.destroy?.();
    };
  }, [gateway]);

  const captureViewportSnapshot = useEffectEvent(() => {
    const viewport = editorViewportRef.current;
    if (!viewport) {
      return null;
    }

    const maxScroll = viewport.scrollHeight - viewport.clientHeight;
    if (maxScroll <= 0) {
      return { ratio: 0 } satisfies ScrollSnapshot;
    }

    return {
      ratio: viewport.scrollTop / maxScroll,
    } satisfies ScrollSnapshot;
  });

  const updateSession = useEffectEvent((updater: SessionUpdate) => {
    const nextSession =
      typeof updater === "function"
        ? (updater as (current: FileSession) => FileSession)(sessionRef.current)
        : updater;

    sessionRef.current = nextSession;
    setSession(nextSession);
    return nextSession;
  });

  const restoreViewportSnapshot = useEffectEvent((snapshot: ScrollSnapshot | null) => {
    if (!snapshot) {
      return;
    }

    const viewport = editorViewportRef.current;
    if (!viewport) {
      return;
    }

    const maxScroll = viewport.scrollHeight - viewport.clientHeight;
    viewport.scrollTop = maxScroll <= 0 ? 0 : Math.round(maxScroll * snapshot.ratio);
  });

  const rememberRawSelection = useEffectEvent(() => {
    const textarea = rawEditorRef.current;
    if (!textarea) {
      return;
    }

    rawSelectionRef.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
      direction: textarea.selectionDirection ?? "none",
    };
  });

  const rememberRichSelection = useEffectEvent(() => {
    richSelectionRef.current = richEditorRef.current?.getSelectionRange() ?? null;
  });

  const refreshSettings = useEffectEvent(async () => {
    const loadedSettings = await gateway.loadSettings();
    const existingRecentFiles = await Promise.all(
      loadedSettings.recentFiles.map(async (entry) => ({
        entry,
        exists: await gateway.pathExists(entry.path),
      })),
    );

    const visibleRecentFiles = existingRecentFiles
      .filter((item) => item.exists)
      .map((item) => item.entry);

    const missingEntries = existingRecentFiles
      .filter((item) => !item.exists)
      .map((item) => item.entry.path);

    for (const path of missingEntries) {
      await gateway.removeRecentFile(path);
    }

    setSettings({ recentFiles: visibleRecentFiles });
  });

  const openPath = useEffectEvent(async (path: string) => {
    setBusyLabel("Opening");
    pendingSurfaceRestoreRef.current = {
      mode: "rich",
      rawSelection: null,
      richSelection: null,
      scroll: { ratio: 0 },
    };

    try {
      const file = await gateway.load(path);
      const richDoc = gateway.toRich(file.markdown);
      const nextSession = openFileSession(file, richDoc, "rich");
      updateSession(nextSession);
      setSettings(await gateway.recordRecentFile(path));
      setFocusTarget("rich");
    } catch (error) {
      await dialogs.showMessage(`Unable to open file.\n\n${String(error)}`, {
        title: "downmark",
        kind: "error",
      });
    } finally {
      setBusyLabel(null);
    }
  });

  const openFileDialog = useEffectEvent(async () => {
    const result = await dialogs.openFile();

    if (isStringPath(result)) {
      await requestOpenPath(result);
    }
  });

  const saveCurrent = useEffectEvent(async (pathOverride?: string) => {
    const currentSession = sessionRef.current;
    const latestSession =
      currentSession.mode === "rich"
        ? syncSessionFromRichEditor(currentSession)
        : currentSession;

    if (latestSession !== currentSession) {
      updateSession(latestSession);
    }

    let targetPath = pathOverride;
    if (!targetPath && !latestSession.path) {
      const result = await dialogs.saveFile("Untitled.md");

      if (!isStringPath(result)) {
        return false;
      }

      targetPath = result;
    }

    setBusyLabel(
      targetPath && targetPath !== latestSession.path ? "Saving as" : "Saving",
    );

    try {
      const result = await gateway.save(latestSession, targetPath);
      updateSession((current) => markSaved(current, result));
      setSettings(await gateway.recordRecentFile(result.path));
      return true;
    } catch (error) {
      const errorMessage = String(error);
      const conflictKind =
        errorMessage === "stale-write" ? "stale-write" : "save-failed";
      updateSession((current) => markConflict(current, conflictKind, errorMessage));

      await dialogs.showMessage(
        errorMessage === "stale-write"
          ? "The file changed on disk before save completed. Review the on-disk version or use Save As."
          : `Save failed.\n\n${errorMessage}`,
        {
          title: "downmark",
          kind: "error",
        },
      );

      return false;
    } finally {
      setBusyLabel(null);
    }
  });

  const saveAsDialog = useEffectEvent(async () => {
    const result = await dialogs.saveFile(sessionRef.current.path ?? "Untitled.md");

    if (isStringPath(result)) {
      await saveCurrent(result);
    }
  });

  const runDeferredAction = useEffectEvent(async (action: DeferredAction) => {
    if (action.kind === "open-path") {
      await openPath(action.path);
      return;
    }

    pendingSurfaceRestoreRef.current = {
      mode: "rich",
      rawSelection: null,
      richSelection: null,
      scroll: { ratio: 0 },
    };
    updateSession(createDraftSession("rich"));
    setFocusTarget("rich");
  });

  const requestOpenPath = useEffectEvent(async (path: string) => {
    const currentSession = sessionRef.current;
    const latestSession =
      currentSession.mode === "rich"
        ? syncSessionFromRichEditor(currentSession)
        : currentSession;

    if (latestSession !== currentSession) {
      updateSession(latestSession);
    }

    if (latestSession.dirty) {
      setPromptState({
        kind: "unsaved",
        action: { kind: "open-path", path },
      });
      return;
    }

    await openPath(path);
  });

  const requestNewDraft = useEffectEvent(async () => {
    const currentSession = sessionRef.current;
    const latestSession =
      currentSession.mode === "rich"
        ? syncSessionFromRichEditor(currentSession)
        : currentSession;

    if (latestSession !== currentSession) {
      updateSession(latestSession);
    }

    if (latestSession.dirty) {
      setPromptState({
        kind: "unsaved",
        action: { kind: "new-draft" },
      });
      return;
    }

    updateSession(createDraftSession("rich"));
    pendingSurfaceRestoreRef.current = {
      mode: "rich",
      rawSelection: null,
      richSelection: null,
      scroll: { ratio: 0 },
    };
    setFocusTarget("rich");
  });

  const blurEditorSurfaces = useEffectEvent(() => {
    rawEditorRef.current?.blur();
    richEditorRef.current?.blur();
  });

  const restoreSidebarToggleFocus = useEffectEvent(() => {
    const restoreFocus = () => {
      (sidebarReturnFocusRef.current ?? sidebarToggleRef.current)?.focus();
    };

    window.requestAnimationFrame(() => {
      restoreFocus();
      window.setTimeout(() => {
        restoreFocus();
      }, 0);
      window.setTimeout(() => {
        restoreFocus();
      }, 40);
    });
  });

  const openSidebar = useEffectEvent((returnFocusTarget?: HTMLElement | null) => {
    sidebarReturnFocusRef.current = returnFocusTarget ?? null;

    if (mobileViewport) {
      blurEditorSurfaces();
      setMobileSidebarOpen(true);
      return;
    }

    setDesktopSidebarCollapsed(false);
  });

  const closeMobileSidebar = useEffectEvent(() => {
    if (!mobileViewport) {
      return;
    }

    blurEditorSurfaces();
    shouldRestoreSidebarFocusRef.current = true;
    setMobileSidebarOpen(false);
    restoreSidebarToggleFocus();
  });

  const collapseSidebar = useEffectEvent(() => {
    blurEditorSurfaces();

    if (mobileViewport) {
      shouldRestoreSidebarFocusRef.current = true;
      setMobileSidebarOpen(false);
      return;
    }

    setDesktopSidebarCollapsed(true);
  });

  const syncSessionFromRichEditor = useEffectEvent(
    (currentSession: FileSession) => {
      if (currentSession.mode !== "rich") {
        return currentSession;
      }

      const pendingDoc = richEditorRef.current?.getPendingDoc();
      if (!pendingDoc) {
        return currentSession;
      }

      const markdown = gateway.fromRich(pendingDoc);
      if (markdown === currentSession.canonicalMarkdown) {
        return currentSession;
      }

      return replaceRichDoc(currentSession, pendingDoc, markdown);
    },
  );

  const checkExternalChanges = useEffectEvent(async () => {
    const currentSession = sessionRef.current;
    const currentPrompt = promptStateRef.current;

    if (!currentSession.path || currentPrompt.kind !== "none") {
      return;
    }

    if (currentSession.conflictKind === "externally-modified") {
      return;
    }

    const status = await gateway.checkFileStatus(
      currentSession.path,
      currentSession,
    );

    if (status.kind === "unchanged") {
      return;
    }

    if (status.kind === "missing") {
      updateSession((current) =>
        markConflict(current, "missing", "The file was moved or deleted on disk."),
      );
      return;
    }

    if (currentSession.dirty) {
      updateSession((current) =>
        markConflict(
          current,
          "externally-modified",
          "The file changed on disk while you still have unsaved edits.",
        ),
      );
      setPromptState({ kind: "external-modified" });
      return;
    }

    const file = await gateway.load(currentSession.path);
    const richDoc = gateway.toRich(file.markdown);
    if (currentSession.mode === "rich") {
      rememberRichSelection();
    } else {
      rememberRawSelection();
    }
    pendingSurfaceRestoreRef.current = {
      mode: currentSession.mode,
      rawSelection:
        currentSession.mode === "raw" ? rawSelectionRef.current : null,
      richSelection:
        currentSession.mode === "rich" ? richSelectionRef.current : null,
      scroll: captureViewportSnapshot(),
    };
    updateSession((current) => applyReloadedDocument(current, file, richDoc));
    setSettings(await gateway.recordRecentFile(file.path));
    setFocusTarget(currentSession.mode);
  });

  useEffect(() => {
    const handleResize = () => {
      setMobileViewport(isMobileViewport());
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    if (!mobileViewport) {
      shouldRestoreSidebarFocusRef.current = false;
      setMobileSidebarOpen(false);
    }
  }, [mobileViewport]);

  useEffect(() => {
    if (!session.path) {
      return;
    }

    const interval = window.setInterval(() => {
      void checkExternalChanges();
    }, pollIntervalMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [checkExternalChanges, pollIntervalMs, session.path]);

  useEffect(() => {
    const handleWindowFocus = () => {
      void checkExternalChanges();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkExternalChanges();
      }
    };

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [checkExternalChanges]);

  const handleModeChange = useEffectEvent((nextMode: "rich" | "raw") => {
    const currentSession = sessionRef.current;
    if (nextMode === currentSession.mode) {
      return;
    }

    const viewportSnapshot = captureViewportSnapshot();

    if (nextMode === "rich") {
      rememberRawSelection();
      pendingSurfaceRestoreRef.current = {
        mode: "rich",
        rawSelection: null,
        richSelection: richSelectionRef.current,
        scroll: viewportSnapshot,
      };
      const richDoc = gateway.toRich(currentSession.canonicalMarkdown);
      updateSession((current) => syncRichFromMarkdown(current, richDoc, "rich"));
      setFocusTarget("rich");
      return;
    }

    rememberRichSelection();
    const latestSession =
      currentSession.mode === "rich"
        ? syncSessionFromRichEditor(currentSession)
        : currentSession;
    pendingSurfaceRestoreRef.current = {
      mode: "raw",
      rawSelection: rawSelectionRef.current,
      richSelection: null,
      scroll: viewportSnapshot,
    };
    updateSession(switchMode(latestSession, "raw"));
    setFocusTarget("raw");
  });

  const handleRawChange = useEffectEvent((value: string) => {
    updateSession((current) =>
      replaceRawMarkdown(current, gateway.normalize(value, { newlineStyle: "lf" })),
    );
  });

  const handleRichChange = useEffectEvent(
    (doc: import("@tiptap/core").JSONContent) => {
      if (sessionRef.current.mode !== "rich") {
        return;
      }

      const markdown = gateway.fromRich(doc);
      updateSession((current) => replaceRichDoc(current, doc, markdown));
    },
  );

  const handlePromptAction = useEffectEvent(async (actionId: string) => {
    const currentPrompt = promptStateRef.current;
    const currentSession = sessionRef.current;
    setPromptState({ kind: "none" });

    if (currentPrompt.kind === "unsaved") {
      if (actionId === "cancel") {
        return;
      }

      if (actionId === "save") {
        const saved = await saveCurrent();
        if (!saved) {
          return;
        }
      }

      await runDeferredAction(currentPrompt.action);
      return;
    }

    if (currentPrompt.kind === "external-modified") {
      if (!currentSession.path) {
        return;
      }

      if (actionId === "reload") {
        await openPath(currentSession.path);
        return;
      }

      if (actionId === "save-as") {
        await saveAsDialog();
      }
    }
  });

  const handlePromptDismiss = useEffectEvent(() => {
    if (promptState.kind === "external-modified") {
      void handlePromptAction("keep");
      return;
    }

    void handlePromptAction("cancel");
  });

  const runMenuAction = useEffectEvent(async (action: string) => {
    switch (action) {
      case "new-draft":
        await requestNewDraft();
        break;
      case "open-file":
        await openFileDialog();
        break;
      case "save-file":
        await saveCurrent();
        break;
      case "save-file-as":
        await saveAsDialog();
        break;
      case "set-rich-mode":
        handleModeChange("rich");
        break;
      case "set-raw-mode":
        handleModeChange("raw");
        break;
      default:
        break;
    }
  });

  useEffect(() => {
    void refreshSettings();

    let unlistenOpen: (() => void) | null = null;
    let unlistenMenu: (() => void) | null = null;
    void shell
      .handleSecondaryOpen((paths) => {
        const nextPath = paths[0];
        if (nextPath) {
          void requestOpenPath(nextPath);
        }
      })
      .then((dispose) => {
        unlistenOpen = dispose;
      });

    void shell
      .handleMenuAction((action) => {
        void runMenuAction(action);
      })
      .then((dispose) => {
        unlistenMenu = dispose;
      });

    void shell.handleInitialOpen().then((paths) => {
      const firstPath = paths[0];
      if (firstPath) {
        void openPath(firstPath);
      } else {
        setFocusTarget("rich");
      }
    });

    return () => {
      unlistenOpen?.();
      unlistenMenu?.();
    };
  }, [shell]);

  const handleGlobalKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey) {
      return;
    }

    if (!(event.metaKey || event.ctrlKey)) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      if (event.shiftKey) {
        void saveAsDialog();
        return;
      }

      void saveCurrent();
      return;
    }

    if (key === "o") {
      event.preventDefault();
      void openFileDialog();
    }
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      handleGlobalKeyDown(event);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleGlobalKeyDown]);

  useEffect(() => {
    if (focusTarget === null) {
      return;
    }

    const id = window.requestAnimationFrame(() => {
      const pendingRestore =
        pendingSurfaceRestoreRef.current?.mode === focusTarget
          ? pendingSurfaceRestoreRef.current
          : null;

      if (focusTarget === "raw") {
        const textarea = rawEditorRef.current;
        textarea?.focus();

        if (textarea && pendingRestore?.rawSelection) {
          const start = Math.min(pendingRestore.rawSelection.start, textarea.value.length);
          const end = Math.min(pendingRestore.rawSelection.end, textarea.value.length);
          textarea.setSelectionRange(
            start,
            end,
            pendingRestore.rawSelection.direction,
          );
        }
      } else {
        richEditorRef.current?.focus();

        if (pendingRestore?.richSelection) {
          richEditorRef.current?.restoreSelection(pendingRestore.richSelection);
        }
      }

      restoreViewportSnapshot(pendingRestore?.scroll ?? null);
      pendingSurfaceRestoreRef.current = null;
      setFocusTarget(null);
    });

    return () => {
      window.cancelAnimationFrame(id);
    };
  }, [focusTarget, restoreViewportSnapshot, session.mode, session.richVersion]);

  useEffect(() => {
    if (!navigator.webdriver) {
      return;
    }

    const waitForPaint = () =>
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            resolve();
          });
        });
      });

    window.__DOWNMARK_TEST__ = {
      async applyRichCommand(commandId) {
        if (sessionRef.current.mode !== "rich") {
          handleModeChange("rich");
          await waitForPaint();
        }

        const applied = (await richEditorRef.current?.applyCommand(commandId)) ?? false;
        await waitForPaint();
        return applied;
      },
      async applySlashCommand(commandId) {
        if (sessionRef.current.mode !== "rich") {
          handleModeChange("rich");
          await waitForPaint();
        }

        const applied = richEditorRef.current?.applySlashCommand(commandId) ?? false;
        await waitForPaint();
        return applied;
      },
      getRawValue() {
        return rawEditorRef.current?.value ?? sessionRef.current.canonicalMarkdown;
      },
      getRichHtml() {
        return richEditorRef.current?.getHtml() ?? "";
      },
      async insertRichText(text) {
        if (sessionRef.current.mode !== "rich") {
          handleModeChange("rich");
          await waitForPaint();
        }

        const inserted = richEditorRef.current?.insertText(text) ?? false;
        await waitForPaint();
        return inserted;
      },
      async selectAllRichText() {
        if (sessionRef.current.mode !== "rich") {
          handleModeChange("rich");
          await waitForPaint();
        }

        const selected = richEditorRef.current?.selectAll() ?? false;
        await waitForPaint();
        return selected;
      },
      async setMode(mode) {
        if (sessionRef.current.mode !== mode) {
          handleModeChange(mode);
        }

        await waitForPaint();
      },
      async setRawValue(value) {
        if (sessionRef.current.mode !== "raw") {
          handleModeChange("raw");
          await waitForPaint();
        }

        const newlineStyle = sessionRef.current.newlineStyle;
        updateSession((current) =>
          replaceRawMarkdown(
            current,
            gateway.normalize(value, { newlineStyle }),
          ),
        );
        await waitForPaint();
      },
    };

    return () => {
      delete window.__DOWNMARK_TEST__;
    };
  }, [gateway, handleModeChange]);

  useEffect(() => {
    if (mobileViewport && mobileSidebarOpen) {
      mobileSidebarWasOpenRef.current = true;

      const id = window.requestAnimationFrame(() => {
        const activeRecent =
          (session.path
            ? recentItemRefs.current.get(session.path) ?? null
            : null) ??
          settings.recentFiles
            .map((entry) => recentItemRefs.current.get(entry.path) ?? null)
            .find(Boolean) ??
          sidebarRefreshButtonRef.current;

        activeRecent?.focus();
      });

      return () => {
        window.cancelAnimationFrame(id);
      };
    }

    if (mobileSidebarWasOpenRef.current) {
      mobileSidebarWasOpenRef.current = false;
      const shouldRestoreFocus = shouldRestoreSidebarFocusRef.current;
      shouldRestoreSidebarFocusRef.current = false;
      if (!shouldRestoreFocus) {
        return;
      }

      const restoreFocus = () => {
        (sidebarReturnFocusRef.current ?? sidebarToggleRef.current)?.focus();
      };

      let immediateTimeoutId: number | null = null;
      let delayedTimeoutId: number | null = null;
      const id = window.requestAnimationFrame(() => {
        restoreFocus();
        immediateTimeoutId = window.setTimeout(() => {
          restoreFocus();
        }, 0);
        delayedTimeoutId = window.setTimeout(() => {
          restoreFocus();
        }, 40);
      });

      return () => {
        window.cancelAnimationFrame(id);
        if (immediateTimeoutId !== null) {
          window.clearTimeout(immediateTimeoutId);
        }
        if (delayedTimeoutId !== null) {
          window.clearTimeout(delayedTimeoutId);
        }
      };
    }
  }, [mobileSidebarOpen, mobileViewport, session.path, settings.recentFiles]);

  const banner = (() => {
    if (session.conflictKind === "missing") {
      return {
        tone: "warning",
        text: "File missing on disk. Keep editing here, then use Save As to keep your changes.",
      };
    }

    if (session.conflictKind === "stale-write") {
      return {
        tone: "warning",
        text: "Disk version changed before save finished. Reload from disk or use Save As.",
      };
    }

    if (session.conflictKind === "save-failed" && session.lastError) {
      return {
        tone: "danger",
        text: `Save failed: ${session.lastError}`,
      };
    }

    if (session.conflictKind === "externally-modified") {
      return {
        tone: "warning",
        text: "Disk version changed while you still have unsaved edits.",
      };
    }

    return null;
  })();

  const statusLabel = busyLabel ?? (session.dirty ? "Unsaved" : "Saved");
  const editorModeLabel = session.mode === "rich" ? "Rich" : "Raw";
  const documentLocationLabel = session.path ?? "Scratch note";
  const liveStatus = [
    session.displayName,
    statusLabel,
    session.mode === "rich" ? "Rich editor" : "Raw editor",
  ].join(". ");

  const drawerRecentCountLabel = `${settings.recentFiles.length} recent ${
    settings.recentFiles.length === 1 ? "file" : "files"
  }`;
  const sidebarToggleLabel =
    sidebarVisible && !mobileViewport ? "Collapse sidebar" : "Open recent files";
  const showSidebarTitlebarPane = sidebarVisible && !mobileViewport;

  return (
    <>
      <div aria-atomic="true" aria-live="polite" className="sr-only" role="status">
        {liveStatus}
      </div>

      <div
        className={`app-shell ${sidebarVisible ? "has-visible-sidebar" : "is-sidebar-collapsed"} ${
          mobileViewport ? "is-mobile-viewport" : ""
        } ${isMacWindow ? "is-macos" : ""}`}
        style={
          isMacWindow
            ? ({
                "--mac-window-controls-width": `${MAC_WINDOW_CONTROLS_RESERVED_WIDTH}px`,
              } as CSSProperties)
            : undefined
        }
      >
        {mobileViewport && mobileSidebarOpen ? (
          <button
            aria-label="Close recent files"
            className="sidebar-scrim"
            onClick={() => {
              closeMobileSidebar();
            }}
            type="button"
          />
        ) : null}

        <header className="app-titlebar">
          {showSidebarTitlebarPane ? (
            <div className="app-titlebar-sidebar-pane">
              <div className="app-titlebar-sidebar-controls">
                <div
                  aria-hidden="true"
                  className="app-titlebar-window-gap"
                  data-tauri-drag-region={isMacWindow ? true : undefined}
                />
                <button
                  aria-expanded={sidebarVisible}
                  aria-haspopup={mobileViewport ? "dialog" : undefined}
                  aria-label={sidebarToggleLabel}
                  className="titlebar-icon-button"
                  onClick={(event) => {
                    if (sidebarVisible && !mobileViewport) {
                      collapseSidebar();
                      return;
                    }

                    openSidebar(event.currentTarget);
                  }}
                  ref={sidebarToggleRef}
                  type="button"
                >
                  <SidebarToggleIcon collapsed={!sidebarVisible} />
                </button>
              </div>
              <div className="app-titlebar-sidebar-drag" data-tauri-drag-region />
            </div>
          ) : null}

          <div className="app-titlebar-workspace-pane">
            <div className="app-titlebar-workspace-main">
              {!showSidebarTitlebarPane ? (
                <div className="app-titlebar-leading-controls">
                  <div
                    aria-hidden="true"
                    className="app-titlebar-window-gap"
                    data-tauri-drag-region={isMacWindow ? true : undefined}
                  />
                  <button
                    aria-expanded={sidebarVisible}
                    aria-haspopup={mobileViewport ? "dialog" : undefined}
                    aria-label={sidebarToggleLabel}
                    className="titlebar-icon-button"
                    onClick={(event) => {
                      if (sidebarVisible && !mobileViewport) {
                        collapseSidebar();
                        return;
                      }

                      openSidebar(event.currentTarget);
                    }}
                    ref={sidebarToggleRef}
                    type="button"
                  >
                    <SidebarToggleIcon collapsed={!sidebarVisible} />
                  </button>
                </div>
              ) : null}
              <div className="document-heading" data-tauri-drag-region>
                <h1 className="document-title">{session.displayName}</h1>
              </div>
              <div className="app-titlebar-workspace-drag" data-tauri-drag-region />
            </div>

            <div className="app-titlebar-actions" role="toolbar" aria-label="Editor actions">
              <div className="document-header-actions">
                <button
                  className="toolbar-button"
                  onClick={() => {
                    void requestNewDraft();
                  }}
                  type="button"
                >
                  New
                </button>
                <button
                  className="toolbar-button"
                  onClick={() => void openFileDialog()}
                  type="button"
                >
                  Open
                </button>
                <button
                  className="toolbar-button"
                  onClick={() => void saveCurrent()}
                  type="button"
                >
                  Save
                </button>
                <button
                  className="toolbar-button"
                  onClick={() => void saveAsDialog()}
                  type="button"
                >
                  Save As
                </button>
                <ModeToggle mode={session.mode} onChange={handleModeChange} />
                <span className={`status-indicator ${session.dirty ? "is-dirty" : ""}`}>
                  {statusLabel}
                </span>
              </div>
            </div>
          </div>
        </header>

        <div className="app-content">
          {sidebarVisible ? (
            <aside
              aria-label="Recent files"
              aria-modal={mobileViewport ? true : undefined}
              className={`app-sidebar ${mobileViewport ? "is-overlay" : ""}`}
              onKeyDown={(event) => {
                if (mobileViewport && event.key === "Escape") {
                  event.preventDefault();
                  closeMobileSidebar();
                }
              }}
              role={mobileViewport ? "dialog" : "complementary"}
            >
              <div className="sidebar-header">
                <div className="sidebar-heading">
                  <div className="sidebar-title">Recent</div>
                  <div className="sidebar-caption">{drawerRecentCountLabel}</div>
                </div>

                {mobileViewport ? (
                  <button
                    aria-label="Close recent files"
                    className="toolbar-button subtle-button"
                    onClick={() => {
                      closeMobileSidebar();
                    }}
                    type="button"
                  >
                    Close
                  </button>
                ) : null}
              </div>

              <div className="sidebar-toolbar">
                <button
                  className="toolbar-button subtle-button"
                  onClick={() => void refreshSettings()}
                  ref={sidebarRefreshButtonRef}
                  type="button"
                >
                  Refresh
                </button>
              </div>

              <div className="recent-list">
                {settings.recentFiles.length === 0 ? (
                  <p className="empty-recent">Recent files will appear here.</p>
                ) : (
                  settings.recentFiles.map((entry) => (
                    <button
                      className={`recent-item ${session.path === entry.path ? "is-active" : ""}`}
                      key={entry.path}
                      onClick={() => {
                        if (mobileViewport) {
                          closeMobileSidebar();
                        }
                        void requestOpenPath(entry.path);
                      }}
                      ref={(element) => {
                        recentItemRefs.current.set(entry.path, element);
                      }}
                      type="button"
                    >
                      <span className="recent-name">{entry.displayName}</span>
                      <span className="recent-meta">
                        {formatLastOpened(entry.lastOpenedMs)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </aside>
          ) : null}

          <main className="workspace">
            <div className="workspace-body">
              {banner ? (
                <div className={`banner tone-${banner.tone}`} role="alert">
                  {banner.text}
                </div>
              ) : null}

              <section className="editor-shell" ref={editorViewportRef}>
                {session.mode === "rich" ? (
                  <RichEditorAdapter
                    autoFocus={focusTarget === "rich"}
                    content={session.richDoc}
                    contentVersion={session.richVersion}
                    onDocumentChange={handleRichChange}
                    onRequestLink={promptForLink}
                    ref={richEditorRef}
                  />
                ) : (
                  <RawEditorSurface
                    autoFocus={focusTarget === "raw"}
                    onChange={handleRawChange}
                    ref={rawEditorRef}
                    value={session.canonicalMarkdown}
                  />
                )}
              </section>

              <footer className="workspace-statusbar">
                <span className="workspace-status-path" title={documentLocationLabel}>
                  {documentLocationLabel}
                </span>
                <div className="workspace-status-meta">
                  <span className="status-chip">{session.newlineStyle.toUpperCase()}</span>
                  <span className="status-chip">{editorModeLabel}</span>
                </div>
              </footer>
            </div>
          </main>
        </div>
      </div>

      <PromptDialog
        actions={
          promptState.kind === "external-modified"
            ? [
                { id: "reload", label: "Reload from Disk", tone: "primary" },
                { id: "keep", label: "Keep Mine" },
                { id: "save-as", label: "Save As" },
              ]
            : [
                { id: "save", label: "Save", tone: "primary" },
                { id: "discard", label: "Don't Save" },
                { id: "cancel", label: "Cancel" },
              ]
        }
        body={
          promptState.kind === "external-modified"
            ? "The document changed on disk while you still have unsaved edits in downmark."
            : "You have unsaved changes. Save them before continuing?"
        }
        onAction={(actionId) => {
          void handlePromptAction(actionId);
        }}
        onRequestClose={handlePromptDismiss}
        open={promptState.kind !== "none"}
        title={
          promptState.kind === "external-modified"
            ? "File changed on disk"
            : "Unsaved changes"
        }
      />
    </>
  );
}

export default App;
