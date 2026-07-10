const fs = require('node:fs');
const path = require('node:path');
const { app, nativeImage } = require('electron');

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, 'assets/icons/app-icon-source.png');
const appPngPath = path.join(projectRoot, 'assets/icons/app-icon.png');
const trayPngPath = path.join(projectRoot, 'assets/icons/tray-icon.png');
const icoPath = path.join(projectRoot, 'assets/icons/app-icon.ico');
const sizes = [16, 24, 32, 48, 64, 128, 256];

function bitmapToDib(bitmap, width, height) {
  const headerSize = 40;
  const pixelSize = width * height * 4;
  const maskRowSize = Math.ceil(width / 32) * 4;
  const maskSize = maskRowSize * height;
  const dib = Buffer.alloc(headerSize + pixelSize + maskSize);

  dib.writeUInt32LE(headerSize, 0);
  dib.writeInt32LE(width, 4);
  dib.writeInt32LE(height * 2, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(32, 14);
  dib.writeUInt32LE(0, 16);
  dib.writeUInt32LE(pixelSize + maskSize, 20);
  dib.writeInt32LE(0, 24);
  dib.writeInt32LE(0, 28);
  dib.writeUInt32LE(0, 32);
  dib.writeUInt32LE(0, 36);

  const pixelOffset = headerSize;
  for (let y = 0; y < height; y += 1) {
    const srcStart = (height - 1 - y) * width * 4;
    const destStart = pixelOffset + y * width * 4;
    bitmap.copy(dib, destStart, srcStart, srcStart + width * 4);
  }

  return dib;
}

function writeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const directory = entries.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  fs.writeFileSync(icoPath, Buffer.concat([header, ...directory, ...entries.map((entry) => entry.data)]));
}

app.whenReady().then(() => {
  const source = nativeImage.createFromPath(sourcePath);
  if (source.isEmpty()) {
    throw new Error(`Unable to read icon source: ${sourcePath}`);
  }

  fs.writeFileSync(appPngPath, source.resize({ width: 256, height: 256 }).toPNG());
  fs.writeFileSync(trayPngPath, source.resize({ width: 32, height: 32 }).toPNG());

  writeIco(
    sizes.map((size) => {
      const resized = source.resize({ width: size, height: size });
      return {
        size,
        data: bitmapToDib(resized.toBitmap(), size, size)
      };
    })
  );
}).finally(() => app.quit());
