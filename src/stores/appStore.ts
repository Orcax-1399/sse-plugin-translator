import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { AppState, Settings, PluginInfo } from '../types';

/**
 * 应用全局状态管理
 */
export const useAppStore = create<AppState>((set, get) => ({
  // 状态
  gamePath: null,
  dsdOutputDir: null,
  plugins: [],
  isLoading: false,
  error: null,

  // 加载配置
  loadSettings: async () => {
    try {
      set({ isLoading: true, error: null });

      const settings = await invoke<Settings>('get_settings');

      set({
        gamePath: settings.game,
        dsdOutputDir: settings.dsd_output_dir ?? null,
        isLoading: false,
      });

      // 如果有游戏路径，自动加载插件列表
      if (settings.game) {
        await get().loadPlugins();
      }
    } catch (error) {
      console.error('加载配置失败:', error);
      set({
        error: error instanceof Error ? error.message : String(error),
        isLoading: false,
      });
    }
  },

  // 设置游戏路径
  setGamePath: async (path: string) => {
    try {
      set({ isLoading: true, error: null });

      // 保存到后端
      await invoke('set_game_path', { path });

      set({
        gamePath: path,
        isLoading: false,
      });

      // 加载插件列表
      await get().loadPlugins();
    } catch (error) {
      console.error('设置游戏路径失败:', error);
      set({
        error: error instanceof Error ? error.message : String(error),
        isLoading: false,
      });
    }
  },

  // 清除游戏路径
  clearGamePath: async () => {
    try {
      set({ isLoading: true, error: null });

      await invoke('clear_game_path');

      set({
        gamePath: null,
        plugins: [],
        isLoading: false,
      });
    } catch (error) {
      console.error('清除游戏路径失败:', error);
      set({
        error: error instanceof Error ? error.message : String(error),
        isLoading: false,
        gamePath: null,
        plugins: [],
      });
    }
  },

  // 加载插件列表
  loadPlugins: async () => {
    try {
      set({ isLoading: true, error: null });

      const plugins = await invoke<PluginInfo[]>('get_plugin_list');

      set({
        plugins,
        isLoading: false,
      });
    } catch (error) {
      console.error('加载插件列表失败:', error);
      set({
        error: error instanceof Error ? error.message : String(error),
        isLoading: false,
        plugins: [],
      });
    }
  },

  // 设置 DSD 导出目录
  setDsdOutputDir: async (path: string) => {
    try {
      await invoke('set_dsd_output_dir', { path });
      set({ dsdOutputDir: path });
    } catch (error) {
      console.error('设置 DSD 导出目录失败:', error);
      set({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  // 清除 DSD 导出目录
  clearDsdOutputDir: async () => {
    try {
      await invoke('clear_dsd_output_dir');
      set({ dsdOutputDir: null });
    } catch (error) {
      console.error('清除 DSD 导出目录失败:', error);
      set({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  // 设置错误信息
  setError: (error: string | null) => {
    set({ error });
  },
}));
