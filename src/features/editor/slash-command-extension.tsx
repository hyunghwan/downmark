import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import tippy, { type Instance, type Props as TippyProps } from "tippy.js";

import {
  applyEditorCommand,
  getCommandRegistry,
  type CommandDefinition,
} from "./command-registry";
import { SlashMenu, type SlashMenuHandle } from "./SlashMenu";

function filterCommands(query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const commands = getCommandRegistry("slash");

  if (!normalizedQuery) {
    return commands.slice(0, 8);
  }

  return commands
    .filter((item) => {
      const haystack = [item.label, item.description, ...item.keywords]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    })
    .slice(0, 8);
}

export function createSlashCommandExtension() {
  return Extension.create({
    name: "slashCommands",
    addProseMirrorPlugins() {
      return [
        Suggestion<CommandDefinition>({
          editor: this.editor,
          char: "/",
          allowSpaces: false,
          items: ({ query }) => filterCommands(query),
          command: ({ editor, range, props }) => {
            editor.chain().focus().deleteRange(range).run();
            applyEditorCommand(editor, props.id);
          },
          allow: ({ state }) => {
            const { $from } = state.selection;
            return $from.parent.type.name === "paragraph";
          },
          render: () => {
            let reactRenderer: ReactRenderer<SlashMenuHandle> | null = null;
            let popup: Instance<TippyProps> | null = null;

            return {
              onStart: (props) => {
                reactRenderer = new ReactRenderer(SlashMenu, {
                  props: {
                    items: props.items,
                    onSelect: (item: CommandDefinition) => {
                      props.command(item);
                    },
                  },
                  editor: props.editor,
                });

                if (!props.clientRect) {
                  return;
                }

                popup = tippy(document.body, {
                  appendTo: () => document.body,
                  content: reactRenderer.element,
                  getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
                  interactive: true,
                  placement: "bottom-start",
                  showOnCreate: true,
                  trigger: "manual",
                  theme: "downmark",
                });
              },
              onUpdate(props) {
                reactRenderer?.updateProps({
                  items: props.items,
                  onSelect: (item: CommandDefinition) => {
                    props.command(item);
                  },
                });

                if (!props.clientRect || !popup) {
                  return;
                }

                popup.setProps({
                  getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
                });
              },
              onKeyDown(props) {
                if (props.event.key === "Escape") {
                  popup?.hide();
                  return true;
                }

                return (
                  (reactRenderer?.ref as SlashMenuHandle | null)?.onKeyDown(
                    props.event,
                  ) ?? false
                );
              },
              onExit() {
                popup?.destroy();
                reactRenderer?.destroy();
              },
            };
          },
        }),
      ];
    },
  });
}
