import type { AddImageResult } from './notes-manager';
import type { SaveImageInput } from './image-storage';

type ClipboardImage = {
  isEmpty: () => boolean;
  toPNG: () => Uint8Array;
  getSize: () => {
    width: number;
    height: number;
  };
};

type ClipboardImageReader = {
  readImage: () => ClipboardImage;
};

export type PasteClipboardImageResult =
  | AddImageResult
  | {
      ok: false;
      reason: 'empty-clipboard';
    };

type PasteClipboardImageOptions = {
  clipboard: ClipboardImageReader;
  addImage: (input: SaveImageInput) => Promise<AddImageResult>;
};

export async function pasteClipboardImage(
  options: PasteClipboardImageOptions
): Promise<PasteClipboardImageResult> {
  const clipboardImage = options.clipboard.readImage();

  if (clipboardImage.isEmpty()) {
    return {
      ok: false,
      reason: 'empty-clipboard'
    };
  }

  const size = clipboardImage.getSize();

  return options.addImage({
    data: clipboardImage.toPNG(),
    width: size.width,
    height: size.height
  });
}
