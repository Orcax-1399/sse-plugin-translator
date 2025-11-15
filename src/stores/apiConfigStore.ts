import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

/**
 * API配置数据结构
 */
export interface ApiConfig {
  id: number;
  name: string;
  endpoint: string;
  apiKey: string;
  modelName: string;
  maxTokens: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * API配置状态管理
 */
interface ApiConfigState {
  // 状态
  configs: ApiConfig[];
  currentApi: ApiConfig | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadConfigs: () => Promise<void>;
  createConfig: (name: string) => Promise<number>;
  updateConfig: (id: number, config: Partial<ApiConfig>) => Promise<void>;
  deleteConfig: (id: number) => Promise<void>;
  activateConfig: (id: number) => Promise<void>;
  refreshCurrentApi: () => Promise<void>;
  setError: (error: string | null) => void;
}

/**
 * API配置全局状态管理
 */
export const useApiConfigStore = create<ApiConfigState>((set, get) => ({
  // 初始状态
  configs: [],
  currentApi: null,
  isLoading: false,
  error: null,

  // 加载所有配置
  loadConfigs: async () => {
    try {
      set({ isLoading: true, error: null });

      const configs = await invoke<ApiConfig[]>('get_api_configs');

      set({
        configs,
        isLoading: false,
      });

      // 同时刷新当前激活的配置
      await get().refreshCurrentApi();
    } catch (error) {
      console.error('加载API配置失败:', error);
      set({
        error: error instanceof Error ? error.message : String(error),
        isLoading: false,
      });
    }
  },

  // 创建新配置
  createConfig: async (name: string) => {
    try {
      set({ isLoading: true, error: null });

      const id = await invoke<number>('create_api_config', { name });

      // 刷新配置列表
      await get().loadConfigs();

      set({ isLoading: false });

      return id;
    } catch (error) {
      console.error('创建API配置失败:', error);
      set({
        error: error instanceof Error ? error.message : String(error),
        isLoading: false,
      });
      throw error;
    }
  },

  // 更新配置
  updateConfig: async (id: number, config: Partial<ApiConfig>) => {
    try {
      // 获取完整配置
      const fullConfig = get().configs.find(c => c.id === id);
      if (!fullConfig) {
        throw new Error('配置不存在');
      }

      const updatedConfig: ApiConfig = {
        ...fullConfig,
        ...config,
      };

      await invoke('update_api_config', { id, config: updatedConfig });

      // 刷新配置列表
      await get().loadConfigs();
    } catch (error) {
      console.error('更新API配置失败:', error);
      set({
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },

  // 删除配置
  deleteConfig: async (id: number) => {
    try {
      set({ isLoading: true, error: null });

      await invoke('delete_api_config', { id });

      // 刷新配置列表
      await get().loadConfigs();

      set({ isLoading: false });
    } catch (error) {
      console.error('删除API配置失败:', error);
      set({
        error: error instanceof Error ? error.message : String(error),
        isLoading: false,
      });
      throw error;
    }
  },

  // 激活配置
  activateConfig: async (id: number) => {
    try {
      set({ isLoading: true, error: null });

      await invoke('activate_api_config', { id });

      // 刷新配置列表和当前配置
      await get().loadConfigs();

      set({ isLoading: false });
    } catch (error) {
      console.error('激活API配置失败:', error);
      set({
        error: error instanceof Error ? error.message : String(error),
        isLoading: false,
      });
      throw error;
    }
  },

  // 刷新当前激活的配置
  refreshCurrentApi: async () => {
    try {
      const currentApi = await invoke<ApiConfig | null>('get_current_api');

      set({ currentApi });
    } catch (error) {
      console.error('获取当前API配置失败:', error);
      set({
        currentApi: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  // 设置错误信息
  setError: (error: string | null) => {
    set({ error });
  },
}));
