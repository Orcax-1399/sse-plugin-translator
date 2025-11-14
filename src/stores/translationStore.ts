import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type {
  Translation,
  FormIdentifier,
  TranslationStats,
  ExtractionStats,
} from '../types';

/**
 * 翻译状态管理
 */
interface TranslationState {
  /** 翻译统计信息 */
  stats: TranslationStats | null;
  /** 加载状态 */
  isLoading: boolean;
  /** 错误信息 */
  error: string | null;

  // ==================== Actions ====================

  /**
   * 保存单条翻译
   */
  saveTranslation: (translation: Translation) => Promise<void>;

  /**
   * 批量保存翻译
   */
  batchSaveTranslations: (translations: Translation[]) => Promise<void>;

  /**
   * 查询单条翻译
   */
  getTranslation: (
    formId: string,
    recordType: string,
    subrecordType: string
  ) => Promise<Translation | null>;

  /**
   * 批量查询翻译（刷翻译）
   */
  batchQueryTranslations: (forms: FormIdentifier[]) => Promise<Translation[]>;

  /**
   * 加载统计信息
   */
  loadStatistics: () => Promise<void>;

  /**
   * 清除指定插件的翻译
   */
  clearPluginTranslations: (pluginName: string) => Promise<void>;

  /**
   * 清除所有翻译（慎用）
   */
  clearAllTranslations: () => Promise<void>;

  /**
   * 清除基础词典数据（9个官方插件）
   */
  clearBaseDictionary: () => Promise<number>;

  /**
   * 获取基础插件列表
   */
  getBasePluginsList: () => Promise<string[]>;

  /**
   * 从游戏 Data 目录提取基础字典
   */
  extractDictionary: (dataDir: string) => Promise<ExtractionStats>;

  /**
   * 设置错误信息
   */
  setError: (error: string | null) => void;
}

/**
 * 翻译Store
 */
export const useTranslationStore = create<TranslationState>((set, get) => ({
  stats: null,
  isLoading: false,
  error: null,

  // ==================== Actions ====================

  saveTranslation: async (translation: Translation) => {
    set({ isLoading: true, error: null });
    try {
      await invoke('save_translation', { translation });
      // 保存后刷新统计
      await get().loadStatistics();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({ error: errorMsg });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  batchSaveTranslations: async (translations: Translation[]) => {
    set({ isLoading: true, error: null });
    try {
      await invoke('batch_save_translations', { translations });
      // 保存后刷新统计
      await get().loadStatistics();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({ error: errorMsg });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  getTranslation: async (formId, recordType, subrecordType) => {
    set({ isLoading: true, error: null });
    try {
      const result = await invoke<Translation | null>('get_translation', {
        formId,
        recordType,
        subrecordType,
      });
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({ error: errorMsg });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  batchQueryTranslations: async (forms: FormIdentifier[]) => {
    set({ isLoading: true, error: null });
    try {
      const translations = await invoke<Translation[]>('batch_query_translations', {
        forms,
      });
      return translations;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({ error: errorMsg });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  loadStatistics: async () => {
    set({ isLoading: true, error: null });
    try {
      const stats = await invoke<TranslationStats>('get_translation_statistics');
      set({ stats });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({ error: errorMsg });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  clearPluginTranslations: async (pluginName: string) => {
    set({ isLoading: true, error: null });
    try {
      await invoke<number>('clear_plugin_translations', { pluginName });
      // 清除后刷新统计
      await get().loadStatistics();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({ error: errorMsg });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  clearAllTranslations: async () => {
    set({ isLoading: true, error: null });
    try {
      await invoke<number>('clear_all_translations');
      // 清除后刷新统计
      set({ stats: null });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({ error: errorMsg });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  clearBaseDictionary: async () => {
    set({ isLoading: true, error: null });
    try {
      const deletedCount = await invoke<number>('clear_base_dictionary');
      // 清除后刷新统计
      set({ stats: null });
      return deletedCount;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({ error: errorMsg });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  getBasePluginsList: async () => {
    set({ isLoading: true, error: null });
    try {
      const plugins = await invoke<string[]>('get_base_plugins_list');
      return plugins;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({ error: errorMsg });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  extractDictionary: async (dataDir: string) => {
    set({ isLoading: true, error: null });
    try {
      const stats = await invoke<ExtractionStats>('extract_dictionary', {
        dataDir,
      });
      // 提取后刷新翻译统计
      await get().loadStatistics();
      return stats;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({ error: errorMsg });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  setError: (error: string | null) => {
    set({ error });
  },
}));
