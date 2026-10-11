import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { roundTo } from '../core/math/vec3';

interface NumberFieldProps {
  label: string;
  /** Colours the label for the X, Y and Z axes. */
  axis?: 'x' | 'y' | 'z';
  value: number;
  /** Change per pixel when dragging the label. */
  dragStep: number;
  decimals: number;
  onCommit: (value: number) => void;
  /** Live updates while the label is dragged; `onScrubEnd` commits once at the end. */
  onScrub?: (value: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: (value: number) => void;
}

/**
 * A number input that commits on Enter or blur, reverts on Escape, and can be
 * changed by dragging its label left and right (hold Shift for fine control).
 */
export function NumberField({ label, axis, value, dragStep, decimals, onCommit, onScrub, onScrubStart, onScrubEnd }: NumberFieldProps) {
  const display = roundTo(value, decimals).toString();
  const [draft, setDraft] = useState(display);
  const [focused, setFocused] = useState(false);
  const scrub = useRef<{ startX: number; startValue: number; value: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (!focused) setDraft(display);
  }, [display, focused]);

  const commitDraft = () => {
    // Untouched fields never commit, so rounding in the display cannot change a value.
    if (draft === display) return;
    const parsed = Number(draft.replace(',', '.'));
    if (draft.trim() !== '' && Number.isFinite(parsed)) {
      if (parsed !== value) onCommit(parsed);
    } else {
      setDraft(display);
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0 || !onScrub) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    scrub.current = { startX: event.clientX, startValue: value, value, moved: false };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const state = scrub.current;
    if (!state) return;
    const dx = event.clientX - state.startX;
    if (!state.moved && Math.abs(dx) < 2) return;
    if (!state.moved) {
      state.moved = true;
      onScrubStart?.();
    }
    const step = event.shiftKey ? dragStep / 10 : dragStep;
    state.value = roundTo(state.startValue + dx * step, decimals);
    onScrub?.(state.value);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const state = scrub.current;
    scrub.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (state?.moved) onScrubEnd?.(state.value);
  };

  return (
    <label className={`number-field ${axis ? `axis-${axis}` : ''}`}>
      <span
        className={`number-label ${onScrub ? 'is-scrubbable' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        title={onScrub ? 'Drag to change' : undefined}
      >
        {label}
      </span>
      <input
        type="text"
        inputMode="decimal"
        spellCheck={false}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => {
          setFocused(true);
          event.currentTarget.select();
        }}
        onBlur={() => {
          setFocused(false);
          commitDraft();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            const input = event.currentTarget;
            setDraft(display);
            event.stopPropagation();
            requestAnimationFrame(() => input.blur());
          }
        }}
      />
    </label>
  );
}
