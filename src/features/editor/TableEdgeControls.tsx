import type { Editor } from "@tiptap/core";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { getLocaleMessages } from "../i18n/messages";
import type { SupportedLocale } from "../i18n/locale";
import {
  addTableColumnAfterAt,
  addTableRowAfterAt,
  moveTableColumnAt,
  moveTableRowAt,
  resolveTableCellPosition,
  selectTableColumn,
  selectTableRow,
} from "./table-utils";

interface TableEdgeControlsProps {
  editor: Editor;
  locale: SupportedLocale;
}

interface BandPosition {
  height: number;
  top: number;
  width: number;
  left: number;
}

interface TableOverlayState {
  columnPositions: BandPosition[];
  hoveredColumnIndex: number | null;
  hoveredRowIndex: number | null;
  rowPositions: BandPosition[];
  tableHeight: number;
  tableLeft: number;
  tablePos: number;
  tableTop: number;
  tableWidth: number;
}

interface TableDragState {
  axis: "column" | "row";
  fromIndex: number;
  tablePos: number;
  toIndex: number | null;
}

const EDGE_CONTROL_OFFSET = 18;
const EDGE_ADD_BUTTON_OFFSET = 30;
const EDGE_CONTROL_VISIBILITY_PADDING = 60;

function isWithinActiveTableBounds(
  container: HTMLElement,
  overlay: TableOverlayState,
  event: PointerEvent,
) {
  const containerRect = container.getBoundingClientRect();
  const relativeX = event.clientX - containerRect.left;
  const relativeY = event.clientY - containerRect.top;

  return (
    relativeX >= overlay.tableLeft - EDGE_CONTROL_VISIBILITY_PADDING &&
    relativeX <= overlay.tableLeft + overlay.tableWidth + EDGE_CONTROL_VISIBILITY_PADDING &&
    relativeY >= overlay.tableTop - EDGE_CONTROL_VISIBILITY_PADDING &&
    relativeY <= overlay.tableTop + overlay.tableHeight + EDGE_CONTROL_VISIBILITY_PADDING
  );
}

function resolveBandIndexFromPointer(
  container: HTMLElement,
  overlay: TableOverlayState,
  axis: "column" | "row",
  event: PointerEvent,
) {
  const containerRect = container.getBoundingClientRect();
  const coordinate =
    axis === "row"
      ? event.clientY - containerRect.top
      : event.clientX - containerRect.left;
  const bands = axis === "row" ? overlay.rowPositions : overlay.columnPositions;

  if (bands.length < 1) {
    return null;
  }

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  bands.forEach((band, index) => {
    const start = axis === "row" ? band.top : band.left;
    const size = axis === "row" ? band.height : band.width;
    const center = start + size / 2;
    const distance = Math.abs(coordinate - center);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function TableGripIcon({ axis }: { axis: "column" | "row" }) {
  return (
    <svg
      aria-hidden="true"
      className={`table-edge-grip-icon${axis === "column" ? " is-column" : ""}`}
      viewBox="0 0 12 12"
    >
      <circle cx="4" cy="2.25" r="1" />
      <circle cx="8" cy="2.25" r="1" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="8" cy="6" r="1" />
      <circle cx="4" cy="9.75" r="1" />
      <circle cx="8" cy="9.75" r="1" />
    </svg>
  );
}

function getTableDomAtPosition(editor: Editor, tablePos: number) {
  if (editor.isDestroyed) {
    return null;
  }

  const dom = editor.view.nodeDOM(tablePos);
  if (!(dom instanceof HTMLElement)) {
    return null;
  }

  const wrapper = dom.matches(".tableWrapper")
    ? dom
    : dom.closest(".tableWrapper");
  const table =
    wrapper instanceof HTMLElement
      ? wrapper.querySelector("table")
      : dom.matches("table")
        ? dom
        : null;

  if (!(wrapper instanceof HTMLElement) || !(table instanceof HTMLTableElement)) {
    return null;
  }

  return { table, wrapper };
}

function buildColumnPositions(row: HTMLTableRowElement, containerRect: DOMRect) {
  const positions: BandPosition[] = [];

  for (const cell of Array.from(row.cells)) {
    const rect = cell.getBoundingClientRect();
    const colspan = Math.max(1, cell.colSpan || 1);
    const width = rect.width / colspan;

    for (let columnIndex = 0; columnIndex < colspan; columnIndex += 1) {
      positions.push({
        height: rect.height,
        left: rect.left - containerRect.left + width * columnIndex,
        top: rect.top - containerRect.top,
        width,
      });
    }
  }

  return positions;
}

function buildOverlayState(
  editor: Editor,
  container: HTMLElement,
  tablePos: number,
  hoveredRowIndex: number | null,
  hoveredColumnIndex: number | null,
) {
  const tableDom = getTableDomAtPosition(editor, tablePos);
  if (!tableDom) {
    return null;
  }

  const containerRect = container.getBoundingClientRect();
  const tableRect = tableDom.table.getBoundingClientRect();
  const rowPositions = Array.from(tableDom.table.rows).map((row) => {
    const rect = row.getBoundingClientRect();

    return {
      height: rect.height,
      left: rect.left - containerRect.left,
      top: rect.top - containerRect.top,
      width: rect.width,
    } satisfies BandPosition;
  });
  const columnPositions = tableDom.table.rows[0]
    ? buildColumnPositions(tableDom.table.rows[0], containerRect)
    : [];

  if (rowPositions.length < 1 || columnPositions.length < 1) {
    return null;
  }

  const clampedHoveredRowIndex =
    hoveredRowIndex === null
      ? null
      : Math.min(Math.max(hoveredRowIndex, 0), rowPositions.length - 1);
  const clampedHoveredColumnIndex =
    hoveredColumnIndex === null
      ? null
      : Math.min(Math.max(hoveredColumnIndex, 0), columnPositions.length - 1);

  return {
    columnPositions,
    hoveredColumnIndex: clampedHoveredColumnIndex,
    hoveredRowIndex: clampedHoveredRowIndex,
    rowPositions,
    tableHeight: tableRect.height,
    tableLeft: tableRect.left - containerRect.left,
    tablePos,
    tableTop: tableRect.top - containerRect.top,
    tableWidth: tableRect.width,
  } satisfies TableOverlayState;
}

export function TableEdgeControls({ editor, locale }: TableEdgeControlsProps) {
  const messages = getLocaleMessages(locale);
  const [overlay, setOverlay] = useState<TableOverlayState | null>(null);
  const [drag, setDrag] = useState<TableDragState | null>(null);
  const overlayRef = useRef<TableOverlayState | null>(null);
  const dragRef = useRef<TableDragState | null>(null);

  const refreshOverlay = useEffectEvent(
    (
      container: HTMLElement,
      tablePos: number,
      hoveredRowIndex: number | null,
      hoveredColumnIndex: number | null,
    ) => {
      const nextOverlay = buildOverlayState(
        editor,
        container,
        tablePos,
        hoveredRowIndex,
        hoveredColumnIndex,
      );
      overlayRef.current = nextOverlay;
      setOverlay(nextOverlay);
      return nextOverlay;
    },
  );

  const handlePointerMove = useEffectEvent((container: HTMLElement, event: PointerEvent) => {
    const currentDrag = dragRef.current;
    const currentOverlay = overlayRef.current;
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest("[data-table-edge-control]")) {
      return;
    }

    const cell = target.closest("th, td");
    if (!(cell instanceof HTMLElement)) {
      if (currentOverlay && isWithinActiveTableBounds(container, currentOverlay, event)) {
        if (currentDrag) {
          const nextIndex = resolveBandIndexFromPointer(
            container,
            currentOverlay,
            currentDrag.axis,
            event,
          );

          if (nextIndex !== null) {
            const nextDrag = {
              ...currentDrag,
              toIndex: nextIndex,
            } satisfies TableDragState;

            dragRef.current = nextDrag;
            setDrag(nextDrag);
            refreshOverlay(
              container,
              currentOverlay.tablePos,
              currentDrag.axis === "row" ? nextIndex : currentOverlay.hoveredRowIndex,
              currentDrag.axis === "column" ? nextIndex : currentOverlay.hoveredColumnIndex,
            );
          }
        }

        return;
      }

      if (!currentDrag) {
        overlayRef.current = null;
        setOverlay(null);
      }
      return;
    }

    const position = resolveTableCellPosition(editor, cell);
    if (!position) {
      if (currentOverlay && isWithinActiveTableBounds(container, currentOverlay, event)) {
        if (currentDrag) {
          const nextIndex = resolveBandIndexFromPointer(
            container,
            currentOverlay,
            currentDrag.axis,
            event,
          );

          if (nextIndex !== null) {
            const nextDrag = {
              ...currentDrag,
              toIndex: nextIndex,
            } satisfies TableDragState;

            dragRef.current = nextDrag;
            setDrag(nextDrag);
          }
        }

        return;
      }

      if (!currentDrag) {
        overlayRef.current = null;
        setOverlay(null);
      }
      return;
    }

    refreshOverlay(container, position.tablePos, position.rowIndex, position.columnIndex);

    if (!currentDrag) {
      return;
    }

    if (currentDrag.tablePos !== position.tablePos) {
      const nextDrag = {
        ...currentDrag,
        toIndex: null,
      } satisfies TableDragState;
      dragRef.current = nextDrag;
      setDrag(nextDrag);
      return;
    }

    const nextIndex =
      currentDrag.axis === "row" ? position.rowIndex : position.columnIndex;
    const nextDrag = {
      ...currentDrag,
      toIndex: nextIndex,
    } satisfies TableDragState;

    dragRef.current = nextDrag;
    setDrag(nextDrag);
  });

  const finishDrag = useEffectEvent((container: HTMLElement) => {
    const currentDrag = dragRef.current;
    const currentOverlay = overlayRef.current;

    if (!currentDrag) {
      return;
    }

    const nextIndex = currentDrag.toIndex;

    if (nextIndex === null || nextIndex === currentDrag.fromIndex) {
      if (currentDrag.axis === "row") {
        selectTableRow(editor, currentDrag.tablePos, currentDrag.fromIndex);
      } else {
        selectTableColumn(editor, currentDrag.tablePos, currentDrag.fromIndex);
      }
    } else if (currentDrag.axis === "row") {
      moveTableRowAt(editor, currentDrag.tablePos, currentDrag.fromIndex, nextIndex);
    } else {
      moveTableColumnAt(editor, currentDrag.tablePos, currentDrag.fromIndex, nextIndex);
    }

    dragRef.current = null;
    setDrag(null);

    window.requestAnimationFrame(() => {
      if (editor.isDestroyed || !container.isConnected) {
        return;
      }

      refreshOverlay(
        container,
        currentDrag.tablePos,
        currentDrag.axis === "row"
          ? (nextIndex ?? currentDrag.fromIndex)
          : currentOverlay?.hoveredRowIndex ?? 0,
        currentDrag.axis === "column"
          ? (nextIndex ?? currentDrag.fromIndex)
          : currentOverlay?.hoveredColumnIndex ?? 0,
      );
    });
  });

  const handlePointerLeave = useEffectEvent(() => {
    if (!dragRef.current) {
      overlayRef.current = null;
      setOverlay(null);
    }
  });

  const handleLayoutRefresh = useEffectEvent((container: HTMLElement) => {
    const currentOverlay = overlayRef.current;
    const currentDrag = dragRef.current;

    if (!currentOverlay || editor.isDestroyed || !container.isConnected) {
      return;
    }

    refreshOverlay(
      container,
      currentOverlay.tablePos,
      currentDrag?.axis === "row"
        ? (currentDrag.toIndex ?? currentDrag.fromIndex)
        : currentOverlay.hoveredRowIndex,
      currentDrag?.axis === "column"
        ? (currentDrag.toIndex ?? currentDrag.fromIndex)
        : currentOverlay.hoveredColumnIndex,
    );
  });

  useEffect(() => {
    const container = editor.view.dom.closest(".rich-editor");
    if (!(container instanceof HTMLElement)) {
      return undefined;
    }

    const handleContainerPointerMove = (event: PointerEvent) => {
      handlePointerMove(container, event);
    };
    const handleWindowPointerMove = (event: PointerEvent) => {
      if (dragRef.current) {
        handlePointerMove(container, event);
      }
    };
    const handleContainerPointerLeave = () => {
      handlePointerLeave();
    };
    const handleWindowPointerUp = () => {
      finishDrag(container);
    };
    const handleContainerLayoutRefresh = () => {
      handleLayoutRefresh(container);
    };

    container.addEventListener("pointermove", handleContainerPointerMove);
    container.addEventListener("pointerleave", handleContainerPointerLeave);
    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("resize", handleContainerLayoutRefresh);
    editor.on("selectionUpdate", handleContainerLayoutRefresh);
    editor.on("update", handleContainerLayoutRefresh);

    return () => {
      container.removeEventListener("pointermove", handleContainerPointerMove);
      container.removeEventListener("pointerleave", handleContainerPointerLeave);
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("resize", handleContainerLayoutRefresh);
      editor.off("selectionUpdate", handleContainerLayoutRefresh);
      editor.off("update", handleContainerLayoutRefresh);
    };
  }, [editor, finishDrag, handleLayoutRefresh, handlePointerLeave, handlePointerMove]);

  if (!overlay) {
    return null;
  }

  const hoveredRow =
    overlay.hoveredRowIndex === null
      ? null
      : overlay.rowPositions[overlay.hoveredRowIndex];
  const hoveredColumn =
    overlay.hoveredColumnIndex === null
      ? null
      : overlay.columnPositions[overlay.hoveredColumnIndex];
  const showBottomAddButton =
    overlay.hoveredRowIndex !== null &&
    overlay.hoveredRowIndex === overlay.rowPositions.length - 1;
  const showRightAddButton =
    overlay.hoveredColumnIndex !== null &&
    overlay.hoveredColumnIndex === overlay.columnPositions.length - 1;

  return (
    <div className="table-edge-controls" data-table-edge-controls="">
      {hoveredRow ? (
        <button
          aria-label={messages.editor.tableRowHandleLabel(overlay.hoveredRowIndex! + 1)}
          className={`table-edge-control table-edge-handle table-edge-row-handle${
            drag?.axis === "row" ? " is-dragging" : ""
          }`}
          data-table-edge-control=""
          onPointerDown={(event) => {
            event.preventDefault();
            const nextDrag = {
              axis: "row",
              fromIndex: overlay.hoveredRowIndex!,
              tablePos: overlay.tablePos,
              toIndex: overlay.hoveredRowIndex,
            } satisfies TableDragState;
            dragRef.current = nextDrag;
            setDrag(nextDrag);
          }}
          style={{
            left: `${overlay.tableLeft - EDGE_CONTROL_OFFSET}px`,
            top: `${hoveredRow.top + hoveredRow.height / 2}px`,
          }}
          title={messages.editor.tableRowHandleLabel(overlay.hoveredRowIndex! + 1)}
          type="button"
        >
          <TableGripIcon axis="row" />
        </button>
      ) : null}
      {hoveredColumn ? (
        <button
          aria-label={messages.editor.tableColumnHandleLabel(overlay.hoveredColumnIndex! + 1)}
          className={`table-edge-control table-edge-handle table-edge-column-handle${
            drag?.axis === "column" ? " is-dragging" : ""
          }`}
          data-table-edge-control=""
          onPointerDown={(event) => {
            event.preventDefault();
            const nextDrag = {
              axis: "column",
              fromIndex: overlay.hoveredColumnIndex!,
              tablePos: overlay.tablePos,
              toIndex: overlay.hoveredColumnIndex,
            } satisfies TableDragState;
            dragRef.current = nextDrag;
            setDrag(nextDrag);
          }}
          style={{
            left: `${hoveredColumn.left + hoveredColumn.width / 2}px`,
            top: `${overlay.tableTop - EDGE_CONTROL_OFFSET}px`,
          }}
          title={messages.editor.tableColumnHandleLabel(overlay.hoveredColumnIndex! + 1)}
          type="button"
        >
          <TableGripIcon axis="column" />
        </button>
      ) : null}
      {showRightAddButton ? (
        <button
          aria-label={messages.commands["table-add-column-after"].label}
          className="table-edge-control table-edge-add-button table-edge-add-column"
          data-table-edge-control=""
          onMouseDown={(event) => {
            event.preventDefault();
            if (overlay.hoveredColumnIndex === null) {
              return;
            }

            addTableColumnAfterAt(
              editor,
              overlay.tablePos,
              overlay.hoveredRowIndex ?? 0,
              overlay.hoveredColumnIndex,
            );
          }}
          style={{
            height: `${Math.max(32, overlay.tableHeight)}px`,
            left: `${overlay.tableLeft + overlay.tableWidth + EDGE_ADD_BUTTON_OFFSET}px`,
            top: `${overlay.tableTop + overlay.tableHeight / 2}px`,
            width: "30px",
          }}
          title={messages.commands["table-add-column-after"].label}
          type="button"
        >
          <span aria-hidden="true" className="table-edge-plus-icon">
            +
          </span>
        </button>
      ) : null}
      {showBottomAddButton ? (
        <button
          aria-label={messages.commands["table-add-row-after"].label}
          className="table-edge-control table-edge-add-button table-edge-add-row"
          data-table-edge-control=""
          onMouseDown={(event) => {
            event.preventDefault();
            if (overlay.hoveredRowIndex === null) {
              return;
            }

            addTableRowAfterAt(
              editor,
              overlay.tablePos,
              overlay.hoveredRowIndex,
              overlay.hoveredColumnIndex ?? 0,
            );
          }}
          style={{
            height: "30px",
            left: `${overlay.tableLeft + overlay.tableWidth / 2}px`,
            top: `${overlay.tableTop + overlay.tableHeight + EDGE_ADD_BUTTON_OFFSET}px`,
            width: `${Math.max(64, overlay.tableWidth)}px`,
          }}
          title={messages.commands["table-add-row-after"].label}
          type="button"
        >
          <span aria-hidden="true" className="table-edge-plus-icon">
            +
          </span>
        </button>
      ) : null}
    </div>
  );
}
