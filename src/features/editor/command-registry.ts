import type { Editor } from "@tiptap/core";

import { getLocaleMessages } from "../i18n/messages";
import type { SupportedLocale } from "../i18n/locale";

export type CommandSurface = "bubble" | "slash";

export interface CommandDefinition {
  id: string;
  label: string;
  description: string;
  keywords: string[];
  surfaces: CommandSurface[];
  isActive: (editor: Editor) => boolean;
  canRun: (editor: Editor) => boolean;
  run?: (editor: Editor) => boolean;
}

type CommandBehavior = Omit<CommandDefinition, "description" | "keywords" | "label">;

const COMMAND_BEHAVIORS: CommandBehavior[] = [
  {
    id: "paragraph",
    surfaces: ["slash"],
    isActive: (editor) => editor.isActive("paragraph"),
    canRun: (editor) => editor.can().chain().focus().setParagraph().run(),
    run: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    id: "heading-1",
    surfaces: ["slash"],
    isActive: (editor) => editor.isActive("heading", { level: 1 }),
    canRun: (editor) => editor.can().chain().focus().toggleHeading({ level: 1 }).run(),
    run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: "heading-2",
    surfaces: ["slash"],
    isActive: (editor) => editor.isActive("heading", { level: 2 }),
    canRun: (editor) => editor.can().chain().focus().toggleHeading({ level: 2 }).run(),
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: "heading-3",
    surfaces: ["slash"],
    isActive: (editor) => editor.isActive("heading", { level: 3 }),
    canRun: (editor) => editor.can().chain().focus().toggleHeading({ level: 3 }).run(),
    run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: "bold",
    surfaces: ["bubble", "slash"],
    isActive: (editor) => editor.isActive("bold"),
    canRun: (editor) => editor.can().chain().focus().toggleBold().run(),
    run: (editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    id: "italic",
    surfaces: ["bubble", "slash"],
    isActive: (editor) => editor.isActive("italic"),
    canRun: (editor) => editor.can().chain().focus().toggleItalic().run(),
    run: (editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    id: "strike",
    surfaces: ["bubble", "slash"],
    isActive: (editor) => editor.isActive("strike"),
    canRun: (editor) => editor.can().chain().focus().toggleStrike().run(),
    run: (editor) => editor.chain().focus().toggleStrike().run(),
  },
  {
    id: "inline-code",
    surfaces: ["bubble", "slash"],
    isActive: (editor) => editor.isActive("code"),
    canRun: (editor) => editor.can().chain().focus().toggleCode().run(),
    run: (editor) => editor.chain().focus().toggleCode().run(),
  },
  {
    id: "link",
    surfaces: ["bubble"],
    isActive: (editor) => editor.isActive("link"),
    canRun: (editor) => editor.state.selection.from !== editor.state.selection.to,
  },
  {
    id: "image",
    surfaces: ["slash"],
    isActive: () => false,
    canRun: () => true,
  },
  {
    id: "bullet-list",
    surfaces: ["slash"],
    isActive: (editor) => editor.isActive("bulletList"),
    canRun: (editor) => editor.can().chain().focus().toggleBulletList().run(),
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: "ordered-list",
    surfaces: ["slash"],
    isActive: (editor) => editor.isActive("orderedList"),
    canRun: (editor) => editor.can().chain().focus().toggleOrderedList().run(),
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "task-list",
    surfaces: ["slash"],
    isActive: (editor) => editor.isActive("taskList"),
    canRun: (editor) => editor.can().chain().focus().toggleTaskList().run(),
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: "blockquote",
    surfaces: ["slash"],
    isActive: (editor) => editor.isActive("blockquote"),
    canRun: (editor) => editor.can().chain().focus().toggleBlockquote().run(),
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "code-block",
    surfaces: ["slash"],
    isActive: (editor) => editor.isActive("codeBlock"),
    canRun: (editor) => editor.can().chain().focus().toggleCodeBlock().run(),
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "table",
    surfaces: ["slash"],
    isActive: (editor) => editor.isActive("table"),
    canRun: (editor) =>
      editor
        .can()
        .chain()
        .focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
    run: (editor) =>
      editor
        .chain()
        .focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    id: "table-add-row-after",
    surfaces: ["slash"],
    isActive: () => false,
    canRun: (editor) => editor.can().chain().focus().addRowAfter().run(),
    run: (editor) => editor.chain().focus().addRowAfter().run(),
  },
  {
    id: "table-add-column-after",
    surfaces: ["slash"],
    isActive: () => false,
    canRun: (editor) => editor.can().chain().focus().addColumnAfter().run(),
    run: (editor) => editor.chain().focus().addColumnAfter().run(),
  },
  {
    id: "table-delete-row",
    surfaces: ["slash"],
    isActive: () => false,
    canRun: (editor) => editor.can().chain().focus().deleteRow().run(),
    run: (editor) => editor.chain().focus().deleteRow().run(),
  },
  {
    id: "table-delete-column",
    surfaces: ["slash"],
    isActive: () => false,
    canRun: (editor) => editor.can().chain().focus().deleteColumn().run(),
    run: (editor) => editor.chain().focus().deleteColumn().run(),
  },
  {
    id: "horizontal-rule",
    surfaces: ["slash"],
    isActive: () => false,
    canRun: (editor) => editor.can().chain().focus().setHorizontalRule().run(),
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
];

function getCommandBehavior(id: string) {
  return COMMAND_BEHAVIORS.find((command) => command.id === id) ?? null;
}

export function getCommandRegistry(locale: SupportedLocale, surface?: CommandSurface) {
  const englishMessages = getLocaleMessages("en").commands;
  const localizedMessages = getLocaleMessages(locale).commands;
  const commands = surface
    ? COMMAND_BEHAVIORS.filter((command) => command.surfaces.includes(surface))
    : COMMAND_BEHAVIORS;

  return commands.map((command) => {
    const localized = localizedMessages[command.id];
    const english = englishMessages[command.id];

    return {
      ...command,
      label: localized.label,
      description: localized.description,
      keywords: Array.from(new Set([...localized.keywords, ...english.keywords])),
    } satisfies CommandDefinition;
  });
}

export function applyEditorCommand(editor: Editor, id: string) {
  const command = getCommandBehavior(id);
  if (!command?.run) {
    return false;
  }

  return command.run(editor);
}

export function canApplyEditorCommand(editor: Editor, id: string) {
  const command = getCommandBehavior(id);
  return command ? command.canRun(editor) : false;
}

export function applyLink(editor: Editor, href: string) {
  if (!href.trim()) {
    return false;
  }

  return editor
    .chain()
    .focus()
    .extendMarkRange("link")
    .setLink({ href: href.trim() })
    .run();
}
