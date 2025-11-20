/**
 * 应用配置
 */
export interface Settings {
  /** 游戏路径 */
  game: string | null;
}

/**
 * 插件信息
 */
export interface PluginInfo {
  /** 插件文件名 */
  name: string;
  /** 插件完整路径 */
  path: string;
}

/**
 * 翻译记录
 */
export interface Translation {
  /** form标识符 (如: "00012BB7|Skyrim.esm") */
  form_id: string;
  /** 记录类型 (如: "WEAP", "ARMO") */
  record_type: string;
  /** 子记录类型 (如: "FULL", "DESC") */
  subrecord_type: string;
  /** 索引 (用于区分同一记录下的多条翻译) */
  index: number;
  /** 编辑器ID (可选) */
  editor_id: string | null;
  /** 原文 */
  original_text: string;
  /** 译文 */
  translated_text: string;
  /** 来源插件名称 */
  plugin_name: string | null;
  /** 创建时间戳 */
  created_at: number;
  /** 更新时间戳 */
  updated_at: number;
}

/**
 * Form标识符，用于批量查询
 */
export interface FormIdentifier {
  /** form标识符 */
  form_id: string;
  /** 记录类型 */
  record_type: string;
  /** 子记录类型 */
  subrecord_type: string;
  /** 索引 */
  index: number;
}

/**
 * 插件统计信息
 */
export interface PluginCount {
  /** 插件名称 */
  plugin_name: string;
  /** 翻译数量 */
  count: number;
}

/**
 * 翻译统计信息
 */
export interface TranslationStats {
  /** 总翻译数量 */
  total_count: number;
  /** 按插件分组的统计 */
  plugin_counts: PluginCount[];
  /** 最后更新时间戳 */
  last_updated: number;
}

/**
 * ESP 字典提取统计信息
 */
export interface ExtractionStats {
  /** 总文件数 */
  total_files: number;
  /** 成功提取的文件数 */
  successful_files: number;
  /** 失败的文件数 */
  failed_files: number;
  /** 提取的总字符串数 */
  total_strings: number;
  /** 跳过的文件列表（未找到） */
  skipped_files: string[];
  /** 错误信息列表 */
  errors: string[];
}

/**
 * 翻译状态类型
 */
export type TranslationStatus = 'untranslated' | 'manual' | 'ai';

/**
 * 字符串记录（用于表格显示）
 */
export interface StringRecord {
  /** form标识符 (完整, 如: "00012BB7|Skyrim.esm") */
  form_id: string;
  /** 编辑器ID (可选) */
  editor_id: string | null;
  /** 记录类型 (如: "WEAP") */
  record_type: string;
  /** 子记录类型 (如: "FULL") */
  subrecord_type: string;
  /** 索引 */
  index: number;
  /** 原文 */
  original_text: string;
  /** 译文（可编辑） */
  translated_text: string;
  /** 翻译状态 (用于标记来源和决定行颜色) */
  translation_status?: TranslationStatus;
}

/**
 * 加载插件返回的完整响应
 */
export interface PluginStringsResponse {
  /** Session ID (即插件名称) */
  session_id: string;
  /** 插件名称 */
  plugin_name: string;
  /** 插件路径 */
  plugin_path: string;
  /** 字符串列表 */
  strings: StringRecord[];
  /** 总数 */
  total_count: number;
}

/**
 * Session 信息
 */
export interface SessionInfo {
  /** Session ID */
  session_id: string;
  /** 插件名称 */
  plugin_name: string;
  /** 字符串数量 */
  string_count: number;
  /** 加载时间（秒） */
  loaded_at: number;
}

/**
 * 翻译进度通知 Payload
 */
export interface TranslationProgressPayload {
  /** Session ID */
  session_id: string;
  /** 当前处理数量 */
  current: number;
  /** 总数量 */
  total: number;
  /** 百分比 (0-100) */
  percentage: number;
}

/**
 * Session 状态
 */
export interface SessionState {
  /** 已打开的 Sessions (Map: session_id -> PluginStringsResponse) */
  openedSessions: Map<string, PluginStringsResponse>;
  /** 当前激活的 Session ID */
  activeSessionId: string | null;
  /** 翻译刷新进度 (Map: session_id -> 百分比 0-100) */
  translationProgress: Map<string, number>;
  /** 未保存的修改 (Map: session_id -> Set<form_id>) */
  pendingChanges?: Map<string, Set<string>>;
  /** 筛选状态 (Map: session_id -> filter status) */
  filterStatus?: Map<string, 'all' | 'untranslated' | 'manual' | 'ai'>;
  /** 行选择状态 (Map: session_id -> Set<row_id>, row_id = "form_id|record_type|subrecord_type|index") */
  selectedRows?: Map<string, Set<string>>;
  /** 加载状态 */
  isLoading: boolean;
  /** 错误信息 */
  error: string | null;

  // Actions
  /** 打开插件 Session */
  openSession: (pluginPath: string) => Promise<void>;
  /** 关闭插件 Session */
  closeSession: (sessionId: string) => Promise<void>;
  /** 切换激活的 Session */
  switchSession: (sessionId: string) => void;
  /** 检查 Session 是否已存在 */
  checkSessionExists: (pluginName: string) => boolean;
  /** 刷新Session的翻译（从数据库批量拉取） */
  refreshTranslations: (sessionId: string) => Promise<void>;
  /** 初始化Event监听器（返回清理函数） */
  initEventListener: () => Promise<() => void>;
  /** 初始化编辑窗口事件监听器（返回清理函数） */
  initEditorEventListener?: () => Promise<() => void>;
  /** 更新单个字符串记录 */
  updateStringRecord?: (
    sessionId: string,
    formId: string,
    recordType: string,
    subrecordType: string,
    index: number,
    translatedText: string,
    translationStatus: string
  ) => void;
  /** 批量保存翻译到数据库 */
  batchSaveTranslations?: () => Promise<number>;
  /** 获取未保存的修改数量 */
  getPendingChangesCount?: () => number;
  /** 获取单个 session 的未保存修改数量 */
  getSessionPendingCount?: (sessionId: string) => number;
  /** 保存单个 session 的翻译到数据库 */
  saveSessionTranslations?: (sessionId: string) => Promise<number>;
  /** 应用翻译到插件文件（生成新的 ESP 文件） */
  applyTranslations?: (sessionId: string, saveAs?: string) => Promise<string>;
  /** 设置错误信息 */
  setError: (error: string | null) => void;
  /** 设置筛选状态 */
  setFilterStatus?: (sessionId: string, status: 'all' | 'untranslated' | 'manual' | 'ai') => void;
  /** 获取筛选状态 */
  getFilterStatus?: (sessionId: string) => 'all' | 'untranslated' | 'manual' | 'ai';
  /** 设置选中的行（rowId格式："form_id|record_type|subrecord_type|index"） */
  setSelectedRows?: (sessionId: string, rowIds: Set<string>) => void;
  /** 清空选中的行 */
  clearSelectedRows?: (sessionId: string) => void;
  /** 获取选中的行（rowId格式："form_id|record_type|subrecord_type|index"） */
  getSelectedRows?: (sessionId: string) => Set<string>;
}

/**
 * 应用状态
 */
export interface AppState {
  /** 游戏路径 */
  gamePath: string | null;
  /** 插件列表 */
  plugins: PluginInfo[];
  /** 加载状态 */
  isLoading: boolean;
  /** 错误信息 */
  error: string | null;

  // Actions
  /** 加载配置 */
  loadSettings: () => Promise<void>;
  /** 设置游戏路径 */
  setGamePath: (path: string) => Promise<void>;
  /** 加载插件列表 */
  loadPlugins: () => Promise<void>;
  /** 设置错误信息 */
  setError: (error: string | null) => void;
}
