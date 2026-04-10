import { useEffect, useId, useRef } from "react";

interface PromptAction {
  id: string;
  label: string;
  tone?: "default" | "danger" | "primary";
}

interface PromptDialogProps {
  open: boolean;
  title: string;
  body: string;
  actions: PromptAction[];
  onAction: (id: string) => void;
  onRequestClose: () => void;
}

function getFocusableButtons(buttons: Array<HTMLButtonElement | null>) {
  return buttons.filter((button): button is HTMLButtonElement => button !== null);
}

export function PromptDialog({
  open,
  title,
  body,
  actions,
  onAction,
  onRequestClose,
}: PromptDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const lastOpenStateRef = useRef(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      lastOpenStateRef.current = true;
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;

      const id = window.requestAnimationFrame(() => {
        getFocusableButtons(actionRefs.current)[0]?.focus();
      });

      return () => {
        window.cancelAnimationFrame(id);
      };
    }

    if (lastOpenStateRef.current) {
      lastOpenStateRef.current = false;
      const id = window.requestAnimationFrame(() => {
        previousFocusRef.current?.focus();
        previousFocusRef.current = null;
      });

      return () => {
        window.cancelAnimationFrame(id);
      };
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={() => onRequestClose()}
      role="presentation"
    >
      <div
        aria-describedby={bodyId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="dialog-card"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onRequestClose();
            return;
          }

          if (event.key !== "Tab") {
            return;
          }

          const focusableButtons = getFocusableButtons(actionRefs.current);
          if (!focusableButtons.length) {
            event.preventDefault();
            dialogRef.current?.focus();
            return;
          }

          const firstButton = focusableButtons[0];
          const lastButton = focusableButtons[focusableButtons.length - 1];
          const activeElement = document.activeElement as HTMLElement | null;

          if (!event.shiftKey && activeElement === lastButton) {
            event.preventDefault();
            firstButton.focus();
            return;
          }

          if (event.shiftKey && activeElement === firstButton) {
            event.preventDefault();
            lastButton.focus();
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="alertdialog"
        tabIndex={-1}
      >
        <h2 id={titleId}>{title}</h2>
        <p id={bodyId}>{body}</p>
        <div className="dialog-actions">
          {actions.map((action, index) => (
            <button
              key={action.id}
              className={`tone-${action.tone ?? "default"}`}
              onClick={() => onAction(action.id)}
              ref={(element) => {
                actionRefs.current[index] = element;
              }}
              type="button"
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
