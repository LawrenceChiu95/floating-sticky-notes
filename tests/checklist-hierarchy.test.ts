import { describe, expect, it } from 'vitest';
import {
  groupChecklist,
  normalizeChecklistHierarchy,
  setChecklistParent
} from '../main/checklist-hierarchy';
import type { NoteChecklistItemRecord } from '../main/note-state';

describe('checklist hierarchy normalization', () => {
  it('keeps old flat checklist items unchanged', () => {
    const items = [createItem('first'), createItem('second')];

    expect(normalizeChecklistHierarchy(items)).toEqual(items);
  });

  it('keeps children beside their parent and preserves sibling order', () => {
    const parent = createItem('parent');
    const firstChild = createItem('child-1', 'parent');
    const secondChild = createItem('child-2', 'parent');
    const next = createItem('next');

    expect(normalizeChecklistHierarchy([parent, next, firstChild, secondChild])).toEqual([
      parent,
      firstChild,
      secondChild,
      next
    ]);
  });

  it('flattens orphaned, self-referencing, and third-level relationships without dropping items', () => {
    const parent = createItem('parent');
    const child = createItem('child', 'parent');
    const orphan = createItem('orphan', 'missing');
    const self = createItem('self', 'self');
    const grandchild = createItem('grandchild', 'child');

    expect(normalizeChecklistHierarchy([parent, child, orphan, self, grandchild])).toEqual([
      parent,
      child,
      setChecklistParent(orphan),
      setChecklistParent(self),
      setChecklistParent(grandchild)
    ]);
  });

  it('flattens children whose parent id is duplicated', () => {
    const firstParent = createItem('duplicate');
    const secondParent = { ...createItem('duplicate'), text: 'second parent' };
    const child = createItem('child', 'duplicate');

    expect(normalizeChecklistHierarchy([firstParent, child, secondParent])).toEqual([
      firstParent,
      setChecklistParent(child),
      secondParent
    ]);
  });

  it('is idempotent and exposes derived groups without changing stored items', () => {
    const parent = createItem('parent');
    const child = createItem('child', 'parent');
    const next = createItem('next');
    const normalized = normalizeChecklistHierarchy([next, child, parent]);

    expect(normalizeChecklistHierarchy(normalized)).toEqual(normalized);
    expect(groupChecklist(normalized)).toEqual([
      { parent: next, children: [] },
      { parent, children: [child] }
    ]);
  });

  it('repairs orphaned relationships before deriving groups', () => {
    const orphan = createItem('orphan', 'missing');

    expect(groupChecklist([orphan])).toEqual([
      { parent: setChecklistParent(orphan), children: [] }
    ]);
  });
});

function createItem(id: string, parentId?: string): NoteChecklistItemRecord {
  return {
    id,
    text: id,
    checked: false,
    ...(parentId ? { parentId } : {}),
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z'
  };
}
