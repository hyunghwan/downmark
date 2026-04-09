import {
  forwardRef,
  memo,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";

import { BubbleMenuBar } from "./BubbleMenuBar";
import {
  applyEditorCommand,
  applyLink,
  canApplyEditorCommand,
} from "./command-registry";
import { createRichEditorExtensions } from "./extensions";
import { applySlashCommand } from "./slash-command-extension";

const richExtensions = createRichEditorExtensions();

export interface RichEditorAdapterHandle {
  setContent: (doc: JSONContent) => void;
  getPendingDoc: () => JSONContent | null;
  getHtml: () => string;
  getSelectionRange: () => { from: number; to: number } | null;
  restoreSelection: (range: { from: number; to: number } | null) => void;
  insertText: (text: string) => boolean;
  selectAll: () => boolean;
  applySlashCommand: (commandId: string) => boolean;
  applyCommand: (commandId: string) => Promise<boolean>;
  canApply: (commandId: string) => boolean;
  focus: () => void;
  blur: () => void;
}

interface RichEditorAdapterProps {
  autoFocus?: boolean;
  content: JSONContent;
  contentVersion: number;
  onDocumentChange: (doc: JSONContent) => void;
  onRequestLink: () => Promise<string | null>;
}

const RichEditorAdapterInner = forwardRef<
  RichEditorAdapterHandle,
  RichEditorAdapterProps
>(function RichEditorAdapter(
  { autoFocus = false, content, contentVersion, onDocumentChange, onRequestLink },
  ref,
) {
  const handleDocumentChange = useEffectEvent(onDocumentChange);
  const handleRequestLink = useEffectEvent(onRequestLink);

  const editor = useEditor({
    extensions: richExtensions,
    content,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        class: "rich-editor__content",
        role: "textbox",
        "aria-label": "Rich text editor",
        "aria-multiline": "true",
      },
    },
    onUpdate({ editor: currentEditor }) {
      handleDocumentChange(currentEditor.getJSON());
    },
  });

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

        const maxPosition = editor.state.doc.content.size;
        if (maxPosition < 1) {
          editor.chain().focus().run();
          return;
        }

        const from = Math.min(Math.max(range.from, 1), maxPosition);
        const to = Math.min(Math.max(range.to, 1), maxPosition);
        editor.chain().focus().setTextSelection({ from, to }).run();
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
      applySlashCommand(commandId) {
        if (!editor) {
          return false;
        }

        return applySlashCommand(editor, commandId);
      },
      async applyCommand(commandId) {
        if (!editor) {
          return false;
        }

        if (commandId === "link") {
          const href = await handleRequestLink();
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
    [editor, handleRequestLink],
  );

  if (!editor) {
    return <div className="editor-loading">Preparing editor…</div>;
  }

  return (
    <div className="rich-editor">
      <BubbleMenuBar
        editor={editor}
        onApplyCommand={(commandId) => {
          if (commandId === "link") {
            void handleRequestLink().then((href) => {
              if (href) {
                applyLink(editor, href);
              }
            });
            return;
          }

          applyEditorCommand(editor, commandId);
        }}
      />
      <EditorContent editor={editor} />
    </div>
  );
});

export const RichEditorAdapter = memo(
  RichEditorAdapterInner,
  (previousProps, nextProps) =>
    previousProps.autoFocus === nextProps.autoFocus &&
    previousProps.contentVersion === nextProps.contentVersion &&
    previousProps.onDocumentChange === nextProps.onDocumentChange &&
    previousProps.onRequestLink === nextProps.onRequestLink,
);
