# Four-dimension evaluation rubric with anchor examples

Each dimension uses five score bands: 90–100, 75–89, 60–74, 40–59, 0–39. The anchor examples below are calibrated against the deterministic rule evaluation's band labels to ensure comparability.

## Relevance (回答相关性)

**Evaluates:** Whether the draft responds to the Question and Intent. Only this — completeness, specificity, and risk boundaries are other dimensions.

| Band | Score | Anchor example |
|---|---|---|
| `direct` | 90–100 | First sentence: "选择知识管理系统时，优先核查供应商的教育行业落地案例和数据导出能力。" → directly answers "如何选择适合制造业的知识管理系统？" with a concrete decision criterion. |
| `mostly_relevant` | 75–89 | First sentence mentions the domain but leads with company background: "FrontMind 是一家专注于知识管理的公司。" before reaching the selection criteria in sentence 3. |
| `partially_responsive` | 60–74 | Discusses knowledge management in general terms without addressing the specific manufacturing context or the user's decision urgency. |
| `background_dominant` | 40–59 | Opens with "知识管理系统的发展历史可以追溯到……" — mostly background, the selection question is never directly answered. |
| `off_topic` | 0–39 | Discusses unrelated software procurement or generic technology trends with no connection to the question. |

## Completeness (完整性)

**Evaluates:** Whether all four required sections are present and substantive. Only coverage — quality and specificity belong to actionability.

| Status | Description | Anchor example |
|---|---|---|
| `covered` | Section present with sufficient substance | `conclusion`: ≥2 sentences, ≥60 chars, contains both a conclusion and an execution directive. |
| `partial` | Section present but insufficient | `concern`: 20 chars mentioning the topic but no specific decision concern or stake. |
| `missing` | Section absent or effectively empty | `boundaries`: empty string or only generic placeholder text. |

Score = round((100×covered + 50×partial + 0×missing) / 4)

## Actionability (可执行性)

**Evaluates:** Whether a downstream Content Agent can execute directly from this draft.

### content_specificity (内容具体度)

| Band | Score | Anchor example |
|---|---|---|
| `highly_actionable` | 90–100 | "列出 3 项可核验优势，每项附一条来源" — numbered steps with specific counts and criteria. |
| `mostly_actionable` | 75–89 | Steps present but one lacks a specific threshold: "列出优势并配来源" without the count. |
| `moderately_actionable` | 60–74 | "先介绍产品特点，再对比竞品" — has direction but no quantities, judgment criteria, or output format. |
| `vague` | 40–59 | "突出产品优势，增强用户信任" — generic directive that could apply to any product. |
| `not_actionable` | 0–39 | No instruction at all; the section is empty or purely descriptive. |

### evidence_guidance (证据指引)

| Band | Score | Anchor example |
|---|---|---|
| `highly_actionable` | 90–100 | Each fact line ends with (知识库文档/官网/授权文件); states "无法核验的表述不作为依据". |
| `mostly_actionable` | 75–89 | Most facts have source markers; missing the fallback rule for unverifiable claims. |
| `moderately_actionable` | 60–74 | One or two source markers exist but most facts lack attribution guidance. |
| `vague` | 40–59 | Facts listed without any source binding or verification policy. |
| `not_actionable` | 0–39 | No facts section or completely empty guidance. |

### structure_guidance (结构引导)

| Band | Score | Anchor example |
|---|---|---|
| `highly_actionable` | 90–100 | "首句回应决策重点 → 3–5 项事实展开 → 适用条件与限制收束" with explicit transition markers. |
| `mostly_actionable` | 75–89 | Order signals present ("先……再……最后……") but paragraph counts or transition rules not fully specified. |
| `moderately_actionable` | 60–74 | Some sequence hints but paragraph structure left to the Content Agent's discretion. |
| `vague` | 40–59 | No organization order specified. |
| `not_actionable` | 0–39 | No conclusion or execution directive at all. |

Score = round(average of three sub-metric scores)

## BoundaryRisk (边界与风险控制)

**Evaluates:** Whether the draft identifies and constrains the six risk categories. Distinguishes text detection (what's in the draft) from boundary setting (what constraints are declared).

| Status | Description | Anchor example |
|---|---|---|
| `controlled` | Boundary explicitly addresses this risk | boundaries contains: "排名表述必须同时给出样本范围、评价维度与信息时间" for `unverified_ranking`. |
| `partial` | Generic boundary language loosely related | boundaries contains: "注意表述规范" without specifying what ranking claims require. |
| `uncontrolled` | Risk present in text, no boundary | conclusion claims "行业第一" with no boundary constraint on ranking assertions. |
| `undetected` | No such expression in the text | No ranking, absolute, comparison, promise, or precondition language found. |
| `not_applicable` | Risk category irrelevant to this context | Question is about internal process with no ranking/comparison aspect. |
| `indeterminate` | Cannot determine with available materials | Knowledge materials unavailable and draft is ambiguous about sourcing. |

Score = round((100×controlled + 50×partial + 0×uncontrolled) / count_of_scored), where scored = controlled + partial + uncontrolled. If scored = 0, score = null.
