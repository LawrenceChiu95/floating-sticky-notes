import type {
  AddImageResult,
  CreateNoteResult,
  DeleteImageResult,
  NoteAppearanceInput,
  NoteView
} from '../../main/notes-manager';
import type { AutoLaunchStatus } from '../../main/auto-launch';
import type { NoteChecklistItemRecord } from '../../main/note-state';
import type { AppCopy } from '../../shared/app-copy';

export {};

declare global {
  interface Window {
    stickyNotes: {
      platform: NodeJS.Platform;
      getAppCopy: () => Promise<AppCopy>;
      getCurrentNote: () => Promise<NoteView | undefined>;
      createNote: () => Promise<CreateNoteResult>;
      updateName: (name: string) => Promise<NoteView | undefined>;
      updateContent: (content: string) => Promise<NoteView | undefined>;
      updateChecklist: (checklist: NoteChecklistItemRecord[]) => Promise<NoteView | undefined>;
      updateAppearance: (appearance: NoteAppearanceInput) => Promise<NoteView | undefined>;
      getAutoLaunchStatus: () => Promise<AutoLaunchStatus>;
      setAutoLaunchEnabled: (enabled: boolean) => Promise<AutoLaunchStatus>;
      pasteClipboardImage: () => Promise<AddImageResult | { ok: false; reason: 'empty-clipboard' }>;
      addImage: (imageInput: {
        data: Uint8Array;
        width: number;
        height: number;
      }) => Promise<AddImageResult | undefined>;
      deleteImage: (imageId: string) => Promise<DeleteImageResult | undefined>;
      deleteCurrentNote: () => Promise<boolean>;
    };
    __stickyNotesFlushPendingContent?: () => Promise<void>;
  }
}
