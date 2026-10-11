import type { Scene } from '../scene/types';

/**
 * Every undoable change to the scene is a command. `apply` and `revert` are pure:
 * they take a scene and return a new one, so undo/redo can never half-apply.
 */
export interface Command {
  readonly label: string;
  apply(scene: Scene): Scene;
  revert(scene: Scene): Scene;
  /** Selection right after the command runs. Leave undefined to keep the current selection. */
  readonly selectAfterApply?: string | null;
}

/** Runs several commands as one undo step. */
export class CompositeCommand implements Command {
  constructor(
    readonly label: string,
    private readonly commands: readonly Command[],
    readonly selectAfterApply?: string | null,
  ) {}

  apply(scene: Scene): Scene {
    return this.commands.reduce((current, command) => command.apply(current), scene);
  }

  revert(scene: Scene): Scene {
    return [...this.commands].reverse().reduce((current, command) => command.revert(current), scene);
  }
}
