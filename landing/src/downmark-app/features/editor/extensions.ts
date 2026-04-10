import { mergeAttributes } from "@tiptap/core";
import { Image } from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

import { getLocaleMessages } from "../i18n/messages";
import type { SupportedLocale } from "../i18n/locale";
import {
  createSlashCommandExtensionWithHandler,
  type SlashCommandHandler,
} from "./slash-command-extension";

const RichImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      displaySrc: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
    };
  },
  renderHTML({ HTMLAttributes, node }) {
    const { displaySrc: _displaySrc, ...rest } = HTMLAttributes;
    const displaySrc =
      typeof node.attrs.displaySrc === "string" && node.attrs.displaySrc.length > 0
        ? node.attrs.displaySrc
        : null;
    const src =
      displaySrc
        ? displaySrc
        : rest.src;

    return ["img", mergeAttributes(this.options.HTMLAttributes, { ...rest, src })];
  },
});

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
    RichImage,
    Table.configure({
      renderWrapper: true,
      resizable: false,
    }),
    TableRow,
    TableHeader,
    TableCell,
    Markdown.configure({
      markedOptions: {
        gfm: true,
      },
    }),
  ];
}

export function createRichEditorExtensions(
  locale: SupportedLocale,
  onSlashCommand?: SlashCommandHandler,
) {
  const messages = getLocaleMessages(locale);

  return [
    ...createMarkdownExtensions(),
    Placeholder.configure({
      placeholder: messages.editor.richEditorPlaceholder,
    }),
    createSlashCommandExtensionWithHandler(locale, onSlashCommand),
  ];
}
