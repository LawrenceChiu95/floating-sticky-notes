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

type DockOfferPayload = {
  side: 'left' | 'right';
  y: number;
  epoch: number;
};

type UndockOfferPayload = {
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  epoch: number;
};

declare global {
  interface Window {
    stickyNotes: {
      platform: NodeJS.Platform;
      getInitialDockSide: () => 'left' | 'right' | null;
      getAppCopy: () => Promise<AppCopy>;
      getCurrentNote: () => Promise<NoteView | undefined>;
      createNote: () => Promise<CreateNoteResult>;
      updateName: (name: string) => Promise<NoteView | undefined>;
      updateContent: (content: string) => Promise<NoteView | undefined>;
      updateChecklist: (checklist: NoteChecklistItemRecord[]) => Promise<NoteView | undefined>;
      updateAppearance: (appearance: NoteAppearanceInput) => Promise<NoteView | undefined>;
      setCollapsed: (collapsed: boolean) => Promise<boolean>;
      onDockOffer: (listener: (payload: DockOfferPayload) => void) => () => void;
      onUndockOffer: (listener: (payload: UndockOfferPayload) => void) => () => void;
      startNoteWindowDrag: (offsetX: number, offsetY: number) => Promise<boolean>;
      finishNoteWindowDrag: () => Promise<boolean>;
      acceptDock: (epoch: number) => Promise<boolean>;
      acceptUndock: (epoch: number) => Promise<boolean>;
      getAutoLaunchStatus: () => Promise<AutoLaunchStatus>;
      setAutoLaunchEnabled: (enabled: boolean) => Promise<AutoLaunchStatus>;
      pasteClipboardImage: () => Promise<AddImageResult | { ok: false; reason: 'empty-clipboard' }>;
      addImage: (imageInput: {
        data: Uint8Array;
        width: number;
        height: number;
      }) => Promise<AddImageResult | undefined>;
      deleteImage: (imageId: string) => Promise<DeleteImageResult | undefined>;
      openImagePreview: (imageId: string) => Promise<boolean>;
      deleteCurrentNote: () => Promise<boolean>;
    };
    __stickyNotesFlushPendingContent?: () => Promise<void>;
  }
}
