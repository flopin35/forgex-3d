import { useState } from 'react';
import { useActions } from '../app/EditorContext';
import { forgetProject, recentProjects } from '../app/recentProjects';
import { uiStore } from '../app/uiState';
import { fileNameFromPath } from '../core/project/paths';
import { BrandMark, Icon } from './icons';

type P = [number, number];

/** A drawing in the board's own language: dots (squares at corners) joined by lines. */
function DotDrawing({ points, closed, wheels = [] }: { points: P[]; closed: boolean; wheels?: P[] }) {
  const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ') + (closed ? ' Z' : '');
  return (
    <svg className="start-drawing" viewBox="0 0 160 80" aria-hidden="true">
      <path className="start-grid" d="M0 20H160M0 40H160M0 60H160M20 0V80M40 0V80M60 0V80M80 0V80M100 0V80M120 0V80M140 0V80" />
      <path className="start-ink" d={d} />
      {wheels.map(([x, y]) => (
        <circle key={`${x}`} className="start-ink" cx={x} cy={y} r={8.5} />
      ))}
      {points.map(([x, y], i) => (
        <rect key={i} className="start-dot" x={x - 2.4} y={y - 2.4} width={4.8} height={4.8} rx={0.8} />
      ))}
    </svg>
  );
}

const BLANK: P[] = [
  [30, 58],
  [62, 22],
  [104, 30],
  [128, 56],
];
const SUPERCAR: P[] = [
  [10, 54],
  [12, 46],
  [40, 40],
  [70, 30],
  [96, 26],
  [122, 34],
  [146, 42],
  [150, 54],
];
const SALOON: P[] = [
  [10, 54],
  [12, 44],
  [42, 40],
  [58, 26],
  [102, 26],
  [120, 40],
  [148, 43],
  [150, 54],
];

/** What opens first: start from a blank board, a ready-made car, a file, or a recent project. */
export function StartScreen() {
  const actions = useActions();
  const [recent, setRecent] = useState(() => (actions.files.kind === 'desktop' ? recentProjects() : []));
  const close = () => uiStore.set({ startOpen: false });

  const openRecent = async (path: string) => {
    try {
      await actions.openProjectAt(path);
    } catch (error) {
      actions.store.log('warning', `${fileNameFromPath(path)} could not be opened. It may have been moved or deleted.`, String(error));
      forgetProject(path);
      setRecent(recentProjects());
    }
  };

  return (
    <div className="scrim" onPointerDown={(event) => event.target === event.currentTarget && close()}>
      <div className="sheet start-sheet" role="dialog" aria-label="Start">
        <header className="start-header">
          <BrandMark size={34} />
          <div>
            <h1>What are you making?</h1>
            <p>Click dots on the board, they join into lines, and the object builds itself in 3D on the right.</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        <div className="start-choices">
          <button type="button" className="start-card" onClick={() => actions.startWith('blank')} autoFocus>
            <DotDrawing points={BLANK} closed={false} />
            <span className="start-card-title">Blank board</span>
            <span className="start-card-text">Start from the first dot.</span>
          </button>
          <button type="button" className="start-card" onClick={() => actions.startWith('supercar')}>
            <DotDrawing points={SUPERCAR} closed wheels={[[38, 56], [124, 56]]} />
            <span className="start-card-title">Supercar</span>
            <span className="start-card-text">A low two-door body to reshape.</span>
          </button>
          <button type="button" className="start-card" onClick={() => actions.startWith('saloon')}>
            <DotDrawing points={SALOON} closed wheels={[[38, 56], [124, 56]]} />
            <span className="start-card-title">Saloon</span>
            <span className="start-card-text">A four-door luxury car.</span>
          </button>
          <button type="button" className="start-card is-plain" onClick={() => void actions.openProject()}>
            <span className="start-open-icon">
              <Icon name="folder" size={30} />
            </span>
            <span className="start-card-title">Open a file</span>
            <span className="start-card-text">A .forgex project on this computer.</span>
          </button>
        </div>
        {recent.length > 0 && (
          <section className="start-recent">
            <h2>Recent</h2>
            <ul>
              {recent.map((path) => (
                <li key={path}>
                  <button type="button" className="recent-item" onClick={() => void openRecent(path)} title={path}>
                    <Icon name="file" size={15} />
                    <span className="recent-name">{fileNameFromPath(path).replace(/\.forgex$/i, '')}</span>
                    <span className="recent-path">{path}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <footer className="start-footer">
          <span>
            <kbd>Ctrl K</kbd> finds any command, part or tool. <kbd>?</kbd> lists the shortcuts.
          </span>
          <button type="button" className="link-button" onClick={() => uiStore.set({ startOpen: false, connectOpen: true })}>
            Connect an AI assistant
          </button>
        </footer>
      </div>
    </div>
  );
}
