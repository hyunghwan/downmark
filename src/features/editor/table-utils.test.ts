import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { CellSelection, findTable } from "@tiptap/pm/tables";

import { MarkdownGateway } from "../documents/markdown-gateway";
import { createMarkdownExtensions } from "./extensions";
import {
  moveTableColumnAt,
  moveTableRowAt,
  resolveTableCellPosition,
  selectTableColumn,
  selectTableRow,
} from "./table-utils";

describe("table utils", () => {
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

  it("selects whole rows and columns", () => {
    const gateway = new MarkdownGateway();
    const editor = new Editor({
      extensions: createMarkdownExtensions(),
      content: gateway.toRich("| Name | Value |\n| --- | --- |\n| Alpha | 1 |\n| Beta | 2 |"),
      editable: true,
      element: document.createElement("div"),
    });

    editors.push(editor);
    gateways.push(gateway);

    const tablePos = findTable(editor.state.doc.resolve(2))?.pos ?? 0;

    expect(selectTableRow(editor, tablePos, 1)).toBe(true);
    expect(editor.state.selection).toBeInstanceOf(CellSelection);
    expect((editor.state.selection as CellSelection).isRowSelection()).toBe(true);

    expect(selectTableColumn(editor, tablePos, 1)).toBe(true);
    expect(editor.state.selection).toBeInstanceOf(CellSelection);
    expect((editor.state.selection as CellSelection).isColSelection()).toBe(true);
  });

  it("moves rows and columns while keeping markdown output stable", () => {
    const gateway = new MarkdownGateway();
    const editor = new Editor({
      extensions: createMarkdownExtensions(),
      content: gateway.toRich("| Name | Value |\n| --- | --- |\n| Alpha | 1 |\n| Beta | 2 |"),
      editable: true,
      element: document.createElement("div"),
    });

    editors.push(editor);
    gateways.push(gateway);

    const tablePos = findTable(editor.state.doc.resolve(2))?.pos ?? 0;

    expect(moveTableRowAt(editor, tablePos, 1, 2)).toBe(true);
    expect(moveTableColumnAt(editor, tablePos, 0, 1)).toBe(true);

    const lines = gateway.fromRich(editor.getJSON()).trim().split("\n");

    expect(lines[0]).toMatch(/^\| Value\s+\| Name\s+\|$/);
    expect(lines[1]).toMatch(/^\| -+\s+\| -+\s+\|$/);
    expect(lines[2]).toMatch(/^\| 2\s+\| Beta\s+\|$/);
    expect(lines[3]).toMatch(/^\| 1\s+\| Alpha\s+\|$/);
  });

  it("resolves row and column indexes from rendered table cells", () => {
    const gateway = new MarkdownGateway();
    const element = document.createElement("div");
    document.body.appendChild(element);

    const editor = new Editor({
      extensions: createMarkdownExtensions(),
      content: gateway.toRich("| Name | Value |\n| --- | --- |\n| Alpha | 1 |\n| Beta | 2 |"),
      editable: true,
      element,
    });

    editors.push(editor);
    gateways.push(gateway);

    const cell = element.querySelectorAll("tbody tr")[1]?.querySelector("td");
    expect(cell).toBeInstanceOf(HTMLElement);

    const position = resolveTableCellPosition(editor, cell as HTMLElement);

    expect(position).toMatchObject({
      columnIndex: 0,
      rowIndex: 1,
    });
  });
});
