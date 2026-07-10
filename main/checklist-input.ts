import type { NoteChecklistItemRecord } from './note-state';

export function normalizeChecklistInput(value: unknown): NoteChecklistItemRecord[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value.flatMap((item) => {
    const normalizedItem = normalizeChecklistItemInput(item);
    return normalizedItem ? [normalizedItem] : [];
  });

  return items.length === value.length ? items : undefined;
}

function normalizeChecklistItemInput(value: unknown): NoteChecklistItemRecord | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<Record<keyof NoteChecklistItemRecord, unknown>>;

  if (
    typeof candidate.id !== 'string' ||
    candidate.id.length === 0 ||
    typeof candidate.text !== 'string' ||
    typeof candidate.checked !== 'boolean' ||
    typeof candidate.createdAt !== 'string' ||
    typeof candidate.updatedAt !== 'string'
  ) {
    return undefined;
  }

  return {
    id: candidate.id,
    text: candidate.text,
    checked: candidate.checked,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt
  };
}
