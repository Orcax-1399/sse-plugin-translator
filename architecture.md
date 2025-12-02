# 系统架构文档 (Architecture)

> 记录 v0.7.8 的技术结构与关键模块流向

---

## 技术栈总览

### 前端
- **React 19 + TypeScript + Vite 7**
- **Zustand + Immer**（状态管理与不可变更新）
- **Material UI 7 + Material React Table 3 + @tanstack/react-table 8**
- **CodeMirror 6**（独立编辑窗口）
- **react-router-dom 7 / framer-motion 12**（导航与动效）

### 后端
- **Tauri 2.x + Rust 2021**
- **esp_extractor 0.6.0**（ESP/ESM/ESL 抽取）
- **rusqlite 0.32 (bundled)**（SQLite）
- **aho-corasick 1.1 / rayon 1 / walkdir 2 / tokio 1.48** 等辅助库

---

## 核心模块（Rust）

### translation_db.rs
```rust
pub struct TranslationDB { conn: Arc<Mutex<Connection>> }

impl TranslationDB {
    pub fn batch_save_translations(&self, translations: Vec<Translation>) -> Result<(), String>;
    pub fn batch_query_translations_with_progress(&self, session_id: &str, forms: Vec<FormIdentifier>) -> Result<(), String>;
    pub fn clear_base_dictionary(&self) -> Result<(), String>;
}
```
- 使用 UPSERT 保护原文字段，仅更新 `translated_text/updated_at`。
- 与 `plugin_session` 配合，按 1000 条批量回传进度事件 `translation-progress`。

### plugin_session.rs
- 管理 Session 生命周期、缓存、翻译刷新与 DSD 覆盖。
- 核心函数：
```rust
pub fn load_session(&self, plugin: &PluginDescriptor) -> Result<LoadedSession, String>;
pub fn apply_dsd_overrides(&self, session: &mut LoadedSession, dsd_dir: &Path) -> Result<usize, String>;
pub fn export_dsd_json(&self, payload: ExportDsdPayload) -> Result<PathBuf, String>;
```
- 加载时会调用 `dsd::load_overrides()` 读取 `<plugin_dir>/SKSE/Plugins/DynamicStringDistributor/<mod>/` 下的 JSON，贴合 Session 列表。
- 导出 DSD 时，统一写入 `<base>/skse/Plugins/DynamicStringDistributor/<mod>/<mod>.json`，并返回最终路径给前端。

### dsd.rs
- 负责 DSD JSON 结构、路径推导与文件 I/O。
```rust
pub fn determine_output_dir(settings: &Settings, plugin_path: &Path) -> Option<PathBuf>;
pub fn load_overrides(plugin_name: &str, plugin_path: &Path) -> Result<Vec<DsdEntry>, String>;
pub fn export_dsd(entries: &[DsdEntry], ctx: &DsdExportContext) -> Result<PathBuf, String>;
```
- 扫描指定目录，将 JSON 内的 `type/formId/source` 映射到 Session/覆盖条目，用于 UI 显示“DSD 覆盖”提示。

### settings.rs + commands::settings
- 维护 `settings.json` 的读写，新增字段：
```rust
pub struct Settings {
    pub game_path: Option<PathBuf>,
    pub dsd_output_dir: Option<PathBuf>,
}
```
- 暴露命令：
  - `get_settings`
  - `set_game_path(path)`
  - `clear_game_path()` —— 清除缓存的 Data 路径与 DSD 目录
  - `set_dsd_output_dir(path)`
  - `clear_dsd_output_dir()`

### coverage_db.rs + utils::load_order.rs
- `CoverageDB::clear_entries()`：刷新覆盖数据库前一次性删除全部条目、load order 快照与统计信息。
- `extract_and_store()` 流程：
  1. 验证 `loadorder.txt` 与游戏 Data 目录；
  2. 顺序遍历插件，调用 `esp_extractor` 解析；
  3. 写入 `coverage_entries` / `coverage_load_order`;
  4. 调用 `dsd::load_overrides` 并套用文本覆盖，记录“DSD override”数；
  5. 通过事件 `coverage_progress` / `coverage_complete` 向前端报告。

### 其余模块
- `esp_service.rs`：基础词典提取（英语/中文 9 个插件）。
- `atomic_db.rs`：术语数据库（SQLite + 内存 matcher），支持异步计数与批量导入。
- `api_manage.rs`：AI 配置 CRUD + 激活管理。
- `search_history.rs`：AI search/apply 工具的使用记录。
- `commands::*`：按主题拆分（session/translation/coverage/atomic/api_config/editor/...），利于 Tauri register。

---

## 核心模块（前端）

### stores/
- `appStore.ts`：加载 settings、管理 `gamePath`/`dsdOutputDir`、窗口尺寸以及调用 `clear_game_path`。
- `sessionStore.ts`：Session 列表、MRT data source、DSD 状态、批量保存、DSD 导出（invoke `export_dsd_json`）、AI 操作与 `pendingChanges` 跟踪。
- `coverageStore.ts`：覆盖快照、提取进度、搜索结果，加载后在表格中显示 DSD override Badge。
- `historyStore.ts`：命令模式撤销（最多 30 条）、批量命令组合。
- `apiConfigStore.ts` / `translationStore.ts` / `notificationStore.ts`：分别封装 API 配置、翻译数据库调用与全局通知。

### components/
- `SessionPanel.tsx`：Material React Table 承载字符串表格；顶部加入 AI、DSD 导出、覆盖状态、DSD 指示器。
- `StringTable.tsx`、`SearchHistoryPanel.tsx`、`CoverageSearchPanel.tsx`、`AtomDbTermsPanel.tsx` 等全部迁移到 MRT，统一 ellipsis/selection/pagination。
- `workspace/WorkspaceAppBar.tsx`：展示游戏目录与 DSD 输出目录，并提供“清空工作区设置”按钮。
- `coverage/` 系列组件：状态卡片 + MRT 搜索表格，显示 load order、DSD override 提示与列宽限制。

### pages/
- `GamePathSelector.tsx`：首屏路径选择，驱动 `appStore.setGamePath`。
- `Workspace.tsx`：主布局（Drawer + Tabs + Panels），处理 DSD 目录选择/清空以及窗口状态。
- `AtomicDbWindow.tsx` / `CoverageWindow.tsx` / `EditorWindow.tsx`：独立窗口，通过 Tauri 菜单或快捷方式打开。

### utils/
- `aiTranslation.ts` / `aiPrompts.ts` / `aiTools.ts`：AI 工具调用、预算限制、取消控制以及 search/apply 路由。
- 其他辅助模块：`aiTranslationBudget.ts`、`formatters.ts` 等。

---

## 数据流

### 插件 Session 加载
```
Workspace 选择插件
  → sessionStore.openSession(plugin)
    → invoke('load_plugin_session', plugin_path)
      → esp_extractor 抽取 + translation_db 批量查询
      → dsd::load_overrides() 套用 JSON 覆盖
    ← LoadedSession { strings, dsd_status, meta }
  → MRT 渲染 + 状态栏展示 DSD/覆盖提示
```

### 翻译刷新
```
sessionStore.refreshTranslations(sessionId)
  → invoke('batch_query_translations_with_progress', forms)
    → translation_db 分批 1000 条查询，emit translation-progress
  ← 每批结果 append → Immer 原地写入 → MRT 局部刷新
```

### 保存翻译
```
用户修改译文 → pendingChanges 记录
点击保存 → 筛选 pendingChanges → invoke('batch_save_translations')
  → rusqlite UPSERT (事务)
← 清空 pendingChanges + push 命令到 historyStore
```

### AI 批量翻译
```
SessionPanel 选择多行 → 调用 aiTranslation.run()
  → 构造 system/prompt/tool schema
  → openai/ai SDK 发起请求（前端执行）
  → search 工具：触发 tauri 命令查询术语/历史
  → apply_translations 工具：批量更新 sessionStore（skipHistory）
  → 预算耗尽时返回 fallback，UI 提示改为 apply/skip
  → 成功/取消都会 push 命令到 historyStore
```

### DSD 导出
```
SessionPanel 点击 DSD 图标
  → sessionStore.exportDsd(sessionId)
    → invoke('export_dsd_json', { sessionId, dsdOutputDir? })
      → dsd::determine_output_dir(settings, plugin_path)
      → dsd::export_dsd(entries)
    ← 返回输出路径，UI Toast + 更新 DSD 状态
```

### 覆盖提取
```
CoverageWindow 点击 “开始提取”
  → coverageStore.startExtraction()
    → invoke('run_coverage_extraction')
      → CoverageDB::clear_entries()
      → load_order::extract_and_store() 顺序抽取
      → 每插件 emit coverage_progress
      → 完成 emit coverage_complete(统计)
    ← coverageStore 根据事件更新 UI，最终刷新状态卡片
```

### 覆盖搜索
```
用户输入 FormID/文本 → coverageStore.searchEntries()
  → invoke('search_coverage_entries', { formId?, text?, limit })
    → SQLite LIKE / = 查询 + load order 关联
  ← 结果通过 MRT 渲染，DSD override 列高亮
```

### 基础词典提取
```
设置面板选择 Data 目录 → invoke('extract_dictionary')
  → translation_db.clear_base_dictionary()
  → esp_service.extract_base_dictionary() (英/中 9 个插件)
  → translation_db.batch_save_translations()
  → 返回统计结果 → UI 显示
```

---

## 数据库结构

### translations
- 复合主键 `(form_id, record_type, subrecord_type)`。
- 重要索引：`plugin_name`、`updated_at`。
- UPSERT 仅修改译文与更新时间，保证原文与 metadata 稳定。

### atomic_translations
- 字段：`original_text`（小写）、`translated_text`、`usage_count`、`source_type` 等。
- `matcher` 内存态通过 Aho-Corasick 统一维护。

### coverage_entries / coverage_load_order / coverage_meta
- `coverage_entries`：记录所有覆盖文本，新增列 `extracted_at` 追踪时间。
- `coverage_load_order`：存储提取时的 load order 快照（position + checksum）。
- `coverage_meta`：保存最近一次提取摘要、覆盖统计。

### api_configs / search_history
- API 配置确保“唯一激活”，`activate_config` 事务化；search_history 记录 AI 工具调用细节。

---

## Tauri 命令

- **Settings**：`get_settings`、`set_game_path`、`clear_game_path`、`set_dsd_output_dir`、`clear_dsd_output_dir`
- **Session**：`load_plugin_session`、`close_plugin_session`、`export_dsd_json`
- **Translation**：`batch_save_translations`、`batch_query_translations_with_progress`、`clear_base_dictionary`
- **Coverage**：`get_coverage_status`、`run_coverage_extraction`、`search_coverage_entries`
- **Atomic**：`get_all_atoms`、`add_atom_translation`、`update_atom_translation`、`delete_atom_translation`
- **ESP / Dictionary**：`extract_dictionary`、`get_base_plugins_list`
- **API Config / Search History / Editor**：相应 CRUD 与窗口命令

---

## 事件系统

- `translation-progress`：批量翻译刷新进度
- `translation-updated`：独立编辑窗口回写
- `coverage_progress`：覆盖提取实时状态
- `coverage_complete`：提取完成/失败摘要

---

## 文件组织（关键目录）

```
src-tauri/
├─ src/
│  ├─ commands/              # Tauri 命令模块
│  ├─ dsd.rs                 # DSD JSON 读写
│  ├─ plugin_session.rs      # Session + DSD 管理
│  ├─ translation_db.rs
│  ├─ coverage_db.rs
│  ├─ atomic_db.rs
│  ├─ esp_service.rs
│  ├─ settings.rs
│  ├─ utils/
│  │  └─ load_order.rs       # 覆盖提取 & DSD 叠加
│  └─ ...
└─ userdata/                 # settings.json、*.db

src/
├─ components/
│  ├─ SessionPanel.tsx       # 主表格 + AI/DSD 操作
│  ├─ coverage/              # 覆盖窗口
│  ├─ atomic/                # 术语 & 搜索历史
│  └─ ...
├─ pages/
│  ├─ GamePathSelector.tsx
│  ├─ Workspace.tsx
│  ├─ CoverageWindow.tsx
│  └─ AtomicDbWindow.tsx
├─ stores/                   # Zustand store
├─ types/                    # type 定义（含 DSD/覆盖）
└─ utils/                    # AI & 通用工具
```

---

**文档版本**: v0.7.8  
**最后更新**: 2025-12-02  
**维护者**: orcax
