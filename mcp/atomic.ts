import { rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/** Same safety rule as the desktop app: write a temporary file, then rename it over the target. */
export async function writeFileAtomically(target: string, contents: string): Promise<void> {
  const temp = join(dirname(target), `.${basename(target)}.saving`);
  try {
    await writeFile(temp, contents, 'utf8');
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}
