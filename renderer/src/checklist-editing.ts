import type { NoteChecklistItemRecord } from '../../main/note-state';
import {
  normalizeChecklistHierarchy,
  setChecklistParent
} from '../../main/checklist-hierarchy';

export type ChecklistFocusTarget =
  | {
      type: 'note';
    }
  | {
      type: 'checklist';
      itemId: string;
    };

export type ChecklistEditingResult = {
  checklist: NoteChecklistItemRecord[];
  focus: ChecklistFocusTarget;
};

type CreateChecklistItemOptions = {
  createId: () => string;
  now: () => string;
};

export type ChecklistKeyAction = 'enter' | 'backspace' | 'indent' | 'outdent';
export type ChecklistShortcutHint = 'indent' | 'outdent';

export function normalizeChecklistText(text: string): string {
  return text.replace(/[\r\n]/g, '');
}

export function getChecklistKeyAction(
  key: string,
  isComposing = false,
  shiftKey = false
): ChecklistKeyAction | undefined {
  if (isComposing) {
    return undefined;
  }

  if (key === 'Enter') {
    return 'enter';
  }

  if (key === 'Backspace') {
    return 'backspace';
  }

  if (key === 'Tab') {
    return shiftKey ? 'outdent' : 'indent';
  }

  return undefined;
}

export function getChecklistShortcutHint(
  checklist: NoteChecklistItemRecord[],
  itemId: string
): ChecklistShortcutHint | undefined {
  const normalizedChecklist = normalizeChecklistHierarchy(checklist);
  const itemIndex = normalizedChecklist.findIndex((item) => item.id === itemId);

  if (itemIndex < 0) {
    return undefined;
  }

  const item = normalizedChecklist[itemIndex];

  if (item.parentId) {
    return 'outdent';
  }

  if (itemIndex === 0 || normalizedChecklist.some((candidate) => candidate.parentId === item.id)) {
    return undefined;
  }

  return 'indent';
}

export function applyChecklistEnter(
  checklist: NoteChecklistItemRecord[],
  itemId: string,
  options: CreateChecklistItemOptions
): ChecklistEditingResult {
  const normalizedChecklist = normalizeChecklistHierarchy(checklist);
  const itemIndex = normalizedChecklist.findIndex((item) => item.id === itemId);

  if (itemIndex < 0) {
    return {
      checklist: normalizedChecklist,
      focus: { type: 'note' }
    };
  }

  const item = normalizedChecklist[itemIndex];

  if (item.text.trim().length === 0) {
    return {
      checklist: normalizeChecklistHierarchy(
        normalizedChecklist.filter((candidate) => candidate.id !== itemId)
      ),
      focus: item.parentId
        ? { type: 'checklist', itemId: item.parentId }
        : { type: 'note' }
    };
  }

  const timestamp = options.now();
  const nextItem: NoteChecklistItemRecord = {
    id: options.createId(),
    text: '',
    checked: false,
    ...(item.parentId ? { parentId: item.parentId } : {}),
    createdAt: timestamp,
    updatedAt: timestamp
  };

  return {
    checklist: normalizeChecklistHierarchy([
      ...normalizedChecklist.slice(0, itemIndex + 1),
      nextItem,
      ...normalizedChecklist.slice(itemIndex + 1)
    ]),
    focus: {
      type: 'checklist',
      itemId: nextItem.id
    }
  };
}

export function applyChecklistBackspace(
  checklist: NoteChecklistItemRecord[],
  itemId: string
): ChecklistEditingResult {
  const normalizedChecklist = normalizeChecklistHierarchy(checklist);
  const itemIndex = normalizedChecklist.findIndex((item) => item.id === itemId);

  if (itemIndex < 0) {
    return {
      checklist: normalizedChecklist,
      focus: { type: 'note' }
    };
  }

  const previousItem = normalizedChecklist[itemIndex - 1];

  return {
    checklist: normalizeChecklistHierarchy(
      normalizedChecklist.filter((item) => item.id !== itemId)
    ),
    focus: previousItem
      ? { type: 'checklist', itemId: previousItem.id }
      : { type: 'note' }
  };
}

export function applyChecklistIndent(
  checklist: NoteChecklistItemRecord[],
  itemId: string
): ChecklistEditingResult {
  const normalizedChecklist = normalizeChecklistHierarchy(checklist);
  const itemIndex = normalizedChecklist.findIndex((item) => item.id === itemId);

  if (itemIndex <= 0) {
    return { checklist: normalizedChecklist, focus: { type: 'checklist', itemId } };
  }

  const item = normalizedChecklist[itemIndex];
  const hasChildren = normalizedChecklist.some((candidate) => candidate.parentId === item.id);
  const previousItem = normalizedChecklist[itemIndex - 1];

  if (item.parentId || hasChildren || !previousItem) {
    return { checklist: normalizedChecklist, focus: { type: 'checklist', itemId } };
  }

  const parentId = previousItem.parentId ?? previousItem.id;
  const nextChecklist = normalizedChecklist.map((candidate) =>
    candidate.id === itemId ? { ...candidate, parentId } : candidate
  );

  return {
    checklist: normalizeChecklistHierarchy(nextChecklist),
    focus: { type: 'checklist', itemId }
  };
}

export function applyChecklistOutdent(
  checklist: NoteChecklistItemRecord[],
  itemId: string
): ChecklistEditingResult {
  const normalizedChecklist = normalizeChecklistHierarchy(checklist);
  const item = normalizedChecklist.find((candidate) => candidate.id === itemId);

  if (!item?.parentId) {
    return { checklist: normalizedChecklist, focus: { type: 'checklist', itemId } };
  }

  return {
    checklist: normalizeChecklistHierarchy(
      normalizedChecklist.map((candidate) =>
        candidate.id === itemId ? setChecklistParent(candidate) : candidate
      )
    ),
    focus: { type: 'checklist', itemId }
  };
}

export function applyChecklistDelete(
  checklist: NoteChecklistItemRecord[],
  itemId: string
): NoteChecklistItemRecord[] {
  return normalizeChecklistHierarchy(
    checklist.filter((item) => item.id !== itemId)
  );
}

export function applyChecklistAddSubtask(
  checklist: NoteChecklistItemRecord[],
  parentId: string,
  options: CreateChecklistItemOptions
): ChecklistEditingResult {
  const normalizedChecklist = normalizeChecklistHierarchy(checklist);
  const parentIndex = normalizedChecklist.findIndex((item) => item.id === parentId);
  const parent = normalizedChecklist[parentIndex];

  if (parentIndex < 0 || !parent || parent.parentId) {
    return { checklist: normalizedChecklist, focus: { type: 'note' } };
  }

  const timestamp = options.now();
  const item: NoteChecklistItemRecord = {
    id: options.createId(),
    text: '',
    checked: false,
    parentId,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  let insertAt = parentIndex + 1;

  while (insertAt < normalizedChecklist.length && normalizedChecklist[insertAt].parentId === parentId) {
    insertAt += 1;
  }

  return {
    checklist: normalizeChecklistHierarchy([
      ...normalizedChecklist.slice(0, insertAt),
      item,
      ...normalizedChecklist.slice(insertAt)
    ]),
    focus: { type: 'checklist', itemId: item.id }
  };
}
