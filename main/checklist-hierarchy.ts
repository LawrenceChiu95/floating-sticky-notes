import type { NoteChecklistItemRecord } from './note-state';

export function normalizeChecklistHierarchy(
  checklist: NoteChecklistItemRecord[]
): NoteChecklistItemRecord[] {
  if (checklist.every((item) => !item.parentId)) {
    return checklist.map((item) => ({ ...item }));
  }

  const idCounts = new Map<string, number>();
  for (const item of checklist) {
    idCounts.set(item.id, (idCounts.get(item.id) ?? 0) + 1);
  }

  const itemsById = new Map(checklist.map((item) => [item.id, item]));
  const normalized = checklist.map((item) => {
    const parent = item.parentId ? itemsById.get(item.parentId) : undefined;
    const parentId =
      parent &&
      parent.id !== item.id &&
      idCounts.get(parent.id) === 1 &&
      !parent.parentId
        ? parent.id
        : undefined;

    return parentId === item.parentId ? { ...item } : setChecklistParent(item, parentId);
  });
  const childrenByParentId = new Map<string, NoteChecklistItemRecord[]>();

  for (const item of normalized) {
    if (!item.parentId) {
      continue;
    }

    const children = childrenByParentId.get(item.parentId) ?? [];
    children.push(item);
    childrenByParentId.set(item.parentId, children);
  }

  const result: NoteChecklistItemRecord[] = [];
  for (const item of normalized) {
    if (item.parentId) {
      continue;
    }

    result.push(item);
    result.push(...(childrenByParentId.get(item.id) ?? []));
  }

  return result;
}

export type ChecklistGroup = {
  parent: NoteChecklistItemRecord;
  children: NoteChecklistItemRecord[];
};

export function groupChecklist(checklist: NoteChecklistItemRecord[]): ChecklistGroup[] {
  const normalizedChecklist = normalizeChecklistHierarchy(checklist);
  const childrenByParentId = new Map<string, NoteChecklistItemRecord[]>();

  for (const item of normalizedChecklist) {
    if (!item.parentId) {
      continue;
    }

    const children = childrenByParentId.get(item.parentId) ?? [];
    children.push(item);
    childrenByParentId.set(item.parentId, children);
  }

  return normalizedChecklist
    .filter((item) => !item.parentId)
    .map((parent) => ({
      parent,
      children: childrenByParentId.get(parent.id) ?? []
    }));
}

export function setChecklistParent(
  item: NoteChecklistItemRecord,
  parentId?: string
): NoteChecklistItemRecord {
  if (parentId) {
    return { ...item, parentId };
  }

  const { parentId: _parentId, ...topLevelItem } = item;
  return topLevelItem;
}

export function readChecklistParentId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
