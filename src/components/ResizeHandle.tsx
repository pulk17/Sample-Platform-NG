import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Persisted, draggable width for a pane. Returns the current width and a
 * <ResizeHandle> to drop on the pane's trailing edge.
 */
export function useResizableWidth(key: string, initial: number, min: number, max: number) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(`sp-w-${key}`));
    return saved >= min && saved <= max ? saved : initial;
  });
  const dragging = useRef(false);

  const onMouseDown = useCallback(() => {
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setWidth((w) => {
        const next = Math.min(max, Math.max(min, w + e.movementX));
        return next;
      });
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setWidth((w) => {
        localStorage.setItem(`sp-w-${key}`, String(w));
        return w;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [key, min, max]);

  const handle = (
    <div
      onMouseDown={onMouseDown}
      className="group relative z-10 -mr-1 w-2 shrink-0 cursor-col-resize"
      role="separator"
      aria-orientation="vertical"
    >
      <div
        className={cn(
          "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors",
          "group-hover:bg-primary/60 group-active:bg-primary",
        )}
      />
    </div>
  );

  return { width, handle };
}
