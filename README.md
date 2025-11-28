# SSE Plugin Translator

面向 Bethesda 游戏（如 Skyrim SE）的桌面级插件翻译工作台。前端基于 **React 19 + TypeScript + Vite**，后端采用 **Tauri 2 + Rust**，在本地解析 ESP/ESM/ESL 插件、管理翻译数据库，并提供 AI 批量翻译与覆盖关系排查等高级功能。

---

## 项目亮点
- **多 Session 工作流**：任意加载多个插件，独立跟踪每个 Session 的翻译记录、未保存变更和历史栈。
- **AI 批量翻译引擎**：内置 OpenAI Chat Completions + 工具调用流程，支持术语搜索、批量应用、进度与取消控制。
- **基础词典与原子数据库**：批量提取九个官方插件，结合 Aho-Corasick 自动标注术语，并配备独立管理窗口。
- **覆盖数据库**：按 mod 加载顺序提取覆盖关系，图形化展示差异、进度和查询结果，帮助定位冲突。
- **全离线存储**：SQLite（WAL）分别管理翻译、术语、覆盖、API 配置与搜索历史，易于备份迁移。
- **性能优化**：MUI DataGrid 虚拟滚动 + Immer 结构共享，可流畅处理 10 万级条目。

---

## 技术栈
| 层级 | 技术 | 说明 |
| ---- | ---- | ---- |
| 前端 | React 19 · Vite 7 · TypeScript 5 · Zustand · MUI · CodeMirror | 工作区、翻译表格、编辑器与多窗口界面 |
| 后端 | Tauri 2 · Rust 2021 | 本地命令、窗口管理、事件总线 |
| 底层 | rusqlite · esp_extractor 0.6.0 · aho-corasick · walkdir · rayon | 插件解析、数据库与高性能匹配 |

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
   - 在设置中指定 `Skyrim Special Edition`（或兼容游戏）的 `Data` 目录。
   - 确保 Mod 管理器生成 `loadorder.txt`，以便覆盖提取遵循实际加载顺序。
3. **配置 AI**
   - 在“设置 → AI 配置”中添加/激活 API（OpenAI 兼容接口），填写 `endpoint / apiKey / modelName / maxTokens`。
   - ⚠️ 当前 AI 翻译假定所连接的订阅源支持 `tool_choice` / 工具调用（如 OpenAI function calling 或 MCP 风格），若后端只返回普通文本响应将导致翻译失败。
4. **导入基础词典（可选）**
   - 选择官方汉化插件所在目录，执行“双语提取”建立初始翻译对照。

---

## 典型工作流
1. **扫描插件**：`GamePathSelector` 设定游戏目录后，扫描可用 ESP/ESM/ESL 列表。
2. **打开 Session**：在 `Workspace` 中选择插件，`sessionStore` 会载入字符串、同步已译内容、标记未翻译。
3. **AI/手动翻译**：
   - 直接编辑 `StringTable` 中的译文，或使用“AI 翻译”选中条目批量处理。
   - AI 过程自动执行术语预处理（原子数据库）与 search/apply 工具调用，可随时取消并查看进度。
4. **保存与撤销**：仅提交有变更的记录，`historyStore` 支持 per-session 撤销/批量撤销。
5. **覆盖排查**：在 `CoverageWindow` 中启动提取，实时查看新增/缺失插件、提取进度及覆盖查询结果。
6. **术语管理**：通过 `AtomicDbWindow` 增删术语，或在搜索历史面板复盘 AI 查询行为。

---

## 功能概览
### 翻译与 Session
- `translation_db.rs` 通过 UPSERT 维护 `translations` 表，仅更新译文字段，保护原文。
- `sessionStore.ts` 负责插件加载、刷新、保存、批量操作与未保存记录管理。
- `historyStore.ts` 采用命令模式 + FIFO（最多 30 条）实现撤销栈，Session 之间互不干扰。

### AI 工作流
> ⚠️ 当前 AI 模块假定模型支持工具调用（`tool_choice` / function calling / MCP 风格），纯文本响应暂不兼容。

- `aiTranslation.ts`：构建会话状态，动态分配 search 预算，循环调用工具直至完成。
- `aiTools.ts`：封装 `search`（术语查询）与 `apply_translations`（回写 UI）的具体实现，并记录搜索历史。
- `aiPrompts.ts`：生成系统 Prompt、上下文、错误回显等消息，指导 AI 合规调用工具。

### 词典与术语
- `esp_service.rs`：提取九个基础插件（英/中）形成初始词典。
- `atomic_db.rs`：SQLite + HashMap + Aho-Corasick，提供术语增删、匹配、使用次数统计与异步更新。
- `AtomicDbWindow.tsx`：术语列表、搜索历史、导入导出和窗口级管理界面。

### 覆盖数据库
- `coverage_db.rs`：维护 `coverage_entries`、`coverage_load_order`、`coverage_meta` 三张表。
- `commands/coverage.rs`：负责检测快照、触发提取、推送 `coverage_progress` / `coverage_complete` 事件及查询接口。
- `CoverageWindow.tsx`：Tab 切换“状态监控 / 覆盖搜索”，并由 `coverageStore` 统一订阅事件。

---

## 目录结构
```
├─ src/                     # React 前端
│  ├─ components/           # 翻译表格、Session 面板、覆盖/原子数据库组件
│  ├─ pages/                # GamePathSelector / Workspace / EditorWindow / CoverageWindow / AtomicDbWindow
│  ├─ stores/               # Zustand stores（app/session/translation/apiConfig/history/coverage 等）
│  ├─ types/                # TypeScript 类型定义
│  └─ utils/                # AI 翻译、工具调用、格式化等
├─ src-tauri/
│  ├─ src/
│  │  ├─ commands/          # Tauri 命令：settings/scanner/translation/session/esp/editor/atomic/api_config/coverage/search_history
│  │  ├─ utils/             # 统一路径、load order 工具
│  │  ├─ coverage_db.rs     # 覆盖数据库
│  │  ├─ translation_db.rs  # 翻译数据库
│  │  ├─ atomic_db.rs       # 原子数据库
│  │  ├─ esp_service.rs     # 基础词典提取
│  │  ├─ api_manage.rs      # AI 配置数据库
│  │  └─ search_history.rs  # AI 搜索历史
│  └─ userdata/             # settings.json、translations.db、atomic_translations.db、coverage.db、api.db 等
└─ docs/
   ├─ architecture.md       # 架构说明
   ├─ stack.md              # 技术选型
   └─ progress.md           # 迭代记录
```

---

## 常见问题
1. **覆盖提取提示缺少 loadorder.txt？**  
   请先在 Mod 管理器中生成 load order（如 MO2 的“导出加载顺序”），再在设置中指定相同游戏目录。
2. **AI 翻译无响应或频繁失败？**  
   检查 API 配置是否激活、模型名是否正确；关注日志中 `AI API调用失败`、`search预算已耗尽` 等信息。如果服务端不支持 `tool_choice`/function calling，则可能无法命中 search/apply 工具，需更换支持工具调用的模型或代理。
3. **是否兼容纯文本类 AI 模型？**  
   暂不兼容。AI 翻译流水线依赖工具调用协议（tool calling / MCP），模型必须能够接收 `tools` 参数并在响应中返回 `tool_calls`；普通 Chat Completion 若仅返回文本将被判定失败。
4. **通过 Mod Organizer 2 启动出现白屏？**  
   在 MO2 中依次进入 `Settings → Workarounds`，在下方按钮里的 `Executable Blacklist` 追加：
   ```
   msedgewebview2.exe
   msedgeproxy.exe
   msedge.exe
   ```
   MO2 的 USVFS 会尝试 hook WebView 进程，导致 Edge WebView2 启动即白屏；本应用所有文件读写均由 Rust/Tauri 端完成，不依赖 WebView 访问虚拟文件，因此直接将上述进程列入黑名单即可。详见 [MO2 issue #1886](https://github.com/ModOrganizer2/modorganizer/issues/1886#event-1981414962)。
3. **翻译记录没保存？**  
   只有 `pendingChanges` 中的条目会写入数据库；保存后会清空未保存集合，并可在历史栈里撤销。

---

## 贡献指南
1. 使用 `pnpm tauri dev` 启动开发环境，Rust 端需安装最新 `stable` toolchain。
2. 代码遵循 `rustfmt` + ESLint（Vite 默认）风格；新增依赖请通过 `cargo add` 或 `pnpm add`。
3. 禁止创建 `mod.rs`，Rust 模块必须使用 `<module>.rs` 或 `<module>/modname.rs`。
4. 提交前可参考 `progress.md` 的迭代记录，确保新功能补充相应文档与命令注册。

欢迎提交 Issue / PR，或在 `architecture.md` 中补充设计想法，携手打造更强大的插件翻译器。
