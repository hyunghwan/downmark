import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

import type { CommandDefinition } from "./command-registry";

export interface SlashMenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface SlashMenuProps {
  items: CommandDefinition[];
  onSelect: (item: CommandDefinition) => void;
}

export const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(
  function SlashMenu({ items, onSelect }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useImperativeHandle(
      ref,
      () => ({
        onKeyDown(event) {
          if (event.key === "ArrowUp") {
            setSelectedIndex((current) =>
              current === 0 ? items.length - 1 : current - 1,
            );
            return true;
          }

          if (event.key === "ArrowDown") {
            setSelectedIndex((current) =>
              current === items.length - 1 ? 0 : current + 1,
            );
            return true;
          }

          if (event.key === "Enter") {
            const item = items[selectedIndex];
            if (item) {
              onSelect(item);
              return true;
            }
          }

          return false;
        },
      }),
      [items, onSelect, selectedIndex],
    );

    if (!items.length) {
      return (
        <div aria-label="Slash commands" className="slash-menu">
          <div className="slash-empty">No matching command</div>
        </div>
      );
    }

    return (
      <div aria-label="Slash commands" className="slash-menu">
        {items.map((item, index) => (
          <button
            aria-pressed={selectedIndex === index}
            key={item.id}
            className={`slash-item ${selectedIndex === index ? "is-active" : ""}`}
            onClick={() => onSelect(item)}
            type="button"
          >
            <span className="slash-label">{item.label}</span>
            <span className="slash-description">{item.description}</span>
          </button>
        ))}
      </div>
    );
  },
);
