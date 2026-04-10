import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";

import { MarkdownGateway } from "../documents/markdown-gateway";
import { createMarkdownExtensions } from "./extensions";
import { applySlashCommand } from "./slash-command-extension";

describe("slash command helper", () => {
  const editors: Editor[] = [];
  const gateways: MarkdownGateway[] = [];

  afterEach(() => {
    while (editors.length) {
      editors.pop()?.destroy();
    }

    while (gateways.length) {
      gateways.pop()?.destroy();
    }
  });

  it("removes the slash query before converting the block", () => {
    const editor = new Editor({
      extensions: createMarkdownExtensions(),
      content: "<p>/hea</p>",
      editable: true,
      element: document.createElement("div"),
    });
    const gateway = new MarkdownGateway();

    editors.push(editor);
    gateways.push(gateway);

    editor.commands.setTextSelection({ from: 5, to: 5 });

    expect(
      applySlashCommand(editor, "heading-1", {
        from: 1,
        to: 5,
      }),
    ).toBe(true);
    expect(editor.commands.insertContent("Title")).toBe(true);

    const markdown = gateway.fromRich(editor.getJSON());
    expect(markdown).toContain("# Title");
    expect(markdown).not.toContain("/hea");
  });

  it("keeps later typing inside the requested list structure", () => {
    const editor = new Editor({
      extensions: createMarkdownExtensions(),
      content: "<p>/todo</p>",
      editable: true,
      element: document.createElement("div"),
    });
    const gateway = new MarkdownGateway();

    editors.push(editor);
    gateways.push(gateway);

    editor.commands.setTextSelection({ from: 6, to: 6 });

    expect(
      applySlashCommand(editor, "task-list", {
        from: 1,
        to: 6,
      }),
    ).toBe(true);
    expect(editor.commands.insertContent("Ship it")).toBe(true);

    const markdown = gateway.fromRich(editor.getJSON());
    expect(markdown).toContain("- [ ] Ship it");
    expect(markdown).not.toContain("/todo");
  });

  it("inserts a markdown table from the slash command", () => {
    const editor = new Editor({
      extensions: createMarkdownExtensions(),
      content: "<p>/table</p>",
      editable: true,
      element: document.createElement("div"),
    });
    const gateway = new MarkdownGateway();

    editors.push(editor);
    gateways.push(gateway);

    editor.commands.setTextSelection({ from: 7, to: 7 });

    expect(
      applySlashCommand(editor, "table", {
        from: 1,
        to: 7,
      }),
    ).toBe(true);

    const markdown = gateway.fromRich(editor.getJSON());
    expect(markdown).toContain("|");
    expect(markdown).toContain("---");
    expect(markdown).not.toContain("/table");
  });
});
