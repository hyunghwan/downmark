# downmark

downmark is a tiny Markdown editor for people who want to open one file, read it, change it, and save it back without vaults or extra project setup. It is built with `Tauri v2`, `Rust`, `React`, and `TypeScript`.

## What v1 includes

- OS-level `.md` file association configuration for macOS and Windows bundles
- single-file open flows through app launch arguments, secondary instance handoff, in-app Open, and Recent files
- two editing surfaces:
  - `Rich`: WYSIWYG-first editing with a bubble menu
  - `Raw`: direct Markdown source editing
- slash commands for Markdown-safe block and inline formatting
- canonical plain Markdown storage with no hidden note database
- atomic save strategy with stale-write protection
- external file change detection, dirty-state prompts, and Save As recovery paths

## Supported Markdown in v1

The first release is intentionally limited to syntax we can round-trip safely:

- paragraphs
- headings
- bold / italic / strike
- links
- inline code
- fenced code blocks
- blockquotes
- bullet lists
- ordered lists
- task lists
- horizontal rules

Tables, local image insertion, and richer note blocks are deferred until the Markdown gateway proves stable enough for them.

## Development

### Prerequisites

- Node.js 24+
- npm 11+
- Rust stable with Cargo on your `PATH`

### Install

```bash
npm install
```

### Run checks

```bash
npm run test:run
npm run build
source "$HOME/.cargo/env" && cargo check --manifest-path src-tauri/Cargo.toml
```

### Start the desktop app

```bash
source "$HOME/.cargo/env" && npm run tauri dev
```

## Project structure

- `src/App.tsx`: app shell, file lifecycle, mode switching, prompts
- `src/features/documents/`: canonical Markdown state and save/load gateway
- `src/features/editor/`: Tiptap adapter, command registry, bubble menu, slash menu
- `src/features/shell/`: Tauri event bridge for initial and secondary file opens
- `src-tauri/`: Rust shell integration, atomic save logic, settings, recent files

## Status

This workspace has been bootstrapped for private development first. The codebase includes `MIT`, contributing, conduct, security, and CI files so it can be published cleanly once the GitHub remote is ready.
