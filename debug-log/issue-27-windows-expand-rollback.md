# Windows 拖出不展开与连续缩回诊断

关联：[Issue #27](https://github.com/LawrenceChiu95/floating-sticky-notes/issues/27)。2026-09-08 用户提交日志和截图，授权诊断、修复计划、Nova Coding 实施。原件留本机，不公开截图、便签名称、完整日志或本机路径。

## 现场证据

最新会话：0.1.20，win32 / x64，OS 10.0.26200，2026-09-08 05:39:01.994 UTC 启动。

- 启动 05:39:03.166 / .295 UTC 两次 `main_uncaught_exception`：`Cannot access 'handleDockWindowMove' before initialization`。
- 10:13:02.201–23.421 UTC 共 8 次 `dock_expand`；后 7 次在 607–624ms 后紧接同一窗口的 `dock_peek_glide reveal:false`。
- 10:13:09.628 和 24.720 UTC 有 `dock_tuck_glide`，x 分别从 1768 / 1765 回到 1872。
- 截图显示书签头停在页面内部；静态图不能证明松手时刻和位移轨迹。

## 因果与证据边界

1. **确定的代码缺陷**：恢复 dock 分支在移动处理器及其闭包状态初始化前创建 tab 并 `setBounds`；Windows 同步 move 回调会访问 TDZ。日志直接证实这一异常实际发生。仅把箭头函数换成可提升函数不足以解决其闭包内其他未初始化状态。
2. **强时间关联，尚非直接证实**：展开 ready ACK 默认超时 600ms，与失败后缩回间隔高度一致。旧日志仅记录尝试，没有 ACK 结果与提交阶段，不能断言每次都 timeout，也不能据此确定 renderer 为何没回执。`backgroundThrottling:false` 已存在，不能当作新修复。
3. **可由代码推导的失败放大链**：展开准备失败回滚后仍处于 docked，finally 会进入 hover reconcile；离边落点没有被保护，程序滑行能与后续 move/settle 相互触发。需要运行回归确认失败后不再自动动窗。
4. **独立残余限制**：Windows 仍使用光标/静止启发式识别松手；松手后光标停在抓取点可延迟收尾。现场已有 settle 和 expand，不应把全部现象归因于未达阈值或未识别松手。

## 已授权工作包与验收

负责人 Nova Sol，selector `nova/codex-5.6-sol`；Lead 独立验收。先修初始化顺序、补展开事务诊断、阻断失败后的自动位移；有可验证证据才改 renderer ACK。保留原生拖动、72px 阈值、恒尺寸 tab 和隐藏主窗准备后交接，不引入 Windows helper、依赖或发布。

回归覆盖：恢复时同步 move；ACK 成功/超时/作废/迟到/再次尝试；展开失败保持落点；正常边缘悬停及带内钉回；关闭与过期异步回调。运行测试、构建、diff 检查。Windows 真机需复验左右贴边、冷启动恢复、拖出松手静止/移动光标、连续多次拖出、双屏共边。Mac 自动验证不替代 Windows 真机。

## 本轮实施与审查状态

Nova 首版增加初始化保护、展开阶段日志和失败落点保护；首版全套 482 项测试、构建、diff 检查通过。Lead 未接受为最终修复：隔离执行生产 rollback 函数确认旧 epoch 仍会 hide/send 并改变 hold；另发现 controller 已展开后 persist 失败不能一律隐藏主窗，以及 ACK listener 清理与行为测试缺口。

已中断首版收尾并向同一 Nova Sol 会话派发返工，首版不是正常全部完成/已验收。返工要求覆盖旧事务隔离、逻辑提交后保存失败、监听清理以及执行生产函数的行为回归。当前仍执行中，未打包、未 Windows 真机验收、未发布。

依赖未变：npm 10 audit 返回 10 项（8 high / 2 moderate），npm 11 audit 返回 9 项（7 high / 2 moderate），均非通过；不在本轮强制修复。

## 返工完成与 Lead 本地验收

已核验 Nova 第二轮完成事件：67 文件 / 491 项测试与构建通过。Lead 检查实际 diff，确认旧代际不再回滚新状态、已逻辑展开后的持久化失败保留主窗、成功 ACK 立即清理，失败观察有界。Lead 将原空操作的迟到 ACK 测试替换为真实消息源和生产 waiter 的联动，验证超时后旧 ACK 不会 show，新一次同窗口尝试可以成功且 listener/timer 清零；相关 36 项通过。另恢复原吸附交接顺序守卫，相关 32 项通过。

本地代码与自动验证通过，Windows 真机、产物启动与发布仍未完成；旧日志未记 ACK 结果，具体准备失败原因尚未确证。当前无运行中 worker，也未启用定时唤醒。

## 0.1.21 发布前独立审查

独立Nova审查发现旧epoch作废后未回renderer终态，会让重新抓取后的下一次展开无previousDock并超时。已补齐docked旧id rollback/expanded旧id committed，native不hide/setBounds；销毁捕获tab时不清新tab指针，旧committed不改新hold。App真实回调回归通过；68文件/492项测试通过。独立复审确认原finding已解决，无新实质问题。候选安装包已重建，Mac隔离启动、签名与DMG校验通过，Windows真机仍待验证，未发布。
