import { useRef } from "react";

import type { EditorMode } from "../documents/types";

interface ModeToggleProps {
  mode: EditorMode;
  onChange: (mode: EditorMode) => void;
}

const MODES: EditorMode[] = ["rich", "raw"];

export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  const buttonRefs = useRef<Record<EditorMode, HTMLButtonElement | null>>({
    rich: null,
    raw: null,
  });

  const moveSelection = (currentMode: EditorMode, direction: -1 | 1) => {
    const currentIndex = MODES.indexOf(currentMode);
    const nextIndex = (currentIndex + direction + MODES.length) % MODES.length;
    const nextMode = MODES[nextIndex];

    onChange(nextMode);
    buttonRefs.current[nextMode]?.focus();
  };

  return (
    <div
      aria-label="Editor mode"
      className="mode-toggle"
      role="radiogroup"
    >
      {MODES.map((item) => (
        <button
          aria-checked={mode === item}
          className={mode === item ? "is-active" : ""}
          key={item}
          onClick={() => onChange(item)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
              event.preventDefault();
              moveSelection(item, -1);
              return;
            }

            if (event.key === "ArrowRight" || event.key === "ArrowDown") {
              event.preventDefault();
              moveSelection(item, 1);
            }
          }}
          ref={(element) => {
            buttonRefs.current[item] = element;
          }}
          role="radio"
          tabIndex={mode === item ? 0 : -1}
          type="button"
        >
          {item === "rich" ? "Rich" : "Raw"}
        </button>
      ))}
    </div>
  );
}
