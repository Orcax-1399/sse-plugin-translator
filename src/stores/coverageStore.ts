import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  CoverageStatus,
  CoverageEntry,
  CoverageExtractionStats,
  CoverageExtractionProgress,
} from "../types";

/**
 * Coverage DB 状态管理
 */
interface CoverageState {
  // 状态数据
  status: CoverageStatus | null;
  searchResults: CoverageEntry[];
  extractionProgress: CoverageExtractionProgress | null;
  lastExtractionStats: CoverageExtractionStats | null;

  // 加载状态
  isLoadingStatus: boolean;
  isExtracting: boolean;
  isSearching: boolean;

  // 错误信息
  error: string | null;

  // Actions
  fetchStatus: () => Promise<void>;
  startExtraction: () => Promise<CoverageExtractionStats | null>;
  searchEntries: (
    formIdQuery?: string,
    textQuery?: string,
    limit?: number
  ) => Promise<void>;
  pollProgress: () => Promise<CoverageExtractionProgress | null>;
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

  // 开始提取
  startExtraction: async () => {
    try {
      set({ isExtracting: true, error: null, extractionProgress: null });

      const stats = await invoke<CoverageExtractionStats>(
        "run_coverage_extraction"
      );

      set({
        lastExtractionStats: stats,
        isExtracting: false,
        extractionProgress: null,
      });

      // 提取完成后刷新状态
      await get().fetchStatus();

      return stats;
    } catch (error) {
      console.error("覆盖提取失败:", error);
      set({
        error: error instanceof Error ? error.message : String(error),
        isExtracting: false,
        extractionProgress: null,
      });
      return null;
    }
  },

  // 搜索覆盖记录
  searchEntries: async (formIdQuery?: string, textQuery?: string, limit = 100) => {
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

  // 轮询进度
  pollProgress: async () => {
    try {
      const progress = await invoke<CoverageExtractionProgress>(
        "get_coverage_extraction_progress"
      );

      set({ extractionProgress: progress });

      return progress;
    } catch (error) {
      console.error("获取进度失败:", error);
      return null;
    }
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
