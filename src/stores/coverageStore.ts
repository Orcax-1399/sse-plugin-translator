import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  CoverageStatus,
  CoverageEntry,
  CoverageExtractionStats,
  CoverageProgressPayload,
} from "../types";

/**
 * Coverage DB 状态管理
 *
 * 提取进度通过事件驱动更新，不再使用轮询
 */
interface CoverageState {
  // 状态数据
  status: CoverageStatus | null;
  searchResults: CoverageEntry[];

  // 提取相关状态 (由事件更新)
  extractionProgress: CoverageProgressPayload | null;
  lastExtractionStats: CoverageExtractionStats | null;

  // 加载状态
  isLoadingStatus: boolean;
  isExtracting: boolean;
  isSearching: boolean;

  // 错误信息
  error: string | null;

  // Actions
  fetchStatus: () => Promise<void>;
  startExtraction: () => Promise<void>;
  searchEntries: (
    formIdQuery?: string,
    textQuery?: string,
    limit?: number
  ) => Promise<void>;

  // 事件驱动的状态更新 (由组件调用)
  setExtractionProgress: (progress: CoverageProgressPayload) => void;
  setExtractionComplete: (
    _success: boolean,
    stats: CoverageExtractionStats | null,
    error: string | null
  ) => void;

  clearError: () => void;
  clearSearchResults: () => void;
}

export const useCoverageStore = create<CoverageState>((set, get) => ({
  // 初始状态
  status: null,
  searchResults: [],
  extractionProgress: null,
  lastExtractionStats: null,
  isLoadingStatus: false,
  isExtracting: false,
  isSearching: false,
  error: null,

  // 获取覆盖状态
  fetchStatus: async () => {
    try {
      set({ isLoadingStatus: true, error: null });

      const status = await invoke<CoverageStatus>("get_coverage_status");

      set({
        status,
        isLoadingStatus: false,
      });
    } catch (error) {
      console.error("获取覆盖状态失败:", error);
      set({
        error: error instanceof Error ? error.message : String(error),
        isLoadingStatus: false,
      });
    }
  },

  // 启动提取 (命令立即返回，进度通过事件更新)
  startExtraction: async () => {
    try {
      set({
        isExtracting: true,
        error: null,
        extractionProgress: null,
        lastExtractionStats: null,
      });

      // 命令立即返回，不等待提取完成
      await invoke("run_coverage_extraction");

      // 注意：isExtracting 将在收到 coverage_complete 事件后由 setExtractionComplete 设为 false
    } catch (error) {
      // 这里只会捕获预检查阶段的错误（如没有游戏路径）
      console.error("启动覆盖提取失败:", error);
      set({
        error: error instanceof Error ? error.message : String(error),
        isExtracting: false,
        extractionProgress: null,
      });
    }
  },

  // 搜索覆盖记录
  searchEntries: async (
    formIdQuery?: string,
    textQuery?: string,
    limit = 100
  ) => {
    try {
      set({ isSearching: true, error: null });

      const results = await invoke<CoverageEntry[]>("search_coverage_entries", {
        formIdQuery: formIdQuery || null,
        textQuery: textQuery || null,
        limit,
      });

      set({
        searchResults: results,
        isSearching: false,
      });
    } catch (error) {
      console.error("搜索覆盖记录失败:", error);
      set({
        error: error instanceof Error ? error.message : String(error),
        isSearching: false,
        searchResults: [],
      });
    }
  },

  // 事件驱动：更新提取进度
  setExtractionProgress: (progress: CoverageProgressPayload) => {
    set({ extractionProgress: progress });
  },

  // 事件驱动：提取完成
  setExtractionComplete: (
    _success: boolean,
    stats: CoverageExtractionStats | null,
    error: string | null
  ) => {
    set({
      isExtracting: false,
      extractionProgress: null,
      lastExtractionStats: stats,
      error: error,
    });

    // 提取完成后自动刷新状态 (无论成功失败，以便显示可能的部分写入数据)
    get().fetchStatus();
  },

  // 清除错误
  clearError: () => {
    set({ error: null });
  },

  // 清除搜索结果
  clearSearchResults: () => {
    set({ searchResults: [] });
  },
}));
