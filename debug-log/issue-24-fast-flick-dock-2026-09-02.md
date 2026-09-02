# 快速甩边吸附失败

- 日期：2026-09-02
- 事项：[Issue #24](https://github.com/LawrenceChiu95/floating-sticky-notes/issues/24)
- 层：原生窗口 `getBounds` 滞后 + 松手瞬间判区闸门

## 现象

快速把收起横条甩向屏幕边缘时吸附不触发；慢拖到位正常。

## 证据

诊断日志 `dock_release_decision` / `dock_post_release_position`：

| 时刻 | 松手 bounds.x | 光标 x | side | +400ms bounds.x |
| --- | --- | --- | --- | --- |
| 2026-09-01 10:36:02 | 3926 | 4269 | null | 3990（下一拍才进区并吸附） |
| 2026-09-01 10:36:12 | 3445 | 4145 | null | fire 时已到 4049，吸上 |
| 2026-09-01 10:36:16 | 3827 | 4269 | null | fire 时 4231，吸上 |
| 2026-09-01 10:36:19 | 3600 | 4269 | null | +400ms 仍 3854，未吸 |
| 2026-09-02 04:10:45 | 3799 | 4031 | null | fire 时 3986，吸上 |

工作区右缘约 4222（`dock_in_glide` 目标 x）。416 宽横条要探出 8px 需 `x ≥ 3814`。甩边松手时窗口常还差几十到几百 px。

10:29 原始失败更硬：四次 `dock_button_release` 零 `settle_fire`（当时还没有无条件 arm）。

## 根因

1. `onDragQuiet(true)` 用松手瞬间 bounds 调 `resolveCollapsedDockSide`；不在区就不 arm。
2. `handleDockWindowMove` 对任何 move 撤 settle 表。松手后窗口追光标的迟到 move 把表拆掉，且不会再有 release 来武装。

## 修法

- 光标贴工作区边缘 ≤8px 视为同一吸附意图；落邻屏不吸。
- 物理松手无条件 arm；settle fire 用冲刷后 bounds + 松手瞬间光标裁决。
- helper 活着且按键已抬起时，迟到 move 不撤表。
