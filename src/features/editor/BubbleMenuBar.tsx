import type { Editor } from "@tiptap/core";
import { BubbleMenu } from "@tiptap/react/menus";

import { getCommandRegistry } from "./command-registry";

interface BubbleMenuBarProps {
  editor: Editor;
  onApplyCommand: (id: string) => void;
}

const bubbleCommands = getCommandRegistry("bubble");

export function BubbleMenuBar({ editor, onApplyCommand }: BubbleMenuBarProps) {
  return (
    <BubbleMenu
      aria-label="Text formatting"
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
