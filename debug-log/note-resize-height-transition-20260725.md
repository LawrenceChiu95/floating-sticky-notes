# 手动缩放窗口时纸面高度滞后 — 诊断证据（#11 回归）

> 日期：2026-07-25 ｜ 修复提交：`73e86b1` ｜ 守卫测试：`tests/note-shell-height-transition.test.ts`

## 用户现象

- 第一手报告：「从上面往上拖，下面会自动变长，以前不是这样。」正式版 0.1.16 无此问题。
- 逐句对齐后的真实现象：用户在顶边做的是**主动的顶边缩放**（往上拉，期望便签向上展开）。窗口原生行为始终正确（底边锚定、顶边跟手）；真正的问题是**纸面内容没贴住窗口**——底部「先收缩一下，然后再回到原位」。

## 误诊路径（全部洗清，按排除顺序）

1. macOS 26 边缘缩放区变大 → 用户 A/B：正式版同机正常移动，排除 OS。
2. 收起循环 `setResizable` 往返 / height-only `setBounds`（Electron #21034 型）→ 用户 A/B：从未收起过的新建便签同样复现，排除原生状态循环。
3. Electron 版本差异 → v0.1.16 lockfile = HEAD lockfile = node_modules = 正式版 bundle 的 Electron Framework = 41.7.1，排除。
4. 稳态 CSS/DOM（will-change、transform 后代、no-drag 洞）→ 中和注入 + 最小 drag 探针（内容区红色块可正常拖动）+ 几何采样含大幅向上纯移动（dy=-148/-136），region 链路本身正常。
5. dev 模式 / CDP 调试挂连 → 与最终根因无关。

共同教训：前四轮都在测**原生窗口几何**（10Hz `screenX/Y/innerWidth/Height`），数据一直"正常"，因为出错的层级是**渲染内容**而非窗口。

## 决定性实验

方法：CDP 60Hz 同步采样 `innerHeight`（窗口）与 `.note-shell.getBoundingClientRect().height`（纸面），同时用 AppleScript 对窗口做底边锚定的拉高（模拟顶边缩放，y-100/h+100）。脚本：`/tmp/fsn-cdp/resize-lag.mjs`（原始采样为临时文件，未入库）。

修复前（窗口 140→240，底边锚定 682）：

| t(ms) | 窗口高 | 纸面高 | 间隙 |
| --- | --- | --- | --- |
| 1066 | 240 | 140.0 | 100.0 |
| 1099 | 240 | 162.6 | 77.4 |

窗口瞬时到位，纸面用约 240ms 以 `cubic-bezier(0.33,0.75,0.35,1)` 追赶——底部透明间隙先出现再闭合，即用户看到的"先缩一下再弹回"。

注入关闭高度过渡后复测、以及修复落地后活窗复测（340→440）：全程逐帧间隙 0.0。

## 根因

#11 为收起动画在 `.note-shell` **基础态**加了 `transition: height 240ms` 与 `will-change: height`。`100vh` 是视口单位，任何边/角原生缩放都让它跳变，纸面高度因此对每次窗口缩放都做 240ms 补间，而不是逐帧贴住。v0.1.16 无此过渡。

## 修复

高度过渡与 `will-change` 移到 `.note-shell--collapse-transitioning`（收起/展开路径在翻转 collapsed class 前已持有该 class，动画时序不变）；基础态只保留 `border-radius` 过渡。`prefers-reduced-motion` 媒体查询仍然覆盖同一元素，无需另列 modifier。

## 验证链

- 自动验证：375 项测试、build、`git diff --check` 全过（含更新的 `collapse-wiring` 旧断言与新增守卫）。
- 活窗验证：dev 三张便签全部 reload 后 computed `transition: border-radius 0.2s`，60Hz 采样间隙 0.0。
- 用户手验（2026-07-25）：顶边上拉底部静止；收起/展开动画与之前一致。
- 协同 worker 只读复核：GO，零阻塞；非阻塞建议：守卫正则按 `transition-property`/`will-change` token 语义加固（未做，记 HANDOFF 遗留）。

## 教训

运动/动画类异常先确认用户预期的行为模型与出错层级（原生窗口几何 vs 渲染内容），再选采样手段；窗口几何正确不代表内容贴住窗口。
