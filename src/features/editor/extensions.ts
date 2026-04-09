import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

import { createSlashCommandExtension } from "./slash-command-extension";

export function createMarkdownExtensions() {
  return [
    StarterKit.configure({
      link: false,
    }),
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    Link.configure({
      autolink: false,
      openOnClick: false,
      protocols: ["http", "https", "mailto"],
    }),
    Markdown.configure({
      markedOptions: {
        gfm: true,
      },
    }),
  ];
}

export function createRichEditorExtensions() {
  return [
    ...createMarkdownExtensions(),
    Placeholder.configure({
      placeholder: "Start typing a note, or use / for commands.",
    }),
    createSlashCommandExtension(),
  ];
}
