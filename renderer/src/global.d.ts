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

type DockAppliedPayload = {
  dock: { side: 'left' | 'right' } | null;
  // 拖出展开时携带：书签头在新窗口坐标系内的矩形（clip 揭示动画起点）。
  expandFrom?: { x: number; y: number; width: number; height: number };
  // 吸附滑入时携带：目标书签头尺寸（多屏共边是 48 宽全露而非 96 半藏），
  // 书签头 DOM 按此钉在横条窗口保留角演交叉淡变（240ms，与平移滑行同拍）。
  morphFromStrip?: { width: number; height: number };
};

type DockPreviewPayload = {
  side: 'left' | 'right' | null;
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
      onDockApplied: (listener: (payload: DockAppliedPayload) => void) => () => void;
      onDockPreview: (listener: (payload: DockPreviewPayload) => void) => () => void;
      dockPeekHover: (hovered: boolean) => void;
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
