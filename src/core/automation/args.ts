import { isFiniteNumber, isVec3, type Vec3 } from '../math/vec3';
import { ToolError } from './toolTypes';

export type Args = Record<string, unknown>;

export function asArgs(raw: unknown): Args {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ToolError('Tool arguments must be a JSON object.');
  return raw as Args;
}

export function optString(args: Args, key: string, maxLength = 200): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ToolError(`${key} must be text.`);
  const trimmed = value.trim();
  if (!trimmed) throw new ToolError(`${key} must not be empty.`);
  if (trimmed.length > maxLength) throw new ToolError(`${key} must be at most ${maxLength} characters.`);
  return trimmed;
}

export function reqString(args: Args, key: string, maxLength = 200): string {
  const value = optString(args, key, maxLength);
  if (value === undefined) throw new ToolError(`${key} is required.`);
  return value;
}

export function optBool(args: Args, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new ToolError(`${key} must be true or false.`);
  return value;
}

export function optInt(args: Args, key: string, min: number, max: number): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new ToolError(`${key} must be a whole number from ${min} to ${max}.`);
  }
  return value as number;
}

export function toVec3(value: unknown, label: string): Vec3 {
  if (!isVec3(value)) throw new ToolError(`${label} must be [x, y, z] with three finite numbers.`);
  return [value[0], value[1], value[2]];
}

export function optVec3(args: Args, key: string): Vec3 | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  return toVec3(value, key);
}

export function optEnum<T extends string>(args: Args, key: string, allowed: readonly T[]): T | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ToolError(`${key} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

export function reqEnum<T extends string>(args: Args, key: string, allowed: readonly T[]): T {
  const value = optEnum(args, key, allowed);
  if (value === undefined) throw new ToolError(`${key} is required (one of: ${allowed.join(', ')}).`);
  return value;
}

/** Accepts #rrggbb, rrggbb or #rgb; returns lowercase #rrggbb. */
export function optColor(args: Args, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const hex = value.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toLowerCase()}`;
    if (/^[0-9a-fA-F]{3}$/.test(hex)) return `#${[...hex].map((c) => c + c).join('').toLowerCase()}`;
  }
  throw new ToolError(`${key} must be a hex colour such as #3d9fe8.`);
}

export function optArray(args: Args, key: string, maxItems: number): unknown[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new ToolError(`${key} must be a list.`);
  if (value.length > maxItems) throw new ToolError(`${key} can hold at most ${maxItems} items per call.`);
  return value;
}

export function toIndex(value: unknown, count: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= count) {
    throw new ToolError(`${label} must be a vertex index from 0 to ${count - 1}.`);
  }
  return value as number;
}

/** Rounds for readable output. */
export function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  const result = Math.round(value * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
}

export function roundVec(v: readonly number[], decimals = 4): number[] {
  return v.map((n) => round(n, decimals));
}

export function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isFiniteNumber);
}
