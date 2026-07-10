import type { SaveImageInput } from './image-storage';

export function normalizeSaveImageInput(value: unknown): SaveImageInput | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<Record<keyof SaveImageInput, unknown>>;
  const data = normalizeImageBytes(candidate.data);

  if (!data || !isPositiveFiniteNumber(candidate.width) || !isPositiveFiniteNumber(candidate.height)) {
    return undefined;
  }

  return {
    data,
    width: candidate.width,
    height: candidate.height
  };
}

function normalizeImageBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  return undefined;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
