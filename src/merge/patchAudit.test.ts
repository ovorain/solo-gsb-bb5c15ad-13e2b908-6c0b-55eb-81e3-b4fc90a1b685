import { describe, expect, it } from 'vitest';
import { diff } from './rfc6902';
import { auditPatch, firstDiff } from './patchAudit';
import type { JsonValue } from './types';

const BASE: JsonValue = {
  app: 'demo-service',
  version: '1.2.0',
  features: { auth: true, cache: false },
  tags: ['web', 'api'],
};

const MERGED: JsonValue = {
  app: 'demo-service',
  version: '1.3.0',
  features: { auth: true, cache: true, logging: { level: 'info' } },
  tags: ['web', 'api', 'audit'],
};

describe('auditPatch', () => {
  it('自动生成的补丁回放后与合并结果一致：通过', () => {
    const patchText = JSON.stringify(diff(BASE, MERGED), null, 2);
    expect(auditPatch(BASE, MERGED, patchText)).toEqual({ kind: 'pass' });
  });

  it('空补丁作用于与基线相同的合并结果：通过', () => {
    expect(auditPatch(BASE, BASE, '[]')).toEqual({ kind: 'pass' });
  });

  it('应用失败：报告从 1 开始的操作序号与原因', () => {
    const r = auditPatch(
      BASE,
      MERGED,
      `[
        { "op": "replace", "path": "/version", "value": "1.3.0" },
        { "op": "remove", "path": "/features/nope" }
      ]`,
    );
    expect(r.kind).toBe('failure');
    if (r.kind === 'failure') {
      expect(r.failure.opIndex).toBe(2);
      expect(r.failure.reason).toContain('路径不存在');
    }
  });

  it('补丁整体格式错误：无操作序号', () => {
    const r = auditPatch(BASE, MERGED, '{bad');
    expect(r.kind).toBe('failure');
    if (r.kind === 'failure') {
      expect(r.failure.opIndex).toBeNull();
      expect(r.failure.reason).toContain('JSON 解析失败');
    }
  });

  it('结构非法的操作：标明操作序号（从 1 开始）', () => {
    const r = auditPatch(BASE, MERGED, '[{"op":"delete","path":"/version"}]');
    expect(r.kind).toBe('failure');
    if (r.kind === 'failure') expect(r.failure.opIndex).toBe(1);
  });

  it('回放完成但与合并结果不同：报告首个差异的指针、期望值与实际值', () => {
    // 补丁把 version 改成 9.9.9，而合并结果是 1.3.0
    const r = auditPatch(
      BASE,
      MERGED,
      JSON.stringify([
        { op: 'replace', path: '/version', value: '9.9.9' },
        { op: 'replace', path: '/features/cache', value: true },
        { op: 'add', path: '/features/logging', value: { level: 'info' } },
        { op: 'add', path: '/tags/2', value: 'audit' },
      ]),
    );
    expect(r.kind).toBe('mismatch');
    if (r.kind === 'mismatch') {
      expect(r.diff.pointer).toBe('/version');
      expect(r.diff.expected).toBe('1.3.0');
      expect(r.diff.actual).toBe('9.9.9');
    }
  });

  it('差异为缺失的键：实际值为 undefined', () => {
    // 补丁只改 version，缺少 logging 新增
    const r = auditPatch(
      BASE,
      MERGED,
      JSON.stringify([
        { op: 'replace', path: '/version', value: '1.3.0' },
        { op: 'replace', path: '/features/cache', value: true },
        { op: 'add', path: '/tags/2', value: 'audit' },
      ]),
    );
    expect(r.kind).toBe('mismatch');
    if (r.kind === 'mismatch') {
      expect(r.diff.pointer).toBe('/features/logging');
      expect(r.diff.expected).toEqual({ level: 'info' });
      expect(r.diff.actual).toBeUndefined();
    }
  });

  it('审计不修改基线与合并结果', () => {
    const base = JSON.parse(JSON.stringify(BASE)) as JsonValue;
    const merged = JSON.parse(JSON.stringify(MERGED)) as JsonValue;
    const patchText = JSON.stringify(diff(BASE, MERGED), null, 2);
    expect(auditPatch(base, merged, patchText).kind).toBe('pass');
    expect(base).toEqual(BASE);
    expect(merged).toEqual(MERGED);
    // 失败与不一致路径同样不污染输入
    auditPatch(base, merged, '[{"op":"remove","path":"/nope"}]');
    auditPatch(base, merged, '[]');
    expect(base).toEqual(BASE);
    expect(merged).toEqual(MERGED);
  });
});

describe('firstDiff', () => {
  it('完全一致返回 null', () => {
    expect(firstDiff({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBeNull();
  });

  it('标量差异：根路径', () => {
    expect(firstDiff(1, 2)).toEqual({ pointer: '', expected: 1, actual: 2 });
  });

  it('类型不同：整体作为差异值', () => {
    expect(firstDiff({ a: 1 }, [1])).toEqual({ pointer: '', expected: { a: 1 }, actual: [1] });
  });

  it('嵌套对象：按 expected 键序找到首个差异', () => {
    const d = firstDiff({ a: { b: 1, c: 2 } }, { a: { b: 9, c: 2 } });
    expect(d).toEqual({ pointer: '/a/b', expected: 1, actual: 9 });
  });

  it('actual 缺少键：actual 为 undefined', () => {
    const d = firstDiff({ a: 1, b: 2 }, { a: 1 });
    expect(d).toEqual({ pointer: '/b', expected: 2, actual: undefined });
  });

  it('actual 多出键：expected 为 undefined', () => {
    const d = firstDiff({ a: 1 }, { a: 1, b: 2 });
    expect(d).toEqual({ pointer: '/b', expected: undefined, actual: 2 });
  });

  it('数组长度不同：首个多余元素为差异', () => {
    expect(firstDiff([1, 2, 3], [1, 2])).toEqual({ pointer: '/2', expected: 3, actual: undefined });
    expect(firstDiff([1], [1, 2])).toEqual({ pointer: '/1', expected: undefined, actual: 2 });
  });

  it('键名含 RFC 6901 需转义字符时指针正确转义', () => {
    const d = firstDiff({ 'a/b~c': 1 }, { 'a/b~c': 2 });
    expect(d?.pointer).toBe('/a~1b~0c');
  });
});
