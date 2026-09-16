# FrontMind 意图优化模块

公开仓库：<https://github.com/xiafanzeng/frontmind-intent>
开发域名：<https://intent.frontmind.cn>

`module/` 与主仓 `modules/intent/` 同步；子仓的 `standalone/` 提供独立入口。问题维护、问题生成、应答逻辑生成/编辑/采用/版本校验的真实组件、API、服务、持久化和工作流均在此目录。主仓原路径仅装配公开接口。

独立模式可输入企业资料和问题，无需先创建品牌知识库或商业套餐。原主仓的知识关联与额度检查通过宿主端口保留。供应商凭据由私有 Core 以不可透明读取的引用注入，公开模块没有密钥。

公开仓本地执行：`pnpm install --frozen-lockfile`、`pnpm dev`；类型、测试与生产构建：`pnpm typecheck`、`pnpm test`、`pnpm build`。预览使用合成数据并清楚标注，不调用供应商。真实生成须在开发子域名验收。

有效流程位于 `workflows/`，历史运行数据和凭据不属于交付。修改包遵循 `PRO_GUIDE.md` 的准确基线和显式删除规则；不要直接覆盖主仓或修改部署目标。
