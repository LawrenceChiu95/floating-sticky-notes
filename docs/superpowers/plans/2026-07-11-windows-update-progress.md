# Windows Update Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Windows 自动更新增加独立、非模态且可最小化的下载进度窗口，并修复关闭全部便签时意外退出安装的问题。

**Architecture:** 更新控制器维护显式 phase 和 operation ID，只通过 `UpdateProgressPresenter` 窄接口驱动 UI。窗口管理器缓存最新快照并包装一个可注入的窗口端口；Electron `BrowserWindow`、独立 preload 和独立 renderer 只在主进程接线层出现。Windows 与 macOS 保持同一更新源，但只有 Windows 使用新窗口。

**Tech Stack:** Electron 41、electron-updater 6、TypeScript 5、electron-vite 2、Vitest 1、原生 HTML/CSS。

---

## File map

- Create `shared/update-progress.ts`: 进度快照类型、IPC channel、非法百分比归一化。
- Create `main/update-progress-window.ts`: 与 Electron 解耦的单实例窗口管理器和任务栏进度同步。
- Create `preload/update-progress-preload.ts`: 只读进度订阅 bridge。
- Create `renderer/update-progress.html`: 独立进度窗口 HTML 入口。
- Create `renderer/src/update-progress.ts`: 校验快照并更新状态文字和 `<progress>`。
- Create `renderer/src/update-progress.css`: 小型 Windows 工具窗口样式和不定进度动画。
- Modify `main/update-controller.ts`: 显式状态机、operation ID、迟到事件保护和 presenter 调用。
- Modify `main/main.ts`: 创建真实进度窗口、Windows 接线、退出清理。
- Modify `main/app-lifecycle.ts`: Windows 关闭全部窗口后保持托盘常驻。
- Modify `electron.vite.config.ts`: 增加独立 preload 和 renderer 构建入口。
- Modify `CHANGELOG.md`, `docs/architecture.md`, `docs/releasing.md`: 用户可见变化、权威架构摘要和真机步骤。
- Create/modify tests listed below; do not replace behavior tests with only source-string assertions。

### Task 1: Shared progress snapshot

**Files:**
- Create: `shared/update-progress.ts`
- Create: `tests/update-progress.test.ts`

- [ ] **Step 1: Write failing normalization tests**

```ts
import { describe, expect, it } from 'vitest';
import { createDownloadingSnapshot, createPreparingSnapshot } from '../shared/update-progress';

describe('update progress snapshots', () => {
  it('uses an indeterminate snapshot before percentage is known', () => {
    expect(createPreparingSnapshot('0.1.11')).toEqual({
      state: 'preparing',
      version: '0.1.11'
    });
  });

  it.each([
    [{ percent: 42.4 }, 42],
    [{ percent: -5 }, 0],
    [{ percent: 105 }, 100]
  ])('normalizes valid progress %#', (input, percent) => {
    expect(createDownloadingSnapshot(input, '0.1.11')).toEqual({
      state: 'downloading',
      version: '0.1.11',
      percent
    });
  });

  it.each([undefined, {}, { percent: Number.NaN }, { percent: Infinity }])(
    'keeps invalid progress indeterminate',
    (input) => {
      expect(createDownloadingSnapshot(input, '0.1.11')).toEqual({
        state: 'downloading',
        version: '0.1.11'
      });
    }
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/update-progress.test.ts`

Expected: FAIL because `shared/update-progress.ts` does not exist.

- [ ] **Step 3: Implement the shared contract**

```ts
export const UPDATE_PROGRESS_CHANNEL = 'update-progress:snapshot';

export type UpdateProgressSnapshot = {
  state: 'preparing' | 'downloading';
  version?: string;
  percent?: number;
};

export function createPreparingSnapshot(version?: string): UpdateProgressSnapshot {
  return { state: 'preparing', ...(version ? { version } : {}) };
}

export function createDownloadingSnapshot(
  value: unknown,
  version?: string
): UpdateProgressSnapshot {
  const raw = value && typeof value === 'object' ? (value as { percent?: unknown }).percent : undefined;
  const percent = typeof raw === 'number' && Number.isFinite(raw)
    ? Math.round(Math.min(100, Math.max(0, raw)))
    : undefined;
  return {
    state: 'downloading',
    ...(version ? { version } : {}),
    ...(percent === undefined ? {} : { percent })
  };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run tests/update-progress.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Stage `shared/update-progress.ts` and `tests/update-progress.test.ts`; commit as `feat(update): 增加下载进度快照模型` using the repository commit format.

### Task 2: Single-instance progress window manager

**Files:**
- Create: `main/update-progress-window.ts`
- Create: `tests/update-progress-window.test.ts`

- [ ] **Step 1: Write failing manager tests with a fake window port**

```ts
class FakeProgressWindow {
  readonly sent: UpdateProgressSnapshot[] = [];
  readonly setProgressBar = vi.fn();
  readonly show = vi.fn();
  readonly focus = vi.fn();
  readonly close = vi.fn();
  readonly destroy = vi.fn();
  load = vi.fn(async () => undefined);
  readyListener?: () => void;
  closedListener?: () => void;
  onReady(listener: () => void) { this.readyListener = listener; }
  onClosed(listener: () => void) { this.closedListener = listener; }
  send(snapshot: UpdateProgressSnapshot) { this.sent.push(snapshot); }
}

it('replays progress received before renderer ready', async () => {
  const window = new FakeProgressWindow();
  const manager = createUpdateProgressWindowManager({ createWindow: () => window });
  manager.showPreparing('0.1.11');
  manager.update({ percent: 37.6 });
  window.readyListener?.();
  expect(window.sent.at(-1)).toEqual({ state: 'downloading', version: '0.1.11', percent: 38 });
});

it('reuses and focuses the existing window', () => {
  const createWindow = vi.fn(() => new FakeProgressWindow());
  const manager = createUpdateProgressWindowManager({ createWindow });
  manager.showPreparing('0.1.11');
  manager.focus();
  manager.showPreparing('0.1.11');
  expect(createWindow).toHaveBeenCalledTimes(1);
});

it('clears taskbar state and programmatically closes', () => {
  const window = new FakeProgressWindow();
  const manager = createUpdateProgressWindowManager({ createWindow: () => window });
  manager.showPreparing();
  manager.close();
  expect(window.setProgressBar).toHaveBeenLastCalledWith(-1);
  expect(window.close).toHaveBeenCalledTimes(1);
});
```

Also cover load rejection, stale `closed` callbacks, `dispose()` using `destroy()`, and invalid progress retaining indeterminate taskbar value `2`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/update-progress-window.test.ts`

Expected: FAIL because the manager does not exist.

- [ ] **Step 3: Implement the port and manager**

```ts
export type UpdateProgressWindowPort = {
  load: () => Promise<void>;
  onReady: (listener: () => void) => void;
  onClosed: (listener: () => void) => void;
  send: (snapshot: UpdateProgressSnapshot) => void;
  setProgressBar: (progress: number) => void;
  show: () => void;
  focus: () => void;
  close: () => void;
  destroy: () => void;
};

export type UpdateProgressPresenter = {
  showPreparing: (version?: string) => void;
  update: (value: unknown) => void;
  focus: () => void;
  close: () => void;
  dispose: () => void;
};
```

The manager must cache `latestSnapshot`, hold one port reference, replay after `onReady`, set taskbar `2` for indeterminate and `percent / 100` for determinate, catch `load()` failures through `logError`, and compare instance identity before clearing the reference.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run tests/update-progress-window.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit the manager and tests as `feat(update): 增加进度窗口生命周期管理`.

### Task 3: Race-safe Windows update controller

**Files:**
- Modify: `main/update-controller.ts`
- Modify: `tests/update-controller.test.ts`

- [ ] **Step 1: Add failing controller tests**

Extend the fake updater tests to assert:

```ts
const presenter = createProgressPresenter();
updater.emit('update-available', { version: '0.1.11' });
await flushMicrotasks();
expect(presenter.showPreparing).toHaveBeenCalledBefore(updater.downloadUpdate);

updater.emit('download-progress', { percent: 51.2 });
expect(presenter.update).toHaveBeenCalledWith({ percent: 51.2 });

updater.emit('update-downloaded', { version: '0.1.11' });
updater.emit('update-downloaded', { version: '0.1.11' });
await flushMicrotasks();
expect(presenter.close).toHaveBeenCalledTimes(1);
expect(dialog.showMessageBox).toHaveBeenCalledTimes(2);
```

Add separate cases for:

- updater `error` while download confirmation is pending, followed by an old response `0`; `downloadUpdate` remains uncalled.
- `downloadUpdate()` rejection plus updater `error`; close and error prompt occur once.
- progress outside `downloading`; presenter is untouched.
- manual check during download; `checkForUpdates` remains once and `presenter.focus()` is called without a message box.
- install prompt “稍后”; later manual check reports “更新已经下载” and does not recheck.
- `dispose()` closes the presenter and suppresses later dialogs.

- [ ] **Step 2: Run the controller test and verify RED**

Run: `npx vitest run tests/update-controller.test.ts`

Expected: FAIL on the new presenter and race assertions.

- [ ] **Step 3: Replace the coarse phase with explicit state**

Use:

```ts
type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'awaiting-download-confirmation'
  | 'downloading'
  | 'awaiting-install-confirmation'
  | 'downloaded-deferred'
  | 'installing';

type Operation = {
  id: number;
  manual: boolean;
  failureHandled: boolean;
  version?: string;
};
```

Add `progress?: UpdateProgressPresenter` to options and `dispose()` to `UpdateController`. Every dialog continuation captures `{ id, expectedPhase }` and returns without mutation unless both still match. Event handlers accept only valid phases. One `finishFailure(error, operationId)` owns logging, presenter cleanup, phase reset, and a phase-specific “检查更新失败” or “下载更新失败” prompt.

- [ ] **Step 4: Run controller tests and verify GREEN**

Run: `npx vitest run tests/update-controller.test.ts`

Expected: PASS, including existing ideal-flow tests.

- [ ] **Step 5: Commit**

Commit controller and tests as `fix(update): 收紧自动更新状态与竞态处理`.

### Task 4: Minimal preload and renderer

**Files:**
- Create: `preload/update-progress-preload.ts`
- Create: `renderer/update-progress.html`
- Create: `renderer/src/update-progress.ts`
- Create: `renderer/src/update-progress.css`
- Create: `renderer/src/update-progress-global.d.ts`
- Create: `tests/update-progress-preload.test.ts`
- Create: `tests/update-progress-renderer.test.ts`
- Modify: `electron.vite.config.ts`

- [ ] **Step 1: Write failing boundary tests**

The preload source test must assert it imports `UPDATE_PROGRESS_CHANNEL`, exposes only `updateProgress`, calls `ipcRenderer.on/removeListener`, and does not contain `sticky-notes:`. The renderer source test must assert it handles missing/invalid payloads without writing `NaN`, sets `<progress>.removeAttribute('value')` for indeterminate state, and sets `progress.value = snapshot.percent` for determinate state. The config test must expect `updateProgressPreload` and `updateProgress` inputs.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run tests/update-progress-preload.test.ts tests/update-progress-renderer.test.ts tests/electron-vite-config.test.ts`

Expected: FAIL because the files and build inputs do not exist.

- [ ] **Step 3: Implement the minimal bridge**

```ts
contextBridge.exposeInMainWorld('updateProgress', {
  onSnapshot: (listener: (snapshot: unknown) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, snapshot: unknown): void => listener(snapshot);
    ipcRenderer.on(UPDATE_PROGRESS_CHANNEL, wrapped);
    return () => ipcRenderer.removeListener(UPDATE_PROGRESS_CHANNEL, wrapped);
  }
});
```

The renderer contains only a title, status line, percentage label and native `<progress>`. It validates `state`, optional string `version`, and finite `percent` before rendering. No buttons or cancellation affordance are present.

- [ ] **Step 4: Add independent build inputs**

```ts
preload: {
  preload: resolve(__dirname, 'preload/preload.ts'),
  updateProgressPreload: resolve(__dirname, 'preload/update-progress-preload.ts')
},
renderer: {
  index: resolve(__dirname, 'renderer/index.html'),
  updateProgress: resolve(__dirname, 'renderer/update-progress.html')
}
```

- [ ] **Step 5: Run focused tests and build**

Run: `npx vitest run tests/update-progress-preload.test.ts tests/update-progress-renderer.test.ts tests/electron-vite-config.test.ts && npm run build`

Expected: all tests PASS and electron-vite emits both HTML/preload entries.

- [ ] **Step 6: Commit**

Commit as `feat(update): 增加独立下载进度页面`.

### Task 5: Electron window wiring and security

**Files:**
- Modify: `main/main.ts`
- Modify: `tests/update-wiring.test.ts`
- Create: `tests/update-progress-window-options.test.ts`

- [ ] **Step 1: Write failing wiring and option tests**

Export the pure function `createUpdateProgressWindowOptions(workArea)` from `main/update-progress-window.ts`. Assert dimensions stay inside the active work area and options include:

```ts
expect(options).toMatchObject({
  width: 360,
  height: 150,
  show: false,
  modal: false,
  closable: false,
  minimizable: true,
  maximizable: false,
  resizable: false,
  skipTaskbar: false,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  }
});
```

Wiring tests must assert Windows controller receives a presenter, uses the cursor display work area, denies navigation/window opening, loads `update-progress.html`, and calls `dispose()` during `before-quit`. Assert the macOS controller remains unchanged.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run tests/update-progress-window-options.test.ts tests/update-wiring.test.ts`

Expected: FAIL on missing options and wiring.

- [ ] **Step 3: Implement the real BrowserWindow adapter**

Use `screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea`, the app icon, `preload: join(__dirname, '../preload/updateProgressPreload.mjs')`, `closable: false`, and the security options above. Wrap `webContents.send`, `setProgressBar`, `show`, `focus`, `close`, and `destroy` in the manager port. Use `preventNoteWindowNavigation` plus `setWindowOpenHandler(() => ({ action: 'deny' }))`. In dev load `${ELECTRON_RENDERER_URL}/update-progress.html`; packaged mode loads `join(__dirname, '../renderer/update-progress.html')`.

- [ ] **Step 4: Wire controller shutdown**

Register a `before-quit` listener that calls `updateController.dispose()` before the existing persistence exit completes. Do not create dialogs or windows after dispose.

- [ ] **Step 5: Run focused tests and build**

Run: `npx vitest run tests/update-progress-window-options.test.ts tests/update-wiring.test.ts && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit as `feat(update): 接入 Windows 下载进度窗口`.

### Task 6: Windows tray-resident lifecycle

**Files:**
- Modify: `main/app-lifecycle.ts`
- Modify: `tests/app-lifecycle.test.ts`

- [ ] **Step 1: Change the test first**

```ts
it('keeps tray-supported desktop platforms alive after all windows close', () => {
  expect(shouldQuitWhenAllWindowsClosed('win32')).toBe(false);
  expect(shouldQuitWhenAllWindowsClosed('darwin')).toBe(false);
  expect(shouldQuitWhenAllWindowsClosed('linux')).toBe(true);
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `npx vitest run tests/app-lifecycle.test.ts`

Expected: FAIL because Windows currently returns `true`.

- [ ] **Step 3: Implement the documented lifecycle**

```ts
export function shouldQuitWhenAllWindowsClosed(platform: NodeJS.Platform): boolean {
  return platform === 'linux';
}
```

- [ ] **Step 4: Run lifecycle and update integration tests**

Run: `npx vitest run tests/app-lifecycle.test.ts tests/update-controller.test.ts tests/update-wiring.test.ts`

Expected: PASS; no path closes the app merely because the progress window completed.

- [ ] **Step 5: Commit**

Commit as `fix(lifecycle): 保持 Windows 托盘常驻`.

### Task 7: Documentation and full verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/architecture.md`
- Modify: `docs/releasing.md`

- [ ] **Step 1: Update the single sources of truth**

Add under `CHANGELOG.md` “未发布 / 新增” the non-blocking Windows download progress window, and under “修复” the Windows tray lifecycle/install-confirmation bug. In `docs/architecture.md`, summarize the presenter/window boundary and Windows tray persistence with a pointer to the design spec. In `docs/releasing.md`, add slow-download, all-notes-closed, disconnect, duplicate-check, multi-display/DPI, minimize/restore and local-data checks without copying the whole design.

- [ ] **Step 2: Run all required local verification**

Run:

```bash
npm test
npm run build
npm audit --omit=dev
git diff --check
```

Expected: tests and build PASS; audit has no production vulnerabilities; diff check is clean.

- [ ] **Step 3: Inspect built entries**

Run:

```bash
find out -maxdepth 3 -type f | sort | rg 'update-progress|updateProgressPreload|main\.js'
```

Expected: packaged renderer HTML/assets and the independent preload entry are present.

- [ ] **Step 4: Commit documentation and any final test-only adjustments**

Commit as `docs(update): 补充下载进度验证说明`.

### Task 8: Review gates and Windows handoff

**Files:**
- Review all changes from `origin/main...HEAD`.

- [ ] **Step 1: Main-agent local review**

Review the complete diff for correctness, especially error/load degradation, phase/operation consistency, mock-vs-real Electron behavior, tray active state, and duplicate exit/reset paths. Record concrete findings; fix issues with failing tests first.

- [ ] **Step 2: Re-run verification after any fix**

Run `npm test && npm run build && npm audit --omit=dev && git diff --check` after every substantive review fix.

- [ ] **Step 3: Opus independent review**

Dispatch a review-only subagent with the design spec, implementation plan, full diff, and test output. Require severity-ranked findings covering Electron lifecycle/security, updater event races, Windows behavior, and missing tests. The subagent must not edit files.

- [ ] **Step 4: Validate review feedback before applying it**

Use `superpowers:receiving-code-review`. Reproduce or reason through each finding; implement only validated fixes, starting with a failing test. Re-run the main-agent review on the new diff.

- [ ] **Step 5: Prepare, but do not claim, Windows verification**

Build with `npm run dist:win`, inspect the asar/runtime package, and directly launch the packaged app where the current host permits. Mark true Windows behavior as pending until the user runs the `docs/releasing.md` checklist on Windows. Do not publish updater metadata or claim Issue #1 closed before that evidence exists.

- [ ] **Step 6: Final handoff**

Report commits, automated verification, package inspection, review outcomes, remaining Windows-only checks, and the exact next authorized action. Do not push, create a release, upload `latest.yml`, or close Issue #1 unless the user explicitly requests it after review.
