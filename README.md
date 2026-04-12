# Downmark

<p align="center">
  <img src="./public/downmark-logo.svg" alt="Downmark app icon" width="96" />
</p>

<p align="center">
  <a href="https://downmark.sqncs.com/">downmark.sqncs.com</a>
</p>

Downmark is a tiny Markdown editor for people who want to open one file, read it, change it, and save it back without vaults or extra project setup. It is built with `Tauri v2`, `Rust`, `React`, and `TypeScript`.

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
- images
- inline code
- fenced code blocks
- blockquotes
- bullet lists
- ordered lists
- task lists
- tables
- horizontal rules

Remote images stay as links. Local files and clipboard images are copied next to the Markdown file and stored as relative image links.

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

## Releasing desktop builds

GitHub Releases can publish downloadable Windows and macOS bundles directly from Actions. This repository now includes a `Release` workflow that builds:

- macOS Apple Silicon (`aarch64-apple-darwin`)
- macOS Intel (`x86_64-apple-darwin`)
- Windows (`windows-latest`)

### One-time GitHub setup

- In the repository settings, make sure `Actions > General > Workflow permissions` is set to `Read and write permissions` so the workflow can create releases and upload assets.
- The workflow is triggered by pushing a version tag like `v0.1.0`, or by running `Release` manually from the Actions tab.
- Pushes to `main` also run `Post-Merge Release Build`, which refreshes a rolling prerelease tag named `main-build` with the latest verified installers that were successfully packaged in CI.

### Release flow

1. Update the version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` to the same value.
2. Commit and push the version bump.
3. Create and push a tag in the `vX.Y.Z` format that matches the app version.

```bash
git tag v0.1.0
git push origin v0.1.0
```

4. Wait for the `Release` GitHub Actions workflow to finish.
5. Open the GitHub Release page and download the generated `.dmg`, `.app`, `.exe`, or `.msi` assets.

If you only need the newest merged build for testing, use the `main-build` prerelease instead of waiting for a version tag. Windows installers download directly from that prerelease, and macOS installers appear there once signing and notarization are configured.

The workflow validates that the Git tag and all app version files match before publishing. If you prefer reviewing a draft release before it becomes public, change `releaseDraft: false` to `releaseDraft: true` in `.github/workflows/release.yml`.

### Optional signing and notarization

If the signing secrets below are configured, the macOS release workflows will sign and notarize the installers automatically. If they are missing, the `main-build` prerelease still refreshes with non-macOS assets, but macOS installers are skipped instead of publishing broken downloads.

macOS GitHub Actions secrets:

- `APPLE_CERTIFICATE`: base64-encoded exported `.p12` certificate
- `APPLE_CERTIFICATE_PASSWORD`: password used when exporting the `.p12`
- `APPLE_ID`: Apple account email
- `APPLE_PASSWORD`: Apple app-specific password
- `APPLE_TEAM_ID`: Apple Developer Team ID
- `KEYCHAIN_PASSWORD`: temporary CI keychain password

Windows GitHub Actions secrets:

- `WINDOWS_CERTIFICATE`: base64-encoded `.pfx` certificate
- `WINDOWS_CERTIFICATE_PASSWORD`: password for the `.pfx`

Windows GitHub Actions variables:

- `WINDOWS_CERTIFICATE_THUMBPRINT`: certificate thumbprint used by `signtool`
- `WINDOWS_TIMESTAMP_URL`: timestamp server URL
- `WINDOWS_DIGEST_ALGORITHM`: optional, defaults to `sha256`

Helpful commands for preparing certificates:

```bash
openssl base64 -A -in /path/to/apple-certificate.p12 -out apple-certificate-base64.txt
openssl base64 -A -in /path/to/windows-certificate.pfx -out windows-certificate-base64.txt
```

## Project structure

- `src/App.tsx`: app shell, file lifecycle, mode switching, prompts
- `src/features/documents/`: canonical Markdown state and save/load gateway
- `src/features/editor/`: Tiptap adapter, command registry, bubble menu, slash menu
- `src/features/shell/`: Tauri event bridge for initial and secondary file opens
- `src-tauri/`: Rust shell integration, atomic save logic, settings, recent files

## Status

This workspace has been bootstrapped for private development first. The codebase includes `MIT`, contributing, conduct, security, and CI files so it can be published cleanly once the GitHub remote is ready.
