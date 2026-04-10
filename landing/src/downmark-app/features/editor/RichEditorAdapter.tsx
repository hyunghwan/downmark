import {
  forwardRef,
  memo,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor, JSONContent } from "@tiptap/core";
import { Selection, TextSelection } from "@tiptap/pm/state";

import type { SupportedLocale } from "../i18n/locale";
import { BubbleMenuBar } from "./BubbleMenuBar";
import { TableFloatingMenu } from "./TableFloatingMenu";
import {
  applyEditorCommand,
  applyLink,
  canApplyEditorCommand,
} from "./command-registry";
import { createRichEditorExtensions } from "./extensions";
import {
  applySlashCommand,
  type SlashCommandHandler,
} from "./slash-command-extension";

export interface EditorImageAsset {
  alt: string;
  displaySrc?: string;
  src: string;
}

export interface RichEditorAdapterHandle {
  setContent: (doc: JSONContent) => void;
  getPendingDoc: () => JSONContent | null;
  getHtml: () => string;
  getSelectionRange: () => { from: number; to: number } | null;
  restoreSelection: (range: { from: number; to: number } | null) => void;
  insertText: (text: string) => boolean;
  selectAll: () => boolean;
  applySlashCommand: (commandId: string) => Promise<boolean>;
  applyCommand: (commandId: string) => Promise<boolean>;
  canApply: (commandId: string) => boolean;
  focus: () => void;
  blur: () => void;
}

interface RichEditorAdapterProps {
  autoFocus?: boolean;
  content: JSONContent;
  contentVersion: number;
  locale: SupportedLocale;
  onDocumentChange: (doc: JSONContent) => void;
  onRequestImage: (prompt: string) => Promise<EditorImageAsset | null>;
  onResolveImageFile: (file: File) => Promise<EditorImageAsset | null>;
  onRequestLink: (prompt: string) => Promise<string | null>;
  messages: {
    imagePrompt: string;
    linkPrompt: string;
    loadingLabel: string;
    richEditorAriaLabel: string;
  };
}

function resolveDropPosition(currentEditor: Editor, event: Pick<DragEvent, "clientX" | "clientY">) {
  return (
    currentEditor.view.posAtCoords({
      left: event.clientX,
      top: event.clientY,
    })?.pos ?? currentEditor.state.doc.content.size
  );
}

const RichEditorAdapterInner = forwardRef<RichEditorAdapterHandle, RichEditorAdapterProps>(
  function RichEditorAdapter(
    {
      autoFocus = false,
      content,
      contentVersion,
      locale,
      messages,
      onDocumentChange,
      onRequestImage,
      onResolveImageFile,
      onRequestLink,
    },
    ref,
  ) {
    const handleDocumentChange = useEffectEvent(onDocumentChange);
    const handleRequestImage = useEffectEvent(onRequestImage);
    const handleResolveImageFile = useEffectEvent(onResolveImageFile);
    const handleRequestLink = useEffectEvent(onRequestLink);

    const insertImage = useEffectEvent(
      async (
        currentEditor: Editor,
        image: EditorImageAsset | null,
        range?: { from: number; to: number },
        position?: number,
      ) => {
        if (!image) {
          return false;
        }

        const chain = currentEditor.chain().focus();
        if (range) {
          chain.deleteRange(range);
        }

        if (typeof position === "number") {
          return chain
            .insertContentAt(position, {
              type: "image",
              attrs: {
                alt: image.alt,
                displaySrc: image.displaySrc ?? null,
                src: image.src,
              },
            })
            .run();
        }

        return chain
          .insertContent({
            type: "image",
            attrs: {
              alt: image.alt,
              displaySrc: image.displaySrc ?? null,
              src: image.src,
            },
          })
          .run();
      },
    );

    const executeSlashCommand = useEffectEvent<SlashCommandHandler>(
      async (currentEditor, commandId, range) => {
        if (commandId === "image") {
          const image = await handleRequestImage(messages.imagePrompt);
          return insertImage(currentEditor, image, range);
        }

        return applySlashCommand(currentEditor, commandId, range);
      },
    );

    const editor = useEditor(
      {
        extensions: createRichEditorExtensions(locale, executeSlashCommand),
        content,
        immediatelyRender: true,
        editorProps: {
          attributes: {
            class: "rich-editor__content",
            role: "textbox",
            "aria-label": messages.richEditorAriaLabel,
            "aria-multiline": "true",
          },
          handlePaste: (_view, event) => {
            const file = Array.from(event.clipboardData?.files ?? []).find((candidate) =>
              candidate.type.startsWith("image/"),
            );
            if (!file) {
              return false;
            }

            event.preventDefault();
            void handleResolveImageFile(file).then((image) => {
              if (editor) {
                void insertImage(editor, image);
              }
            });
            return true;
          },
          handleDrop: (view, event) => {
            const file = Array.from(event.dataTransfer?.files ?? []).find((candidate) =>
              candidate.type.startsWith("image/"),
            );
            if (!file) {
              return false;
            }

            const position =
              view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
              })?.pos ?? view.state.doc.content.size;

            event.preventDefault();
            void handleResolveImageFile(file).then((image) => {
              if (editor) {
                void insertImage(editor, image, undefined, position);
              }
            });
            return true;
          },
        },
        onUpdate({ editor: currentEditor }) {
          handleDocumentChange(currentEditor.getJSON());
        },
      },
      [locale],
    );

    useEffect(() => {
      if (!editor) {
        return;
      }

      editor.commands.setContent(content, { emitUpdate: false });
    }, [contentVersion, editor]);

    useEffect(() => {
      if (!autoFocus || !editor) {
        return;
      }

      editor.chain().focus().run();
      (editor.view.dom as HTMLElement).focus();
    }, [autoFocus, contentVersion, editor]);

    useImperativeHandle(
      ref,
      () => ({
        setContent(doc) {
          editor?.commands.setContent(doc, { emitUpdate: false });
        },
        getPendingDoc() {
          return editor?.getJSON() ?? null;
        },
        getHtml() {
          return editor?.getHTML() ?? "";
        },
        getSelectionRange() {
          if (!editor) {
            return null;
          }

          const { from, to } = editor.state.selection;
          return { from, to };
        },
        restoreSelection(range) {
          if (!editor || !range) {
            return;
          }

          const { doc, tr } = editor.state;
          const maxPosition = doc.content.size;
          if (maxPosition < 1) {
            editor.chain().focus().run();
            return;
          }

          const from = Math.min(Math.max(range.from, 1), maxPosition);
          const to = Math.min(Math.max(range.to, 1), maxPosition);
          const selection =
            from === to
              ? Selection.near(doc.resolve(from))
              : TextSelection.between(doc.resolve(from), doc.resolve(to));

          editor.view.dispatch(tr.setSelection(selection));
          editor.commands.focus();
        },
        insertText(text) {
          if (!editor) {
            return false;
          }

          return editor.chain().focus().insertContent(text).run();
        },
        selectAll() {
          if (!editor) {
            return false;
          }

          return editor.chain().focus().selectAll().run();
        },
        async applySlashCommand(commandId) {
          if (!editor) {
            return false;
          }

          return executeSlashCommand(editor, commandId);
        },
        async applyCommand(commandId) {
          if (!editor) {
            return false;
          }

          if (commandId === "link") {
            const href = await handleRequestLink(messages.linkPrompt);
            return href ? applyLink(editor, href) : false;
          }

          return applyEditorCommand(editor, commandId);
        },
        canApply(commandId) {
          if (!editor) {
            return false;
          }

          if (commandId === "link") {
            return editor.state.selection.from !== editor.state.selection.to;
          }

          return canApplyEditorCommand(editor, commandId);
        },
        focus() {
          if (!editor) {
            return;
          }

          editor.chain().focus().run();
          (editor.view.dom as HTMLElement).focus();
        },
        blur() {
          if (!editor) {
            return;
          }

          editor.commands.blur();
          (editor.view.dom as HTMLElement).blur();
        },
      }),
      [editor, executeSlashCommand, handleRequestLink, messages.linkPrompt],
    );

    if (!editor) {
      return <div className="editor-loading">{messages.loadingLabel}</div>;
    }

    return (
      <div className="rich-editor">
        <BubbleMenuBar
          editor={editor}
          locale={locale}
          onApplyCommand={(commandId) => {
            if (commandId === "link") {
              void handleRequestLink(messages.linkPrompt).then((href) => {
                if (href) {
                  applyLink(editor, href);
                }
              });
              return;
            }

            applyEditorCommand(editor, commandId);
          }}
        />
        <TableFloatingMenu
          editor={editor}
          locale={locale}
          onApplyCommand={(commandId) => {
            applyEditorCommand(editor, commandId);
          }}
        />
        <EditorContent
          editor={editor}
          onDrop={(event) => {
            if (event.defaultPrevented) {
              return;
            }

            const file = Array.from(event.dataTransfer?.files ?? []).find((candidate) =>
              candidate.type.startsWith("image/"),
            );
            if (!file) {
              return;
            }

            const position = resolveDropPosition(editor, event.nativeEvent);
            event.preventDefault();
            void handleResolveImageFile(file).then((image) => {
              if (editor) {
                void insertImage(editor, image, undefined, position);
              }
            });
          }}
          onPaste={(event) => {
            if (event.defaultPrevented) {
              return;
            }

            const file = Array.from(event.clipboardData?.files ?? []).find((candidate) =>
              candidate.type.startsWith("image/"),
            );
            if (!file) {
              return;
            }

            event.preventDefault();
            void handleResolveImageFile(file).then((image) => {
              if (editor) {
                void insertImage(editor, image);
              }
            });
          }}
        />
      </div>
    );
  },
);

export const RichEditorAdapter = memo(
  RichEditorAdapterInner,
  (previousProps, nextProps) =>
    previousProps.autoFocus === nextProps.autoFocus &&
    previousProps.contentVersion === nextProps.contentVersion &&
    previousProps.locale === nextProps.locale &&
    previousProps.messages === nextProps.messages &&
    previousProps.onDocumentChange === nextProps.onDocumentChange &&
    previousProps.onRequestImage === nextProps.onRequestImage &&
    previousProps.onRequestLink === nextProps.onRequestLink &&
    previousProps.onResolveImageFile === nextProps.onResolveImageFile,
);
