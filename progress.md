# 开发进度规划 (Development Progress)

## 项目里程碑

| 阶段 | 目标 | 状态 | 预计工时 |
|-----|------|------|---------|
| 阶段1 | 基础设施搭建 | 🚧 进行中 | 2h |
| 阶段2 | 配置管理系统 | ⏳ 未开始 | 3h |
| 阶段3 | 插件扫描功能 | ⏳ 未开始 | 4h |
| 阶段4 | UI界面实现 | ⏳ 未开始 | 6h |
| 阶段5 | 集成测试 | ⏳ 未开始 | 2h |

**总预计工时**: 17小时

---

## 阶段1：基础设施搭建 🚧

### 目标
搭建项目开发环境，安装所有必要依赖

### 任务清单

#### 1.1 前端依赖安装
- [x] 创建技术选型文档 `stack.md`
- [x] 创建进度规划文档 `progress.md`
- [ ] 安装UI框架
  ```bash
  pnpm add @mui/material @emotion/react @emotion/styled
  ```
- [ ] 安装路由库
  ```bash
  pnpm add react-router-dom
  ```
- [ ] 安装状态管理
  ```bash
  pnpm add zustand
  ```
- [ ] 安装开发依赖
  ```bash
  pnpm add -D @types/node
  ```

#### 1.2 Rust依赖配置
- [ ] 编辑 `src-tauri/Cargo.toml`
  ```toml
  [dependencies]
  walkdir = "2"
  directories = "5"
  ```

#### 1.3 项目结构初始化
- [ ] 创建前端目录结构
  ```
  src/
  ├── components/
  ├── pages/
  ├── stores/
  ├── types/
  └── utils/
  ```
- [ ] 创建后端模块文件
  ```
  src-tauri/src/
  ├── settings.rs
  └── scanner.rs
  ```

**验收标准**：
- ✅ 所有依赖安装成功，无冲突
- ✅ `pnpm dev` 和 `pnpm tauri dev` 正常启动
- ✅ 项目目录结构清晰

---

## 阶段2：配置管理系统 ⏳

### 目标
实现settings.json的读写和游戏路径管理

### 任务清单

#### 2.1 Rust配置模块 (`settings.rs`)
- [ ] 定义配置数据结构
  ```rust
  #[derive(Serialize, Deserialize)]
  struct Settings {
      game: Option<String>,
  }
  ```
- [ ] 实现获取可执行文件路径逻辑
  - 使用 `std::env::current_exe()` 获取路径
  - 开发模式：项目根目录
  - 生产模式：可执行文件同级目录
- [ ] 实现 `read_settings()` 函数
- [ ] 实现 `write_settings()` 函数

#### 2.2 Tauri命令暴露
- [ ] `get_settings() -> Result<Settings>`
- [ ] `set_game_path(path: String) -> Result<()>`

#### 2.3 前端状态管理（Zustand Store）
- [ ] 创建 `src/stores/appStore.ts`
- [ ] 定义状态类型
  ```typescript
  interface AppState {
    gamePath: string | null
    setGamePath: (path: string) => Promise<void>
    loadSettings: () => Promise<void>
  }
  ```
- [ ] 集成Tauri命令调用

**验收标准**：
- ✅ settings.json 正确存储在可执行文件旁
- ✅ 配置读写功能正常
- ✅ 前端Store与后端同步

---

## 阶段3：插件扫描功能 ⏳

### 目标
实现游戏目录验证和插件文件扫描

### 任务清单

#### 3.1 目录验证 (`scanner.rs`)
- [ ] 实现 `validate_game_path(path: &str) -> bool`
  - 检查 `{path}/Data` 是否存在（大小写不敏感）
  - 检查 `{path}/Data/Skyrim.esm` 是否存在
- [ ] Tauri命令：`validate_game_directory(path: String) -> Result<bool>`

#### 3.2 插件扫描
- [ ] 定义插件数据结构
  ```rust
  #[derive(Serialize)]
  struct PluginInfo {
      name: String,
      path: String,
  }
  ```
- [ ] 实现 `scan_plugins(game_path: &str) -> Vec<PluginInfo>`
  - 使用 `walkdir` 扫描 `Data` 目录
  - 过滤 `.esp`, `.esm`, `.esl` 文件
  - 仅返回文件名和完整路径
- [ ] Tauri命令：`get_plugin_list() -> Result<Vec<PluginInfo>>`

#### 3.3 前端集成
- [ ] 更新Store添加 `plugins` 状态
- [ ] 实现 `scanPlugins()` action

**验收标准**：
- ✅ 正确识别有效的游戏目录
- ✅ 成功扫描所有插件文件
- ✅ 前端能正确接收插件列表

**TODO标记**：
> 📌 插件元数据解析（插件名称、作者、版本等）待后续接入专门的Rust ESP解析库

---

## 阶段4：UI界面实现 ⏳

### 目标
实现完整的用户界面

### 任务清单

#### 4.1 路由配置
- [ ] 安装并配置 `react-router-dom`
- [ ] 定义路由结构
  ```typescript
  / - GamePathSelector（首屏）
  /workspace - Workspace（主界面）
  ```
- [ ] 实现路由守卫：未设置游戏路径时重定向到 `/`

#### 4.2 首屏组件 (`pages/GamePathSelector.tsx`)
- [ ] 创建页面布局（居中卡片）
- [ ] 集成文件夹选择器
  - 使用 Tauri `dialog` API
  - 调用 `validate_game_directory` 验证
- [ ] 实现错误提示
  - 目录无效时显示错误信息
  - 要求重新选择
- [ ] 保存成功后跳转到 `/workspace`

#### 4.3 主界面布局 (`pages/Workspace.tsx`)
- [ ] 创建整体布局（MUI `Box` + Flexbox）
- [ ] 实现顶部工具栏（AppBar）
  - 显示当前游戏路径
  - 提供"重新选择"按钮

#### 4.4 左侧插件列表 (`components/PluginSidebar.tsx`)
- [ ] 使用 MUI `Drawer` 组件（`variant="persistent"`）
- [ ] 实现搜索框
  - `TextField` 输入框
  - 实时过滤插件列表
- [ ] 实现插件列表
  - `List` + `ListItem` 组件
  - 显示插件文件名
  - 支持点击选中（预留功能）
- [ ] 实现折叠按钮
  - 默认展开
  - IconButton 控制显示/隐藏

#### 4.5 中间内容区 (`components/ContentArea.tsx`)
- [ ] 创建Placeholder
  - 居中显示提示文字："选择插件开始翻译"
  - 使用 `Typography` + `Box`

**验收标准**：
- ✅ 首次启动显示目录选择界面
- ✅ 选择有效目录后进入主界面
- ✅ 插件列表正确显示
- ✅ 搜索功能正常工作
- ✅ 侧边栏可折叠

---

## 阶段5：集成测试 ⏳

### 目标
端到端测试，确保功能完整可用

### 任务清单

#### 5.1 功能测试
- [ ] 测试场景1：首次启动
  - 无 settings.json → 显示目录选择
  - 选择无效目录 → 提示错误
  - 选择有效目录 → 保存配置并跳转
- [ ] 测试场景2：二次启动
  - 有 settings.json → 直接进入主界面
  - 正确加载插件列表
- [ ] 测试场景3：插件列表
  - 搜索框输入 → 实时过滤
  - 侧边栏折叠 → UI正确响应
  - 空目录处理 → 显示"无插件"提示

#### 5.2 跨平台测试（可选）
- [ ] Windows 测试
- [ ] Linux 测试（如有环境）
- [ ] macOS 测试（如有环境）

#### 5.3 性能测试
- [ ] 大量插件场景（100+ 文件）
  - 扫描性能
  - 列表渲染性能
  - 搜索响应速度

#### 5.4 代码质量检查
- [ ] TypeScript类型检查：`pnpm build`
- [ ] Rust编译检查：`cargo clippy`
- [ ] 代码格式化：`cargo fmt`

**验收标准**：
- ✅ 所有核心功能正常工作
- ✅ 无明显UI问题
- ✅ 性能满足基本要求

---

## 后续迭代计划 💡

### 短期优化（1-2周）
1. **插件元数据解析**
   - 接入 ESP 解析库
   - 显示插件名称、作者、版本、描述
   - 支持主控文件（Master）依赖关系显示

2. **UI增强**
   - 添加暗色主题切换
   - 优化列表虚拟滚动（性能）
   - 添加插件详情面板

### 中期功能（1-2月）
1. **翻译核心功能**
   - 集成翻译API
   - 实现文本提取
   - 实现翻译结果应用

2. **批量处理**
   - 多选插件批量翻译
   - 翻译进度显示
   - 翻译历史管理

### 长期规划（3月+）
1. **高级功能**
   - 自定义翻译规则
   - 术语库管理
   - 翻译质量检查

2. **用户体验**
   - 多语言界面
   - 快捷键支持
   - 插件加载顺序优化

---

## 风险管理

| 风险项 | 影响 | 应对措施 |
|-------|------|---------|
| ESP文件格式复杂 | 高 | 使用成熟的Rust解析库，避免自行实现 |
| 大量插件性能 | 中 | 实现虚拟滚动，异步加载 |
| 跨平台路径处理 | 中 | 使用 `std::path::PathBuf` 统一处理 |
| 翻译API限流 | 低 | 实现请求队列和重试机制 |

---

## 开发原则

1. **KISS原则**：保持简单，避免过度设计
2. **渐进式开发**：先实现核心功能，再逐步优化
3. **用户反馈驱动**：根据实际使用调整优先级
4. **代码可读性**：清晰的命名和注释
5. **错误处理**：友好的错误提示

---

**文档版本**: v1.0
**创建日期**: 2025-11-13
**最后更新**: 2025-11-13
**维护者**: orcax

---

## 更新日志

### v1.0 (2025-11-13)
- ✅ 创建项目规划文档
- ✅ 定义5个开发阶段
- ✅ 规划详细任务清单
- ✅ 明确验收标准
