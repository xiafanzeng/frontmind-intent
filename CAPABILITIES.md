# 意图优化：能力与验收记录

## 记录基线

- 模块：`intent`。
- 审阅的业务源码：[`0d95af53bd326e168c37a899f9ae312aa81cc48a`](https://github.com/xiafanzeng/frontmind-intent/tree/0d95af53bd326e168c37a899f9ae312aa81cc48a)。
- 整理日期：2026-09-16。本清单记录已执行检查与仍待补充的验收。
- 开发域名：[intent.frontmind.cn](https://intent.frontmind.cn)。实际运行版本以 `/api/version` 的 `moduleSha` 和 `coreSha` 为准。

“源码已包含”“本地检查通过”“真实业务验收通过”分别记录，不能互相替代。文档合并不会更新正在运行的镜像。

## 能力清单

| 能力 | 源码能力 | 主要源码 | 本地验证 | 真实业务验收 |
|---|---|---|---|---|
| 问题维护 | 已包含：完整问题列表与编辑页面；手工输入、分类、选择、维护、确认意图、持久化和修订号检查。 | `module/client/ModuleWorkspace.tsx`；`module/server/router.ts`；`module/server/questions.ts`；`module/server/question-maintenance-service.ts` | 见下方本地检查；不据此推定真实业务通过。 | 真实 UI 新增问题、刷新持久化和 UI 删除已通过；单独编辑与并发冲突未验收。 |
| 问题生成 | 已包含：企业资料和参考材料输入、任务上下文、生成结果处理和问题集工作流。 | `module/server/brand-question-portfolio-api.ts`；`module/server/brand-question-task-context.ts`；`module/server/generated-questions.ts`；`module/workflows/brand-question-portfolio.skill/` | 见下方本地检查；不据此推定真实业务通过。 | 真实供应商生成与结果入库未验收。 |
| 应答逻辑 | 已包含：应答逻辑页面、任务入口、编辑保存、采用和版本冲突规则。 | `module/client/ResponseLogicWorkspace.tsx`；`module/server/response-logic-api.ts`；`module/server/response-logic-service.ts`；`module/workflows/response-logic-builder.skill/` | 见下方本地检查；不据此推定真实业务通过。 | 实际生成、编辑保存、采用和并发版本冲突待分别验收；付费生成未执行。 |
| 独立输入与接入 | 已包含：独立问题输入和固定工作区接口，不要求其他模块先建立问题记录。 | `module/client/ModuleWorkspace.tsx`；`module/server/router.ts`；`standalone/` | 见下方本地检查；不据此推定真实业务通过。 | 目标版本的门禁、直接进入、深链和刷新通过。 |

## 已完成的本地检查

名称修改目标完成 frozen install、typecheck、3 个 Vitest 文件 / 9 项测试和完整 build。范围包括独立手工生成输入、路由和应答逻辑工作区规则。

本轮修改包均经过 delivery skill 的路径检查、准确基线候选和隔离三方合并，没有未解决冲突。以上测试使用本地或合成场景，不产生真实供应商任务。

## 开发域名实际验收记录

| 范围 | 已有证据与待完成项 |
|---|---|
| 目标版本页面 | 目标 moduleSha 的首页、应答逻辑页、问题生成页、深链、刷新与通用智能体路径回首页已通过；无名称测试后缀、无本地预览标记、无浏览器异常或失败业务请求。 |
| 普通保存与刷新 | 真实测试域名通过 UI 手工新增问题、刷新后读取及 UI 删除测试问题；本次没有单独验证编辑、采用或并发版本冲突。 |
| 供应商流程 | 问题生成、应答逻辑生成与生成结果入库未真实执行。 |

后续部署应重新记录实际两个 SHA，并对变更交互复验。停用的 worker 不记为任务执行通过；旧版本结果不直接作为新镜像验收。公开文档只记录检查结论，不包含账号凭据、私有路径、业务记录正文或运行数据。

## 仍保留的能力边界

应答生成、编辑、采用和版本冲突需分别验收；手工问题保存通过不能替代这些能力。

## 运行与公开范围

`module/` 包含公开业务源码、业务依赖和所属工作流，`standalone/` 包含独立壳与合成预览，`vendor/` 由主仓维护并按版本下发。`pnpm dev` 明确显示“本地预览”，不连接真实测试数据库或付费供应商。真实持久化、后台任务、授权文件和供应商连接由私有 Core 运行入口提供。

开发域名进入固定测试工作区；子仓不实现产品登录、成员、租户或通用智能体。主仓注入真实用户和工作区上下文，并按需提供跨模块入口。独立模块保留自己的输入流程。

普通 ZIP 导入、CI 和页面检查不触发付费生成、监控采集、媒体外发或客户域名发布。没有供应商配置、指定测试目标或额度时，明确记录未配置或未执行；不以合成预览替代真实验收。

## 下一轮修改

先让 `frontmind-module-delivery` 读取开发域名 `/api/version` 并导出精确线上源码、完整 SHA 和交接模板。`main` 可能含尚未上线的文档或代码，不能直接当线上基线。

Pro 按 [PRO_GUIDE.md](https://github.com/xiafanzeng/frontmind-intent/blob/main/PRO_GUIDE.md) 返回 ZIP 后，delivery skill 在隔离工作树中合并、验证并部署指定子域名。验收后使用 `frontmind-module-sync` 合回业务源码；独立壳、预览数据和开发门禁不回灌主仓。源码同步不自动部署生产 Dashboard。
