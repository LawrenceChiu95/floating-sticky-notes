import { describe, expect, it } from 'vitest';
import {
  classifyUpdateNetworkError,
  describeUpdateFailure
} from '../shared/update-error';

describe('update failure copy', () => {
  it('classifies proxy and tunnel errors separately from timeouts', () => {
    expect(
      classifyUpdateNetworkError(new Error('net::ERR_PROXY_CONNECTION_FAILED'))
    ).toBe('proxy');
    expect(
      classifyUpdateNetworkError({ message: 'net::ERR_TUNNEL_CONNECTION_FAILED' })
    ).toBe('proxy');
    expect(
      classifyUpdateNetworkError({ code: 'ERR_CONNECTION_TIMED_OUT' })
    ).toBe('timeout');
    expect(
      classifyUpdateNetworkError(new Error('net::ERR_CONNECTION_RESET'))
    ).toBe('timeout');
    expect(classifyUpdateNetworkError(new Error('offline'))).toBe('generic');
  });

  it('keeps install copy independent of network errors', () => {
    expect(
      describeUpdateFailure('install', new Error('net::ERR_PROXY_CONNECTION_FAILED'))
    ).toEqual({
      title: '安装更新失败',
      content: '便签暂时无法退出安装，请稍后再试。'
    });
  });

  it('explains proxy, timeout, and generic check failures', () => {
    expect(
      describeUpdateFailure('check', new Error('net::ERR_PROXY_CONNECTION_FAILED'))
    ).toEqual({
      title: '检查更新失败',
      content:
        '当前网络代理或 VPN 连不上更新服务器。请关闭失效的代理/VPN，或换一个网络后再试。'
    });
    expect(
      describeUpdateFailure('download', { message: 'net::ERR_CONNECTION_TIMED_OUT' })
    ).toEqual({
      title: '下载更新失败',
      content: '连接更新服务器超时或被中断，请稍后重试。'
    });
    expect(describeUpdateFailure('check', new Error('offline'))).toEqual({
      title: '检查更新失败',
      content: '暂时无法完成更新，请稍后重试；如果仍失败，请检查网络。'
    });
    expect(
      describeUpdateFailure('check', new Error('offline'), {
        includeDownloadDirectory: true
      })
    ).toEqual({
      title: '检查更新失败',
      content: '暂时无法完成更新，请稍后重试；如果仍失败，请检查网络和下载目录权限。'
    });
  });
});
