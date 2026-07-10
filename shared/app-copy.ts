export type AppCopy = {
  noteContentPlaceholder: string;
  checklistItemPlaceholder: string;
};

export const DEFAULT_APP_COPY: AppCopy = {
  noteContentPlaceholder: '可以在这里随便记点什么',
  checklistItemPlaceholder: '待办事项'
};

export function getAppCopy(displayName?: string): AppCopy {
  const normalizedName = displayName?.trim();

  if (!normalizedName) {
    return DEFAULT_APP_COPY;
  }

  return {
    noteContentPlaceholder: `${normalizedName}可以在这里随便记点什么`,
    checklistItemPlaceholder: `${normalizedName}的待办事项`
  };
}
