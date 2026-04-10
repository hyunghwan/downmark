import type { Editor } from "@tiptap/core";
import { BubbleMenu } from "@tiptap/react/menus";

import { getLocaleMessages } from "../i18n/messages";
import type { SupportedLocale } from "../i18n/locale";
import { getCommandRegistry } from "./command-registry";

interface BubbleMenuBarProps {
  editor: Editor;
  locale: SupportedLocale;
  onApplyCommand: (id: string) => void;
}

export function BubbleMenuBar({ editor, locale, onApplyCommand }: BubbleMenuBarProps) {
  const bubbleCommands = getCommandRegistry(locale, "bubble");
  const messages = getLocaleMessages(locale);

  return (
    <BubbleMenu
      aria-label={messages.editor.bubbleMenuAriaLabel}
      editor={editor}
      className="bubble-menu"
      options={{ placement: "top" }}
      shouldShow={({ editor: currentEditor }: { editor: Editor }) =>
        !currentEditor.state.selection.empty
      }
    >
      {bubbleCommands.map((command) => (
        <button
          key={command.id}
          className={command.isActive(editor) ? "is-active" : ""}
          disabled={!command.canRun(editor)}
          onMouseDown={(event) => {
            event.preventDefault();
            onApplyCommand(command.id);
          }}
          type="button"
        >
          {command.label}
        </button>
      ))}
    </BubbleMenu>
  );
}
