# Pro 开发说明

修改具体线上 SHA 对应的源码。`module/` 包含完整业务 UI、API、持久化、结果状态机与工作流；`standalone/` 是独立启动和本地预览适配，`vendor/` 是主仓维护的公开 Core 契约。

请保留主体业务语义：问题 revision 校验；应答任务与问题/会话/轮次绑定；未知创建结果先恢复，不重复付费；旧任务工作流冻结；明确采用模型结果后才变更正式应答。

允许修改业务页面和模块自己的依赖（`module/package.json`）；不要把真实门禁、供应商密钥、客户数据放入 ZIP。共享 Core 接口变更需在 HANDOFF.md 明确列出，不能绕过现有接口失败。

默认返回 `handoff.json`、`HANDOFF.md`、`files/`。记录准确 baseCommit、修改目标、依赖变更和已实际执行的检查。缺失文件不是删除；删除必须写入 manifest 的 `delete`。本地预览与开发域名真实验收分开记录。
