export type NotePopover = 'more' | 'note-delete';

/**
 * The two drag-bar popovers (more menu, note-delete confirmation) are mutually
 * exclusive. Keeping them in one nullable state makes double-open impossible
 * for both pointer and keyboard activation paths.
 */
export function togglePopover(
  current: NotePopover | null,
  target: NotePopover
): NotePopover | null {
  return current === target ? null : target;
}
