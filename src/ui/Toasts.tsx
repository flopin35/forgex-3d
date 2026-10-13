import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../app/EditorContext';
import type { DiagnosticMessage, MessageLevel } from '../core/editor/editorStore';
import { Icon, type IconName } from './icons';

const LEVEL_ICON: Record<MessageLevel, IconName> = { info: 'info', success: 'check', warning: 'warning', error: 'error' };
/** How long each kind stays up, in milliseconds. Errors stay until closed. */
const LIFETIME: Record<MessageLevel, number> = { info: 4200, success: 4200, warning: 8000, error: Infinity };
const MAX_SHOWN = 3;

/** Messages pop up briefly in the corner instead of filling a panel; the activity pop-over keeps them all. */
export function Toasts() {
  const messages = useEditor((s) => s.messages);
  const [shown, setShown] = useState<DiagnosticMessage[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  // Messages from before the app was on screen (start-up notes) are not popped up.
  const lastSeen = useRef(messages.at(-1)?.id ?? 0);

  useEffect(() => {
    const fresh = messages.filter((m) => m.id > lastSeen.current && !m.quiet);
    if (messages.length) lastSeen.current = Math.max(lastSeen.current, messages.at(-1)!.id);
    if (fresh.length === 0) return;
    setShown((current) => [...current, ...fresh].slice(-MAX_SHOWN));
  }, [messages]);

  useEffect(() => {
    if (shown.length === 0) return;
    const now = Date.now();
    const next = Math.min(...shown.map((m) => (m.id === open ? Infinity : m.time + LIFETIME[m.level] - now)));
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(() => {
      const at = Date.now();
      setShown((current) => current.filter((m) => m.id === open || m.time + LIFETIME[m.level] > at));
    }, Math.max(50, next));
    return () => window.clearTimeout(timer);
  }, [shown, open]);

  if (shown.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {shown.map((message) => (
        <div key={message.id} className={`toast toast--${message.level}`}>
          <Icon name={LEVEL_ICON[message.level]} size={16} className="toast-icon" />
          <div className="toast-text">
            <p>{message.text}</p>
            {message.detail && open === message.id && <pre>{message.detail}</pre>}
            {message.detail && (
              <button type="button" className="link-button" onClick={() => setOpen(open === message.id ? null : message.id)}>
                {open === message.id ? 'Hide details' : 'Details'}
              </button>
            )}
          </div>
          <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => setShown((current) => current.filter((m) => m.id !== message.id))}>
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
