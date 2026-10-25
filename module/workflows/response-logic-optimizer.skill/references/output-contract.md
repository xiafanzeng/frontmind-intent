# Optimizer structured output contract

The v2 task schema requires exactly one string field: `payload`. Its value must be a strict JSON object serialized once. The server parses and validates this JSON against a Zod schema before accepting the result.

## Top-level structure

```json
{
  "kind": "judge-optimization",
  "summary": "string (1-3 sentences: what was improved and why)",
  "optimizedDraft": {
    "concern": "string (optimized 用户真实关心)",
    "conclusion": "string (optimized 核心结论与执行口径)",
    "facts": "string (optimized 企业材料与官方依据)",
    "boundaries": "string (optimized 回答边界与禁止表达)"
  },
  "changes": [
    {
      "field": "concern" | "conclusion" | "facts" | "boundaries",
      "summary": "string (what changed and why — which judge finding it resolves)",
      "evidence": [
        {
          "source": "draft" | "knowledge",
          "excerpt": "string (verbatim contiguous substring of the cited source)",
          "supports": "string (what this evidence supports)"
        }
      ]
    }
  ]
}
```

### Field rules

- `kind`: must be exactly `"judge-optimization"`.
- `summary`: a concise narrative of the optimization; no scores.
- `optimizedDraft`: ALL FOUR fields are required. A section you did not change must be copied verbatim from `currentDraft`; never leave it empty or abbreviated.
- `changes`: at least one entry. Each entry describes ONE key modification:
  - `field`: the section that was modified.
  - `summary`: the reason for the change, referencing the judge finding it addresses (e.g. "evidence_guidance 68：来源绑定格式不具体 → 为每条事实补充来源标记").
  - `evidence`: optional per change. `draft` excerpts MUST be contiguous substrings of the original `currentDraft` sections. `knowledge` excerpts MUST be contiguous substrings of the provided knowledge materials. When knowledge is unavailable, NEVER emit `knowledge` evidence.
- No additional top-level or nested fields. No scores, bands, aggregates or rule-engine references anywhere.

## Verification (server-side, strict)

- Unknown fields, missing sections or empty `changes` reject the output.
- Every `draft` excerpt is checked as a contiguous substring of the evaluated draft.
- Every `knowledge` excerpt is checked against the actual knowledge materials; any knowledge citation while knowledge is unavailable rejects the output.
- A mismatch rejects the whole optimization with a diagnostic error — the model cannot retry silently.
