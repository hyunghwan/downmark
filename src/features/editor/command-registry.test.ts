import { afterEach, describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";

import { MarkdownGateway } from "../documents/markdown-gateway";
import { applyEditorCommand, getCommandRegistry } from "./command-registry";
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

    editor.commands.clearContent();
    expect(applyEditorCommand(editor, "table")).toBe(true);
    expect(applyEditorCommand(editor, "table-add-row-after")).toBe(true);
    expect(applyEditorCommand(editor, "table-add-column-after")).toBe(true);
    expect(applyEditorCommand(editor, "table-delete-row")).toBe(true);
    expect(applyEditorCommand(editor, "table-delete-column")).toBe(true);
    const table = editor.getJSON().content?.[0] as JSONContent | undefined;
    expect(table?.type).toBe("table");
    expect(table?.content).toHaveLength(3);
    expect(table?.content?.[0]?.content).toHaveLength(3);
    serialized = gateway.fromRich(editor.getJSON());
    expect(serialized).toContain("|");
    expect(serialized).toContain("---");
  });

  it("localizes command labels and keeps English search keywords as fallbacks", () => {
    const koreanCommands = getCommandRegistry("ko", "bubble");
    const spanishCommands = getCommandRegistry("es", "slash");

    expect(koreanCommands.find((command) => command.id === "bold")?.label).toBe("굵게");
    expect(koreanCommands.find((command) => command.id === "bold")?.keywords).toContain(
      "bold",
    );
    expect(spanishCommands.find((command) => command.id === "image")?.label).toBe(
      "Imagen",
    );
    expect(spanishCommands.find((command) => command.id === "heading-1")?.label).toBe(
      "Encabezado 1",
    );
  });
});
