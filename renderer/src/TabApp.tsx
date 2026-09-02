import { useEffect, useRef, useState, type JSX } from 'react';
import type { NoteView } from '../../main/notes-manager';
import {
  DEFAULT_NOTE_COLOR,
  DEFAULT_NOTE_OPACITY,
  hexToRgba,
  noteColorToMenuSurface
} from '../../shared/note-appearance';
import { NOTE_COLLAPSED_HEIGHT } from '../../shared/note-window';
import { DockedNoteShell, type NoteShellStyle } from './docked-note-shell';
import { createNoteNamingState, getNoteNamePresentation } from './note-naming';
import { getPreloadStatus } from './preload-status';

// 书签头窗（?view=tab）的入口：独立恒尺寸窗口里只渲染一枚静态书签头壳，
// 不挂载正文、工具栏、命名输入。窗口交接架构（2026-09-01）下它是贴边态的
// 正式可交互表面：悬停探头 enter/leave 由 DockedNoteShell 壳上报，拖动走
// 壳内 pill 的原生 app-region drag，与便签主窗的 overlay 同一套 DOM/CSS。
export function TabApp(): JSX.Element {
  const preloadStatus = getPreloadStatus(window);
  const [note, setNote] = useState<NoteView | null>(null);
  const side = window.stickyNotes.getInitialDockSide() ?? 'left';

  useEffect(() => {
    let isMounted = true;
    window.stickyNotes
      .getCurrentNote()
      .then((current) => {
        if (isMounted) {
          setNote(current ?? null);
        }
      })
      .catch(() => undefined);
    return () => {
      isMounted = false;
    };
  }, []);

  // 交接安全回执：真实数据的首帧 paint 之后才允许主进程 showInactive 上屏——
  // 上屏画面必须与吸附动画末帧同像素，缺颜色/名字的占位帧不允许出现。
  const readySentRef = useRef(false);
  useEffect(() => {
    if (!note || readySentRef.current) {
      return;
    }
    readySentRef.current = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.stickyNotes.dockTabReady();
      });
    });
  }, [note]);

  const color = note?.color ?? DEFAULT_NOTE_COLOR;
  const opacity = note?.opacity ?? DEFAULT_NOTE_OPACITY;
  const shellStyle: NoteShellStyle = {
    backgroundColor: hexToRgba(color, opacity),
    '--note-menu-surface': noteColorToMenuSurface(color),
    '--note-collapsed-height': `${NOTE_COLLAPSED_HEIGHT}px`,
    '--note-transition-title-width': '0px',
    '--collapsed-name-edit-start-width': '0px'
  };
  const namePresentation = getNoteNamePresentation(
    createNoteNamingState(note?.name ?? ''),
    ''
  );

  return (
    <DockedNoteShell
      dock={{ side }}
      namePresentation={namePresentation}
      preloadStatus={preloadStatus}
      shellStyle={shellStyle}
    />
  );
}
