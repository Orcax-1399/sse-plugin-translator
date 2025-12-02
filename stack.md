# 技术选型文档 (Technology Stack)

## 项目概述
SSE Plugin Translator —— 面向 Bethesda 系列插件的桌面翻译工作台。React + Vite 构建的前端负责编辑体验，Tauri + Rust 负责 ESP 解析、SQLite 操作与 DSD/覆盖工具链。

---

## 前端技术栈

### 核心框架
- **React** `^19.1.0` + **TypeScript** `~5.8.3` + **Vite** `^7.0.4`
  - 支持并发特性与自动批处理，配合 Vite HMR 提供毫秒级反馈。
  - TypeScript 保证 store/command/tauri 调用签名一致性。

### 状态与不可变更新
- **Zustand** `^5.0.8`
  - 每个 store 独立 slice，支持选择性订阅，局部刷新。
  - `sessionStore`/`appStore`/`coverageStore` 等共享 `immer` 生产者以避免深拷贝。
- **Immer** `^10.2.0`
  - 结构共享 + Draft 写法，大幅降低 10w+ 行表格的内存峰值。

### UI / 表格
- **Material UI (MUI)** `^7.3.5`
  - 全局主题、弹窗、布局与图标（`@mui/icons-material`）。
- **Material React Table (MRT)** `^3.2.1` + **@tanstack/react-table** `^8.21.3`
  - 取代 DataGrid，提供轻量数据表、列/行虚拟化、全局 ellipsis 样式。
  - Session 表格、Coverage 搜索、AtomDb 面板等均共享同一配置，行操作按钮图标化。
- **CodeMirror 6** (`@uiw/react-codemirror` + `@codemirror/lang-*`)
  - 负责独立编辑窗口与 Prompt 预览。

### 路由与动画
- **react-router-dom** `^7.9.5` 用于 GamePathSelector ↔ Workspace / 子窗口导航。
- **framer-motion** `^12.23.24` 提供细节动效（Tab 切换、空态等）。

### AI & API 交互
- **openai** `^6.9.0` + **ai** `^5.0.93`
  - 构建兼容 OpenAI/MCP 的工具调用请求，封装流式响应与取消控制。
  - 自定工具（search/apply_translations）通过 `ai` 包的工具路由实现。

### 状态模块划分
| Store | 职责 | 持久化 |
|-------|------|--------|
| `appStore` | 游戏路径、DSD 导出目录、窗口布局/设置加载 | settings.json + localStorage |
| `sessionStore` | Session 管理、翻译数据、DSD 覆盖标记、批量保存 | translations.db |
| `translationStore` | 翻译数据库 RPC 封装 | translations.db |
| `historyStore` | per-session 撤销栈（FIFO 30 条） | 内存 |
| `apiConfigStore` | AI 配置 CRUD、当前激活项 | api.db |
| `coverageStore` | 覆盖快照状态、提取进度、搜索结果、DSD override | coverage.db |
| `notificationStore` | 全局 Snackbar/Toast | 内存 |

---

## 后端技术栈

### 核心框架
- **Tauri** `2.x`
  - 调用系统 WebView，暴露 Rust 命令给前端，包含 `plugin-dialog`/`plugin-opener` 插件用于目录选择 & 打开外部资源。
- **Rust** `2021 Edition`
  - 提供零成本并发与内存安全；所有命令模块按功能拆分（settings/session/coverage/dsd/...）。

### 关键依赖
- **esp_extractor** `0.6.0`
  - 支持 SSE/AE 插件解析，输出结构化字符串记录，配合 Rayon 并行提取。
- **rusqlite** `0.32` (bundled)
  - 统一管理 translations/atomic/coverage/api DB；采用 WAL 模式保证并发读写。
- **aho-corasick** `1.1`
  - 为原子数据库构建多模式匹配器，实现 AI 前置术语替换。
- **rayon** `1.x`
  - 并行遍历插件、覆盖提取与 DSD JSON 应用。
- **walkdir** `2.x`
  - 扫描 Data 目录与 SKSE/DynamicStringDistributor 目录。
- **tokio** `1.48.0`
  - 处理定时任务与异步事件（如 coverage progress）。
- **chrono / directories / serde / serde_json**
  - 时间戳、路径、序列化/反序列化辅助。

### 重要模块
- `translation_db.rs`：对 `translations` 表进行 UPSERT/批量查询，保护原文字段。
- `plugin_session.rs`：Session 生命周期、DSD 覆盖套用、DSD 导出命令。
- `dsd.rs`：定义 JSON 结构，解析/导出 `<base>/skse/DynamicStringDistributor/<mod>/<mod>.json`。
- `coverage_db.rs` + `utils::load_order.rs`：覆盖数据库 + loadorder 解析，`clear_entries()` 确保刷新前清库。
- `commands::settings`：游戏路径、DSD 导出目录、`clear_game_path()`。
- `commands::coverage`、`commands::session` 等按职责拆分。

---

## 构建与工具链

- **pnpm** - 管理 Node 依赖与 Tauri CLI。
- **Vite** - 前端 dev server 与生产构建。
- **TypeScript Compiler (tsc)** - 独立类型检查。
- **Cargo** - Rust 构建与依赖管理。
- **tauri-cli** - `pnpm tauri dev/build` 入口，负责多目标打包。

---

## 数据流概要

```
React (Zustand actions)
   ↕ invoke/emit
Tauri (Rust commands + events)
   ↕
SQLite / DSD JSON / loadorder.txt / Data 目录
```

1. **游戏目录**：`appStore.loadSettings()` 调用 `get_settings`，Rust 端读取 settings.json 并返回 `game_path` + `dsd_output_dir`；Workspace 顶栏允许 `set_game_path`/`clear_game_path`。
2. **Session 加载**：`sessionStore.openSession()` → `plugin_session::load` → esp_extractor 抽取 → DSD JSON 覆盖 → 返回字符串数组 + DSD 状态。
3. **AI 批翻**：前端构造工具调用请求 → Rust 不参与 → 结果回写表格并触发历史命令。
4. **覆盖提取**：`run_coverage_extraction` 先 `CoverageDB::clear_entries()`，再按 load order 解包并应用 DSD JSON，event 传回进度。
5. **DSD 导出**：`sessionStore.exportDsd()` → `commands::session::export_dsd` → `dsd::export_dsd_json()` 以配置路径写出 JSON，返回最终路径给 UI。

---

## 性能与用户体验

- **虚拟化表格**：MRT + TanStack 提供虚拟滚动和列裁剪，改善 10w+ 行渲染。
- **批量命令**：翻译/覆盖查询采用分页、批量写入（事务）减少锁竞争。
- **DSD 覆盖标记**：加载/导出即时更新 stores，Workspace 顶栏实时显示状态。
- **可撤销操作**：历史栈按 session 隔离，配合 Immer diff 减少内存。
- **进度反馈**：覆盖提取、翻译刷新、AI 批量均通过通知与事件回传状态。

---

## 依赖策略

- 核心库（Tauri/esp_extractor/rusqlite）锁定主版本，必要时跟随安全更新。
- 前端依赖允许次版本升级（`^`），使用 pnpm lock 保证 reproducible。
- 新增 Rust 依赖统一用 `cargo add`，前端依赖统一 `pnpm add`，确保 lock 文件同步。

---

**文档版本**: v0.7.8  
**最后更新**: 2025-12-02  
**维护者**: orcax
