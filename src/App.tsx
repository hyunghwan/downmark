import { useEffect, useEffectEvent, useRef, useState, type CSSProperties } from "react";
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
import type { AppSettings, FileSession } from "./features/documents/types";
import { ModeToggle } from "./features/editor/ModeToggle";
import { RawEditorSurface } from "./features/editor/RawEditorSurface";
import {
  RichEditorAdapter,
  type RichEditorAdapterHandle,
} from "./features/editor/RichEditorAdapter";
import { ShellIntegration } from "./features/shell/shell-integration";

type DeferredAction = { kind: "open-path"; path: string } | { kind: "new-draft" };
type PromptState =
  | { kind: "none" }
  | { kind: "unsaved"; action: DeferredAction }
  | { kind: "external-modified" };
type DialogResult = string | string[] | null;
type EditorFocusTarget = "raw" | "rich" | null;

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
    "handleInitialOpen" | "handleSecondaryOpen" | "openRecent"
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
const MAC_WINDOW_CONTROLS_RESERVED_WIDTH = 88;

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

export function createDefaultAppDependencies(): AppDependencies {
  const gateway = new MarkdownGateway();
  const shell = new ShellIntegration();

  return {
    gateway,
    shell,
    dialogs: {
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
  const [settings, setSettings] = useState<AppSettings>({ recentFiles: [] });
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [promptState, setPromptState] = useState<PromptState>({ kind: "none" });
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(() => isMobileViewport());
  const [isMacWindow] = useState(() => isMacWindowPlatform());
  const [focusTarget, setFocusTarget] = useState<EditorFocusTarget>(null);

  const sessionRef = useRef(session);
  const promptStateRef = useRef(promptState);
  const rawEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const richEditorRef = useRef<RichEditorAdapterHandle | null>(null);
  const sidebarReturnFocusRef = useRef<HTMLElement | null>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement | null>(null);
  const sidebarRefreshButtonRef = useRef<HTMLButtonElement | null>(null);
  const recentItemRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const mobileSidebarWasOpenRef = useRef(false);
  const shouldRestoreSidebarFocusRef = useRef(false);
  const sidebarVisible = mobileViewport ? mobileSidebarOpen : !desktopSidebarCollapsed;

  useEffect(() => {
    return () => {
      gateway.destroy?.();
    };
  }, [gateway]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    promptStateRef.current = promptState;
  }, [promptState]);

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

    try {
      const file = await gateway.load(path);
      const richDoc = gateway.toRich(file.markdown);
      const nextSession = openFileSession(file, richDoc, "rich");
      setSession(nextSession);
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
    const latestSession =
      session.mode === "rich" ? syncSessionFromRichEditor(session) : session;

    if (latestSession !== session) {
      setSession(latestSession);
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
      setSession((current) => markSaved(current, result));
      setSettings(await gateway.recordRecentFile(result.path));
      return true;
    } catch (error) {
      const errorMessage = String(error);
      const conflictKind =
        errorMessage === "stale-write" ? "stale-write" : "save-failed";
      setSession((current) => markConflict(current, conflictKind, errorMessage));

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
    const result = await dialogs.saveFile(session.path ?? "Untitled.md");

    if (isStringPath(result)) {
      await saveCurrent(result);
    }
  });

  const runDeferredAction = useEffectEvent(async (action: DeferredAction) => {
    if (action.kind === "open-path") {
      await openPath(action.path);
      return;
    }

    setSession(createDraftSession(session.mode));
    setFocusTarget(session.mode);
  });

  const requestOpenPath = useEffectEvent(async (path: string) => {
    const latestSession =
      session.mode === "rich" ? syncSessionFromRichEditor(session) : session;

    if (latestSession !== session) {
      setSession(latestSession);
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
    const latestSession =
      session.mode === "rich" ? syncSessionFromRichEditor(session) : session;

    if (latestSession !== session) {
      setSession(latestSession);
    }

    if (latestSession.dirty) {
      setPromptState({
        kind: "unsaved",
        action: { kind: "new-draft" },
      });
      return;
    }

    setSession(createDraftSession(latestSession.mode));
    setFocusTarget(latestSession.mode);
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
      setSession((current) =>
        markConflict(current, "missing", "The file was moved or deleted on disk."),
      );
      return;
    }

    if (currentSession.dirty) {
      setSession((current) =>
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
    setSession((current) => applyReloadedDocument(current, file, richDoc));
    setSettings(await gateway.recordRecentFile(file.path));
    setFocusTarget(currentSession.mode);
  });

  useEffect(() => {
    void refreshSettings();

    let unlisten: (() => void) | null = null;
    void shell
      .handleSecondaryOpen((paths) => {
        const nextPath = paths[0];
        if (nextPath) {
          void requestOpenPath(nextPath);
        }
      })
      .then((dispose) => {
        unlisten = dispose;
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
      unlisten?.();
    };
  }, [openPath, refreshSettings, requestOpenPath, shell]);

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
    if (nextMode === session.mode) {
      return;
    }

    if (nextMode === "rich") {
      const richDoc = gateway.toRich(session.canonicalMarkdown);
      setSession((current) => syncRichFromMarkdown(current, richDoc, "rich"));
      setFocusTarget("rich");
      return;
    }

    const latestSession =
      session.mode === "rich" ? syncSessionFromRichEditor(session) : session;
    setSession(switchMode(latestSession, "raw"));
    setFocusTarget("raw");
  });

  const handleRawChange = useEffectEvent((value: string) => {
    setSession((current) =>
      replaceRawMarkdown(current, gateway.normalize(value, { newlineStyle: "lf" })),
    );
  });

  const handleRichChange = useEffectEvent(
    (doc: import("@tiptap/core").JSONContent) => {
      const markdown = gateway.fromRich(doc);
      setSession((current) => replaceRichDoc(current, doc, markdown));
    },
  );

  const handlePromptAction = useEffectEvent(async (actionId: string) => {
    const currentPrompt = promptState;
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
      if (!session.path) {
        return;
      }

      if (actionId === "reload") {
        await openPath(session.path);
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
      if (focusTarget === "raw") {
        rawEditorRef.current?.focus();
      } else {
        richEditorRef.current?.focus();
      }

      setFocusTarget(null);
    });

    return () => {
      window.cancelAnimationFrame(id);
    };
  }, [focusTarget, session.mode, session.richVersion]);

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
        text: "This file was moved or deleted on disk. Keep editing here, then use Save As to keep your changes.",
      };
    }

    if (session.conflictKind === "stale-write") {
      return {
        tone: "warning",
        text: "The file changed on disk before save finished. Reload from disk or use Save As to avoid overwriting.",
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
        text: "This file changed on disk while you were editing it.",
      };
    }

    return null;
  })();

  const statusLabel = busyLabel ?? (session.dirty ? "Unsaved" : "Saved");
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
  const sidebarToggleText = sidebarVisible && !mobileViewport ? "Hide" : "Recent";
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
              <div
                aria-hidden="true"
                className="app-titlebar-window-gap"
                data-tauri-drag-region={isMacWindow ? true : undefined}
              />
              <div className="app-titlebar-sidebar-drag" data-tauri-drag-region />
              <button
                aria-expanded={sidebarVisible}
                aria-haspopup={mobileViewport ? "dialog" : undefined}
                aria-label={sidebarToggleLabel}
                className="toolbar-button"
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
                {sidebarToggleText}
              </button>
            </div>
          ) : null}

          <div className="app-titlebar-workspace-pane">
            <div className="app-titlebar-workspace-main">
              {!showSidebarTitlebarPane ? (
                <button
                  aria-expanded={sidebarVisible}
                  aria-haspopup={mobileViewport ? "dialog" : undefined}
                  aria-label={sidebarToggleLabel}
                  className="toolbar-button"
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
                  {sidebarToggleText}
                </button>
              ) : null}
              <div className="document-heading" data-tauri-drag-region>
                <span className="document-label">Document</span>
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
            <div className="workspace-top">
              <div className="meta-row">
                <span className="document-path">{session.path ?? "Scratch note"}</span>
                <span className="meta-inline">
                  {session.newlineStyle.toUpperCase()} . {session.mode === "rich" ? "Rich" : "Raw"}
                </span>
              </div>
            </div>

            <div className="workspace-body">
              {banner ? (
                <div className={`banner tone-${banner.tone}`} role="alert">
                  {banner.text}
                </div>
              ) : null}

              <section className="editor-shell">
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
