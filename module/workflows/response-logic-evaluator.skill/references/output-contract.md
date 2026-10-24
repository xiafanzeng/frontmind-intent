# Judge structured output contract

The v2 task schema requires exactly one string field: `payload`. Its value must be a strict JSON object serialized once. The server parses and validates this JSON against a Zod schema before accepting the result.

## Top-level structure

```json
{
  "kind": "judge-evaluation",
  "dimensions": {
    "relevance": { ... },
    "completeness": { ... },
    "actionability": { ... },
    "boundaryRisk": { ... }
  },
  "overallAssessment": "string"
}
```

`overallAssessment` is a 1–3 sentence narrative summary of the draft's semantic quality. It must NOT contain any numeric score, ranking, or aggregate rating.

## Common finding structure (used inside every dimension)

```json
{
  "severity": "info" | "improve" | "risk",
  "evidence": "string (must be a contiguous substring of the cited source, or empty)",
  "evidenceSource": "draft" | "knowledge" | "inference",
  "evidenceConfidence": "supported" | "partial" | "unverifiable",
  "reason": "string",
  "suggestion": "string"
}
```

### Field rules

- `severity`: `info` = observation, `improve` = actionable weakness, `risk` = potential harm or compliance issue.
- `evidence`: the verbatim excerpt. When `evidenceSource` is `"draft"`, this MUST be a contiguous substring of the corresponding draft field. When `evidenceSource` is `"knowledge"`, this MUST quote content from the provided knowledge materials. When `evidenceSource` is `"inference"`, this may be empty or a brief paraphrase.
- `evidenceConfidence`: `supported` = excerpt directly supports the finding; `partial` = excerpt partially supports or is indirect; `unverifiable` = no available material can confirm or deny this finding.
- `reason`: why this finding matters for the dimension being evaluated.
- `suggestion`: a specific, actionable improvement step. Avoid vague directives like "加强" or "完善".

## Dimension: relevance

```json
{
  "score": 0-100 (integer),
  "band": "direct" | "mostly_relevant" | "partially_responsive" | "background_dominant" | "off_topic",
  "findings": [ ...finding objects... ]
}
```

Band mapping:
- `direct` (90–100): First sentence directly answers the question's core decision; all user concerns addressed.
- `mostly_relevant` (75–89): Overall on-topic; some concerns addressed indirectly or superficially.
- `partially_responsive` (60–74): Partially addresses the question; key decision uncertainty unresolved.
- `background_dominant` (40–59): Mostly background information; core question not clearly answered.
- `off_topic` (0–39): Clearly off-topic or essentially unresponsive.

## Dimension: completeness

```json
{
  "score": 0-100 (integer),
  "coverage": [
    {
      "field": "concern" | "conclusion" | "facts" | "boundaries",
      "status": "covered" | "partial" | "missing",
      "findings": [ ...finding objects... ]
    }
  ],
  "findings": [ ...dimension-level finding objects... ]
}
```

Coverage items (exactly 4, in order):
1. `concern` (用户真实关心)
2. `conclusion` (核心结论/执行口径)
3. `facts` (企业材料/官方依据)
4. `boundaries` (回答边界/禁止表达)

Each item independently judged as `covered`, `partial`, or `missing`. The server recomputes the dimension score as `(100×covered + 50×partial + 0×missing) ÷ 4`, rounded. The model's `score` must match this recomputation.

## Dimension: actionability

```json
{
  "score": 0-100 (integer),
  "subMetrics": [
    {
      "key": "content_specificity" | "evidence_guidance" | "structure_guidance",
      "score": 0-100 (integer),
      "band": "highly_actionable" | "mostly_actionable" | "moderately_actionable" | "vague" | "not_actionable",
      "findings": [ ...finding objects... ]
    }
  ],
  "findings": [ ...dimension-level finding objects... ]
}
```

Sub-metrics (exactly 3, in order):
1. `content_specificity` (内容具体度): Whether the conclusion contains numbered steps, specific quantities, judgment criteria.
2. `evidence_guidance` (证据指引): Whether facts are linked to verifiable sources; how missing evidence is handled.
3. `structure_guidance` (结构引导): Whether content organization order is specified (first sentence, body, closing).

Sub-metric band mapping:
- `highly_actionable` (90–100): Instructions are specific enough to execute directly.
- `mostly_actionable` (75–89): Mostly executable; minor details to fill in.
- `moderately_actionable` (60–74): Direction clear but key operational details insufficient.
- `vague` (40–59): Mostly generic advice; significant interpretation needed.
- `not_actionable` (0–39): Almost no actionable instruction.

The server recomputes the dimension score as the arithmetic mean of three sub-metric scores, rounded. The model's `score` must match.

## Dimension: boundaryRisk

```json
{
  "score": 0-100 (integer) or null,
  "risks": [
    {
      "key": "unverified_ranking" | "absolute_claim" | "effect_promise" | "unverified_comparison" | "unsupported_fact" | "missing_precondition",
      "status": "controlled" | "partial" | "uncontrolled" | "undetected" | "not_applicable" | "indeterminate",
      "findings": [ ...finding objects... ]
    }
  ],
  "findings": [ ...dimension-level finding objects... ]
}
```

Risk categories (exactly 6, matching the rule evaluation):
1. `unverified_ranking` (无依据排名)
2. `absolute_claim` (绝对化表达)
3. `effect_promise` (缺乏依据的效果保证)
4. `unverified_comparison` (未经核实的比较)
5. `unsupported_fact` (缺少依据的事实性结论)
6. `missing_precondition` (缺失必要适用条件或限制)

Status meanings:
- `controlled`: The draft's boundary section explicitly addresses this risk category.
- `partial`: Some boundary language relates to this risk but is generic or incomplete.
- `uncontrolled`: Risk present in text with no corresponding boundary constraint.
- `undetected`: No such expression detected in the text (text check only, not proof of safety).
- `not_applicable`: Risk category not relevant to the current question context.
- `indeterminate`: Cannot determine with available materials.

Score computation: only `controlled` (100), `partial` (50), and `uncontrolled` (0) count toward the denominator. If no risks are scored (all are `undetected`/`not_applicable`/`indeterminate`), score must be `null` (not evaluated), never a default value.

## Forbidden

- No `overall`, `totalScore`, `aggregate`, `weightedScore`, or any field not listed above.
- No empty findings array when the dimension has issues — always include at least one finding with severity and suggestion.
- No invented risk categories or coverage fields beyond those specified.
- No Markdown formatting, code fences, or commentary inside the JSON.
