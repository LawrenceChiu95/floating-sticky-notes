const IMAGE_FILE_EXTENSIONS = new Set(['.avif', '.bmp', '.gif', '.jpeg', '.jpg', '.png', '.webp']);

export type ImageDropFileCandidate = {
  name: string;
  type: string;
};

export function isImageDropFile(file: ImageDropFileCandidate): boolean {
  if (file.type.startsWith('image/')) {
    return true;
  }

  if (file.type !== '') {
    return false;
  }

  return IMAGE_FILE_EXTENSIONS.has(getLowercaseExtension(file.name));
}

function getLowercaseExtension(filename: string): string {
  const extensionStart = filename.lastIndexOf('.');

  if (extensionStart < 0) {
    return '';
  }

  return filename.slice(extensionStart).toLowerCase();
}
