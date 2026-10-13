import { useEffect, useState, useSyncExternalStore } from 'react';
import { useActions } from '../app/EditorContext';
import { aiLink } from '../app/mcpBridge';
import { uiStore } from '../app/uiState';
import { claudeCodeCommand, genericConfigSnippet, relayServerEntry, type McpServerEntry } from '../core/ai/claudeConfig';
import type { AiSetupStatus } from '../platform/files';
import { Icon } from './icons';

function CopyBox({ text, label }: { text: string; label: string }) {
  const actions = useActions();
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-box">
      <pre aria-label={label}>{text}</pre>
      <button
        type="button"
        className="text-button"
        onClick={() =>
          void actions.files.copyText(text).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            },
            () => actions.store.log('warning', 'The clipboard is not available. Select the text and copy it instead.'),
          )
        }
      >
        <Icon name={copied ? 'check' : 'copy'} size={14} />
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/**
 * Connect an AI assistant: sets FORGEX up in Claude Desktop with one click (no Node.js
 * needed), and shows the exact setup for Claude Code and other MCP apps.
 */
export function ConnectPanel() {
  const actions = useActions();
  const ai = useSyncExternalStore(aiLink.subscribe, aiLink.getSnapshot);
  const [status, setStatus] = useState<AiSetupStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const setup = actions.files.ai;
  const close = () => uiStore.set({ connectOpen: false });

  const refresh = () => {
    if (!setup) return;
    setup.status().then(
      (next) => (setStatus(next), setStatusError(null)),
      (error) => setStatusError(String(error)),
    );
  };
  useEffect(refresh, [setup]);

  const connect = async () => {
    setWorking(true);
    setFailed(null);
    try {
      const where = await actions.connectClaudeDesktop();
      setDone(where);
      refresh();
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(false);
    }
  };

  const entry: McpServerEntry = status ? relayServerEntry(status.appPath) : relayServerEntry('C:\\path\\to\\FORGEX 3D.exe');
  const linkText = ai.busyWith ? `Working now: ${ai.busyWith}` : ai.connected ? 'Linked. The assistant can see and change this project live.' : 'No assistant is linked yet.';

  return (
    <div className="scrim" onPointerDown={(event) => event.target === event.currentTarget && close()}>
      <div className="sheet connect-sheet" role="dialog" aria-label="Connect an AI assistant">
        <header className="sheet-header">
          <div>
            <h2>Connect an AI assistant</h2>
            <p className="sheet-lead">FORGEX has its own MCP server. Once an assistant is connected, it can build and edit models in the open project while you watch, and save parts to My Parts.</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={close}>
            <Icon name="close" />
          </button>
        </header>

        <p className={`link-status ${ai.connected ? 'is-linked' : ''}`}>
          <span className="ai-dot" aria-hidden="true" />
          {linkText}
        </p>

        {setup ? (
          <>
            <section className="connect-step">
              <h3>Claude Desktop</h3>
              {statusError && <p className="panel-error">{statusError}</p>}
              <p>
                One click adds FORGEX to Claude Desktop. The MCP server is built into FORGEX 3D.exe, so nothing else needs installing. Afterwards, quit Claude completely (right-click its icon by the clock, then Quit) and open it again.
              </p>
              <div className="connect-actions">
                <button type="button" className="text-button is-primary" onClick={() => void connect()} disabled={working || !status}>
                  <Icon name={status?.connected ? 'check' : 'plug'} size={15} />
                  {working ? 'Setting up…' : status?.connected ? 'Set up again' : 'Set up Claude Desktop'}
                </button>
              </div>
              {status?.connected && !done && <p className="connect-note">Claude Desktop is set up to use this copy of FORGEX. If you move FORGEX 3D.exe, set it up again.</p>}
              {done && (
                <p className="connect-note is-ok">
                  <Icon name="check" size={14} /> Added to {done}. Restart Claude, then ask it something like “Use FORGEX to model a simple wooden table”. If FORGEX is closed, Claude opens it.
                </p>
              )}
              {failed && <p className="panel-error">{failed}</p>}
            </section>

            <section className="connect-step">
              <h3>Claude Code</h3>
              <p>Run this once in a terminal. It makes FORGEX available in every folder you open with Claude Code.</p>
              <CopyBox label="Claude Code command" text={claudeCodeCommand(entry)} />
            </section>

            <section className="connect-step">
              <h3>VS Code, Cursor, Codex and other MCP apps</h3>
              <p>Add this server to the app’s MCP settings.</p>
              <CopyBox label="MCP server settings" text={genericConfigSnippet(entry)} />
            </section>

            {status && (
              <p className="connect-foot">
                Projects and My Parts live in{' '}
                <button type="button" className="link-button" onClick={() => void actions.files.reveal(status.projects).catch(() => undefined)}>
                  {status.projects}
                </button>
                . With FORGEX closed, the assistant works on files there instead.
              </p>
            )}
          </>
        ) : (
          <section className="connect-step">
            <h3>Desktop app needed</h3>
            <p>This is the browser preview. Connecting an assistant needs the FORGEX 3D desktop app, which sets it up in one click. For development, run the server with Node.js:</p>
            <CopyBox label="Development command" text="node mcp/forgex-mcp.cjs" />
            <p>The preview links to a running server automatically.</p>
          </section>
        )}
      </div>
    </div>
  );
}
