/** Creates a random, stable identifier such as `obj_3f9a1c0b2d4e5f60`. */
export function randomId(prefix: string): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

export function createObjectId(): string {
  return randomId('obj');
}
