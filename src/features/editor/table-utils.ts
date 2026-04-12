import type { Editor } from "@tiptap/core";
import {
  addColumnAfter,
  addRowAfter,
  CellSelection,
  TableMap,
  cellAround,
  findCell,
  findTable,
  moveTableColumn,
  moveTableRow,
} from "@tiptap/pm/tables";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection, type EditorState } from "@tiptap/pm/state";

interface TableResolution {
  columnCount: number;
  map: TableMap;
  rowCount: number;
  tableNode: ProseMirrorNode;
  tablePos: number;
  tableStart: number;
}

export interface TableCellPosition {
  cellPos: number;
  columnCount: number;
  columnIndex: number;
  rowCount: number;
  rowIndex: number;
  tablePos: number;
  tableStart: number;
}

function resolveTable(state: EditorState, tablePos?: number) {
  const resolvePos =
    typeof tablePos === "number"
      ? Math.min(Math.max(tablePos + 1, 1), state.doc.content.size)
      : state.selection.from;
  const table = findTable(state.doc.resolve(resolvePos));

  if (!table) {
    return null;
  }

  const map = TableMap.get(table.node);

  return {
    columnCount: map.width,
    map,
    rowCount: map.height,
    tableNode: table.node,
    tablePos: table.pos,
    tableStart: table.start,
  } satisfies TableResolution;
}

function resolveBandSelection(
  state: EditorState,
  axis: "row" | "column",
  tablePos: number,
  index: number,
) {
  const table = resolveTable(state, tablePos);
  if (!table || table.rowCount < 1 || table.columnCount < 1) {
    return null;
  }

  if (axis === "row" && (index < 0 || index >= table.rowCount)) {
    return null;
  }

  if (axis === "column" && (index < 0 || index >= table.columnCount)) {
    return null;
  }

  const anchorCell =
    axis === "row"
      ? table.tableStart + table.map.positionAt(index, 0, table.tableNode)
      : table.tableStart + table.map.positionAt(0, index, table.tableNode);
  const headCell =
    axis === "row"
      ? table.tableStart + table.map.positionAt(index, table.columnCount - 1, table.tableNode)
      : table.tableStart + table.map.positionAt(table.rowCount - 1, index, table.tableNode);

  return {
    axis,
    anchorCell,
    headCell,
  } as const;
}

export function resolveTableCellPosition(editor: Editor, cell: HTMLElement) {
  const domPosition = editor.view.posAtDOM(cell, 0);
  const $pos = editor.state.doc.resolve(domPosition);
  const $cell = cellAround($pos);
  if (!$cell) {
    return null;
  }

  const table = findTable($cell);

  if (!table) {
    return null;
  }

  const map = TableMap.get(table.node);
  const rect = findCell($cell);

  return {
    cellPos: $cell.pos,
    columnCount: map.width,
    columnIndex: rect.left,
    rowCount: map.height,
    rowIndex: rect.top,
    tablePos: table.pos,
    tableStart: table.start,
  } satisfies TableCellPosition;
}

export function focusTableCell(
  editor: Editor,
  tablePos: number,
  rowIndex: number,
  columnIndex: number,
) {
  const table = resolveTable(editor.state, tablePos);
  if (
    !table ||
    rowIndex < 0 ||
    rowIndex >= table.rowCount ||
    columnIndex < 0 ||
    columnIndex >= table.columnCount
  ) {
    return false;
  }

  const anchorCell = table.tableStart + table.map.positionAt(rowIndex, columnIndex, table.tableNode);

  return editor.chain().focus().setCellSelection({ anchorCell }).run();
}

function setTextSelectionInTableCell(
  editor: Editor,
  tablePos: number,
  rowIndex: number,
  columnIndex: number,
) {
  const table = resolveTable(editor.state, tablePos);
  if (
    !table ||
    rowIndex < 0 ||
    rowIndex >= table.rowCount ||
    columnIndex < 0 ||
    columnIndex >= table.columnCount
  ) {
    return false;
  }

  const cellPos = table.tableStart + table.map.positionAt(rowIndex, columnIndex, table.tableNode);
  const selection = TextSelection.near(editor.state.doc.resolve(cellPos + 1));
  editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
  editor.commands.focus();
  return true;
}

export function addTableRowAfterAt(
  editor: Editor,
  tablePos: number,
  rowIndex: number,
  columnIndex: number,
) {
  if (!setTextSelectionInTableCell(editor, tablePos, rowIndex, columnIndex)) {
    return false;
  }

  return editor.chain().focus().command(({ state, dispatch }) => addRowAfter(state, dispatch)).run();
}

export function addTableColumnAfterAt(
  editor: Editor,
  tablePos: number,
  rowIndex: number,
  columnIndex: number,
) {
  if (!setTextSelectionInTableCell(editor, tablePos, rowIndex, columnIndex)) {
    return false;
  }

  return editor.chain().focus().command(({ state, dispatch }) => addColumnAfter(state, dispatch)).run();
}

export function moveTableRowAt(editor: Editor, tablePos: number, from: number, to: number) {
  if (!selectTableRow(editor, tablePos, from)) {
    return false;
  }

  return editor.chain().focus().command(({ state, dispatch }) => {
    const table = resolveTable(state, tablePos);
    if (!table) {
      return false;
    }

    const sourceCellPos =
      table.tableStart + table.map.positionAt(from, 0, table.tableNode);

    return moveTableRow({ from, to, pos: sourceCellPos, select: true })(state, dispatch);
  }).run();
}

export function moveTableColumnAt(editor: Editor, tablePos: number, from: number, to: number) {
  if (!selectTableColumn(editor, tablePos, from)) {
    return false;
  }

  return editor.chain().focus().command(({ state, dispatch }) => {
    const table = resolveTable(state, tablePos);
    if (!table) {
      return false;
    }

    const sourceCellPos =
      table.tableStart + table.map.positionAt(0, from, table.tableNode);

    return moveTableColumn({ from, to, pos: sourceCellPos, select: true })(state, dispatch);
  }).run();
}

function dispatchSelection(editor: Editor, selection: CellSelection) {
  editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
  editor.commands.focus();
  return true;
}

export function selectTableRow(editor: Editor, tablePos: number, rowIndex: number) {
  const rowSelection = resolveBandSelection(editor.state, "row", tablePos, rowIndex);
  if (!rowSelection) {
    return false;
  }

  return dispatchSelection(
    editor,
    CellSelection.rowSelection(
      editor.state.doc.resolve(rowSelection.anchorCell),
      editor.state.doc.resolve(rowSelection.headCell),
    ),
  );
}

export function selectTableColumn(editor: Editor, tablePos: number, columnIndex: number) {
  const columnSelection = resolveBandSelection(editor.state, "column", tablePos, columnIndex);
  if (!columnSelection) {
    return false;
  }

  return dispatchSelection(
    editor,
    CellSelection.colSelection(
      editor.state.doc.resolve(columnSelection.anchorCell),
      editor.state.doc.resolve(columnSelection.headCell),
    ),
  );
}
