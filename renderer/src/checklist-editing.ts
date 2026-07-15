import type { NoteChecklistItemRecord } from '../../main/note-state';

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

export type ChecklistKeyAction = 'enter' | 'backspace';

export function normalizeChecklistText(text: string): string {
  return text.replace(/[\r\n]/g, '');
}

export function getChecklistKeyAction(
  key: string,
  isComposing = false
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

  return undefined;
}

export function applyChecklistEnter(
  checklist: NoteChecklistItemRecord[],
  itemId: string,
  options: CreateChecklistItemOptions
): ChecklistEditingResult {
  const itemIndex = checklist.findIndex((item) => item.id === itemId);

  if (itemIndex < 0) {
    return {
      checklist,
      focus: {
        type: 'note'
      }
    };
  }

  if (checklist[itemIndex].text.trim().length === 0) {
    return {
      checklist: checklist.filter((item) => item.id !== itemId),
      focus: {
        type: 'note'
      }
    };
  }

  const timestamp = options.now();
  const nextItem = {
    id: options.createId(),
    text: '',
    checked: false,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  return {
    checklist: [...checklist.slice(0, itemIndex + 1), nextItem, ...checklist.slice(itemIndex + 1)],
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
  const itemIndex = checklist.findIndex((item) => item.id === itemId);

  if (itemIndex < 0) {
    return {
      checklist,
      focus: {
        type: 'note'
      }
    };
  }

  const previousItem = checklist[itemIndex - 1];

  return {
    checklist: checklist.filter((item) => item.id !== itemId),
    focus: previousItem
      ? {
          type: 'checklist',
          itemId: previousItem.id
        }
      : {
          type: 'note'
        }
  };
}
