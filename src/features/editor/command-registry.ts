import type { Editor } from "@tiptap/core";

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

const COMMANDS: CommandDefinition[] = [
  {
    id: "paragraph",
    label: "Paragraph",
    description: "Turn the current block into plain paragraph text.",
    keywords: ["body", "text"],
    surfaces: ["slash"],
    isActive: (editor) => editor.isActive("paragraph"),
    canRun: (editor) => editor.can().chain().focus().setParagraph().run(),
    run: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    id: "heading-1",
    label: "Heading 1",
    description: "Large section heading.",
    keywords: ["title", "h1", "section"],
    surfaces: ["slash"],
    isActive: (editor) => editor.isActive("heading", { level: 1 }),
    canRun: (editor) => editor.can().chain().focus().toggleHeading({ level: 1 }).run(),
    run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: "heading-2",
    label: "Heading 2",
    description: "Medium section heading.",
    keywords: ["subtitle", "h2"],
    surfaces: ["slash"],
    isActive: (editor) => editor.isActive("heading", { level: 2 }),
    canRun: (editor) => editor.can().chain().focus().toggleHeading({ level: 2 }).run(),
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: "heading-3",
    label: "Heading 3",
    description: "Small section heading.",
    keywords: ["h3"],
    surfaces: ["slash"],
    isActive: (editor) => editor.isActive("heading", { level: 3 }),
    canRun: (editor) => editor.can().chain().focus().toggleHeading({ level: 3 }).run(),
    run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: "bold",
    label: "Bold",
    description: "Emphasize selected text strongly.",
    keywords: ["strong"],
    surfaces: ["bubble", "slash"],
    isActive: (editor) => editor.isActive("bold"),
    canRun: (editor) => editor.can().chain().focus().toggleBold().run(),
    run: (editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    id: "italic",
    label: "Italic",
    description: "Add gentle emphasis.",
    keywords: ["emphasis", "slanted"],
    surfaces: ["bubble", "slash"],
    isActive: (editor) => editor.isActive("italic"),
    canRun: (editor) => editor.can().chain().focus().toggleItalic().run(),
    run: (editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    id: "strike",
    label: "Strike",
    description: "Cross out selected text.",
    keywords: ["strikethrough"],
    surfaces: ["bubble", "slash"],
    isActive: (editor) => editor.isActive("strike"),
    canRun: (editor) => editor.can().chain().focus().toggleStrike().run(),
    run: (editor) => editor.chain().focus().toggleStrike().run(),
  },
  {
    id: "inline-code",
    label: "Inline Code",
    description: "Format selected text as inline code.",
    keywords: ["code", "snippet"],
    surfaces: ["bubble", "slash"],
    isActive: (editor) => editor.isActive("code"),
    canRun: (editor) => editor.can().chain().focus().toggleCode().run(),
    run: (editor) => editor.chain().focus().toggleCode().run(),
  },
  {
    id: "link",
    label: "Link",
    description: "Attach a URL to the current selection.",
    keywords: ["url", "href"],
    surfaces: ["bubble"],
    isActive: (editor) => editor.isActive("link"),
    canRun: (editor) => editor.state.selection.from !== editor.state.selection.to,
  },
  {
    id: "bullet-list",
    label: "Bullet List",
    description: "Create an unordered list.",
    keywords: ["list", "unordered"],
    surfaces: ["slash"],
    isActive: (editor) => editor.isActive("bulletList"),
    canRun: (editor) => editor.can().chain().focus().toggleBulletList().run(),
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: "ordered-list",
    label: "Numbered List",
    description: "Create an ordered list.",
    keywords: ["list", "ordered", "numbered"],
    surfaces: ["slash"],
    isActive: (editor) => editor.isActive("orderedList"),
    canRun: (editor) => editor.can().chain().focus().toggleOrderedList().run(),
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "task-list",
    label: "Checklist",
    description: "Create a task list with checkboxes.",
    keywords: ["tasks", "todos", "checklist"],
    surfaces: ["slash"],
    isActive: (editor) => editor.isActive("taskList"),
    canRun: (editor) => editor.can().chain().focus().toggleTaskList().run(),
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: "blockquote",
    label: "Quote",
    description: "Wrap the block in a quote.",
    keywords: ["blockquote", "callout"],
    surfaces: ["slash"],
    isActive: (editor) => editor.isActive("blockquote"),
    canRun: (editor) => editor.can().chain().focus().toggleBlockquote().run(),
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "code-block",
    label: "Code Block",
    description: "Create a fenced code block.",
    keywords: ["snippet", "fence"],
    surfaces: ["slash"],
    isActive: (editor) => editor.isActive("codeBlock"),
    canRun: (editor) => editor.can().chain().focus().toggleCodeBlock().run(),
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "horizontal-rule",
    label: "Divider",
    description: "Insert a horizontal rule.",
    keywords: ["separator", "rule", "line"],
    surfaces: ["slash"],
    isActive: () => false,
    canRun: (editor) => editor.can().chain().focus().setHorizontalRule().run(),
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
];

export function getCommandRegistry(surface?: CommandSurface) {
  if (!surface) {
    return COMMANDS;
  }

  return COMMANDS.filter((command) => command.surfaces.includes(surface));
}

export function findCommand(id: string) {
  return COMMANDS.find((command) => command.id === id) ?? null;
}

export function applyEditorCommand(editor: Editor, id: string) {
  const command = findCommand(id);
  if (!command?.run) {
    return false;
  }

  return command.run(editor);
}

export function canApplyEditorCommand(editor: Editor, id: string) {
  const command = findCommand(id);
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
