import { applyJsonPatch, parseJsonPatch, type PatchFailure } from './jsonPatch';
import { deepEqual } from './deepEqual';
import { escapeSegment } from './pointer';
import { isPlainObject, type JsonValue } from './types';

/**
 * 补丁审计：把（可能被用户修改过的）JSON Patch 文本在基线的独立副本上
 * 按顺序逐操作回放，再与当前合并结果比对。基线与合并结果均不会被修改。
 */

/** 回放结果与合并结果的首个差异：JSON Pointer 及双方值（undefined 表示该侧不存在此节点） */
export interface AuditDiff {
  pointer: string;
  expected: JsonValue | undefined;
  actual: JsonValue | undefined;
}

export type PatchAuditResult =
  | { kind: 'pass' }
  | { kind: 'failure'; failure: PatchFailure }
  | { kind: 'mismatch'; diff: AuditDiff };

/**
 * 审计补丁文本：
 * - 补丁解析 / 结构校验失败，或任一操作应用失败：报告失败操作序号（从 1 开始，整体格式错误时为 null）与原因；
 * - 回放完成但与合并结果不同：报告首个差异的 JSON Pointer、期望值（合并结果侧）与实际值（回放侧）；
 * - 完全一致：通过。
 */
export function auditPatch(
  base: JsonValue,
  merged: JsonValue,
  patchText: string,
): PatchAuditResult {
  const parsed = parseJsonPatch(patchText);
  if (!parsed.ok) return { kind: 'failure', failure: parsed.failure };
  const applied = applyJsonPatch(base, parsed.ops);
  if (!applied.ok) return { kind: 'failure', failure: applied.failure };
  const diff = firstDiff(merged, applied.document);
  return diff ? { kind: 'mismatch', diff } : { kind: 'pass' };
}

/**
 * 按确定性顺序查找 expected 与 actual 的首个差异：
 * 对象按 expected 键序先比共有键、再查 actual 多出的键；数组按下标顺序。
 * 完全一致时返回 null。
 */
export function firstDiff(expected: JsonValue, actual: JsonValue, path = ''): AuditDiff | null {
  if (deepEqual(expected, actual)) return null;

  if (isPlainObject(expected) && isPlainObject(actual)) {
    for (const k of Object.keys(expected)) {
      const childPath = path + '/' + escapeSegment(k);
      if (!(k in actual)) return { pointer: childPath, expected: expected[k], actual: undefined };
      const d = firstDiff(expected[k], actual[k], childPath);
      if (d) return d;
    }
    for (const k of Object.keys(actual)) {
      if (!(k in expected)) {
        return { pointer: path + '/' + escapeSegment(k), expected: undefined, actual: actual[k] };
      }
    }
    return null;
  }

  if (Array.isArray(expected) && Array.isArray(actual)) {
    const min = Math.min(expected.length, actual.length);
    for (let i = 0; i < min; i++) {
      const d = firstDiff(expected[i], actual[i], `${path}/${i}`);
      if (d) return d;
    }
    // 长度不同：首个多余元素即首个差异
    if (expected.length > min) {
      return { pointer: `${path}/${min}`, expected: expected[min], actual: undefined };
    }
    return { pointer: `${path}/${min}`, expected: undefined, actual: actual[min] };
  }

  return { pointer: path, expected, actual };
}
