/** The last projects opened or saved on this computer (desktop only), for the start screen. */

const KEY = 'forgex.recent.v1';
const MAX = 8;

export function recentProjects(): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((path): path is string => typeof path === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberProject(path: string): void {
  try {
    const next = [path, ...recentProjects().filter((item) => item.toLowerCase() !== path.toLowerCase())].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A convenience only.
  }
}

export function forgetProject(path: string): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(recentProjects().filter((item) => item !== path)));
  } catch {
    // A convenience only.
  }
}
