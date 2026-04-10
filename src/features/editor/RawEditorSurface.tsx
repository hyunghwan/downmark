import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";

interface RawEditorSurfaceProps {
  autoFocus?: boolean;
  ariaLabel: string;
  onDropImageFile?: (
    file: File,
    selection: { end: number; start: number },
  ) => Promise<void> | void;
  placeholder: string;
  onPasteImageFile?: (
    file: File,
    selection: { end: number; start: number },
  ) => Promise<void> | void;
  value: string;
  onChange: (value: string) => void;
}

export const RawEditorSurface = forwardRef<
  HTMLTextAreaElement,
  RawEditorSurfaceProps
>(function RawEditorSurface(
  {
    ariaLabel,
    autoFocus = false,
    onDropImageFile,
    onPasteImageFile,
    placeholder,
    value,
    onChange,
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement, []);

  const resizeToContent = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    resizeToContent();
  }, [resizeToContent, value]);

  useEffect(() => {
    if (autoFocus) {
      textareaRef.current?.focus();
    }
  }, [autoFocus]);

  useEffect(() => {
    resizeToContent();

    const handleResize = () => {
      resizeToContent();
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [resizeToContent]);

  const createSelectionSnapshot = () => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return { start: 0, end: 0 };
    }

    return {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
  };

  return (
    <label className="raw-surface">
      <span className="sr-only">{ariaLabel}</span>
      <textarea
        aria-label={ariaLabel}
        autoCapitalize="off"
        autoCorrect="off"
        className="raw-textarea"
        onChange={(event) => onChange(event.currentTarget.value)}
        onDrop={(event) => {
          const file = Array.from(event.dataTransfer.files).find((candidate) =>
            candidate.type.startsWith("image/"),
          );
          if (!file || !onDropImageFile) {
            return;
          }

          event.preventDefault();
          void onDropImageFile(file, createSelectionSnapshot());
        }}
        onPaste={(event) => {
          const file = Array.from(event.clipboardData.files).find((candidate) =>
            candidate.type.startsWith("image/"),
          );
          if (!file || !onPasteImageFile) {
            return;
          }

          event.preventDefault();
          void onPasteImageFile(file, createSelectionSnapshot());
        }}
        placeholder={placeholder}
        ref={textareaRef}
        spellCheck={false}
        value={value}
      />
    </label>
  );
});
