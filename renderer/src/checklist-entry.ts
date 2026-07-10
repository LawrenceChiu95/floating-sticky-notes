export function getChecklistAddLabel(
  itemCount: number,
  checklistItemPlaceholder: string
): string | undefined {
  return itemCount > 0 ? undefined : `+ ${checklistItemPlaceholder}`;
}

export function shouldShowChecklistAddEntry(itemCount: number): boolean {
  return itemCount === 0;
}
