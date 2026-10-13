import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useActions, useEditor } from '../app/EditorContext';
import { aiLink } from '../app/mcpBridge';
import { perfStats } from '../app/perfStats';
import { uiStore } from '../app/uiState';
import type { MessageLevel } from '../core/editor/editorStore';
import { Icon, type IconName } from './icons';

const LEVEL_ICON: Record<MessageLevel, IconName> = { info: 'info', success: 'check', warning: 'warning', error: 'error' };

function formatTime(time: number): string {
  return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function ms(value: number): string {
  return value < 10 ? value.toFixed(1) : Math.round(value).toString();
}

/**
 * Messages, the undo history (click a step to go back to it) and performance, in one
 * pop-over under the top bar. It replaces the old bottom panel and status bar.
 */
export function ActivityPopover() {
  const actions = useActions();
  const messages = useEditor((s) => s.messages);
  const history = useEditor((s) => s.history);
  const project = useEditor((s) => s.project);
  const objectCount = useEditor((s) => Object.keys(s.scene.objects).length);
  const perf = useSyncExternalStore(perfStats.subscribe, perfStats.getSnapshot);
  const ai = useSyncExternalStore(aiLink.subscribe, aiLink.getSnapshot);
  const [tab, setTab] = useState<'messages' | 'history' | 'about'>('messages');
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Opening the pop-over counts as having seen the messages.
  useEffect(() => {
    const last = messages.at(-1)?.id ?? 0;
    if (last > uiStore.getState().activitySeen) uiStore.set({ activitySeen: last });
  }, [messages]);

  useEffect(() => {
    const list = listRef.current;
    if (list && tab !== 'about') list.scrollTop = list.scrollHeight;
  }, [messages, history, tab]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || (target instanceof Element && target.closest('.popover-anchor'))) return;
      uiStore.set({ activityOpen: false });
    };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  }, []);

  /** Undoes or redoes until the step at `index` (−1 is the opened project) is the latest. */
  const goTo = (index: number) => {
    const steps = history.past.length - 1 - index;
    for (let i = 0; i < Math.abs(steps); i++) {
      if (steps > 0) actions.undo();
      else actions.redo();
    }
  };

  return (
    <div className="popover activity" ref={rootRef} role="dialog" aria-label="Activity">
      <div className="popover-tabs" role="tablist">
        {(['messages', 'history', 'about'] as const).map((item) => (
          <button key={item} type="button" role="tab" aria-selected={tab === item} className={tab === item ? 'is-active' : ''} onClick={() => setTab(item)}>
            {item === 'messages' ? 'Messages' : item === 'history' ? `History · ${history.past.length}` : 'Project'}
          </button>
        ))}
        <span className="popover-spacer" />
        {tab === 'messages' && messages.length > 0 && (
          <button type="button" className="link-button" onClick={() => actions.store.clearMessages()}>
            Clear
          </button>
        )}
      </div>
      <div className="popover-body" ref={listRef}>
        {tab === 'messages' &&
          (messages.length === 0 ? (
            <p className="empty-note">Nothing yet. Saves, exports, warnings and AI work show up here.</p>
          ) : (
            <ul className="message-list">
              {messages.map((message) => (
                <li key={message.id} className={`message message--${message.level}`}>
                  <Icon name={LEVEL_ICON[message.level]} size={14} className="message-icon" />
                  <div className="message-text">
                    <span>{message.text}</span>
                    {message.detail && <pre>{message.detail}</pre>}
                  </div>
                  <time>{formatTime(message.time)}</time>
                </li>
              ))}
            </ul>
          ))}
        {tab === 'history' && (
          <ol className="history-list">
            <li>
              <button type="button" className={`history-item ${history.past.length === 0 ? 'is-current' : ''}`} onClick={() => goTo(-1)}>
                Project opened
              </button>
            </li>
            {history.past.map((item, i) => (
              <li key={item.seq}>
                <button type="button" className={`history-item ${i === history.past.length - 1 ? 'is-current' : ''}`} onClick={() => goTo(i)}>
                  {item.label}
                </button>
              </li>
            ))}
            {history.future.map((item, i) => (
              <li key={item.seq}>
                <button type="button" className="history-item is-undone" onClick={() => goTo(history.past.length + i)}>
                  {item.label}
                </button>
              </li>
            ))}
          </ol>
        )}
        {tab === 'about' && (
          <dl className="property-list">
            <div>
              <dt>File</dt>
              <dd className="path">{project.path ?? 'Not saved yet'}</dd>
            </div>
            <div>
              <dt>Objects</dt>
              <dd>{objectCount}</dd>
            </div>
            <div>
              <dt>Triangles</dt>
              <dd>{perf.triangles.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Last frame</dt>
              <dd>{ms(perf.renderMs)} ms render · {ms(perf.rebuildMs)} ms mesh rebuild</dd>
            </div>
            <div>
              <dt>AI link</dt>
              <dd>{ai.busyWith ? `Working: ${ai.busyWith}` : ai.connected ? 'Linked' : 'No assistant linked'}</dd>
            </div>
            <div>
              <dt>Running as</dt>
              <dd>{actions.files.kind === 'desktop' ? 'Desktop app' : 'Browser preview (saving downloads files)'}</dd>
            </div>
          </dl>
        )}
      </div>
    </div>
  );
}
