import { Extension, type Editor } from "@tiptap/core";
import Suggestion, { exitSuggestion, SuggestionPluginKey } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import tippy, { type Instance, type Props as TippyProps } from "tippy.js";

import { getCommandRegistry, type CommandDefinition } from "./command-registry";
import { SlashMenu, type SlashMenuHandle } from "./SlashMenu";

export function applySlashCommand(
  editor: Editor,
  id: string,
  range?: { from: number; to: number },
) {
  const chain = editor.chain().focus();

  if (range) {
    chain.deleteRange(range);
  }

  switch (id) {
    case "paragraph":
      return chain.setParagraph().run();
    case "heading-1":
      return chain.setHeading({ level: 1 }).run();
    case "heading-2":
      return chain.setHeading({ level: 2 }).run();
    case "heading-3":
      return chain.setHeading({ level: 3 }).run();
    case "bold":
      return chain.toggleBold().run();
    case "italic":
      return chain.toggleItalic().run();
    case "strike":
      return chain.toggleStrike().run();
    case "inline-code":
      return chain.toggleCode().run();
    case "bullet-list":
      return chain.toggleBulletList().run();
    case "ordered-list":
      return chain.toggleOrderedList().run();
    case "task-list":
      return chain.toggleTaskList().run();
    case "blockquote":
      return chain.toggleBlockquote().run();
    case "code-block":
      return chain.toggleCodeBlock().run();
    case "horizontal-rule":
      return chain.setHorizontalRule().run();
    default:
      return false;
  }
}

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
            const applied = applySlashCommand(editor, props.id, range);

            if (applied) {
              exitSuggestion(editor.view, SuggestionPluginKey);
            }
          },
          allow: ({ state }) => {
            const { $from } = state.selection;
            return $from.parent.type.name === "paragraph";
          },
          render: () => {
            let reactRenderer: ReactRenderer<SlashMenuHandle> | null = null;
            let popup: Instance<TippyProps> | null = null;
            const destroyMenu = () => {
              if (popup && !popup.state.isDestroyed) {
                popup.destroy();
              }
              popup = null;
              reactRenderer?.destroy();
              reactRenderer = null;
            };

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
                  arrow: false,
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
                destroyMenu();
              },
            };
          },
        }),
      ];
    },
  });
}
