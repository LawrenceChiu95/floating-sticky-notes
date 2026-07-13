import { CheckSquare, ImagePlus, Palette, Plus, Trash2, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent
} from 'react';
import { createRoot } from 'react-dom/client';
import type { NoteImageView } from '../../main/notes-manager';
import type { NoteChecklistItemRecord } from '../../main/note-state';
import { DEFAULT_APP_COPY } from '../../shared/app-copy';
import { DEFAULT_NOTE_COLOR, DEFAULT_NOTE_OPACITY, NOTE_COLORS } from '../../shared/note-appearance';
import { createDebouncedValueAction, type DebouncedValueAction } from '../../shared/debounced-action';
import { limitNoteNameLength } from '../../shared/note-name';
import {
  applyChecklistBackspace,
  applyChecklistEnter,
  type ChecklistFocusTarget
} from './checklist-editing';
import {
  getChecklistAddLabel,
  shouldShowChecklistAddEntry
} from './checklist-entry';
import { isImageDropFile } from './image-drop';
import {
  applySavedNoteName,
  beginNoteNameSave,
  cancelNoteNameEditing,
  createNoteNamingState,
  failNoteNameSave,
  getNoteNameKeyAction,
  getNoteNamePresentation,
  startNoteNameEditing,
  updateNoteNameDraft
} from './note-naming';
import { getPreloadStatus } from './preload-status';
import './styles.css';

const STATUS_MESSAGE_DURATION_MS = 2000;
const PERSISTENT_STATUS_MESSAGES = new Set(['读取失败']);

function App(): JSX.Element {
  const preloadStatus = getPreloadStatus(window);
  const [content, setContent] = useState('');
  const [checklist, setChecklist] = useState<NoteChecklistItemRecord[]>([]);
  const [images, setImages] = useState<NoteImageView[]>([]);
  const [color, setColor] = useState<string>(DEFAULT_NOTE_COLOR);
  const [opacity, setOpacity] = useState(DEFAULT_NOTE_OPACITY);
  const [isAppearanceOpen, setIsAppearanceOpen] = useState(false);
  const [isImageDragActive, setIsImageDragActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [appCopy, setAppCopy] = useState(DEFAULT_APP_COPY);
  const [noteNaming, setNoteNaming] = useState(() => createNoteNamingState(''));
  const [pendingImageDelete, setPendingImageDelete] = useState<{
    imageId: string;
    focusTarget: ChecklistFocusTarget;
  }>();
  const saveContentRef = useRef<DebouncedValueAction<string>>();
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const isNameEditingRef = useRef(false);
  const isNameSavingRef = useRef(false);
  const noteInputRef = useRef<HTMLTextAreaElement | null>(null);
  const checklistInputRefs = useRef(new Map<string, HTMLInputElement>());
  const pendingFocusRestoreRef = useRef<ChecklistFocusTarget>();
  const lastEditingTargetRef = useRef<{ type: 'note' } | { type: 'checklist'; itemId: string }>({
    type: 'note'
  });

  if (!saveContentRef.current) {
    saveContentRef.current = createDebouncedValueAction<string>((nextContent) => {
      return window.stickyNotes
        .updateContent(nextContent)
        .then(() => undefined)
        .catch(() => {
          setStatusMessage('保存失败');
        });
    }, 350);
  }

  useEffect(() => {
    let isMounted = true;

    const flushPendingContent = (): Promise<void> =>
      saveContentRef.current?.flush() ?? Promise.resolve();
    window.__stickyNotesFlushPendingContent = flushPendingContent;
    window.addEventListener('beforeunload', flushPendingContent);

    window.stickyNotes
      .getCurrentNote()
      .then((note) => {
        if (!isMounted) {
          return;
        }

        setContent(note?.content ?? '');
        setNoteNaming(createNoteNamingState(note?.name ?? ''));
        setChecklist(note?.checklist ?? []);
        setImages(note?.images ?? []);
        setColor(note?.color ?? DEFAULT_NOTE_COLOR);
        setOpacity(note?.opacity ?? DEFAULT_NOTE_OPACITY);
      })
      .catch(() => {
        if (isMounted) {
          setStatusMessage('读取失败');
        }
      });

    window.stickyNotes
      .getAppCopy()
      .then((copy) => {
        if (isMounted) {
          setAppCopy(copy);
        }
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
      window.removeEventListener('beforeunload', flushPendingContent);
      if (window.__stickyNotesFlushPendingContent === flushPendingContent) {
        delete window.__stickyNotesFlushPendingContent;
      }
      void flushPendingContent();
    };
  }, []);

  useEffect(() => {
    const focusTarget = pendingFocusRestoreRef.current;

    if (!focusTarget) {
      return;
    }

    pendingFocusRestoreRef.current = undefined;
    focusEditingTarget(focusTarget);
  });

  useEffect(() => {
    if (!noteNaming.isEditing) {
      return;
    }

    requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });
  }, [noteNaming.isEditing]);

  useEffect(() => {
    if (!statusMessage || PERSISTENT_STATUS_MESSAGES.has(statusMessage)) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setStatusMessage('');
    }, STATUS_MESSAGE_DURATION_MS);

    return () => window.clearTimeout(timeoutId);
  }, [statusMessage]);

  const handleContentChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const nextContent = event.target.value;
    setContent(nextContent);
    saveContentRef.current?.schedule(nextContent);
  };

  const handleStartNameEditing = (): void => {
    if (isNameSavingRef.current) {
      return;
    }

    isNameEditingRef.current = true;
    setNoteNaming(startNoteNameEditing);
  };

  const handleNameSubmit = (): void => {
    if (!isNameEditingRef.current || isNameSavingRef.current) {
      return;
    }

    isNameSavingRef.current = true;
    const draft = noteNaming.draft;
    setNoteNaming(beginNoteNameSave);

    void window.stickyNotes
      .updateName(draft)
      .then((note) => {
        isNameSavingRef.current = false;

        if (note) {
          isNameEditingRef.current = false;
          setNoteNaming((state) => applySavedNoteName(state, note.name));
          return;
        }

        setNoteNaming(failNoteNameSave);
        requestAnimationFrame(() => nameInputRef.current?.focus());
      })
      .catch(() => {
        isNameSavingRef.current = false;
        setNoteNaming(failNoteNameSave);
        requestAnimationFrame(() => nameInputRef.current?.focus());
      });
  };

  const handleCancelNameEditing = (): void => {
    isNameEditingRef.current = false;
    setNoteNaming(cancelNoteNameEditing);
  };

  const handleNameKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const action = getNoteNameKeyAction(event.key, event.nativeEvent.isComposing);

    if (!action) {
      return;
    }

    event.preventDefault();

    if (isNameSavingRef.current) {
      return;
    }

    if (action === 'submit') {
      handleNameSubmit();
      return;
    }

    handleCancelNameEditing();
  };

  const rememberChecklistInput = (itemId: string, element: HTMLInputElement | null): void => {
    if (element) {
      checklistInputRefs.current.set(itemId, element);
      return;
    }

    checklistInputRefs.current.delete(itemId);
  };

  const focusEditingTarget = (target: ChecklistFocusTarget): void => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const focusTarget =
          target.type === 'checklist'
            ? checklistInputRefs.current.get(target.itemId) ?? noteInputRef.current
            : noteInputRef.current;

        focusTarget?.focus();
      });
    });
  };

  const restoreEditingFocus = (): void => {
    focusEditingTarget(lastEditingTargetRef.current);
  };

  const handlePasteImage = (): void => {
    const flushPendingContent = saveContentRef.current?.flush() ?? Promise.resolve();

    void flushPendingContent
      .then(() => window.stickyNotes.pasteClipboardImage())
      .then((result) => {
        if (result.ok) {
          setImages(result.note.images);
          setStatusMessage('');
          return;
        }

        setStatusMessage(result.reason === 'empty-clipboard' ? '剪贴板没有图片' : '贴图失败');
      })
      .catch(() => {
        setStatusMessage('贴图失败');
      });
  };

  const saveChecklist = (nextChecklist: NoteChecklistItemRecord[]): void => {
    setChecklist(nextChecklist);
    window.stickyNotes
      .updateChecklist(nextChecklist)
      .then((note) => {
        if (note) {
          setChecklist(note.checklist);
          setStatusMessage('');
          return;
        }

        setStatusMessage('保存失败');
      })
      .catch(() => {
        setStatusMessage('保存失败');
      });
  };

  const handleAddChecklistItem = (): void => {
    const now = new Date().toISOString();
    const itemId = createClientId();
    const nextChecklist = [
      ...checklist,
      {
        id: itemId,
        text: '',
        checked: false,
        createdAt: now,
        updatedAt: now
      }
    ];
    const focus = {
      type: 'checklist',
      itemId
    } satisfies ChecklistFocusTarget;

    saveChecklist(nextChecklist);
    lastEditingTargetRef.current = focus;
    focusEditingTarget(focus);
  };

  const handleChecklistTextChange = (itemId: string, text: string): void => {
    const now = new Date().toISOString();
    saveChecklist(
      checklist.map((item) => (item.id === itemId ? { ...item, text, updatedAt: now } : item))
    );
  };

  const handleChecklistCheckedChange = (itemId: string, checked: boolean): void => {
    const now = new Date().toISOString();
    saveChecklist(
      checklist.map((item) => (item.id === itemId ? { ...item, checked, updatedAt: now } : item))
    );
  };

  const handleDeleteChecklistItem = (itemId: string): void => {
    saveChecklist(checklist.filter((item) => item.id !== itemId));
  };

  const handleChecklistKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    itemId: string
  ): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const result = applyChecklistEnter(checklist, itemId, {
        createId: createClientId,
        now: () => new Date().toISOString()
      });
      saveChecklist(result.checklist);
      lastEditingTargetRef.current = result.focus;
      focusEditingTarget(result.focus);
      return;
    }

    if (
      event.key === 'Backspace' &&
      event.currentTarget.value.length === 0 &&
      event.currentTarget.selectionStart === 0 &&
      event.currentTarget.selectionEnd === 0
    ) {
      event.preventDefault();
      const result = applyChecklistBackspace(checklist, itemId);
      saveChecklist(result.checklist);
      lastEditingTargetRef.current = result.focus;
      focusEditingTarget(result.focus);
    }
  };

  const saveAppearance = (nextAppearance: { color?: string; opacity?: number }): void => {
    window.stickyNotes
      .updateAppearance(nextAppearance)
      .then((note) => {
        if (note) {
          setColor(note.color);
          setOpacity(note.opacity);
          setStatusMessage('');
          return;
        }

        setStatusMessage('保存失败');
      })
      .catch(() => {
        setStatusMessage('保存失败');
      });
  };

  const handleColorChange = (nextColor: string): void => {
    setColor(nextColor);
    saveAppearance({ color: nextColor });
  };

  const handleOpacityChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const nextOpacity = Number(event.target.value);
    setOpacity(nextOpacity);
    saveAppearance({ opacity: nextOpacity });
  };

  const handleDropImage = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault();
    setIsImageDragActive(false);

    const imageFile = getFirstImageFile(event.dataTransfer.files);

    if (!imageFile) {
      setStatusMessage('没有图片');
      return;
    }

    const flushPendingContent = saveContentRef.current?.flush() ?? Promise.resolve();

    void flushPendingContent
      .then(() => readImageFileForNote(imageFile))
      .then((imageInput) => window.stickyNotes.addImage(imageInput))
      .then((result) => {
        if (result?.ok) {
          setImages(result.note.images);
          setStatusMessage('');
          restoreEditingFocus();
          return;
        }

        setStatusMessage('贴图失败');
      })
      .catch(() => {
        setStatusMessage('贴图失败');
      });
  };

  const handleDragOver = (event: DragEvent<HTMLElement>): void => {
    if (!hasImageDragData(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsImageDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }

    setIsImageDragActive(false);
  };

  const handleRequestDeleteImage = (imageId: string): void => {
    setPendingImageDelete({
      imageId,
      focusTarget: lastEditingTargetRef.current
    });
  };

  const handleCancelDeleteImage = (): void => {
    const focusTarget = pendingImageDelete?.focusTarget;

    if (focusTarget) {
      pendingFocusRestoreRef.current = focusTarget;
    }

    setPendingImageDelete(undefined);
  };

  const handleConfirmDeleteImage = (): void => {
    const pendingDelete = pendingImageDelete;

    if (!pendingDelete) {
      return;
    }

    window.stickyNotes
      .deleteImage(pendingDelete.imageId)
      .then((result) => {
        pendingFocusRestoreRef.current = pendingDelete.focusTarget;
        setPendingImageDelete(undefined);

        if (result?.ok) {
          setImages(result.note.images);
          setStatusMessage('');
          return;
        }

        setStatusMessage('删除图片失败');
      })
      .catch(() => {
        pendingFocusRestoreRef.current = pendingDelete.focusTarget;
        setPendingImageDelete(undefined);
        setStatusMessage('删除图片失败');
      });
  };

  const handlePaste = (event: ClipboardEvent<HTMLElement>): void => {
    const hasImage = Array.from(event.clipboardData.items).some((item) =>
      item.type.startsWith('image/')
    );

    if (!hasImage) {
      return;
    }

    event.preventDefault();
    handlePasteImage();
  };

  const handleCreateNote = (): void => {
    window.stickyNotes
      .createNote()
      .then((result) => {
        setStatusMessage(result.ok ? '' : '最多 20 张');
      })
      .catch(() => {
        setStatusMessage('新建失败');
      });
  };

  const handleDeleteNote = (): void => {
    if (!window.confirm('删除这张便签？')) {
      return;
    }

    window.stickyNotes.deleteCurrentNote().catch(() => {
      setStatusMessage('删除失败');
    });
  };

  const shellStyle = {
    backgroundColor: hexToRgba(color, opacity)
  } satisfies CSSProperties;
  const checklistAddLabel = getChecklistAddLabel(
    checklist.length,
    appCopy.checklistItemPlaceholder
  );
  const showChecklistAddEntry = shouldShowChecklistAddEntry(checklist.length);
  const namePresentation = getNoteNamePresentation(noteNaming, statusMessage);

  return (
    <main
      className={`note-shell${isImageDragActive ? ' note-shell--dragging-image' : ''}`}
      data-preload-status={preloadStatus}
      style={shellStyle}
      onPaste={handlePaste}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDropImage}
    >
      <div className="drag-bar">
        <span className="drag-grip" aria-hidden="true" />
        <div className="status-label" aria-live="polite">
          {namePresentation.kind === 'status' ? namePresentation.text : null}
          {namePresentation.kind === 'editor' ? (
            <>
              <input
                ref={nameInputRef}
                className={`note-name-input${
                  noteNaming.hasSaveError ? ' note-name-input--error' : ''
                }`}
                type="text"
                aria-label="便签名称"
                aria-busy={noteNaming.isSaving}
                aria-invalid={noteNaming.hasSaveError}
                aria-describedby={noteNaming.hasSaveError ? 'name-save-error' : undefined}
                readOnly={noteNaming.isSaving}
                value={noteNaming.draft}
                onChange={(event) =>
                  setNoteNaming((state) =>
                    updateNoteNameDraft(state, limitNoteNameLength(event.target.value))
                  )
                }
                onKeyDown={handleNameKeyDown}
                onBlur={handleNameSubmit}
              />
              {noteNaming.hasSaveError ? (
                <span id="name-save-error" className="visually-hidden">
                  保存失败
                </span>
              ) : null}
            </>
          ) : null}
          {namePresentation.kind === 'name' ? (
            <span
              className="note-name-hit-area note-name-hit-area--named"
              onDoubleClick={handleStartNameEditing}
            >
              <span className="note-name" title={namePresentation.title}>
                {namePresentation.text}
              </span>
            </span>
          ) : null}
          {namePresentation.kind === 'empty' ? (
            <span className="note-name-hit-area" onDoubleClick={handleStartNameEditing}>
              <span
                className="note-name note-name--empty"
                data-hint={namePresentation.hint}
              />
            </span>
          ) : null}
        </div>
        <div className="toolbar" aria-label="便签工具">
          <button type="button" title="新建便签" aria-label="新建便签" onClick={handleCreateNote}>
            <Plus size={15} strokeWidth={2} />
          </button>
          <button
            type="button"
            title="添加事项"
            aria-label="添加事项"
            onClick={handleAddChecklistItem}
          >
            <CheckSquare size={15} strokeWidth={2} />
          </button>
          <button
            type="button"
            title="外观"
            aria-label="外观"
            aria-pressed={isAppearanceOpen}
            onClick={() => setIsAppearanceOpen((value) => !value)}
          >
            <Palette size={15} strokeWidth={2} />
          </button>
          <button type="button" title="贴图" aria-label="贴图" onClick={handlePasteImage}>
            <ImagePlus size={15} strokeWidth={2} />
          </button>
          <button type="button" title="删除" aria-label="删除" onClick={handleDeleteNote}>
            <Trash2 size={15} strokeWidth={2} />
          </button>
        </div>
      </div>
      <div className="note-content">
        {isAppearanceOpen ? (
          <div className="appearance-panel" aria-label="便签外观">
            <div className="color-swatches" aria-label="颜色">
              {Object.values(NOTE_COLORS).map((swatchColor) => (
                <button
                  key={swatchColor}
                  type="button"
                  className={`color-swatch${swatchColor === color ? ' color-swatch--active' : ''}`}
                  style={{ backgroundColor: swatchColor }}
                  title="颜色"
                  aria-label="颜色"
                  aria-pressed={swatchColor === color}
                  onClick={() => handleColorChange(swatchColor)}
                />
              ))}
            </div>
            <input
              className="opacity-slider"
              type="range"
              min="0.3"
              max="1"
              step="0.05"
              value={opacity}
              title="透明度"
              aria-label="透明度"
              onChange={handleOpacityChange}
            />
          </div>
        ) : null}
        {images.length > 0 ? (
          <div className="image-list" aria-label="便签图片">
            {images.map((image) => (
              <figure key={image.id} className="image-item">
                <img
                  className="note-image"
                  src={image.src}
                  width={image.width || undefined}
                  height={image.height || undefined}
                  alt=""
                />
                <button
                  type="button"
                  className="image-delete"
                  title="删除图片"
                  aria-label="删除图片"
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => handleRequestDeleteImage(image.id)}
                >
                  <X size={14} strokeWidth={2.2} />
                </button>
                {pendingImageDelete?.imageId === image.id ? (
                  <div className="image-delete-confirm" role="dialog" aria-label="确认删除图片">
                    <span>删除图片？</span>
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onClick={handleConfirmDeleteImage}
                    >
                      删除
                    </button>
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onClick={handleCancelDeleteImage}
                    >
                      取消
                    </button>
                  </div>
                ) : null}
              </figure>
            ))}
          </div>
        ) : null}
        {checklist.length > 0 ? (
          <div className="checklist" aria-label="勾选事项">
            {checklist.map((item) => (
              <div key={item.id} className="checklist-item">
                <input
                  className="checklist-checkbox"
                  type="checkbox"
                  checked={item.checked}
                  aria-label="完成"
                  onChange={(event) => handleChecklistCheckedChange(item.id, event.target.checked)}
                />
                <input
                  className="checklist-input"
                  type="text"
                  value={item.text}
                  placeholder={appCopy.checklistItemPlaceholder}
                  aria-label="事项内容"
                  ref={(element) => rememberChecklistInput(item.id, element)}
                  onFocus={() => {
                    lastEditingTargetRef.current = {
                      type: 'checklist',
                      itemId: item.id
                    };
                  }}
                  onKeyDown={(event) => handleChecklistKeyDown(event, item.id)}
                  onChange={(event) => handleChecklistTextChange(item.id, event.target.value)}
                />
                <button
                  type="button"
                  className="checklist-delete"
                  title="删除事项"
                  aria-label="删除事项"
                  onClick={() => handleDeleteChecklistItem(item.id)}
                >
                  <X size={13} strokeWidth={2.2} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {showChecklistAddEntry ? (
          <button
            type="button"
            className="checklist-add checklist-add--empty"
            onClick={handleAddChecklistItem}
            aria-label="添加待办事项"
          >
            {checklistAddLabel}
          </button>
        ) : null}
        <textarea
          className="note-input"
          ref={noteInputRef}
          spellCheck={false}
          aria-label="便签内容"
          placeholder={appCopy.noteContentPlaceholder}
          value={content}
          onFocus={() => {
            lastEditingTargetRef.current = {
              type: 'note'
            };
          }}
          onChange={handleContentChange}
          onBlur={() => {
            void saveContentRef.current?.flush();
          }}
        />
      </div>
    </main>
  );
}

const container = document.getElementById('root');

if (!container) {
  throw new Error('Renderer root was not found');
}

createRoot(container).render(<App />);

function getFirstImageFile(files: FileList): File | undefined {
  return Array.from(files).find(isImageDropFile);
}

function createClientId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const normalizedHex = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : DEFAULT_NOTE_COLOR;
  const red = Number.parseInt(normalizedHex.slice(1, 3), 16);
  const green = Number.parseInt(normalizedHex.slice(3, 5), 16);
  const blue = Number.parseInt(normalizedHex.slice(5, 7), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function hasImageDragData(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.items).some((item) => {
    if (item.kind !== 'file') {
      return false;
    }

    return item.type === '' || item.type.startsWith('image/');
  });
}

async function readImageFileForNote(file: File): Promise<{
  data: Uint8Array;
  width: number;
  height: number;
}> {
  const pngImage = await readImageFileAsPng(file);

  return {
    data: pngImage.data,
    width: pngImage.width,
    height: pngImage.height
  };
}

function readImageFileAsPng(file: File): Promise<{
  data: Uint8Array;
  width: number;
  height: number;
}> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');

        if (!context) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('Image could not be rendered'));
          return;
        }

        context.drawImage(image, 0, 0);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(objectUrl);

          if (!blob) {
            reject(new Error('Image could not be encoded'));
            return;
          }

          blob
            .arrayBuffer()
            .then((buffer) => {
              resolve({
                data: new Uint8Array(buffer),
                width: image.naturalWidth,
                height: image.naturalHeight
              });
            })
            .catch(reject);
        }, 'image/png');
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        reject(error);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Image dimensions could not be read'));
    };
    image.src = objectUrl;
  });
}
