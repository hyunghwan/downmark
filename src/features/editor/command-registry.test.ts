import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";

import { MarkdownGateway } from "../documents/markdown-gateway";
import { applyEditorCommand } from "./command-registry";
import { createMarkdownExtensions } from "./extensions";

describe("command registry", () => {
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

  it("keeps structural commands inside supported markdown syntax", () => {
    const editor = new Editor({
      extensions: createMarkdownExtensions(),
      content: "hello world",
      contentType: "markdown",
      editable: true,
      element: document.createElement("div"),
    });
    const gateway = new MarkdownGateway();

    editors.push(editor);
    gateways.push(gateway);

    expect(applyEditorCommand(editor, "heading-1")).toBe(true);
    let serialized = gateway.fromRich(editor.getJSON());
    expect(serialized).toContain("# hello world");

    editor.commands.setContent(gateway.toRich("task item"));
    expect(applyEditorCommand(editor, "task-list")).toBe(true);
    serialized = gateway.fromRich(editor.getJSON());
    expect(serialized).toContain("- [ ] task item");

    editor.commands.setContent(gateway.toRich("divider"));
    expect(applyEditorCommand(editor, "horizontal-rule")).toBe(true);
    serialized = gateway.fromRich(editor.getJSON());
    expect(serialized).toContain("---");
    expect(serialized).not.toContain("<hr");
  });
});
