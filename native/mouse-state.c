// 鼠标左键物理状态监视器（macOS）：每 8ms 查询一次 WindowServer 的按键状态，
// 状态翻转时向 stdout 吐一行 "down" / "up"。主进程借此获得确定性的「松手」
// 信号——macOS 原生拖动没有结束事件，而轮询窗口 bounds/光标在原理上区分不了
// 「按住不动」和「松手不动」。
// 只读状态（CGEventSourceButtonState），不是事件监听（CGEventTap），不需要
// 辅助功能 / 输入监控权限。
// 构建：node scripts/build-mouse-state.cjs（产物 bin/mouse-state-darwin-arm64）
#include <CoreGraphics/CoreGraphics.h>
#include <stdio.h>
#include <unistd.h>

int main(void) {
  int last = -1;
  for (;;) {
    // 父进程死了（崩溃/kill 漏送）就变孤儿：闲置时收不到 SIGPIPE（只在翻转时
    // 才写 stdout），靠 ppid 变 1 自查，8ms 内退出，不留空转僵尸。
    if (getppid() == 1) {
      return 0;
    }
    const int down = CGEventSourceButtonState(
                       kCGEventSourceStateCombinedSessionState, kCGMouseButtonLeft)
                       ? 1
                       : 0;
    if (down != last) {
      fputs(down ? "down\n" : "up\n", stdout);
      fflush(stdout);
      last = down;
    }
    usleep(8000);
  }
  return 0;
}
