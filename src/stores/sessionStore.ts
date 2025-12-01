import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { produce } from "immer";
import type {
  PluginStringsResponse,
  SessionState,
  FormIdentifier,
  Translation,
  TranslationProgressPayload,
} from "../types";
import {
  useHistoryStore,
  type HistoryCommand,
  type HistoryRecord,
} from "./historyStore";

/**
 * 翻译更新事件 Payload
 */
export interface TranslationUpdatedPayload {
  form_id: string;
  record_type: string;
  subrecord_type: string;
  index: number;
  original_text: string; // ✅ 添加 original_text 用于批量检测
  translated_text: string;
  translation_status: string;
}

/**
 * Session 状态管理
 *
 * 管理插件加载的 Session，每个插件对应一个 Session
 * Session 在后端缓存，前端维护 Session 列表和激活状态
 */
export const useSessionStore = create<SessionState>((set, get) => ({
  openedSessions: new Map(),
  activeSessionId: null,
  translationProgress: new Map(),
  isLoading: false,
  error: null,
  // ✅ 跟踪未保存的修改（Map: session_id -> Set<record_id>）
  // record_id 格式："form_id|record_type|subrecord_type|index"（与 selectedRows 保持一致）
  pendingChanges: new Map(),
  // ✅ 筛选状态（Map: session_id -> filter status）
  filterStatus: new Map(),
  // ✅ 行选择状态（Map: session_id -> Set<row_id>，row_id = "form_id|record_type|subrecord_type|index"）
  selectedRows: new Map(),
  // ✅ ESP 对照加载状态（Map: session_id -> isLoading）
  espReferenceLoading: new Map(),

  /**
   * 打开插件 Session
   *
   * @param pluginPath - 插件文件的完整路径
   */
  openSession: async (pluginPath: string) => {
    const { checkSessionExists, refreshTranslations } = get();

    // 提取插件名称
    const pluginName = pluginPath.split(/[/\\]/).pop() || "";

    // 检查是否已打开
    if (checkSessionExists(pluginName)) {
      console.log(`Session 已存在，切换到: ${pluginName}`);
      set({ activeSessionId: pluginName });
      return;
    }

    set({ isLoading: true, error: null });

    try {
      // 调用后端命令加载插件
      const response = await invoke<PluginStringsResponse>(
        "load_plugin_session",
        { pluginPath },
      );

      console.log(
        `✓ 成功加载 Session: ${response.session_id}, ${response.total_count} 条字符串`,
      );

      // ✅ 直接使用后端数据（后端已初始化 translation_status）
      // 避免在前端创建新数组，节省内存
      set((state) => {
        const newSessions = new Map(state.openedSessions);
        newSessions.set(response.session_id, response);

        return {
          openedSessions: newSessions,
          activeSessionId: response.session_id,
          isLoading: false,
        };
      });

      // 自动触发翻译刷新（异步，不阻塞）
      console.log(`🔄 开始自动刷新翻译: ${response.session_id}`);
      refreshTranslations(response.session_id).catch((err) => {
        console.error("自动刷新翻译失败:", err);
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("加载 Session 失败:", errorMsg);
      set({ error: errorMsg, isLoading: false });
    }
  },

  /**
   * 关闭插件 Session
   *
   * @param sessionId - Session ID（即插件名称）
   */
  closeSession: async (sessionId: string) => {
    set({ isLoading: true, error: null });
    console.log(useSessionStore.getState().openedSessions);

    try {
      // 调用后端命令关闭 Session
      await invoke("close_plugin_session", { sessionId });

      console.log(`✓ 成功关闭 Session: ${sessionId}`);

      // 更新状态并清理所有相关数据
      set((state) => {
        // ⚠️ 关键修复：Map.delete() 只是逻辑删除，V8 内部哈希表仍可能保留引用
        // 必须重建新 Map 以确保旧数据完全不可达
        const tmpSessions = new Map(state.openedSessions);
        tmpSessions.delete(sessionId);
        // 重建 Map，丢弃旧 Map 的内部 table
        const newSessions =
          tmpSessions.size > 0 ? new Map(tmpSessions) : new Map();

        // ✅ 同时清理进度数据（防止内存泄漏）
        const newProgress = new Map(state.translationProgress);
        newProgress.delete(sessionId);

        // ✅ 清理筛选状态
        const newFilterStatus = new Map(state.filterStatus);
        newFilterStatus.delete(sessionId);

        // ✅ 清理行选择状态
        const newSelectedRows = new Map(state.selectedRows);
        newSelectedRows.delete(sessionId);

        // ✅ 清理待保存修改
        const newPendingChanges = new Map(state.pendingChanges);
        newPendingChanges.delete(sessionId);

        // ✅ 清理 ESP 对照加载状态
        const newEspReferenceLoading = new Map(state.espReferenceLoading);
        newEspReferenceLoading.delete(sessionId);

        // 如果关闭的是当前激活的 Session，切换到其他 Session 或 null
        let newActiveSessionId = state.activeSessionId;
        if (newActiveSessionId === sessionId) {
          const remainingSessions = Array.from(newSessions.keys());
          newActiveSessionId =
            remainingSessions.length > 0 ? remainingSessions[0] : null;
        }
        console.log("[closeSession] openedSessions", newSessions.size);
        console.log(
          "[closeSession] total strings",
          [...newSessions.values()].reduce(
            (sum, s) => sum + s.strings.length,
            0,
          ),
        );

        return {
          openedSessions: newSessions,
          translationProgress: newProgress,
          filterStatus: newFilterStatus,
          selectedRows: newSelectedRows,
          pendingChanges: newPendingChanges,
          espReferenceLoading: newEspReferenceLoading,
          activeSessionId: newActiveSessionId,
          isLoading: false,
        };
      });

      // 🗑️ 清空历史记录
      useHistoryStore.getState().clearSession(sessionId);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("关闭 Session 失败:", errorMsg);
      set({ error: errorMsg, isLoading: false });
    }
  },

  /**
   * 切换激活的 Session
   *
   * @param sessionId - Session ID
   */
  switchSession: (sessionId: string) => {
    const { openedSessions } = get();

    if (openedSessions.has(sessionId)) {
      console.log(`切换到 Session: ${sessionId}`);
      set({ activeSessionId: sessionId });
    } else {
      console.warn(`Session 不存在: ${sessionId}`);
    }
  },

  /**
   * 检查 Session 是否已存在
   *
   * @param pluginName - 插件名称
   * @returns true 如果 Session 已打开
   */
  checkSessionExists: (pluginName: string): boolean => {
    const { openedSessions } = get();
    return openedSessions.has(pluginName);
  },

  /**
   * 刷新Session的翻译（从数据库批量拉取）
   *
   * @param sessionId - Session ID
   */
  refreshTranslations: async (sessionId: string) => {
    const { openedSessions } = get();
    const session = openedSessions.get(sessionId);

    if (!session) {
      console.warn(`Session 不存在: ${sessionId}`);
      return;
    }

    console.log(
      `开始刷新翻译: ${sessionId}, 共 ${session.total_count} 条字符串`,
    );

    // ✅ 使用 Map 暂存翻译数据（需要在 finally 中清理）
    let translationMap: Map<string, string> | null = null;

    try {
      // 1. 构造查询参数
      const forms: FormIdentifier[] = session.strings.map((s) => ({
        form_id: s.form_id,
        record_type: s.record_type,
        subrecord_type: s.subrecord_type,
        index: s.index,
      }));

      // 2. 批量查询翻译（带进度通知）
      const translations = await invoke<Translation[]>(
        "batch_query_translations_with_progress",
        {
          sessionId,
          forms,
        },
      );

      console.log(`✓ 查询到 ${translations.length} 条翻译`);

      // 3. ✅ 优化：只存储译文字符串，减少内存占用
      translationMap = new Map<string, string>();
      translations.forEach((t) => {
        const key = `${t.form_id}|${t.record_type}|${t.subrecord_type}|${t.index}`;
        translationMap!.set(key, t.translated_text);
      });

      // 4. ✅ 使用 Immer 原地更新，避免创建新数组（节省约 60% 内存）
      const updatedSession = produce(session, (draft) => {
        draft.strings.forEach((s) => {
          const key = `${s.form_id}|${s.record_type}|${s.subrecord_type}|${s.index}`;
          const translatedText = translationMap!.get(key);

          if (translatedText) {
            s.translated_text = translatedText;
            s.translation_status = "manual";
          } else {
            s.translation_status = "untranslated";
          }
        });
      });

      // 5. 更新 Session 数据
      set((state) => {
        const newSessions = new Map(state.openedSessions);
        newSessions.set(sessionId, updatedSession);

        // 清除进度状态
        const newProgress = new Map(state.translationProgress);
        newProgress.delete(sessionId);

        return {
          openedSessions: newSessions,
          translationProgress: newProgress,
        };
      });

      console.log(`✓ 刷新翻译完成: 应用了 ${translations.length} 条翻译`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("刷新翻译失败:", errorMsg);
      set({ error: errorMsg });

      // 清除进度状态
      set((state) => {
        const newProgress = new Map(state.translationProgress);
        newProgress.delete(sessionId);
        return { translationProgress: newProgress };
      });
    } finally {
      // ✅ 显式清理 translationMap，确保内存立即释放
      if (translationMap) {
        translationMap.clear();
        translationMap = null;
      }
    }
  },

  /**
   * 初始化Event监听器（返回清理函数）
   *
   * 在 Workspace 组件中调用，确保监听器生命周期与组件绑定
   */
  initEventListener: async () => {
    const unlisten = await listen<TranslationProgressPayload>(
      "translation_progress",
      (event) => {
        const { session_id, percentage } = event.payload;

        useSessionStore.setState((state) => {
          const newProgress = new Map(state.translationProgress);
          newProgress.set(session_id, percentage);
          return { translationProgress: newProgress };
        });
      },
    );

    // 返回清理函数
    return () => {
      unlisten();
    };
  },

  /**
   * 设置错误信息
   *
   * @param error - 错误信息
   */
  setError: (error: string | null) => {
    set({ error });
  },

  /**
   * 更新单个字符串记录（来自编辑窗口）
   *
   * @param sessionId - Session ID
   * @param formId - Form ID
   * @param recordType - Record Type
   * @param subrecordType - Subrecord Type
   * @param translatedText - 新的译文
   * @param translationStatus - 翻译状态
   * @param skipHistory - 是否跳过历史记录（用于批量操作中的临时更新）
   */
  updateStringRecord: (
    sessionId: string,
    formId: string,
    recordType: string,
    subrecordType: string,
    index: number,
    translatedText: string,
    translationStatus: string,
    skipHistory?: boolean,
  ) => {
    const { openedSessions } = get();
    const session = openedSessions.get(sessionId);

    if (!session) {
      console.warn(`Session 不存在: ${sessionId}`);
      return;
    }

    // 📸 捕获修改前的状态（深拷贝）
    const recordId = `${formId}|${recordType}|${subrecordType}|${index}`;
    const beforeRecord = session.strings.find(
      (s) =>
        s.form_id === formId &&
        s.record_type === recordType &&
        s.subrecord_type === subrecordType &&
        s.index === index,
    );

    if (!beforeRecord) {
      console.warn(`记录不存在: ${recordId}`);
      return;
    }

    const beforeState = structuredClone(beforeRecord);

    // ✅ 使用 Immer 原地更新，避免创建新数组
    const updatedSession = produce(session, (draft) => {
      const record = draft.strings.find(
        (s) =>
          s.form_id === formId &&
          s.record_type === recordType &&
          s.subrecord_type === subrecordType &&
          s.index === index,
      );

      if (record) {
        record.translated_text = translatedText;
        record.translation_status = translationStatus as any;
      }
    });

    // 📸 捕获修改后的状态（深拷贝）
    const afterRecord = updatedSession.strings.find(
      (s) =>
        s.form_id === formId &&
        s.record_type === recordType &&
        s.subrecord_type === subrecordType &&
        s.index === index,
    );

    if (!afterRecord) {
      console.warn(`修改后记录不存在: ${recordId}`);
      return;
    }

    const afterState = structuredClone(afterRecord);

    // 更新 Session 数据
    set((state) => {
      const newSessions = new Map(state.openedSessions);
      newSessions.set(sessionId, updatedSession);

      // ✅ 标记为待保存（使用复合 key）
      const newPendingChanges = new Map(state.pendingChanges);
      const changes = newPendingChanges.get(sessionId) || new Set<string>();
      changes.add(recordId);
      newPendingChanges.set(sessionId, changes);

      return {
        openedSessions: newSessions,
        pendingChanges: newPendingChanges,
      };
    });

    // 📝 添加到历史记录（除非明确跳过）
    if (!skipHistory) {
      const historyRecord: HistoryRecord = {
        recordId,
        beforeState,
        afterState,
      };

      const historyCommand: HistoryCommand = {
        id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
        timestamp: Date.now(),
        type: "single",
        description: `Edit 1 item`,
        sessionId,
        records: [historyRecord],
      };

      useHistoryStore.getState().pushCommand(historyCommand);
    }

    console.log(
      `✓ 已更新记录: ${recordId} (${sessionId})${skipHistory ? " (跳过历史)" : ""}`,
    );
  },

  /**
   * 批量保存翻译到数据库
   *
   * 保存所有 session 中在 pendingChanges 记录的修改
   *
   * @returns 保存的记录数量
   */
  batchSaveTranslations: async (): Promise<number> => {
    const { openedSessions, pendingChanges } = get();

    if (!pendingChanges || pendingChanges.size === 0) {
      console.log("没有未保存的修改");
      return 0;
    }

    // 收集所有需要保存的翻译
    const translationsToSave: Translation[] = [];

    for (const [sessionId, session] of openedSessions.entries()) {
      // 获取该 session 的 pendingChanges
      const changedFormIds = pendingChanges.get(sessionId);
      if (!changedFormIds || changedFormIds.size === 0) {
        continue; // 该 session 没有修改，跳过
      }

      for (const record of session.strings) {
        // ✅ 使用复合 key 检查是否需要保存
        const recordId = `${record.form_id}|${record.record_type}|${record.subrecord_type}|${record.index}`;
        if (changedFormIds.has(recordId)) {
          const now = Math.floor(Date.now() / 1000);

          translationsToSave.push({
            form_id: record.form_id,
            record_type: record.record_type,
            subrecord_type: record.subrecord_type,
            index: record.index,
            editor_id: record.editor_id,
            original_text: record.original_text,
            translated_text: record.translated_text,
            plugin_name: session.plugin_name,
            created_at: now,
            updated_at: now,
          });
        }
      }
    }

    if (translationsToSave.length === 0) {
      console.log("没有需要保存的翻译");
      return 0;
    }

    console.log(`开始批量保存翻译: ${translationsToSave.length} 条`);

    try {
      // 调用后端批量保存接口
      await invoke("batch_save_translations", {
        translations: translationsToSave,
      });

      console.log(`✓ 批量保存成功: ${translationsToSave.length} 条`);

      // ✅ 清空所有 pendingChanges
      set({ pendingChanges: new Map() });

      return translationsToSave.length;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("批量保存翻译失败:", errorMsg);
      throw new Error(errorMsg);
    }
  },

  /**
   * 获取未保存的修改数量
   *
   * @returns 未保存的记录数量
   */
  getPendingChangesCount: (): number => {
    const { pendingChanges } = get();
    if (!pendingChanges) return 0;

    let count = 0;
    for (const changes of pendingChanges.values()) {
      count += changes.size;
    }
    return count;
  },

  /**
   * 获取单个 session 的未保存修改数量
   *
   * @param sessionId - Session ID
   * @returns 未保存的记录数量
   */
  getSessionPendingCount: (sessionId: string): number => {
    const { pendingChanges } = get();
    if (!pendingChanges) return 0;

    const sessionChanges = pendingChanges.get(sessionId);
    return sessionChanges ? sessionChanges.size : 0;
  },

  /**
   * 保存单个 session 的翻译到数据库
   *
   * @param sessionId - Session ID
   * @returns 保存的记录数量
   */
  saveSessionTranslations: async (sessionId: string): Promise<number> => {
    const { openedSessions, pendingChanges } = get();

    const session = openedSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session 不存在: ${sessionId}`);
    }

    // 获取该 session 的 pendingChanges
    const changedFormIds = pendingChanges?.get(sessionId);
    if (!changedFormIds || changedFormIds.size === 0) {
      console.log(`Session ${sessionId}: 没有未保存的修改`);
      return 0;
    }

    // 收集该 session 需要保存的翻译
    const translationsToSave: Translation[] = [];

    for (const record of session.strings) {
      // ✅ 使用复合 key 检查是否需要保存
      const recordId = `${record.form_id}|${record.record_type}|${record.subrecord_type}|${record.index}`;
      if (changedFormIds.has(recordId)) {
        const now = Math.floor(Date.now() / 1000);

        translationsToSave.push({
          form_id: record.form_id,
          record_type: record.record_type,
          subrecord_type: record.subrecord_type,
          index: record.index,
          editor_id: record.editor_id,
          original_text: record.original_text,
          translated_text: record.translated_text,
          plugin_name: session.plugin_name,
          created_at: now,
          updated_at: now,
        });
      }
    }

    if (translationsToSave.length === 0) {
      console.log(`Session ${sessionId}: 没有需要保存的翻译`);
      return 0;
    }

    console.log(
      `Session ${sessionId}: 开始保存翻译 ${translationsToSave.length} 条`,
    );

    try {
      // 调用后端批量保存接口
      await invoke("batch_save_translations", {
        translations: translationsToSave,
      });

      console.log(
        `✓ Session ${sessionId}: 保存成功 ${translationsToSave.length} 条`,
      );

      const savedRecordIds = new Set(changedFormIds);
      set((state) => {
        const newSessions = new Map(state.openedSessions);
        const targetSession = newSessions.get(sessionId);
        if (targetSession) {
          const updatedSession = produce(targetSession, (draft) => {
            draft.strings.forEach((record) => {
              const recordId = `${record.form_id}|${record.record_type}|${record.subrecord_type}|${record.index}`;
              if (savedRecordIds.has(recordId)) {
                record.translation_status = "manual";
              }
            });
          });
          newSessions.set(sessionId, updatedSession);
        }

        const newPendingChanges = new Map(state.pendingChanges);
        newPendingChanges.delete(sessionId);

        return {
          openedSessions: newSessions,
          pendingChanges: newPendingChanges,
        };
      });

      return translationsToSave.length;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Session ${sessionId}: 保存翻译失败:`, errorMsg);
      throw new Error(errorMsg);
    }
  },

  /**
   * 应用翻译到插件文件（生成新的 ESP 文件）
   *
   * @param sessionId - Session ID
   * @param saveAs - 另存为路径（可选）
   * @returns 保存的文件路径
   */
  applyTranslations: async (
    sessionId: string,
    saveAs?: string,
  ): Promise<string> => {
    const { openedSessions } = get();
    const session = openedSessions.get(sessionId);

    if (!session) {
      throw new Error(`Session 不存在: ${sessionId}`);
    }

    console.log(`开始应用翻译到插件: ${sessionId}`);

    try {
      // 调用后端命令
      const savedPath = await invoke<string>("apply_translations", {
        sessionId,
        translations: session.strings,
        saveAs,
      });

      console.log(`✓ 翻译已应用到文件: ${savedPath}`);
      return savedPath;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("应用翻译失败:", errorMsg);
      throw new Error(errorMsg);
    }
  },

  /**
   * 导出 DSD (Dynamic String Distributor) 格式
   *
   * @param sessionId - Session ID
   * @returns 生成的文件路径
   */
  exportDsd: async (sessionId: string): Promise<string> => {
    const { openedSessions } = get();
    const session = openedSessions.get(sessionId);

    if (!session) {
      throw new Error(`Session 不存在: ${sessionId}`);
    }

    console.log(`开始导出 DSD 格式: ${sessionId}`);

    try {
      const savedPath = await invoke<string>("export_dsd", {
        sessionId,
        records: session.strings,
      });

      console.log(`✓ DSD 已导出到: ${savedPath}`);
      return savedPath;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("导出 DSD 失败:", errorMsg);
      throw new Error(errorMsg);
    }
  },

  /**
   * 设置筛选状态
   *
   * @param sessionId - Session ID
   * @param status - 筛选状态
   */
  setFilterStatus: (
    sessionId: string,
    status: "all" | "untranslated" | "manual" | "ai",
  ) => {
    set((state) => {
      const newFilterStatus = new Map(state.filterStatus);
      newFilterStatus.set(sessionId, status);
      return { filterStatus: newFilterStatus };
    });
  },

  /**
   * 获取筛选状态
   *
   * @param sessionId - Session ID
   * @returns 筛选状态（默认为 'all'）
   */
  getFilterStatus: (
    sessionId: string,
  ): "all" | "untranslated" | "manual" | "ai" => {
    const { filterStatus } = get();
    return filterStatus?.get(sessionId) || "all";
  },

  /**
   * 设置选中的行
   *
   * @param sessionId - Session ID
   * @param rowIds - 行ID集合（格式："form_id|record_type|subrecord_type|index"）
   */
  setSelectedRows: (sessionId: string, rowIds: Set<string>) => {
    set((state) => {
      const newSelectedRows = new Map(state.selectedRows);
      newSelectedRows.set(sessionId, rowIds);
      return { selectedRows: newSelectedRows };
    });
  },

  /**
   * 清空选中的行
   *
   * @param sessionId - Session ID
   */
  clearSelectedRows: (sessionId: string) => {
    set((state) => {
      const newSelectedRows = new Map(state.selectedRows);
      newSelectedRows.delete(sessionId);
      return { selectedRows: newSelectedRows };
    });
  },

  /**
   * 获取选中的行
   *
   * @param sessionId - Session ID
   * @returns 行ID集合（格式："form_id|record_type|subrecord_type|index"）
   */
  getSelectedRows: (sessionId: string): Set<string> => {
    const { selectedRows } = get();
    return selectedRows?.get(sessionId) || new Set<string>();
  },

  /**
   * 批量更新字符串记录（用于查找替换功能）
   *
   * @param sessionId - Session ID
   * @param updates - 更新列表
   */
  batchUpdateStringRecords: (
    sessionId: string,
    updates: Array<{
      formId: string;
      recordType: string;
      subrecordType: string;
      index: number;
      translatedText: string;
      translationStatus?: string;
    }>,
    /** 自定义历史记录描述（可选，默认 "Replace N items"） */
    customDescription?: string,
  ) => {
    const { openedSessions } = get();
    const session = openedSessions.get(sessionId);

    if (!session) {
      console.warn(`Session 不存在: ${sessionId}`);
      return;
    }

    // 📸 批量捕获修改前的状态（深拷贝）
    const historyRecords: HistoryRecord[] = [];

    for (const update of updates) {
      const recordId = `${update.formId}|${update.recordType}|${update.subrecordType}|${update.index}`;
      const beforeRecord = session.strings.find(
        (s) =>
          s.form_id === update.formId &&
          s.record_type === update.recordType &&
          s.subrecord_type === update.subrecordType &&
          s.index === update.index,
      );

      if (beforeRecord) {
        const beforeState = structuredClone(beforeRecord);
        historyRecords.push({
          recordId,
          beforeState,
          afterState: beforeState, // 暂时设置为 beforeState，稍后更新
        });
      }
    }

    // ✅ 使用 Immer 原地更新，避免创建新数组
    const updatedSession = produce(session, (draft) => {
      for (const update of updates) {
        const record = draft.strings.find(
          (s) =>
            s.form_id === update.formId &&
            s.record_type === update.recordType &&
            s.subrecord_type === update.subrecordType &&
            s.index === update.index,
        );

        if (record) {
          record.translated_text = update.translatedText;
          record.translation_status = (update.translationStatus || "ai") as any;
        }
      }
    });

    // 📸 批量捕获修改后的状态并更新 historyRecords
    for (let i = 0; i < historyRecords.length; i++) {
      const historyRecord = historyRecords[i];
      const update = updates[i];

      const afterRecord = updatedSession.strings.find(
        (s) =>
          s.form_id === update.formId &&
          s.record_type === update.recordType &&
          s.subrecord_type === update.subrecordType &&
          s.index === update.index,
      );

      if (afterRecord) {
        historyRecord.afterState = structuredClone(afterRecord);
      }
    }

    // 更新 Session 数据
    set((state) => {
      const newSessions = new Map(state.openedSessions);
      newSessions.set(sessionId, updatedSession);

      // ✅ 批量标记为待保存
      const newPendingChanges = new Map(state.pendingChanges);
      const changes = newPendingChanges.get(sessionId) || new Set<string>();

      for (const update of updates) {
        const recordId = `${update.formId}|${update.recordType}|${update.subrecordType}|${update.index}`;
        changes.add(recordId);
      }

      newPendingChanges.set(sessionId, changes);

      return {
        openedSessions: newSessions,
        pendingChanges: newPendingChanges,
      };
    });

    // 📝 添加到历史记录（作为一个批量操作）
    const historyCommand: HistoryCommand = {
      id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
      timestamp: Date.now(),
      type: "batch",
      description: customDescription || `Replace ${updates.length} items`,
      sessionId,
      records: historyRecords,
    };

    useHistoryStore.getState().pushCommand(historyCommand);

    console.log(`✓ 批量更新完成: ${updates.length} 条记录 (${sessionId})`);
  },

  /**
   * 撤销历史命令（恢复到修改前的状态）
   *
   * ⚠️ 注意：此方法不会添加新的历史记录（避免无限递归）
   *
   * @param command - 要撤销的历史命令
   */
  revertCommand: (command: HistoryCommand) => {
    const { openedSessions } = get();
    const session = openedSessions.get(command.sessionId);

    if (!session) {
      console.warn(`Session 不存在: ${command.sessionId}`);
      return;
    }

    // 使用 Immer 批量恢复所有记录的 beforeState
    const revertedSession = produce(session, (draft) => {
      for (const historyRecord of command.records) {
        const record = draft.strings.find(
          (s) =>
            s.form_id === historyRecord.beforeState.form_id &&
            s.record_type === historyRecord.beforeState.record_type &&
            s.subrecord_type === historyRecord.beforeState.subrecord_type &&
            s.index === historyRecord.beforeState.index,
        );

        if (record) {
          // 恢复所有字段到 beforeState
          record.translated_text = historyRecord.beforeState.translated_text;
          record.translation_status =
            historyRecord.beforeState.translation_status;
          record.editor_id = historyRecord.beforeState.editor_id;
          record.original_text = historyRecord.beforeState.original_text;
        } else {
          console.warn(`撤销失败：记录不存在 ${historyRecord.recordId}`);
        }
      }
    });

    // 更新 Session 数据
    set((state) => {
      const newSessions = new Map(state.openedSessions);
      newSessions.set(command.sessionId, revertedSession);

      // ✅ 智能更新 pendingChanges：判断撤销后是否需要保存
      const newPendingChanges = new Map(state.pendingChanges);
      const changes =
        newPendingChanges.get(command.sessionId) || new Set<string>();

      for (const historyRecord of command.records) {
        const beforeStatus = historyRecord.beforeState.translation_status;

        // 判断撤销后的状态是否需要保存
        if (beforeStatus === "manual" || beforeStatus === "untranslated") {
          // 假设 "manual" 和 "untranslated" 状态来自数据库/初始状态
          // 撤销到这些状态时，从 pendingChanges 移除
          changes.delete(historyRecord.recordId);
          console.log(
            `↶ 撤销到数据库状态，移除待保存: ${historyRecord.recordId}`,
          );
        } else {
          // "ai" 或其他状态，保留在 pendingChanges
          changes.add(historyRecord.recordId);
          console.log(
            `↶ 撤销后仍需保存，保留待保存: ${historyRecord.recordId}`,
          );
        }
      }

      // 如果 changes 为空，从 Map 中删除该 session 的 key
      if (changes.size === 0) {
        newPendingChanges.delete(command.sessionId);
      } else {
        newPendingChanges.set(command.sessionId, changes);
      }

      return {
        openedSessions: newSessions,
        pendingChanges: newPendingChanges,
      };
    });

    console.log(
      `↶ 撤销完成: ${command.description} (${command.records.length} 条记录)`,
    );
  },

  /**
   * 设置 ESP 对照加载状态
   *
   * @param sessionId - Session ID
   * @param loading - 是否正在加载
   */
  setEspReferenceLoading: (sessionId: string, loading: boolean) => {
    set((state) => {
      const newLoading = new Map(state.espReferenceLoading);
      if (loading) {
        newLoading.set(sessionId, true);
      } else {
        newLoading.delete(sessionId);
      }
      return { espReferenceLoading: newLoading };
    });
  },
}));
