// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import PatchAuditPanel from './PatchAuditPanel';
import { diff } from '../merge/rfc6902';
import type { JsonValue } from '../merge/types';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function makeRenderer(container: HTMLElement) {
  const root = createRoot(container);
  return (node: ReactElement) => act(() => root.render(node));
}

const h = (container: HTMLElement, sel: string) => container.querySelector(sel);
const all = (container: HTMLElement, sel: string) => [...container.querySelectorAll(sel)];
const btnByText = (container: HTMLElement, text: string) =>
  all(container, 'button').find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

/** React 受控组件需要用原生 setter 赋值后再派发 input 事件 */
function typeInto(container: HTMLElement, v: string) {
  const ta = h(container, '.audit-input') as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  setter.call(ta, v);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

const BASE: JsonValue = { version: '1.2.0', features: { cache: false } };
const MERGED: JsonValue = { version: '1.3.0', features: { cache: true } };
const PATCH = diff(BASE, MERGED);
const AUTO_TEXT = JSON.stringify(PATCH, null, 2);

function setup() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const render = makeRenderer(container);
  render(<PatchAuditPanel base={BASE} merged={MERGED} patch={PATCH} />);
  return container;
}

describe('PatchAuditPanel', () => {
  it('加载自动生成的补丁；直接审计通过', () => {
    const container = setup();
    const ta = h(container, '.audit-input') as HTMLTextAreaElement;
    expect(ta.value).toBe(AUTO_TEXT);

    act(() => btnByText(container, '审计')!.click());
    expect(h(container, '.audit-result.pass')?.textContent).toContain('审计通过');
  });

  it('回放结果与合并结果不同：显示首个差异指针、期望值与实际值', () => {
    const container = setup();
    act(() =>
      typeInto(
        container,
        JSON.stringify([
          { op: 'replace', path: '/version', value: '9.9.9' },
          { op: 'replace', path: '/features/cache', value: true },
        ]),
      ),
    );
    act(() => btnByText(container, '审计')!.click());

    const result = h(container, '.audit-result.mismatch')!;
    expect(result.textContent).toContain('不一致');
    expect(h(container, '.audit-pointer')?.textContent).toBe('/version');
    const sides = all(container, '.audit-diff-side');
    expect(sides[0].textContent).toContain('期望值');
    expect(sides[0].textContent).toContain('1.3.0');
    expect(sides[1].textContent).toContain('实际值');
    expect(sides[1].textContent).toContain('9.9.9');
  });

  it('应用失败：显示从 1 开始的操作序号与原因；整体格式错误时无序号', () => {
    const container = setup();
    act(() =>
      typeInto(
        container,
        JSON.stringify([
          { op: 'replace', path: '/version', value: '1.3.0' },
          { op: 'remove', path: '/nope' },
        ]),
      ),
    );
    act(() => btnByText(container, '审计')!.click());
    const failure = h(container, '.audit-result.failure')!;
    expect(failure.textContent).toContain('第 2 个操作应用失败');
    expect(failure.textContent).toContain('路径不存在');

    act(() => typeInto(container, '{bad'));
    act(() => btnByText(container, '审计')!.click());
    expect(h(container, '.audit-result.failure')?.textContent).toContain('JSON 解析失败');
  });

  it('重置恢复自动生成补丁并清空审计结果', () => {
    const container = setup();
    act(() => typeInto(container, '[]'));
    expect(h(container, '.audit-dirty')).not.toBeNull();
    act(() => btnByText(container, '审计')!.click());
    expect(h(container, '.audit-result.mismatch')).not.toBeNull();

    act(() => btnByText(container, '重置为自动生成补丁')!.click());
    expect((h(container, '.audit-input') as HTMLTextAreaElement).value).toBe(AUTO_TEXT);
    expect(h(container, '.audit-result')).toBeNull();
    expect(h(container, '.audit-dirty')).toBeNull();

    // 重置后再次审计：通过
    act(() => btnByText(container, '审计')!.click());
    expect(h(container, '.audit-result.pass')).not.toBeNull();
  });

  it('审计后再次编辑：旧结果标记为过期', () => {
    const container = setup();
    act(() => btnByText(container, '审计')!.click());
    expect(h(container, '.audit-result.pass')).not.toBeNull();
    expect(h(container, '.audit-stale')).toBeNull();

    act(() => typeInto(container, AUTO_TEXT + '\n'));
    expect(h(container, '.audit-stale')?.textContent).toContain('上一次审计');
  });

  it('审计编辑不修改合并结果与基线', () => {
    const base: JsonValue = JSON.parse(JSON.stringify(BASE));
    const merged: JsonValue = JSON.parse(JSON.stringify(MERGED));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const render = makeRenderer(container);
    render(<PatchAuditPanel base={base} merged={merged} patch={PATCH} />);

    act(() => typeInto(container, '[{"op":"add","path":"/x","value":1}]'));
    act(() => btnByText(container, '审计')!.click());
    expect(h(container, '.audit-result.mismatch')).not.toBeNull();

    expect(base).toEqual(BASE);
    expect(merged).toEqual(MERGED);
  });
});
