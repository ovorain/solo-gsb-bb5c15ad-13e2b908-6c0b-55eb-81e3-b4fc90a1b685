import { useState } from 'react';
import type { PatchOp } from '../merge/rfc6902';
import type { JsonValue } from '../merge/types';
import { auditPatch, type PatchAuditResult } from '../merge/patchAudit';

interface Props {
  base: JsonValue;
  merged: JsonValue;
  /** 自动生成的 RFC 6902 补丁（基线 → 合并结果），作为审计面板的初始内容 */
  patch: PatchOp[];
}

/** 差异一侧的值：JSON 文本，undefined 表示该侧不存在此节点 */
function formatSide(v: JsonValue | undefined): string {
  return v === undefined ? '（不存在）' : JSON.stringify(v, null, 2);
}

/**
 * 可编辑的补丁审计面板：加载自动生成的补丁，允许修改后在基线的独立副本上
 * 按序回放并与合并结果比对。审计只读取 base / merged，不会修改合并结果。
 */
export default function PatchAuditPanel({ base, merged, patch }: Props) {
  const autoText = JSON.stringify(patch, null, 2);
  const [text, setText] = useState(autoText);
  // 最近一次审计及其对应的补丁文本；编辑后文本不再匹配即视为过期
  const [audited, setAudited] = useState<{ text: string; result: PatchAuditResult } | null>(null);

  const dirty = text !== autoText;
  const stale = audited !== null && audited.text !== text;

  const runAudit = () => setAudited({ text, result: auditPatch(base, merged, text) });

  const reset = () => {
    setText(autoText);
    setAudited(null);
  };

  return (
    <div className="audit-panel">
      <div className="audit-head">
        <h3>补丁审计（可编辑）</h3>
        <span className="hint">
          在基线的独立副本上按序回放补丁并与合并结果比对；此处编辑不会修改合并结果
        </span>
      </div>
      <textarea
        className="audit-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      <div className="panel-actions">
        <button className="small primary" onClick={runAudit}>
          审计
        </button>
        <button className="small" onClick={reset} disabled={!dirty && audited === null}>
          重置为自动生成补丁
        </button>
        {dirty && <span className="audit-dirty">● 已修改，与自动生成补丁不同</span>}
      </div>
      {audited && (
        <div className={`audit-result ${audited.result.kind}`}>
          {stale && <div className="audit-stale">补丁已修改，以下为上一次审计的结果</div>}
          {audited.result.kind === 'pass' && (
            <div className="audit-line">✓ 审计通过：回放结果与合并结果一致</div>
          )}
          {audited.result.kind === 'failure' && (
            <div className="audit-line">
              ✗ 审计失败：
              {audited.result.failure.opIndex !== null
                ? `第 ${audited.result.failure.opIndex} 个操作应用失败`
                : '补丁格式错误'}
              —— {audited.result.failure.reason}
            </div>
          )}
          {audited.result.kind === 'mismatch' && (
            <>
              <div className="audit-line">
                ✗ 回放完成，但结果与合并结果不一致。首个差异：
                <code className="audit-pointer">
                  {audited.result.diff.pointer || '（根）'}
                </code>
              </div>
              <div className="audit-diff">
                <div className="audit-diff-side">
                  <h4>期望值（合并结果）</h4>
                  <pre>{formatSide(audited.result.diff.expected)}</pre>
                </div>
                <div className="audit-diff-side">
                  <h4>实际值（补丁回放）</h4>
                  <pre>{formatSide(audited.result.diff.actual)}</pre>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
