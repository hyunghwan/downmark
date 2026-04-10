import { MarkdownGateway } from "../downmark-app/features/documents/markdown-gateway";
import type {
  AppSettings,
  FileSession,
  FileStatusResponse,
  LoadedFile,
  PrepareImageAssetInput,
  PreparedImageAsset,
  SaveFileResult,
} from "../downmark-app/features/documents/types";
import type { AppDependencies, DialogPort } from "../downmark-app/App";
import type {
  LanguagePreference,
  SupportedLocale,
} from "../downmark-app/features/i18n/locale";

const ENGLISH_LOCALE: SupportedLocale = "en";
const ENGLISH_PREFERENCE: LanguagePreference = "en";
const DEMO_PATH = "/notes/About Downmark.md";
const FALLBACK_DEMO_MARKDOWN = `# About Downmark

Downmark is a focused Markdown editor for people who want plain files to stay plain.

## What it does

- Open one \`.md\` file at a time
- Switch between **Rich** and **Raw** editing in the same document
- Save back to standard Markdown with no export step

## Why it stays light

Downmark avoids vaults, databases, and extra project structure. It keeps the editor centered on writing while still surfacing file state, word count, and save status.

Designed for fast desktop writing on macOS and Windows.

> This web sample resets when the page refreshes.
`;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function inferAltFromPath(path: string) {
  const segment = path.split(/[\\/]/).pop() ?? "image";
  return segment.replace(/\.[^.]+$/, "") || "image";
}

class BrowserDemoGateway {
  private readonly markdownGateway = new MarkdownGateway();
  private readonly settingsBase: AppSettings = {
    documentZoomPercent: 100,
    recentFiles: [],
    languagePreference: ENGLISH_PREFERENCE,
    locale: ENGLISH_LOCALE,
  };

  private activeFile: LoadedFile | null = null;
  private revision = 0;
  private imageCounter = 0;
  private settings = clone(this.settingsBase);
  private seedPromise: Promise<void> | null = null;

  destroy() {
    this.markdownGateway.destroy();
  }

  toRich(markdown: string) {
    return this.markdownGateway.toRich(markdown);
  }

  fromRich(doc: Parameters<MarkdownGateway["fromRich"]>[0]) {
    return this.markdownGateway.fromRich(doc);
  }

  normalize(markdown: string, policy: Parameters<MarkdownGateway["normalize"]>[1]) {
    return this.markdownGateway.normalize(markdown, policy);
  }

  async load(path: string) {
    if (path === DEMO_PATH && (!this.activeFile || this.activeFile.path !== path)) {
      await this.ensureDemoLoaded();
    }

    if (!this.activeFile || this.activeFile.path !== path) {
      throw new Error(`Missing file: ${path}`);
    }

    return clone(this.activeFile);
  }

  async save(session: FileSession, pathOverride?: string) {
    const path = pathOverride ?? session.path ?? DEMO_PATH;
    const nextFile = this.createLoadedFile(path, session.canonicalMarkdown);
    this.activeFile = nextFile;
    await this.recordRecentFile(path);

    return {
      path: nextFile.path,
      displayName: nextFile.displayName,
      newlineStyle: nextFile.newlineStyle,
      encoding: nextFile.encoding,
      fingerprint: nextFile.fingerprint,
    } satisfies SaveFileResult;
  }

  async checkFileStatus(path: string, session: FileSession) {
    if (path === DEMO_PATH && (!this.activeFile || this.activeFile.path !== path)) {
      await this.ensureDemoLoaded();
    }

    if (!this.activeFile || this.activeFile.path !== path) {
      return {
        kind: "missing",
        fingerprint: null,
      } satisfies FileStatusResponse;
    }

    return session.fingerprint?.sha256 === this.activeFile.fingerprint.sha256
      ? ({
          kind: "unchanged",
          fingerprint: this.activeFile.fingerprint,
        } satisfies FileStatusResponse)
      : ({
          kind: "modified",
          fingerprint: this.activeFile.fingerprint,
        } satisfies FileStatusResponse);
  }

  async pathExists(path: string) {
    return path === DEMO_PATH || this.activeFile?.path === path;
  }

  async loadSettings() {
    return clone(this.settings);
  }

  async recordRecentFile(path: string) {
    const existing = this.settings.recentFiles.filter((entry) => entry.path !== path);
    this.settings = {
      ...this.settings,
      recentFiles: [
        {
          path,
          displayName: path.split(/[\\/]/).pop() ?? path,
          lastOpenedMs: Date.now(),
        },
        ...existing,
      ].slice(0, 12),
    };

    return clone(this.settings);
  }

  async removeRecentFile(path: string) {
    this.settings = {
      ...this.settings,
      recentFiles: this.settings.recentFiles.filter((entry) => entry.path !== path),
    };

    return clone(this.settings);
  }

  async setLanguagePreference(_languagePreference: LanguagePreference) {
    this.settings = {
      ...this.settings,
      languagePreference: ENGLISH_PREFERENCE,
      locale: ENGLISH_LOCALE,
    };

    return clone(this.settings);
  }

  async setDocumentZoomPercent(documentZoomPercent: number) {
    this.settings = {
      ...this.settings,
      documentZoomPercent,
    };

    return clone(this.settings);
  }

  async prepareImageAsset(input: PrepareImageAssetInput) {
    this.imageCounter += 1;
    const extension =
      "sourcePath" in input
        ? (input.sourcePath.split(".").pop() ?? "png")
        : input.mimeType.split("/").pop()?.replace("jpeg", "jpg") ?? "png";
    const fileName = `demo-image-${this.imageCounter}.${extension}`;

    return {
      relativePath: fileName,
      absolutePath: `/virtual/${fileName}`,
      alt: "sourcePath" in input ? inferAltFromPath(input.sourcePath) : `demo-image-${this.imageCounter}`,
    } satisfies PreparedImageAsset;
  }

  async relocateLocalImageLinks(markdown: string) {
    return markdown;
  }

  private async ensureDemoLoaded() {
    if (this.activeFile?.path === DEMO_PATH) {
      return;
    }

    if (!this.seedPromise) {
      this.seedPromise = this.loadDemoSeed();
    }

    await this.seedPromise;
  }

  private async loadDemoSeed() {
    let markdown = FALLBACK_DEMO_MARKDOWN;

    try {
      const response = await fetch("/demo-seed.md");
      if (response.ok) {
        markdown = await response.text();
      }
    } catch {
      markdown = FALLBACK_DEMO_MARKDOWN;
    }

    this.activeFile = this.createLoadedFile(DEMO_PATH, markdown);
  }

  private createLoadedFile(path: string, markdown: string): LoadedFile {
    this.revision += 1;

    return {
      path,
      displayName: path.split(/[\\/]/).pop() ?? path,
      markdown,
      newlineStyle: "lf",
      encoding: "utf-8",
      fingerprint: {
        exists: true,
        modifiedMs: this.revision,
        size: markdown.length,
        sha256: `browser-demo:${this.revision}:${markdown.length}`,
      },
    };
  }
}

class BrowserDemoShell {
  async handleInitialOpen() {
    return [DEMO_PATH];
  }

  async handleSecondaryOpen(_onPaths: (paths: string[]) => void) {
    return () => {};
  }

  async handleMenuAction(_onAction: (action: string) => void) {
    return () => {};
  }

  async openRecent(path: string) {
    return [path];
  }
}

function createDialogs(): DialogPort {
  return {
    async openFile() {
      return null;
    },
    async saveFile() {
      return null;
    },
    async showMessage(body, options) {
      console.info(`${options.title}: ${body}`);
    },
  };
}

export function createBrowserDemoDependencies(): AppDependencies {
  return {
    gateway: new BrowserDemoGateway(),
    shell: new BrowserDemoShell(),
    dialogs: createDialogs(),
    disableRecentDrawer: true,
    platform: "macos",
    async promptForLink(prompt) {
      const value = window.prompt(prompt);
      return value?.trim() ? value.trim() : null;
    },
    requiresRestartOnLanguageChange: false,
  };
}
