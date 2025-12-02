# SSE Plugin Translator

面向 Bethesda 游戏（如 Skyrim SE/AE）的桌面级插件翻译工作台。前端基于 **React 19 + TypeScript + Vite**，后端采用 **Tauri 2 + Rust 2021**，在本地解析 ESP/ESM/ESL 插件、管理翻译数据库，并提供 AI 批量翻译、DSD 导出与覆盖差异排查等完整工具链。当前版本 **v0.7.8** 相比 v0.6.0 补齐了 DSD 管道、覆盖刷新可靠性和多窗体工作流。

---

## 项目亮点
- **多 Session 工作区 + 持久化路径**：一次设定游戏目录即可自动记住，工作区默认 1280×800 视口，支持多插件并行、Tab 切换、未保存提示与一键清空工作区配置。
- **DSD 全流程**：Session 面板新增导出入口，可配置 DSD 输出目录并实时看见覆盖指示；导出路径统一为 `<base>/skse/DynamicStringDistributor/<mod>/<mod>.json`，成功后自动标记为手动翻译。
- **覆盖数据库 2.0**：刷新前自动清空旧条目，遵循最新 load order 批量套用 DSD 覆盖；覆盖面板同步展示 DSD override 状态与列宽限制，便于快速定位冲突。
- **AI 批量翻译引擎**：内置 OpenAI/MCP 兼容工作流，按预算动态分配 search/apply 工具调用，可立即取消，预算耗尽时自动引导手动 apply/skip；原子词典用于预处理术语。
- **Material React Table UI**：核心表格迁移至 MRT + TanStack React Table，提供轻量虚拟滚动、统一 ellipsis 展示与更灵活的行样式；操作按钮图标化并联动 DSD/覆盖状态。
- **全离线持久化**：SQLite（WAL）分别管理翻译、术语、覆盖、AI 配置与搜索历史，Rust 后端通过 Tauri 命令操作文件系统，数据安全可控。

---

## 技术栈
| 层级 | 技术 | 说明 |
| ---- | ---- | ---- |
| 前端 | React 19 · Vite 7 · TypeScript 5.8 · Zustand · Immer · Material React Table · TanStack React Table · CodeMirror 6 | 工作区、翻译表格、编辑器与多窗口界面 |
| 后端 | Tauri 2 · Rust 2021 | 本地命令、窗口管理、事件总线 |
| 底层 | rusqlite · esp_extractor 0.6.0 · aho-corasick · walkdir · rayon · tokio | 插件解析、数据库与高性能匹配 |

更多模块说明详见 `architecture.md` 与 `stack.md`。

---

## 快速开始
1. **安装依赖**
   ```bash
   pnpm install
   pnpm tauri dev          # 开发模式
   pnpm tauri build        # 打包
   ```
2. **准备游戏环境**
   - 在设置中指定 `Skyrim Special Edition`（或兼容作品）的 `Data` 目录。
   - 确保 Mod 管理器导出 `loadorder.txt`，覆盖提取会严格依赖该顺序。
   - 选错目录时可点击 Workspace 顶栏的“清除工作区设置”按钮重置。
3. **配置 AI**
   - 在“设置 → AI 配置”面板中添加/激活 API（OpenAI 兼容接口），填写 `endpoint / apiKey / modelName / maxTokens` 等信息。
   - ⚠️ 当前 AI 翻译假定模型支持工具调用（function calling/MCP）。若仅返回纯文本，将无法驱动 search/apply，需切换模型或供应商。
4. **设定 DSD 输出目录（可选）**
   - 通过 Workspace 顶栏选择 DSD 导出目录；不设置时默认写回插件同级 `SKSE/DynamicStringDistributor/<mod>/`。
   - 导出成功会弹出路径并在 Session 列表里打钩，覆盖视图也会显示 override 标签。
5. **导入基础词典（可选）**
   - 选择官方汉化插件所在目录，执行“双语提取”建立初始翻译对照，后续 AI/批量导出会优先引用这些译文。

---

## 典型工作流
1. **扫描插件**：`GamePathSelector` 设定游戏目录后，扫描可用 ESP/ESM/ESL 列表，路径持久化到 settings 与 localStorage。
2. **打开 Session**：在 `Workspace` 中选择插件，`sessionStore` 载入字符串、套用翻译数据库与 DSD 覆盖，记录 DSD 状态。
3. **AI/手动翻译**：
   - 直接编辑 Material React Table 中的译文，或使用“AI 翻译”批量处理。
   - AI 过程会执行术语替换、search/apply 工具调用与预算检查，可随时取消并查看耗时/剩余预算。
4. **保存与撤销**：仅提交有变更的记录，`historyStore` 以命令模式维护每个 Session 的撤销栈（最多 30 条），批量操作也可一次撤销。
5. **覆盖排查**：在覆盖窗口启动提取，Rust 端清空旧数据库后重新解包全部插件并套用 DSD JSON 覆盖；完成后可搜索 FormID/文本，查看 DSD override 指示与 load order 对比。
6. **DSD 导出**：在 Session 面板点击 DSD 图标，选择输出目录并确认，导出后的记录会标记为“手动翻译”，覆盖面板也会提示潜在覆盖。
7. **术语管理**：通过 `AtomicDbWindow` 增删术语，或在搜索历史面板复盘 AI 查询栈。

---

## 功能概览
### Session 与翻译
- `translation_db.rs` 通过 UPSERT 维护 `translations` 表，仅更新译文字段，保护原文与历史。
- `sessionStore.ts` 管理插件加载、刷新、保存、批量操作与 DSD/覆盖指示器；`pendingChanges` 精准追踪未保存记录。
- `historyStore.ts` 采用命令模式 + FIFO（30 条）实现 per-session 撤销，批量命令可一次回滚。

### AI 工作流
> ⚠️ 模型必须支持工具调用（`tool_choice` / function calling / MCP）。纯文本响应会被判定失败。

- `aiTranslation.ts`：构建会话状态、动态分配 search 预算、监听取消信号与预算耗尽 fallback。
- `aiPrompts.ts`：重构后的 prompt 限制上下文，明确 budget/exhausted 行为，帮助模型遵循 apply/skip 指令。
- `aiTools.ts`：封装 search（术语/参考查询）与 apply_translations（写回 UI），记录搜索历史并提供扩散统计。

### 词典与原子数据库
- `esp_service.rs`：提取九个官方插件（英/中）建立基础词典。
- `atomic_db.rs`：SQLite + HashMap + Aho-Corasick，支持术语增删、匹配、使用次数统计与异步刷新，AI 运行前自动替换术语。

### DSD 管道
- `dsd.rs`：定义 DSD JSON 结构，负责检测 DSD 目录、载入覆盖、构建导出路径并写入 `<base>/skse/DynamicStringDistributor/<mod>/<mod>.json`。
- `plugin_session.rs`：加载 Session 时套用 DSD 覆盖、提供 `export_dsd_json`，日志中标记成功条目数；覆盖提取完成后也会套用 DSD JSON 以保持 UI 与游戏一致。
- `settings.rs` + `appStore.ts`：新增 `dsd_output_dir` 字段与 `clear_game_path` 命令，用户可在 UI 中设置/清除。

### 覆盖数据库
- `coverage_db.rs`：新增 `clear_entries()` 一键清空，再运行 `extract_and_store()` 生成干净快照。
- `load_order.rs`：解包顺序遵循最新 `loadorder.txt`，并在写入数据库后套用 DSD 覆盖，打印统计信息。
- `CoverageWindow.tsx`：基于 Material React Table 呈现搜索结果与快照状态，列宽限制保证可读性；`coverageStore.ts` 订阅 `coverage_progress` / `coverage_complete` 事件。

---

## 目录结构
```
├─ src/
│  ├─ components/                    # 翻译表格、Session 面板、覆盖/原子数据库组件（MRT + MUI）
│  ├─ pages/                         # GamePathSelector / Workspace / EditorWindow / CoverageWindow / AtomicDbWindow
│  ├─ stores/                        # Zustand stores（app/session/translation/apiConfig/history/coverage 等）
│  ├─ types/                         # TypeScript 类型定义（含 DSD/AI/覆盖结构）
│  └─ utils/                         # AI 翻译、工具调用、格式化
├─ src-tauri/
│  ├─ src/
│  │  ├─ commands/                   # Tauri 命令：settings/coverage/session/translation/esp/atomic/api_config 等
│  │  ├─ dsd.rs                      # DSD 读写逻辑
│  │  ├─ coverage_db.rs              # 覆盖数据库
│  │  ├─ translation_db.rs           # 翻译数据库
│  │  ├─ plugin_session.rs           # Session 管理 + DSD 导出
│  │  ├─ settings.rs                 # settings.json + DSD 输出目录/路径清除
│  │  ├─ utils/load_order.rs         # 覆盖提取与 DSD 叠加
│  │  └─ ...                         # 其余命令/工具模块
│  └─ userdata/                      # settings.json、translations.db、atomic_translations.db、coverage.db、api.db 等
└─ docs/
   ├─ architecture.md                # 架构说明
   ├─ stack.md                       # 技术选型
   └─ progress.md                    # 迭代记录
```

---

## 常见问题
1. **覆盖提取提示缺少 loadorder.txt？**  
   请先在 Mod 管理器（MO2/Vortex 等）导出加载顺序，再在设置中指定同一游戏目录。覆盖刷新会使用最新快照并自动清空旧数据库。
2. **DSD 覆盖提示是什么？**  
   Session 若检测到 `<base>/skse/DynamicStringDistributor/<mod>/` 下的 JSON，会在面板与覆盖窗口显示 DSD 图标/Badge；导出行为也会重新计算覆盖状态。
3. **AI 翻译无响应或频繁失败？**  
   检查 API 是否激活、模型名是否正确，确认服务端支持工具调用，并关注日志中的 `budget exhausted`、`tool call missing` 等提示。可在“搜索历史”窗口查看 AI 调用记录。
4. **是否兼容纯文本类 AI 模型？**  
   暂不兼容。AI 流水线依赖工具调用协议（function calling/MCP），纯文本响应无法驱动 search/apply。
5. **通过 Mod Organizer 2 启动出现白屏？**  
   在 MO2 → `Settings → Workarounds` → `Executable Blacklist` 追加 `msedgewebview2.exe/msedgeproxy.exe/msedge.exe`，避免 USVFS hook WebView。
6. **翻译记录没保存？**  
   仅 `pendingChanges` 中的条目会写入数据库；保存后自动清空并记录在历史栈，可随时撤销。

---

## 贡献指南
1. 使用 `pnpm tauri dev` 启动前端与 Rust 后端；Rust 端需安装最新 `stable` toolchain。
2. 代码遵循 `rustfmt` + ESLint（Vite 默认）风格；新增依赖请通过 `cargo add` 或 `pnpm add`。
3. Rust 模块严禁使用 `mod.rs`，必须采用 `<module>.rs` 或 `<module>/<submodule>.rs`。
4. 新特性需同步更新 `progress.md`、`README.md`、`stack.md` 或 `architecture.md` 中相关章节。

欢迎提交 Issue / PR，也可在 `architecture.md` 中补充设计方案，共同打造更强大的插件翻译器。
