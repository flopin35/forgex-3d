import { useEffect, useRef, type KeyboardEvent } from 'react';

export interface MeasureDraft {
  length: string;
  angle: string;
  focus: 'length' | 'angle';
}

/** Reads a typed number; accepts a comma as the decimal mark. */
export function parseMeasure(text: string): number | null {
  const value = Number(text.replace(',', '.').trim());
  return text.trim() !== '' && Number.isFinite(value) ? value : null;
}

/**
 * The small box that appears while drawing when you type a number: the next line's exact
 * length and angle. Enter places the dot, Tab moves between the two, Esc cancels.
 */
export function MeasureEntry({
  draft,
  x,
  y,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: MeasureDraft;
  x: number;
  y: number;
  onChange: (draft: MeasureDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const lengthRef = useRef<HTMLInputElement>(null);
  const angleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = draft.focus === 'length' ? lengthRef.current : angleRef.current;
    if (input && document.activeElement !== input) {
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }
  }, [draft.focus]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onSubmit();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      onChange({ ...draft, focus: draft.focus === 'length' ? 'angle' : 'length' });
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  const valid = (parseMeasure(draft.length) ?? 0) > 0 && parseMeasure(draft.angle) !== null;
  return (
    <div className="measure-entry" style={{ left: x, top: y }} role="group" aria-label="Exact line size">
      <label>
        <span>Length</span>
        <input
          ref={lengthRef}
          inputMode="decimal"
          value={draft.length}
          onChange={(event) => onChange({ ...draft, length: event.target.value })}
          onFocus={() => draft.focus !== 'length' && onChange({ ...draft, focus: 'length' })}
          onKeyDown={onKeyDown}
          aria-label="Length in metres"
        />
        <span className="unit-note">m</span>
      </label>
      <label>
        <span>Angle</span>
        <input
          ref={angleRef}
          inputMode="decimal"
          value={draft.angle}
          onChange={(event) => onChange({ ...draft, angle: event.target.value })}
          onFocus={() => draft.focus !== 'angle' && onChange({ ...draft, focus: 'angle' })}
          onKeyDown={onKeyDown}
          aria-label="Angle in degrees"
        />
        <span className="unit-note">°</span>
      </label>
      <span className={`measure-hint ${valid ? 'is-ready' : ''}`}>{valid ? 'Enter to place' : 'Type a length'}</span>
    </div>
  );
}
