# 系统架构文档 (Architecture)

> 技术架构概览和关键模块函数地图

---

## 技术栈

### 前端
- **React 19** + TypeScript + Vite
- **MUI (Material-UI)** - UI组件库
- **Zustand** - 状态管理
- **Immer** - 不可变状态更新
- **CodeMirror 6** - 代码编辑器
- **react-router-dom** - 路由

### 后端
- **Tauri 2.x** - 桌面应用框架
- **Rust 2021** - 系统编程语言
- **rusqlite** - SQLite数据库
- **esp_extractor v0.5.2** - ESP文件解析
- **walkdir** - 文件系统遍历

---

## 核心模块

### 后端模块 (Rust)

#### 1. 翻译数据库 (`translation_db.rs`)
```rust
// 核心结构
struct TranslationDB { conn: Arc<Mutex<Connection>> }
struct Translation {
    form_id, record_type, subrecord_type,
    original_text, translated_text, ...
}

// 主要方法
fn save_translation()              // 单条UPSERT
fn batch_save_translations()       // 批量保存（事务）
fn get_translation()               // 单条查询
fn batch_query_translations()      // 批量查询
fn clear_base_dictionary()         // 清除基础词典
fn query_by_text()                 // 按原文查询（参考翻译）
```

#### 2. ESP提取服务 (`esp_service.rs`)
```rust
// 主要函数
fn extract_plugin_strings()        // 双语提取（英+中）
fn extract_base_dictionary()       // 提取9个基础插件
fn get_base_plugins()              // 获取基础插件列表

// 工作流程
// 1. 加载英文版 → 2. 加载中文版 → 3. HashMap映射 → 4. 建立英→中对照
```

#### 3. 插件Session管理 (`plugin_session.rs`)
```rust
struct PluginSessionManager {
    sessions: HashMap<String, Arc<PluginSession>>
}

fn get_or_load()    // 加载/复用Session
fn close()          // 关闭Session
fn list_sessions()  // 列出活跃Session
```

#### 4. 配置管理 (`settings.rs`)
```rust
fn read_settings()   // 读取settings.json
fn write_settings()  // 写入配置
fn get_exe_dir()     // 获取可执行文件目录
```

#### 5. 插件扫描 (`scanner.rs`)
```rust
fn validate_game_path()  // 验证游戏目录
fn scan_plugins()        // 扫描.esp/.esm/.esl文件
```

#### 6. 原子数据库 (`atomic_db.rs`)
```rust
// 核心结构
struct AtomicDB {
    conn: Arc<Mutex<Connection>>,              // SQLite持久化
    memory_index: Arc<Mutex<HashMap<...>>>,    // 内存索引
    matcher: Arc<Mutex<Option<AhoCorasick>>>,  // 多模式匹配器
}

struct AtomTranslation {
    id, original, translated, usage_count, source, ...
}

// 主要方法
fn upsert_atom()              // 添加/更新术语
fn delete_atom()              // 删除术语
fn get_all_atoms()            // 获取全部术语
fn replace_with_atoms()       // 🔥 核心功能：文本术语标注
fn batch_upsert()             // 批量导入（预留）

// 内部方法
fn load_all_to_memory()       // SQLite → HashMap
fn rebuild_matcher()          // 重建Aho-Corasick自动机
fn find_atom_by_normalization()  // 词形还原（复数匹配）
fn increment_usage_async()    // 异步更新使用计数

// 工作流程
// 1. 初始化：SQLite → HashMap + Aho-Corasick
// 2. 文本输入：find_iter() 查找所有匹配
// 3. 替换：保留原文大小写 + (译文) 格式
// 4. 统计：异步更新usage_count
```

#### 7. API配置管理 (`api_manage.rs`)
```rust
// 核心结构
struct ApiConfigDB { conn: Arc<Mutex<Connection>> }

struct ApiConfig {
    id, name, endpoint, api_key,
    model_name, max_tokens,
    is_active, created_at, updated_at
}

// 主要方法
fn new(db_path)               // 初始化数据库（WAL模式）
fn get_all_configs()          // 获取所有配置
fn create_config(name)        // 创建默认配置
fn update_config(id, config)  // 更新配置
fn delete_config(id)          // 删除配置
fn activate_config(id)        // 激活配置（事务保证唯一性）
fn get_current_config()       // 获取当前激活配置

// 特性
// - 唯一激活约束：activate时自动取消其他配置
// - 事务保证：BEGIN → 全部设为0 → 激活指定ID → COMMIT
// - 明文存储：API Key不加密（依赖文件系统安全）
```

---

### 前端模块 (TypeScript/React)

#### 1. 状态管理 (`stores/`)

**appStore.ts** - 全局应用状态
```typescript
interface AppState {
    gamePath, plugins, isLoading, error
    setGamePath(), loadSettings(), loadPlugins()
}
```

**sessionStore.ts** - Session管理
```typescript
interface SessionState {
    openedSessions, activeSessionId, pendingChanges
    openSession(), closeSession(), switchSession()
    refreshTranslations(), updateStringRecord()
    saveSessionTranslations()
}
```

**translationStore.ts** - 翻译数据
```typescript
interface TranslationState {
    saveTranslation(), batchSaveTranslations()
    getTranslation(), batchQueryTranslations()
    extractDictionary(), clearBaseDictionary()
}
```

**notificationStore.ts** - 通知系统
```typescript
showSuccess(), showError(), showWarning(), showInfo()
```

**apiConfigStore.ts** - API配置管理
```typescript
interface ApiConfigState {
    configs: ApiConfig[]          // 所有配置列表
    currentApi: ApiConfig | null  // 当前激活的配置
    isLoading, error

    loadConfigs()                 // 加载所有配置
    createConfig(name)            // 创建新配置
    updateConfig(id, config)      // 更新配置（自动保存）
    deleteConfig(id)              // 删除配置
    activateConfig(id)            // 激活配置
    refreshCurrentApi()           // 刷新当前激活配置
}
```

#### 2. 核心组件 (`components/`)

- **StringTable.tsx** - 翻译表格（MUI DataGrid）
- **SessionPanel.tsx** - Session面板（状态栏+表格）
- **SessionTabBar.tsx** - Tab切换栏
- **EditorWindow.tsx** - 独立编辑窗口（CodeMirror）
- **TranslationReferencePanel.tsx** - 参考翻译面板
- **SettingsModal.tsx** - 设置对话框（3个Tab：词典提取/AI配置/通用设置）
- **ApiConfigPanel.tsx** - AI配置面板（配置列表+编辑区）
- **BatchApplyConfirmModal.tsx** - 批量应用确认

#### 3. 页面组件 (`pages/`)

- **GamePathSelector.tsx** - 游戏目录选择（首屏）
- **Workspace.tsx** - 主工作界面（Drawer + Tabs + Panel）
- **AtomicDbWindow.tsx** - 原子数据库管理窗口（独立窗口）

---

## 数据流

### 1. 插件加载流程
```
用户选择插件 → sessionStore.openSession()
    ↓
后端 load_plugin_session(plugin_path)
    ↓
esp_extractor 提取字符串
    ↓
返回 PluginStringsResponse
    ↓
前端存储到 openedSessions Map
    ↓
StringTable 显示
```

### 2. 刷新翻译流程
```
openSession() 触发 → sessionStore.refreshTranslations()
    ↓
构造 forms: FormIdentifier[]
    ↓
后端 batch_query_translations_with_progress()
    ↓
分批查询（1000条/批）+ 进度事件
    ↓
前端使用 Immer 原地更新 session.strings
    ↓
UI自动刷新（颜色标记）
```

### 3. 保存翻译流程
```
用户修改译文 → updateStringRecord()
    ↓
pendingChanges.add(form_id)
    ↓
用户点击保存 → saveSessionTranslations()
    ↓
筛选 pendingChanges 中的记录
    ↓
后端 batch_save_translations()
    ↓
SQLite UPSERT（UPDATE只改translated_text）
    ↓
清空 pendingChanges
```

### 4. 双语提取流程
```
用户选择Data目录 → extractDictionary()
    ↓
后端 clear_base_dictionary()  # 清除旧数据
    ↓
后端 extract_base_dictionary()
    ↓
遍历9个基础插件：
    load_auto(..., "english") → 英文记录
    load_auto(..., "chinese") → 中文记录
    HashMap映射 → 建立英→中对照
    ↓
batch_save_translations() 存入数据库
    ↓
返回统计信息
```

### 5. 原子数据库术语标注流程
```
用户添加术语 → add_atom_translation("savangard", "松加德")
    ↓
后端 upsert_atom() 持久化到SQLite
    ↓
load_all_to_memory() 加载到HashMap
    ↓
rebuild_matcher() 构建Aho-Corasick自动机
    ↓

AI翻译前调用 → replace_with_atoms("savangard awaits!")
    ↓
Aho-Corasick.find_iter() 查找所有匹配
    ↓
按位置倒序替换（避免偏移）
    ↓
返回 "savangard(松加德) awaits!"
    ↓
increment_usage_async() 统计使用次数
```

---

## 数据库结构

### translations 表
```sql
CREATE TABLE translations (
    form_id TEXT NOT NULL,           -- "00012345|Skyrim.esm"
    record_type TEXT NOT NULL,        -- "WEAP"
    subrecord_type TEXT NOT NULL,     -- "FULL"
    editor_id TEXT,                   -- 编辑器ID
    original_text TEXT NOT NULL,      -- 英文原文
    translated_text TEXT NOT NULL,    -- 中文翻译
    plugin_name TEXT,                 -- 插件名称
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (form_id, record_type, subrecord_type)
);

CREATE INDEX idx_plugin_name ON translations(plugin_name);
CREATE INDEX idx_updated_at ON translations(updated_at);
```

**UPSERT策略**：
- INSERT：所有字段
- UPDATE：只更新 `translated_text` 和 `updated_at`（保护 `original_text`）

### atomic_translations 表
```sql
CREATE TABLE atomic_translations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_text TEXT NOT NULL UNIQUE,  -- 英文原文（小写存储）
    translated_text TEXT NOT NULL,       -- 中文翻译
    usage_count INTEGER DEFAULT 0,       -- 使用次数统计
    source_type TEXT NOT NULL,           -- 来源：base/ai/manual
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX idx_atomic_original ON atomic_translations(original_text);
CREATE INDEX idx_atomic_usage ON atomic_translations(usage_count DESC);
CREATE INDEX idx_atomic_source ON atomic_translations(source_type);
```

**特性**：
- 原文小写存储（大小写不敏感匹配）
- 使用次数自动统计
- 来源追踪（基础/AI/手动）

---

## 关键优化

### 内存优化
1. **Immer** - 结构共享，避免深拷贝（节省60-70%内存）
2. **React.memo** - 组件缓存，避免无效渲染
3. **Arc<Vec>** - 后端数据共享，避免重复克隆
4. **显式清理** - Map.clear() + try-finally

### 性能优化
1. **虚拟滚动** - MUI DataGrid 支持10万+条数据
2. **批量操作** - 1000条/批 + 事务
3. **HashMap查找** - O(1)复杂度
4. **WAL模式** - SQLite并发读写

### 用户体验
1. **进度通知** - Tauri Event System
2. **行颜色标记** - 未翻译/已翻译/AI翻译
3. **批量应用** - 自动检测相同原文
4. **独立保存** - 每个Session独立管理

---

## Tauri命令清单

### 配置管理
- `get_settings()`
- `set_game_path(path: String)`

### 插件扫描
- `validate_game_directory(path: String)`
- `get_plugin_list()`

### 翻译数据库
- `save_translation(translation: Translation)`
- `batch_save_translations(translations: Vec<Translation>)`
- `get_translation(form_id, record_type, subrecord_type)`
- `batch_query_translations(forms: Vec<FormIdentifier>)`
- `batch_query_translations_with_progress(session_id, forms)`
- `get_translation_statistics()`
- `clear_plugin_translations(plugin_name: String)`
- `clear_all_translations()`
- `clear_base_dictionary()`

### ESP提取
- `get_base_plugins_list()`
- `extract_dictionary(data_dir: String)`

### Session管理
- `load_plugin_session(plugin_path: String)`
- `close_plugin_session(session_id: String)`
- `list_plugin_sessions()`

### 编辑器
- `open_editor_window(record: StringRecord)`
- `get_editor_data(window_label: String)`
- `query_word_translations(text: String, limit: usize)`

### 原子数据库
- `open_atomic_db_window()`
- `get_all_atoms()`
- `add_atom_translation(original, translated, source)`
- `delete_atom_translation(original)`
- `replace_text_with_atoms(text: String)`

---

## 事件系统

### Tauri Events
- `translation-progress` - 翻译刷新进度（每批1000条）
- `translation-updated` - 编辑器应用翻译（窗口间通信）

---

## 文件组织

```
src-tauri/src/
├── main.rs              # 应用入口
├── lib.rs               # Tauri命令注册
├── settings.rs          # 配置管理
├── scanner.rs           # 插件扫描
├── translation_db.rs    # 翻译数据库
├── esp_service.rs       # ESP提取服务
├── plugin_session.rs    # Session管理
└── atomic_db.rs         # 原子数据库 (新增)

src/
├── components/          # React组件
├── pages/               # 页面组件
│   ├── GamePathSelector.tsx
│   ├── Workspace.tsx
│   ├── EditorWindow.tsx
│   └── AtomicDbWindow.tsx  # 原子数据库管理窗口 (新增)
├── stores/              # Zustand状态管理
├── types/               # TypeScript类型
└── utils/               # 工具函数

src-tauri/userdata/
├── settings.json             # 用户配置
├── translations.db           # 翻译数据库
├── translations.db-wal       # WAL日志
├── atomic_translations.db    # 原子数据库
└── api.db                    # API配置数据库 (新增)
```

---

**文档版本**: v0.1.0
**最后更新**: 2025-11-15
