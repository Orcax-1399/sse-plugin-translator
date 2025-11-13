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
