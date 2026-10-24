# 意图优化 Skill 开发

问题生成的 Skill 在 `brand-question-portfolio.skill/`，应答逻辑的 Skill 在
`response-logic-builder.skill/`。提示词、规则、示例和执行代码均由本模块维护，
可以直接在子仓 `module/` 内修改，然后按开发指南构建并发布子域名。

运行时完整打包所选 Skill 目录，新增的 `references/`、`scripts/`、`agents/`
和其他正常资源也会进入任务附件。`SKILL.md` 与
`references/output-contract.md` 是必须保留的业务合同文件，并非资源白名单。
解释器缓存不会入包；实际资源内容参与任务版本哈希。

新任务读取新发布的 Skill。已有任务保留原来的 Skill 绑定，避免开发更新改变
执行到一半的任务。修改输出格式时，应同时修改 `module/contracts/` 中的结果合同
和 `module/server/` 中的解析、校验及采用逻辑。

服务器继续提供现有 AI 凭据，修改业务 Skill 无需提交 Key 或修改主仓。
