# Optimization rubric

The optimizer is measured by whether its candidate draft genuinely resolves the Judge's findings — never by re-evaluation scores.

## Principles (in priority order)

1. **Resolve real defects.** Map every `improve`/`risk` finding of the judge diagnosis to a concrete content change. If a finding cannot be resolved without inventing facts, state the limitation inside the section (uncertainty marker) instead of fabricating.
2. **Preserve what is right.** Sections or sentences the judge found `covered`/`direct`/`supported` should be kept as-is. Rewriting correct content is a defect, not an optimization.
3. **Evidence honesty.** A change may cite `draft` excerpts (the original text it preserves or sharpens) or `knowledge` excerpts (enterprise facts it introduces). No evidence is better than fake evidence. Explanation text (summary) is never evidence.
4. **No score chasing.** Do not add keywords, checklists or boilerplate because they "look more complete". Every sentence in the optimized draft must serve the user's decision.
5. **Structure and boundaries.** Four sections stay four sections. Boundary rules (禁止表达、适用条件) may only become stricter or more precise, never looser.

## Worked examples

### Good change

- Judge finding (actionability/evidence_guidance 68): "来源标记缺失，无法确定每条事实应引用哪份材料".
- Change: `{field: "facts", summary: "为每条事实补充来源标记（知识库文档/官网/授权文件），并写明无法核验的表述不作为依据", evidence: [{source: "knowledge", excerpt: "授权文件：知识库文档", supports: "来源标记映射到实际存在的知识材料条目"}]}`.

### Bad change (rejected by review)

- `{field: "conclusion", summary: "增加关键词提高相关性", evidence: []}` — keyword stuffing with no finding addressed.
- `{field: "facts", summary: "补充官方数据", evidence: [{source: "knowledge", excerpt: "转化率提升 300%", supports: "官方数据"}]}` — excerpt not present in the knowledge materials (fabricated) → server rejects the whole output.
- Copying the entire original draft into `optimizedDraft` with `changes: []` — no optimization proposed.

## Knowledge-unavailable mode

When turn-input declares knowledge unavailable:
- Do NOT emit any `knowledge` evidence (server rejects it).
- Enterprise specifics must be replaced by verifiable placeholders or explicit uncertainty ("待企业材料核验后补充"), never by invented numbers, policies or official claims.
