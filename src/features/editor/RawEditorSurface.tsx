import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

interface RawEditorSurfaceProps {
  autoFocus?: boolean;
  value: string;
  onChange: (value: string) => void;
}

export const RawEditorSurface = forwardRef<
  HTMLTextAreaElement,
  RawEditorSurfaceProps
>(function RawEditorSurface({ autoFocus = false, value, onChange }, ref) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement, []);

  useEffect(() => {
    if (autoFocus) {
      textareaRef.current?.focus();
    }
  }, [autoFocus]);

  return (
    <label className="raw-surface">
      <span className="sr-only">Raw markdown editor</span>
      <textarea
        aria-label="Raw markdown editor"
        autoCapitalize="off"
        autoCorrect="off"
        className="raw-textarea"
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder="Write markdown directly…"
        ref={textareaRef}
        spellCheck={false}
        value={value}
      />
    </label>
  );
});
