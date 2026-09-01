# Edge Dock Geometry Transaction Implementation Plan

> **For agentic workers:** Implement the plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a collapsed note become a 96×32 edge bookmark without any visible native-window stretch, end-frame flash, or black outline, while preserving native `-webkit-app-region: drag` behavior.

**Architecture:** The main process is the single owner of native geometry and performs exactly two writes: source/target union, then final target. The renderer owns the visible motion on one persistent overlay surface and acknowledges source paint, animation completion, and target paint. The controller commits synchronously after the target is painted; disk persistence follows through the existing serialized bounds channel and is not part of the visual transaction.

**Tech Stack:** Electron `BrowserWindow`, React 19, TypeScript, WAAPI, Vitest, electron-vite.

---

The approved product and interaction design remains in [`docs/design/edge-dock.md`](../../design/edge-dock.md). This plan records implementation order and evidence only; it does not create a second design truth.

### Task 1: Lock the cross-process transaction contract in tests

**Files:**

- Modify: `tests/collapse-wiring.test.ts`
- Modify: `tests/note-window-collapse.test.ts`
- Modify: `tests/notes-manager.test.ts`
- Modify: `tests/window-options.test.ts`

- [x] **Step 1: Assert that source paint precedes the union geometry write**

```ts
const readyAwaitIndex = mainSource.indexOf('const readyResult = await readyPromise;');
const unionBoundsIndex = mainSource.indexOf('noteWindow.setBounds(union, false);');
expect(readyAwaitIndex).toBeGreaterThan(-1);
expect(readyAwaitIndex).toBeLessThan(unionBoundsIndex);
expect(preloadSource).toContain(
  "ipcRenderer.send('sticky-notes:dock-shrink-ready', transitionId)"
);
```

- [x] **Step 2: Assert that the legal 300ms shrink path has its own timeout budget**

```ts
expect(mainSource).toContain('const NOTE_DOCK_SHRINK_ACK_TIMEOUT_MS = 1_200;');
expect(mainSource).toMatch(
  /'sticky-notes:dock-shrink-finished',[\s\S]*?transitionId,[\s\S]*?epoch,[\s\S]*?NOTE_DOCK_SHRINK_ACK_TIMEOUT_MS/
);
```

- [x] **Step 3: Assert that visual commit precedes logical commit and disk persistence**

```ts
const targetCropIndex = mainSource.indexOf('noteWindow.setBounds(target, false);');
const visualAckIndex = mainSource.indexOf('const visualCommitResult = await visualCommitPromise;');
const controllerCommitIndex = mainSource.indexOf('collapseController.commitDocked({');
const persistIndex = mainSource.indexOf('saveBounds.schedule(undefined);', controllerCommitIndex);
expect(targetCropIndex).toBeLessThan(visualAckIndex);
expect(visualAckIndex).toBeLessThan(controllerCommitIndex);
expect(controllerCommitIndex).toBeLessThan(persistIndex);
```

- [x] **Step 4: Assert that native shadow configuration is immutable**

```ts
expect(createNoteWindowOptions(note).hasShadow).toBe(false);
expect(mainSource).not.toContain('setHasShadow(');
expect(styles).toMatch(
  /\.dock-shrink-stub\s*{[^}]*border:\s*none;[^}]*box-shadow:\s*none;/s
);
```

- [x] **Step 5: Run the focused regression tests**

```bash
npx vitest run \
  tests/collapse-wiring.test.ts \
  tests/note-window-collapse.test.ts \
  tests/notes-manager.test.ts \
  tests/window-options.test.ts
```

Expected: exit code 0; no failed tests.

### Task 2: Make the main process own one cancellable geometry transaction

**Files:**

- Modify: `main/main.ts`
- Modify: `main/note-window-collapse.ts`
- Modify: `main/notes-manager.ts`

- [x] **Step 1: Give every dock attempt a monotonic ID and epoch**

```ts
let transitionEpoch = 0;
let dockTransitionSequence = 0;

type DockTransitionContext = {
  transitionId: number;
  epoch: number;
  side: DockSide;
  sourceBounds: Required<NoteBounds>;
  stripOffset: { x: number; y: number };
  unionApplied: boolean;
};
```

- [x] **Step 2: Execute the only allowed success sequence**

```text
renderer source overlay painted
  -> dock-shrink-ready
  -> BrowserWindow.setBounds(union, false)
  -> renderer 300ms inverse reveal
  -> dock-shrink-finished
  -> BrowserWindow.setBounds(target, false)
  -> renderer target geometry + paint
  -> dock-visual-committed
  -> collapseController.commitDocked(...)
  -> renderer committed:true
  -> schedule serialized persistence
```

- [x] **Step 3: Fail closed on timeout, destruction, epoch change, or exception**

The abort path must cancel the renderer surface and either restore the source strip immediately or record `pendingStripRestore` while a real native drag is active. It must not commit dock state or persist union/target transition frames.

- [x] **Step 4: Keep controller commit synchronous and side-effect free**

```ts
commitDocked({ side, bounds: target, anchor: sourceBounds });
```

`commitDocked` records the already-painted geometry and must not issue another `setBounds` or wait for storage.

- [x] **Step 5: Reuse the existing debounced/serialized bounds persistence path**

```ts
suppressBoundsPersistence = false;
saveBounds.schedule(undefined);
```

This path persists both the expanded anchor and `dock`; there is no second dock-specific write/rollback API that can arrive late and undo a newer transaction.

### Task 3: Keep one renderer surface alive across both native geometry writes

**Files:**

- Modify: `preload/preload.ts`
- Modify: `renderer/src/global.d.ts`
- Modify: `renderer/src/App.tsx`
- Modify: `renderer/src/styles.css`

- [x] **Step 1: Expose the three typed acknowledgements**

```ts
dockShrinkReady(transitionId: number): void;
dockShrinkFinished(transitionId: number): void;
dockVisualCommitted(transitionId: number): void;
```

- [x] **Step 2: Mount and explicitly pin the source overlay before ready**

```ts
flushSync(() => setDockShrink({ side, phase: 'animating', ...payload }));
pinDockShrinkSourceToViewportEdge(sourceScreenPoint, payload);
await waitForNextPaint();
window.stickyNotes.dockShrinkReady(transitionId);
```

The overlay width and height are explicit pixels; `100vw`/`100vh` must never define the source paper during union expansion.

- [x] **Step 3: Wait for both viewport size and global origin**

```ts
await waitForWindowGeometry(
  payload.unionWidth,
  payload.unionHeight,
  unionScreenPoint,
  repinSourceOverlay
);
```

This covers macOS applying move and resize in separate compositor frames.

- [x] **Step 4: Animate the same overlay and keep it through final crop**

```ts
stub.animate(
  [sourceFrame, targetFrame],
  { duration: 300, easing: 'cubic-bezier(0.33, 0.75, 0.35, 1)', fill: 'forwards' }
);
```

No key swap or separate landed surface is allowed. After the target geometry and one paint are confirmed, send `dockVisualCommitted`; only the later `committed:true` message releases the transition object.

- [x] **Step 5: Preserve native dragging**

The stable and aborted surface becomes interactive and contains the existing `-webkit-app-region: drag` pill. The renderer must not send pointer-move IPC or move the native window.

### Task 4: Remove the black native outline deterministically

**Files:**

- Modify: `main/window-options.ts`
- Modify: `renderer/src/styles.css`
- Test: `tests/window-options.test.ts`
- Test: `tests/collapse-wiring.test.ts`

- [x] **Step 1: Disable native shadow once, at window creation**

```ts
hasShadow: false
```

- [x] **Step 2: Remove dock-only border and shadow styling**

```css
.note-shell--docked,
.dock-shrink-stub {
  border: none;
  box-shadow: none;
}
```

- [x] **Step 3: Forbid runtime compositor toggles**

```ts
expect(mainSource).not.toContain('setHasShadow(');
```

Ordinary notes retain their existing CSS border/inset shading, but no longer receive an OS-level outer shadow. That steady-state appearance is a target-environment acceptance item, not something an automated test can approve.

### Task 5: Remove stale protocol descriptions and generated debris

**Files:**

- Modify: `docs/design/edge-dock.md`
- Modify: `HANDOFF.md`
- Modify: comments in `main/notes-manager.ts`, `main/note-window-collapse.ts`, `preload/preload.ts`, `renderer/src/App.tsx`
- Remove from workspace: untracked root artifact `index-CJbGlY_l.css`

- [x] **Step 1: Replace “persist, then commit” with “paint, commit, then persist” everywhere**

- [x] **Step 2: Replace obsolete “dock-in glide” wording with the two-write inverse-reveal protocol**

- [x] **Step 3: Keep the four native-shadow comparison screenshots as Issue #24 evidence**

- [x] **Step 4: Move the unrelated Tailwind output to the macOS Trash**

### Task 6: Run fresh repository verification

**Files:**

- Verify: `out/main/**`
- Verify: `out/preload/**`
- Verify: `out/renderer/**`

- [x] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: exit code 0; no failed test files or tests.

- [x] **Step 2: Run TypeScript and production build checks**

```bash
npx tsc --noEmit
npm run build
git diff --check
```

Expected: every command exits 0.

- [x] **Step 3: Record audit truthfully**

```bash
npm audit
npx --yes npm@11 audit
```

Existing advisories tracked by Issue #23 may remain; record exact counts and do not describe audit as green.

- [x] **Step 4: Inspect the produced preload topology**

Verify that `out/preload/preload.cjs` contains all three dock acknowledgements, all four preloads are independent `.cjs` files, the three sandbox preloads have no shared chunk, and the main bundle contains no preload `.mjs` path.

### Task 7: Restart only the isolated development app and run target acceptance

**Files:**

- Update after evidence: `HANDOFF.md`
- Update after evidence: [Issue #24](https://github.com/LawrenceChiu95/floating-sticky-notes/issues/24)

- [x] **Step 1: Resolve current process identities before stopping anything**

Confirm the command line and start time for electron-vite/Electron development processes. Do not stop `/Applications/悬浮便签.app` or any process using the production userData directory.

- [x] **Step 2: Restart the development instance in the background**

```bash
npm run dev
```

Use background execution and record the new development main-process PID/start time.

- [ ] **Step 3: Validate with a real mouse on macOS**

Check left and right docking, source-to-bookmark motion, final-frame stability, immediate re-grab during the 300ms transition, pointer-inside/pointer-away landing, hover reveal/hide, top/bottom-edge grabbing, drag-out expansion, neighbor-display expansion, removal of the black outline, and ordinary-note appearance without native shadow.

- [ ] **Step 4: Only after target acceptance, update the Issue with the correct GitHub identity**

```bash
gh api user --jq .login
```

The login must be `LawrenceChiu95`. Do not duplicate or extend the stale comments posted from `Yuanxia-Qiuyiming`; add one accurate status comment after real-mouse evidence exists.
