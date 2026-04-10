# Contributing

Thanks for helping with Downmark.

## Ground rules

- Keep the product focused on single-file Markdown editing.
- Preserve plain `.md` files as the only source of note content.
- Prefer changes that improve reliability of open, edit, save, and recovery flows over feature breadth.
- Do not introduce proprietary storage, sync, or vault assumptions into core flows.

## Local setup

```bash
npm install
source "$HOME/.cargo/env" && cargo check --manifest-path src-tauri/Cargo.toml
```

## Before opening a PR

Run:

```bash
npm run test:run
npm run build
source "$HOME/.cargo/env" && cargo check --manifest-path src-tauri/Cargo.toml
```

## Implementation guidelines

- New editor features must go through `MarkdownGateway`, not direct ad hoc serialization from UI code.
- If a formatting feature cannot round-trip safely to Markdown, defer it instead of forcing it into v1.
- Changes to file lifecycle behavior should include tests for dirty state, save failures, and external modifications.
- Keep UI decisions intentionally simple. Downmark should feel closer to Notes or Notepad than a full knowledge base tool.
