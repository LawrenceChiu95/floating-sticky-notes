export type NoteNamingState = {
  name: string;
  draft: string;
  isEditing: boolean;
  isSaving: boolean;
};

export type NoteNamePresentation =
  | { kind: 'status'; text: string }
  | { kind: 'editor' }
  | { kind: 'name'; text: string; title: string }
  | { kind: 'empty'; hint: string };

export function createNoteNamingState(name: string): NoteNamingState {
  return {
    name,
    draft: name,
    isEditing: false,
    isSaving: false
  };
}

export function startNoteNameEditing(state: NoteNamingState): NoteNamingState {
  if (state.isSaving) {
    return state;
  }

  return {
    ...state,
    draft: state.name,
    isEditing: true
  };
}

export function updateNoteNameDraft(state: NoteNamingState, draft: string): NoteNamingState {
  return {
    ...state,
    draft
  };
}

export function cancelNoteNameEditing(state: NoteNamingState): NoteNamingState {
  return {
    name: state.name,
    draft: state.name,
    isEditing: false,
    isSaving: false
  };
}

export function beginNoteNameSave(state: NoteNamingState): NoteNamingState {
  return {
    name: state.name,
    draft: state.name,
    isEditing: false,
    isSaving: true
  };
}

export function failNoteNameSave(state: NoteNamingState): NoteNamingState {
  return {
    name: state.name,
    draft: state.name,
    isEditing: false,
    isSaving: false
  };
}

export function applySavedNoteName(state: NoteNamingState, name: string): NoteNamingState {
  return {
    name,
    draft: name,
    isEditing: false,
    isSaving: false
  };
}

export function getNoteNameKeyAction(
  key: string,
  isComposing = false
): 'submit' | 'cancel' | undefined {
  if (isComposing) {
    return undefined;
  }

  if (key === 'Enter') {
    return 'submit';
  }

  if (key === 'Escape') {
    return 'cancel';
  }

  return undefined;
}

export function getNoteNamePresentation(
  state: NoteNamingState,
  statusMessage: string
): NoteNamePresentation {
  if (state.isEditing) {
    return { kind: 'editor' };
  }

  if (statusMessage) {
    return { kind: 'status', text: statusMessage };
  }

  if (state.name) {
    return {
      kind: 'name',
      text: state.name,
      title: state.name
    };
  }

  return {
    kind: 'empty',
    hint: '双击命名'
  };
}
