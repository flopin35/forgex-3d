import { useEffect, useRef, useState } from 'react';
import { useActions, useEditor } from '../app/EditorContext';
import type { MessageLevel } from '../core/editor/editorStore';
import { Icon, type IconName } from './icons';

const LEVEL_ICON: Record<MessageLevel, IconName> = { info: 'info', success: 'check', warning: 'warning', error: 'error' };

function formatTime(time: number): string {
  return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function DiagnosticsPanel() {
  const actions = useActions();
  const messages = useEditor((s) => s.messages);
  const history = useEditor((s) => s.history);
  const [tab, setTab] = useState<'messages' | 'history'>('messages');
  // Short screens start with the panel folded so the board and 3D view get the room.
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerHeight >= 860);
  const listRef = useRef<HTMLDivElement>(null);
  const problems = messages.filter((m) => m.level === 'error' || m.level === 'warning').length;

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, history, tab, open]);

  return (
    <section className={`diagnostics ${open ? '' : 'is-collapsed'}`} aria-label="Diagnostics">
      <div className="diagnostics-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'messages'} className={tab === 'messages' ? 'is-active' : ''} onClick={() => { setTab('messages'); setOpen(true); }}>
          Messages
          {problems > 0 && <span className="badge badge--warn">{problems}</span>}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'is-active' : ''} onClick={() => { setTab('history'); setOpen(true); }}>
          History
          <span className="badge">{history.past.length}</span>
        </button>
        {!open && messages.length > 0 && (
          <button type="button" className={`diagnostics-latest message--${messages[messages.length - 1].level}`} onClick={() => { setTab('messages'); setOpen(true); }}>
            <Icon name={LEVEL_ICON[messages[messages.length - 1].level]} size={13} className="message-icon" />
            <span>{messages[messages.length - 1].text}</span>
          </button>
        )}
        <span className="diagnostics-spacer" />
        {tab === 'messages' && open && messages.length > 0 && (
          <button type="button" className="text-button" onClick={() => actions.store.clearMessages()}>
            Clear
          </button>
        )}
        <button type="button" className="icon-button" onClick={() => setOpen((v) => !v)} aria-label={open ? 'Collapse diagnostics' : 'Expand diagnostics'}>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
        </button>
      </div>
      {open && (
        <div className="diagnostics-body" ref={listRef} role="tabpanel">
          {tab === 'messages' ? (
            messages.length === 0 ? (
              <p className="empty-note">No messages.</p>
            ) : (
              <ul className="message-list">
                {messages.map((message) => (
                  <li key={message.id} className={`message message--${message.level}`}>
                    <Icon name={LEVEL_ICON[message.level]} size={14} className="message-icon" />
                    <time>{formatTime(message.time)}</time>
                    <div className="message-text">
                      <span>{message.text}</span>
                      {message.detail && <pre>{message.detail}</pre>}
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <ol className="history-list">
              <li className={`history-item ${history.past.length === 0 ? 'is-current' : ''}`}>Project opened</li>
              {history.past.map((item, i) => (
                <li key={item.seq} className={`history-item ${i === history.past.length - 1 ? 'is-current' : ''}`}>
                  {item.label}
                </li>
              ))}
              {history.future.map((item) => (
                <li key={item.seq} className="history-item is-undone">
                  {item.label}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
