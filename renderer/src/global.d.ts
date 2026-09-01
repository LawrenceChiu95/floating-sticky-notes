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
  transitionId?: number;
  committed?: boolean;
  // 拖出展开时携带：书签头在新窗口坐标系内的矩形（clip 揭示动画起点）。
  expandFrom?: { x: number; y: number; width: number; height: number };
  // 吸附逆揭示时携带：union 视口尺寸与 strip / bookmark 两个矩形（union 窗口
  // 坐标系），renderer 用它们演「纸面收成书签头并滑到贴边点」的 DOM 动画。
  shrinkFromStrip?: {
    unionWidth: number;
    unionHeight: number;
    strip: { x: number; y: number; width: number; height: number };
    bookmark: { x: number; y: number; width: number; height: number };
  };
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
      dockShrinkFinished: (transitionId: number) => void;
      // 吸附逆揭示开演前的握手：stub 已提交并钉好后发送，主进程收到才扩窗。
      dockShrinkReady: (transitionId: number) => void;
      dockShrinkUnionSized: (transitionId: number) => void;
      // 窗口交接的展开 prepare 回执：揭示首帧已 paint，主进程收到才上屏交接。
      dockExpandReady: (transitionId: number) => void;
      // 书签头窗（?view=tab）真实数据首帧 paint 完成的回执（窗口交接架构）。
      dockTabReady: () => void;
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
