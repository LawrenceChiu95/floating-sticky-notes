export function createDockWindowMoveHandler(
  isReady: () => boolean,
  onMove: () => void,
  onSave: () => void
): () => void {
  return (): void => {
    // Restored dock tabs can emit move synchronously from setBounds while the
    // surrounding note-window closure is still being initialized.
    if (!isReady()) {
      return;
    }
    onMove();
    onSave();
  };
}
