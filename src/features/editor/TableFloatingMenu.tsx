import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";

import { getLocaleMessages } from "../i18n/messages";
import type { SupportedLocale } from "../i18n/locale";

interface TableFloatingMenuProps {
  editor: Editor;
  locale: SupportedLocale;
  onApplyCommand: (id: string) => void;
}

export function TableFloatingMenu({
  editor,
  locale,
  onApplyCommand,
}: TableFloatingMenuProps) {
  const messages = getLocaleMessages(locale);
  const tableState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      isActive: currentEditor.isActive("table"),
      canAddColumnAfter: currentEditor.can().chain().focus().addColumnAfter().run(),
      canAddRowAfter: currentEditor.can().chain().focus().addRowAfter().run(),
    }),
  });

  if (!tableState?.isActive) {
    return null;
  }

  return (
    <div className="table-floating-menu-anchor">
      <div
        className="table-floating-menu"
        aria-label={messages.editor.tableMenuAriaLabel}
        role="toolbar"
      >
        <button
          aria-label={messages.commands["table-add-row-after"].label}
          disabled={!tableState.canAddRowAfter}
          onMouseDown={(event) => {
            event.preventDefault();
            onApplyCommand("table-add-row-after");
          }}
          type="button"
        >
          {messages.commands["table-add-row-after"].label}
        </button>
        <button
          aria-label={messages.commands["table-add-column-after"].label}
          disabled={!tableState.canAddColumnAfter}
          onMouseDown={(event) => {
            event.preventDefault();
            onApplyCommand("table-add-column-after");
          }}
          type="button"
        >
          {messages.commands["table-add-column-after"].label}
        </button>
      </div>
    </div>
  );
}
