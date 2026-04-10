import { convertFileSrc } from "@tauri-apps/api/core";
import type { JSONContent } from "@tiptap/core";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
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
import type {
  AppSettings,
  EditorMode,
  FileSession,
} from "./features/documents/types";
import { DEFAULT_DOCUMENT_ZOOM_PERCENT as DEFAULT_ZOOM_PERCENT } from "./features/documents/types";
import { ModeToggle } from "./features/editor/ModeToggle";
import { RawEditorSurface } from "./features/editor/RawEditorSurface";
import {
  RichEditorAdapter,
  type EditorImageAsset,
  type RichEditorAdapterHandle,
} from "./features/editor/RichEditorAdapter";
import { getLocaleMessages } from "./features/i18n/messages";
import {
  getSystemLocale,
  resolveLocaleFromPreference,
  type LanguagePreference,
  type SupportedLocale,
} from "./features/i18n/locale";
import {
  hasTauriRuntime,
  resolveAppPlatform,
  startWindowDragging,
  type AppPlatform,
} from "./features/runtime/tauri-runtime";
import { ShellIntegration } from "./features/shell/shell-integration";

type DeferredAction =
  | { kind: "open-path"; path: string; mode: EditorMode }
  | { kind: "new-draft"; mode: EditorMode };
type PromptState =
  | { kind: "none" }
  | { kind: "unsaved"; action: DeferredAction }
  | { kind: "external-modified" };
type DialogResult = string | string[] | null;
type EditorFocusTarget = "raw" | "rich" | null;
type SessionUpdate = FileSession | ((current: FileSession) => FileSession);
type RawImageSelection = { end: number; start: number };

export interface DialogPort {
  openFile: (filters: Array<{ extensions: string[]; name: string }>) => Promise<DialogResult>;
  saveFile: (
    defaultPath: string,
    filters: Array<{ extensions: string[]; name: string }>,
  ) => Promise<DialogResult>;
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
    | "prepareImageAsset"
    | "recordRecentFile"
    | "relocateLocalImageLinks"
    | "removeRecentFile"
    | "save"
    | "setDocumentZoomPercent"
    | "setLanguagePreference"
    | "toRich"
  > & { destroy?: () => void };
  shell: Pick<
    ShellIntegration,
    "handleInitialOpen" | "handleMenuAction" | "handleSecondaryOpen" | "openRecent"
  >;
  dialogs: DialogPort;
  fileStatusPollMs?: number;
  platform: AppPlatform;
  promptForLink: (prompt: string) => Promise<string | null>;
  requiresRestartOnLanguageChange?: boolean;
}

interface AppProps {
  dependencies?: AppDependencies;
}

const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdown"];
const EMPTY_SETTINGS: AppSettings = {
  documentZoomPercent: DEFAULT_ZOOM_PERCENT,
  recentFiles: [],
  languagePreference: "system",
  locale: resolveLocaleFromPreference("system", getSystemLocale()),
};
const MIN_DOCUMENT_ZOOM_PERCENT = 80;
const MAX_DOCUMENT_ZOOM_PERCENT = 200;
const DOCUMENT_ZOOM_STEP_PERCENT = 10;

function clampDocumentZoomPercent(value: number) {
  return Math.min(MAX_DOCUMENT_ZOOM_PERCENT, Math.max(MIN_DOCUMENT_ZOOM_PERCENT, value));
}

interface ScrollSnapshot {
  ratio: number;
}

interface RawSelectionSnapshot {
  direction: "backward" | "forward" | "none";
  end: number;
  start: number;
}

const WINDOW_DRAG_EXCLUDED_SELECTOR = [
  "button",
  "input",
  "textarea",
  "select",
  "option",
  "a",
  "summary",
  "[role='button']",
  "[role='radio']",
  "[role='switch']",
  "[contenteditable='true']",
  "[data-no-window-drag]",
].join(", ");

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

function createTopSurfaceRestoreState(mode: EditorMode): SurfaceRestoreState {
  return {
    mode,
    rawSelection:
      mode === "raw"
        ? {
            start: 0,
            end: 0,
            direction: "none",
          }
        : null,
    richSelection: mode === "rich" ? { from: 1, to: 1 } : null,
    scroll: { ratio: 0 },
  };
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

function formatLastOpened(timestamp: number, locale: SupportedLocale) {
  return new Intl.DateTimeFormat(getLocaleMessages(locale).intlLocale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function createMarkdownFilters(name: string) {
  return [
    {
      name,
      extensions: MARKDOWN_EXTENSIONS,
    },
  ];
}

function inferAltFromReference(reference: string) {
  const normalized = reference.trim().replace(/[\\/]+$/, "");
  if (!normalized) {
    return "image";
  }

  const lastSegment = normalized.split(/[\\/]/).pop() ?? normalized;
  let decodedSegment = lastSegment;
  try {
    decodedSegment = decodeURIComponent(lastSegment);
  } catch {
    decodedSegment = lastSegment;
  }

  const baseName = decodedSegment.replace(/\.[^.]+$/, "").trim();

  return baseName || "image";
}

function isRemoteImageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isAbsoluteFilePath(value: string) {
  return (
    value.startsWith("/") ||
    value.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/.test(value)
  );
}

function shouldStartTitlebarDrag(target: EventTarget | null) {
  if (!(target instanceof Node)) {
    return true;
  }

  const element = target instanceof Element ? target : target.parentElement;
  return !element?.closest(WINDOW_DRAG_EXCLUDED_SELECTOR);
}

function getPathSeparator(path: string) {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

function getParentPath(path: string) {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return lastSlash >= 0 ? path.slice(0, lastSlash) : "";
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

function normalizeAbsolutePath(path: string) {
  const separator = getPathSeparator(path);
  const normalized = separator === "\\" ? path.replace(/\//g, "\\") : path.replace(/\\/g, "/");
  let prefix = "";
  let remainder = normalized;

  if (normalized.startsWith("\\\\")) {
    prefix = "\\\\";
    remainder = normalized.slice(2);
  } else if (/^[A-Za-z]:[\\/]/.test(normalized)) {
    prefix = `${normalized.slice(0, 2)}${separator}`;
    remainder = normalized.slice(3);
  } else if (normalized.startsWith("/") || normalized.startsWith("\\")) {
    prefix = separator;
    remainder = normalized.slice(1);
  }

  const segments = remainder.split(/[\\/]+/);
  const stack: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (stack.length > 0 && stack[stack.length - 1] !== "..") {
        stack.pop();
      } else if (!prefix) {
        stack.push(segment);
      }
      continue;
    }

    stack.push(segment);
  }

  return `${prefix}${stack.join(separator)}`;
}

function decodePathLike(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isWebImageUrl(value: string) {
  return (
    isRemoteImageUrl(value) ||
    value.startsWith("//") ||
    value.startsWith("data:") ||
    value.startsWith("blob:") ||
    value.startsWith("asset:") ||
    value.startsWith("http://asset.localhost")
  );
}

function toDisplayFileUrl(path: string) {
  if (hasTauriRuntime()) {
    return convertFileSrc(path);
  }

  const normalized = path.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${encodeURI(normalized)}`;
  }

  return `file://${encodeURI(normalized)}`;
}

function resolveDisplayImageSrc(src: string, documentPath: string | null) {
  const trimmed = src.trim();
  if (!trimmed) {
    return null;
  }

  if (isWebImageUrl(trimmed)) {
    return trimmed;
  }

  const decodedSource = decodePathLike(trimmed);
  const absolutePath = isAbsoluteFilePath(decodedSource)
    ? normalizeAbsolutePath(decodedSource)
    : documentPath
      ? normalizeAbsolutePath(joinPath(getParentPath(documentPath), decodedSource))
      : null;

  return absolutePath ? toDisplayFileUrl(absolutePath) : null;
}

function mapRichDoc(
  node: JSONContent,
  transform: (node: JSONContent) => JSONContent,
): JSONContent {
  const mappedNode = transform(node);
  if (!mappedNode.content) {
    return mappedNode;
  }

  return {
    ...mappedNode,
    content: mappedNode.content.map((child) => mapRichDoc(child, transform)),
  };
}

function withDisplayImageSources(doc: JSONContent, documentPath: string | null) {
  return mapRichDoc(doc, (node) => {
    if (node.type !== "image") {
      return node;
    }

    const source =
      typeof node.attrs?.src === "string"
        ? node.attrs.src
        : "";
    const displaySrc = resolveDisplayImageSrc(source, documentPath);
    const nextAttrs = {
      ...(node.attrs ?? {}),
      displaySrc,
    };

    return {
      ...node,
      attrs: nextAttrs,
    };
  });
}

function stripDisplayImageSources(doc: JSONContent): JSONContent {
  return mapRichDoc(doc, (node) => {
    if (!node.attrs || !Object.prototype.hasOwnProperty.call(node.attrs, "displaySrc")) {
      return node;
    }

    const { displaySrc: _displaySrc, ...rest } = node.attrs;
    return {
      ...node,
      attrs: rest,
    };
  });
}

function resolvePromptedFilePath(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("file://")) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "file:") {
      return trimmed;
    }

    let pathname = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:\//.test(pathname)) {
      pathname = pathname.slice(1);
    }

    return pathname;
  } catch {
    return trimmed;
  }
}

function inferMimeTypeFromFile(file: File) {
  if (file.type) {
    return file.type;
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "bmp":
      return "image/bmp";
    case "tif":
    case "tiff":
      return "image/tiff";
    case "ico":
      return "image/x-icon";
    case "avif":
      return "image/avif";
    default:
      return null;
  }
}

function createImageMarkdown(asset: EditorImageAsset) {
  return `![${asset.alt}](${asset.src})`;
}

function replaceSelection(value: string, selection: RawImageSelection, inserted: string) {
  const start = Math.max(0, Math.min(selection.start, value.length));
  const end = Math.max(start, Math.min(selection.end, value.length));

  return {
    nextValue: `${value.slice(0, start)}${inserted}${value.slice(end)}`,
    nextSelectionStart: start + inserted.length,
  };
}

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="titlebar-toggle-icon"
      fill="none"
      viewBox="0 0 16 16"
    >
      <path
        d="M6 4.25h6M6 8h4.75M6 11.75h6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.25"
      />
      {collapsed ? (
        <path
          d="M1.75 8h2.5M3.25 6.25L5 8 3.25 9.75"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.25"
        />
      ) : (
        <path
          d="M4.25 8h-2.5M2.75 6.25L1 8l1.75 1.75"
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
          openFile(filters) {
            return open({
              multiple: false,
              filters,
            });
          },
          saveFile(defaultPath: string, filters) {
            return save({
              defaultPath,
              filters,
            });
          },
          async showMessage(body, options) {
            await message(body, options);
          },
        }
      : {
          async openFile(_filters) {
            return null;
          },
          async saveFile(_defaultPath, _filters) {
            return null;
          },
          async showMessage(body, options) {
            console.info(`${options.title}: ${body}`);
          },
        },
    platform: resolveAppPlatform(),
    async promptForLink(prompt) {
      const href = window.prompt(prompt);
      return href?.trim() ? href.trim() : null;
    },
    requiresRestartOnLanguageChange: desktopRuntime,
  };
}

function App({ dependencies }: AppProps) {
  const [appDependencies] = useState(
    () => dependencies ?? createDefaultAppDependencies(),
  );
  const {
    dialogs,
    gateway,
    platform,
    promptForLink,
    requiresRestartOnLanguageChange = false,
    shell,
  } = appDependencies;
  const pollIntervalMs = appDependencies.fileStatusPollMs ?? 3000;
  const usesMacosTitlebar = platform === "macos";

  const [locale, setLocale] = useState<SupportedLocale>(EMPTY_SETTINGS.locale);
  const [session, setSession] = useState<FileSession>(() => createDraftSession());
  const [settings, setSettings] = useState<AppSettings>(EMPTY_SETTINGS);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [promptState, setPromptState] = useState<PromptState>({ kind: "none" });
  const [recentDrawerOpen, setRecentDrawerOpen] = useState(false);
  const [focusTarget, setFocusTarget] = useState<EditorFocusTarget>(null);

  const localeRef = useRef(locale);
  const sessionRef = useRef(session);
  const settingsRef = useRef(settings);
  const promptStateRef = useRef(promptState);
  const editorViewportRef = useRef<HTMLElement | null>(null);
  const rawEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const richEditorRef = useRef<RichEditorAdapterHandle | null>(null);
  const recentDrawerRef = useRef<HTMLElement | null>(null);
  const sidebarReturnFocusRef = useRef<HTMLElement | null>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement | null>(null);
  const recentItemRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const recentDrawerWasOpenRef = useRef(false);
  const shouldRestoreSidebarFocusRef = useRef(false);
  const rawSelectionRef = useRef<RawSelectionSnapshot | null>(null);
  const richSelectionRef = useRef<RichSelectionSnapshot | null>(null);
  const pendingSurfaceRestoreRef = useRef<SurfaceRestoreState | null>(null);

  const messages = useMemo(() => getLocaleMessages(locale), [locale]);
  const markdownFilters = useMemo(
    () => createMarkdownFilters(messages.fileDialog.markdownFilterName),
    [messages.fileDialog.markdownFilterName],
  );
  const richEditorMessages = useMemo(
    () => ({
      imagePrompt: messages.prompts.image,
      linkPrompt: messages.prompts.link,
      loadingLabel: messages.editor.richEditorLoading,
      richEditorAriaLabel: messages.editor.richEditorAriaLabel,
    }),
    [
      messages.prompts.image,
      messages.editor.richEditorAriaLabel,
      messages.editor.richEditorLoading,
      messages.prompts.link,
    ],
  );
  const editorShellStyle = useMemo(
    () =>
      ({
        "--editor-zoom": `${settings.documentZoomPercent / 100}`,
      }) as CSSProperties,
    [settings.documentZoomPercent],
  );
  const richEditorContent = useMemo(
    () => withDisplayImageSources(session.richDoc, session.path),
    [session.path, session.richDoc, session.richVersion],
  );

  localeRef.current = locale;
  sessionRef.current = session;
  settingsRef.current = settings;
  promptStateRef.current = promptState;

  const titlebarDragRegionProps = usesMacosTitlebar
    ? ({ "data-tauri-drag-region": "" } as const)
    : {};

  const handleTitlebarMouseDown = useEffectEvent(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!usesMacosTitlebar || event.button !== 0) {
        return;
      }

      if (!shouldStartTitlebarDrag(event.target)) {
        return;
      }

      event.preventDefault();
      void startWindowDragging();
    },
  );

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

  const applySettings = useEffectEvent(
    (nextSettings: AppSettings, options?: { preserveEditorState?: boolean }) => {
      const currentMode = sessionRef.current.mode;

      if (options?.preserveEditorState && nextSettings.locale !== localeRef.current) {
        const viewportSnapshot = captureViewportSnapshot();

        if (currentMode === "rich") {
          rememberRichSelection();
          pendingSurfaceRestoreRef.current = {
            mode: "rich",
            rawSelection: null,
            richSelection: richSelectionRef.current,
            scroll: viewportSnapshot,
          };
        } else {
          rememberRawSelection();
          pendingSurfaceRestoreRef.current = {
            mode: "raw",
            rawSelection: rawSelectionRef.current,
            richSelection: null,
            scroll: viewportSnapshot,
          };
        }

        setFocusTarget(currentMode);
      }

      localeRef.current = nextSettings.locale;
      setLocale(nextSettings.locale);
      setSettings(nextSettings);
    },
  );

  const applySettingsWithoutLocaleChange = useEffectEvent((nextSettings: AppSettings) => {
    const stableSettings = {
      ...nextSettings,
      locale: localeRef.current,
    };

    settingsRef.current = stableSettings;
    setSettings(stableSettings);
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

    return {
      ...loadedSettings,
      recentFiles: visibleRecentFiles,
    } satisfies AppSettings;
  });

  const openPath = useEffectEvent(async (path: string, mode: EditorMode) => {
    setBusyLabel(messages.busy.opening);
    pendingSurfaceRestoreRef.current = createTopSurfaceRestoreState(mode);

    try {
      const file = await gateway.load(path);
      const richDoc = gateway.toRich(file.markdown);
      const nextSession = openFileSession(file, richDoc, mode);
      updateSession(nextSession);
      applySettings(await gateway.recordRecentFile(path));
      setFocusTarget(mode);
    } catch (error) {
      await dialogs.showMessage(messages.errors.openFailed(String(error)), {
        title: messages.appTitle,
        kind: "error",
      });
    } finally {
      setBusyLabel(null);
    }
  });

  const openFileDialog = useEffectEvent(async () => {
    const result = await dialogs.openFile(markdownFilters);

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
      const result = await dialogs.saveFile(
        messages.fileDialog.untitledFileName,
        markdownFilters,
      );

      if (!isStringPath(result)) {
        return false;
      }

      targetPath = result;
    }

    setBusyLabel(
      targetPath && targetPath !== latestSession.path
        ? messages.busy.savingAs
        : messages.busy.saving,
    );

    try {
      let sessionToSave = latestSession;
      if (targetPath && targetPath !== latestSession.path) {
        const relocatedMarkdown = await gateway.relocateLocalImageLinks(
          latestSession.canonicalMarkdown,
          latestSession.path,
          targetPath,
        );
        const nextRichDoc =
          relocatedMarkdown !== latestSession.canonicalMarkdown
            ? gateway.toRich(relocatedMarkdown)
            : latestSession.richDoc;

        sessionToSave = {
          ...latestSession,
          canonicalMarkdown: relocatedMarkdown,
          richDoc: withDisplayImageSources(nextRichDoc, targetPath),
          richVersion: latestSession.richVersion + 1,
        };
      }

      const result = await gateway.save(sessionToSave, targetPath);
      const savedSession = markSaved(sessionToSave, result);
      updateSession(savedSession);

      if (savedSession.mode === "rich") {
        richEditorRef.current?.setContent(savedSession.richDoc);
      }

      applySettings(await gateway.recordRecentFile(result.path));
      return true;
    } catch (error) {
      const errorMessage = String(error);
      const conflictKind =
        errorMessage === "stale-write" ? "stale-write" : "save-failed";
      updateSession((current) => markConflict(current, conflictKind, errorMessage));

      await dialogs.showMessage(
        errorMessage === "stale-write"
          ? messages.errors.staleWrite
          : messages.errors.saveFailed(errorMessage),
        {
          title: messages.appTitle,
          kind: "error",
        },
      );

      return false;
    } finally {
      setBusyLabel(null);
    }
  });

  const saveAsDialog = useEffectEvent(async () => {
    const result = await dialogs.saveFile(
      sessionRef.current.path ?? messages.fileDialog.untitledFileName,
      markdownFilters,
    );

    if (isStringPath(result)) {
      await saveCurrent(result);
    }
  });

  const ensureSavedDocumentPath = useEffectEvent(async () => {
    if (sessionRef.current.path) {
      return sessionRef.current.path;
    }

    const saved = await saveCurrent();
    return saved ? sessionRef.current.path : null;
  });

  const showImageAssetError = useEffectEvent(async (error: unknown) => {
    await dialogs.showMessage(messages.errors.imageAssetFailed(String(error)), {
      title: messages.appTitle,
      kind: "error",
    });
  });

  const prepareImageAssetFromFile = useEffectEvent(async (file: File) => {
    try {
      const sourcePath = (
        file as File & {
          path?: string;
        }
      ).path;
      const documentPath = await ensureSavedDocumentPath();
      if (!documentPath) {
        return null;
      }

      if (sourcePath && isAbsoluteFilePath(sourcePath)) {
        const prepared = await gateway.prepareImageAsset({
          documentPath,
          sourcePath,
        });

        return {
          alt: prepared.alt,
          displaySrc: resolveDisplayImageSrc(prepared.absolutePath, documentPath) ?? undefined,
          src: prepared.relativePath,
        } satisfies EditorImageAsset;
      }

      const mimeType = inferMimeTypeFromFile(file);
      if (!mimeType) {
        throw new Error(`Unsupported image type: ${file.type || file.name || "unknown"}`);
      }

      const prepared = await gateway.prepareImageAsset({
        documentPath,
        bytes: new Uint8Array(await file.arrayBuffer()),
        mimeType,
      });

      return {
        alt: file.name ? inferAltFromReference(file.name) : prepared.alt,
        displaySrc: resolveDisplayImageSrc(prepared.absolutePath, documentPath) ?? undefined,
        src: prepared.relativePath,
      } satisfies EditorImageAsset;
    } catch (error) {
      await showImageAssetError(error);
      return null;
    }
  });

  const requestImageFromPrompt = useEffectEvent(async (prompt: string) => {
    const value = await promptForLink(prompt);
    if (!value?.trim()) {
      return null;
    }

    const trimmed = value.trim();
    if (isRemoteImageUrl(trimmed)) {
      const url = new URL(trimmed);
      return {
        alt: inferAltFromReference(url.pathname || trimmed),
        displaySrc: trimmed,
        src: trimmed,
      } satisfies EditorImageAsset;
    }

    const sourcePath = resolvePromptedFilePath(trimmed);
    if (!isAbsoluteFilePath(sourcePath)) {
      await showImageAssetError(messages.errors.invalidImageSource);
      return null;
    }

    try {
      const documentPath = await ensureSavedDocumentPath();
      if (!documentPath) {
        return null;
      }

      const prepared = await gateway.prepareImageAsset({
        documentPath,
        sourcePath,
      });

      return {
        alt: prepared.alt,
        displaySrc: resolveDisplayImageSrc(prepared.absolutePath, documentPath) ?? undefined,
        src: prepared.relativePath,
      } satisfies EditorImageAsset;
    } catch (error) {
      await showImageAssetError(error);
      return null;
    }
  });

  const insertRawImageAtSelection = useEffectEvent(
    (selection: RawImageSelection, asset: EditorImageAsset) => {
      const { nextSelectionStart, nextValue } = replaceSelection(
        sessionRef.current.canonicalMarkdown,
        selection,
        createImageMarkdown(asset),
      );

      updateSession((current) =>
        replaceRawMarkdown(current, gateway.normalize(nextValue, { newlineStyle: "lf" })),
      );

      window.requestAnimationFrame(() => {
        rawEditorRef.current?.focus();
        rawEditorRef.current?.setSelectionRange(nextSelectionStart, nextSelectionStart);
      });
    },
  );

  const handleRawImageFileInsert = useEffectEvent(
    async (file: File, selection: RawImageSelection) => {
      const asset = await prepareImageAssetFromFile(file);
      if (!asset) {
        return;
      }

      insertRawImageAtSelection(selection, asset);
    },
  );

  const runDeferredAction = useEffectEvent(async (action: DeferredAction) => {
    if (action.kind === "open-path") {
      await openPath(action.path, action.mode);
      return;
    }

    pendingSurfaceRestoreRef.current = createTopSurfaceRestoreState(action.mode);
    updateSession(createDraftSession(action.mode));
    setFocusTarget(action.mode);
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
        action: { kind: "open-path", path, mode: latestSession.mode },
      });
      return;
    }

    await openPath(path, latestSession.mode);
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
        action: { kind: "new-draft", mode: latestSession.mode },
      });
      return;
    }

    updateSession(createDraftSession(latestSession.mode));
    pendingSurfaceRestoreRef.current = createTopSurfaceRestoreState(latestSession.mode);
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

  const openRecentDrawer = useEffectEvent((returnFocusTarget?: HTMLElement | null) => {
    sidebarReturnFocusRef.current = returnFocusTarget ?? null;
    blurEditorSurfaces();
    setRecentDrawerOpen(true);
  });

  const closeRecentDrawer = useEffectEvent(() => {
    blurEditorSurfaces();
    shouldRestoreSidebarFocusRef.current = true;
    setRecentDrawerOpen(false);
    restoreSidebarToggleFocus();
  });

  const handleRecentDrawerToggle = useEffectEvent(
    (returnFocusTarget?: HTMLElement | null) => {
      if (recentDrawerOpen) {
        closeRecentDrawer();
        return;
      }

      openRecentDrawer(returnFocusTarget);
    },
  );

  const requestOpenRecentPath = useEffectEvent(async (path: string) => {
    closeRecentDrawer();
    await requestOpenPath(path);
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

      const markdown = gateway.fromRich(stripDisplayImageSources(pendingDoc));
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
        markConflict(current, "missing", messages.banners.missing),
      );
      return;
    }

    if (currentSession.dirty) {
      updateSession((current) =>
        markConflict(
          current,
          "externally-modified",
          messages.banners.externallyModified,
        ),
      );
      setPromptState({ kind: "external-modified" });
      return;
    }

    const file = await gateway.load(currentSession.path);
    const richDoc = gateway.toRich(file.markdown);
    pendingSurfaceRestoreRef.current = createTopSurfaceRestoreState(currentSession.mode);
    updateSession((current) => applyReloadedDocument(current, file, richDoc));
    applySettings(await gateway.recordRecentFile(file.path));
    setFocusTarget(currentSession.mode);
  });

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
    (doc: JSONContent) => {
      if (sessionRef.current.mode !== "rich") {
        return;
      }

      const markdown = gateway.fromRich(stripDisplayImageSources(doc));
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
          await openPath(currentSession.path, currentSession.mode);
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

  const applyLanguagePreference = useEffectEvent(
    async (languagePreference: LanguagePreference) => {
      if (languagePreference === settingsRef.current.languagePreference) {
        return;
      }

      if (requiresRestartOnLanguageChange) {
        const persistedSettings = await gateway.setLanguagePreference(languagePreference);
        applySettingsWithoutLocaleChange(persistedSettings);
        await dialogs.showMessage(messages.prompts.languageChangeRestartBody, {
          kind: "info",
          title: messages.prompts.languageChangeRestartTitle,
        });
        return;
      }

      const optimisticSettings: AppSettings = {
        ...settingsRef.current,
        languagePreference,
        locale: resolveLocaleFromPreference(languagePreference, getSystemLocale()),
      };

      applySettings(optimisticSettings, {
        preserveEditorState: true,
      });

      const persistedSettings = await gateway.setLanguagePreference(languagePreference);
      applySettings(persistedSettings);
    },
  );

  const applyDocumentZoomPercent = useEffectEvent(async (documentZoomPercent: number) => {
    const clampedDocumentZoomPercent = clampDocumentZoomPercent(documentZoomPercent);
    if (clampedDocumentZoomPercent === settingsRef.current.documentZoomPercent) {
      return;
    }

    const optimisticSettings: AppSettings = {
      ...settingsRef.current,
      documentZoomPercent: clampedDocumentZoomPercent,
    };

    applySettings(optimisticSettings);

    const persistedSettings = await gateway.setDocumentZoomPercent(clampedDocumentZoomPercent);
    applySettings(persistedSettings);
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
      case "set-language-system":
        await applyLanguagePreference("system");
        break;
      case "set-language-en":
        await applyLanguagePreference("en");
        break;
      case "set-language-ko":
        await applyLanguagePreference("ko");
        break;
      case "set-language-es":
        await applyLanguagePreference("es");
        break;
      default:
        break;
    }
  });

  useEffect(() => {
    let unlistenOpen: (() => void) | null = null;
    let unlistenMenu: (() => void) | null = null;
    let disposed = false;

    void (async () => {
      const nextSettings = await refreshSettings();
      if (disposed) {
        return;
      }

      applySettings(nextSettings);
      setInitialized(true);

      unlistenOpen = await shell.handleSecondaryOpen((paths) => {
        const nextPath = paths[0];
        if (nextPath) {
          void requestOpenPath(nextPath);
        }
      });
      if (disposed) {
        unlistenOpen?.();
        return;
      }

      unlistenMenu = await shell.handleMenuAction((action) => {
        void runMenuAction(action);
      });
      if (disposed) {
        unlistenMenu?.();
        return;
      }

      const paths = await shell.handleInitialOpen();
      if (disposed) {
        return;
      }

        const firstPath = paths[0];
        if (firstPath) {
          void openPath(firstPath, sessionRef.current.mode);
        } else {
          setFocusTarget("rich");
        }
    })();

    return () => {
      disposed = true;
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
    if (key === "-" || key === "_") {
      event.preventDefault();
      void applyDocumentZoomPercent(
        settingsRef.current.documentZoomPercent - DOCUMENT_ZOOM_STEP_PERCENT,
      );
      return;
    }

    if (key === "=" || key === "+") {
      event.preventDefault();
      void applyDocumentZoomPercent(
        settingsRef.current.documentZoomPercent + DOCUMENT_ZOOM_STEP_PERCENT,
      );
      return;
    }

    if (key === "0") {
      event.preventDefault();
      void applyDocumentZoomPercent(DEFAULT_ZOOM_PERCENT);
      return;
    }

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
  }, [focusTarget, locale, restoreViewportSnapshot, session.mode, session.richVersion]);

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

        const applied = (await richEditorRef.current?.applySlashCommand(commandId)) ?? false;
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
    if (recentDrawerOpen) {
      recentDrawerWasOpenRef.current = true;

      const id = window.requestAnimationFrame(() => {
        const activeRecent =
          (session.path
            ? recentItemRefs.current.get(session.path) ?? null
            : null) ??
          settings.recentFiles
            .map((entry) => recentItemRefs.current.get(entry.path) ?? null)
            .find(Boolean) ??
          recentDrawerRef.current;

        activeRecent?.focus();
      });

      return () => {
        window.cancelAnimationFrame(id);
      };
    }

    if (recentDrawerWasOpenRef.current) {
      recentDrawerWasOpenRef.current = false;
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
  }, [recentDrawerOpen, session.path, settings.recentFiles]);

  const banner = (() => {
    if (session.conflictKind === "missing") {
      return {
        tone: "warning",
        text: messages.banners.missing,
      };
    }

    if (session.conflictKind === "stale-write") {
      return {
        tone: "warning",
        text: messages.banners.staleWrite,
      };
    }

    if (session.conflictKind === "save-failed" && session.lastError) {
      return {
        tone: "danger",
        text: messages.banners.saveFailed(session.lastError),
      };
    }

    if (session.conflictKind === "externally-modified") {
      return {
        tone: "warning",
        text: messages.banners.externallyModified,
      };
    }

    return null;
  })();

  const saveStateLabel = session.dirty
    ? messages.workspace.unsaved
    : messages.workspace.saved;
  const documentLocationLabel = session.path ?? messages.workspace.scratchNote;
  const documentTitleLabel =
    usesMacosTitlebar && session.path
      ? session.displayName
      : documentLocationLabel;
  const trimmedMarkdown = session.canonicalMarkdown.trim();
  const wordCount = trimmedMarkdown
    ? (trimmedMarkdown.match(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu) ?? []).length
    : 0;
  const characterCount = session.canonicalMarkdown.length;
  const documentStatsLabel = messages.workspace.documentStats({
    characters: characterCount,
    words: wordCount,
  });
  const liveStatus = messages.workspace.liveStatus({
    document: session.path ? session.displayName : messages.workspace.scratchNote,
    state: busyLabel ?? saveStateLabel,
    editor:
      session.mode === "rich"
        ? messages.workspace.richEditorStatus
        : messages.workspace.rawEditorStatus,
  });

  const drawerRecentCountLabel = messages.workspace.recentCount(
    settings.recentFiles.length,
  );
  const sidebarToggleLabel = recentDrawerOpen
    ? messages.workspace.closeRecentFiles
    : messages.workspace.openRecentFiles;
  const recentListContent =
    settings.recentFiles.length === 0 ? (
      <p className="empty-recent">{messages.workspace.recentEmpty}</p>
    ) : (
      settings.recentFiles.map((entry) => (
        <button
          className={`recent-item ${session.path === entry.path ? "is-active" : ""}`}
          key={entry.path}
          onClick={() => void requestOpenRecentPath(entry.path)}
          ref={(element) => {
            recentItemRefs.current.set(entry.path, element);
          }}
          type="button"
        >
          <span className="recent-name">{entry.displayName}</span>
          <span className="recent-meta">
            {formatLastOpened(entry.lastOpenedMs, locale)}
          </span>
        </button>
      ))
    );

  const renderRecentDrawer = () => (
    <aside
      aria-label={messages.workspace.recentFilesAriaLabel}
      aria-modal="true"
      className={`app-sidebar ${usesMacosTitlebar ? "is-offset-titlebar" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeRecentDrawer();
        }
      }}
      ref={recentDrawerRef}
      role="dialog"
      tabIndex={-1}
    >
      <div className="sidebar-header">
        <div className="sidebar-heading">
          <div className="sidebar-title">{messages.workspace.recentTitle}</div>
          <div className="sidebar-caption">{drawerRecentCountLabel}</div>
        </div>
      </div>

      <div className="recent-list">{recentListContent}</div>
    </aside>
  );

  if (!initialized) {
    return null;
  }

  return (
    <>
      <div aria-atomic="true" aria-live="polite" className="sr-only" role="status">
        {liveStatus}
      </div>

      <div className={`app-shell ${usesMacosTitlebar ? "platform-macos" : "platform-default"}`}>
        {recentDrawerOpen ? (
          <button
            aria-hidden="true"
            className={`sidebar-scrim ${usesMacosTitlebar ? "is-offset-titlebar" : ""}`}
            onClick={() => {
              closeRecentDrawer();
            }}
            tabIndex={-1}
            type="button"
          />
        ) : null}

        {recentDrawerOpen ? renderRecentDrawer() : null}

        <main className="workspace">
          <div className="workspace-body">
            <div
              className={`workspace-header ${
                usesMacosTitlebar ? "is-custom-titlebar" : ""
              }`}
              onMouseDownCapture={handleTitlebarMouseDown}
            >
              <div className="workspace-heading">
                <button
                  aria-expanded={recentDrawerOpen}
                  aria-haspopup="dialog"
                  aria-label={sidebarToggleLabel}
                  className="titlebar-icon-button sidebar-toggle-button"
                  onClick={(event) => {
                    handleRecentDrawerToggle(event.currentTarget);
                  }}
                  ref={sidebarToggleRef}
                  type="button"
                >
                  <SidebarToggleIcon collapsed={!recentDrawerOpen} />
                </button>
                <p
                  className={`workspace-path ${usesMacosTitlebar ? "is-file-title" : ""}`}
                  title={documentLocationLabel}
                  {...titlebarDragRegionProps}
                >
                  {documentTitleLabel}
                </p>
              </div>
              <div
                aria-hidden="true"
                className={`workspace-drag-spacer ${
                  usesMacosTitlebar ? "is-custom-titlebar" : ""
                }`}
                {...titlebarDragRegionProps}
              />
              <div
                className="workspace-meta"
                aria-label={messages.workspace.metadataAriaLabel}
              >
                <span className="workspace-meta-item">
                  {documentStatsLabel}
                </span>
                <span
                  className="workspace-meta-divider"
                  aria-hidden="true"
                />
                <ModeToggle
                  groupAriaLabel={messages.editor.modeToggleAriaLabel}
                  labels={{
                    raw: messages.editor.rawMode,
                    rich: messages.editor.richMode,
                  }}
                  mode={session.mode}
                  onChange={handleModeChange}
                />
                <span
                  className="workspace-meta-divider"
                  aria-hidden="true"
                />
                <span className="workspace-meta-item">
                  {saveStateLabel}
                </span>
              </div>
            </div>

            {banner ? (
              <div className={`banner tone-${banner.tone}`} role="alert">
                {banner.text}
              </div>
            ) : null}

            <section className="editor-shell" ref={editorViewportRef} style={editorShellStyle}>
              {session.mode === "rich" ? (
                <RichEditorAdapter
                  autoFocus={focusTarget === "rich"}
                  content={richEditorContent}
                  contentVersion={session.richVersion}
                  locale={locale}
                  messages={richEditorMessages}
                  onDocumentChange={handleRichChange}
                  onRequestImage={requestImageFromPrompt}
                  onResolveImageFile={prepareImageAssetFromFile}
                  onRequestLink={promptForLink}
                  ref={richEditorRef}
                />
              ) : (
                <RawEditorSurface
                  ariaLabel={messages.editor.rawEditorAriaLabel}
                  autoFocus={focusTarget === "raw"}
                  onChange={handleRawChange}
                  onDropImageFile={handleRawImageFileInsert}
                  onPasteImageFile={handleRawImageFileInsert}
                  placeholder={messages.editor.rawEditorPlaceholder}
                  ref={rawEditorRef}
                  value={session.canonicalMarkdown}
                />
              )}
            </section>
          </div>
        </main>
      </div>

      <PromptDialog
        actions={
          promptState.kind === "external-modified"
            ? [
                {
                  id: "reload",
                  label: messages.prompts.reloadFromDisk,
                  tone: "primary",
                },
                { id: "keep", label: messages.prompts.keepMine },
                { id: "save-as", label: messages.prompts.saveAs },
              ]
            : [
                { id: "save", label: messages.prompts.save, tone: "primary" },
                { id: "discard", label: messages.prompts.dontSave },
                { id: "cancel", label: messages.prompts.cancel },
              ]
        }
        body={
          promptState.kind === "external-modified"
            ? messages.prompts.externalModifiedBody
            : messages.prompts.unsavedBody
        }
        onAction={(actionId) => {
          void handlePromptAction(actionId);
        }}
        onRequestClose={handlePromptDismiss}
        open={promptState.kind !== "none"}
        title={
          promptState.kind === "external-modified"
            ? messages.prompts.externalModifiedTitle
            : messages.prompts.unsavedTitle
        }
      />
    </>
  );
}

export default App;
