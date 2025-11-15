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

/**
 * 翻译更新事件 Payload
 */
export interface TranslationUpdatedPayload {
  form_id: string;
  record_type: string;
  subrecord_type: string;
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
  // ✅ 跟踪未保存的修改（Map: session_id -> Set<form_id>）
  pendingChanges: new Map(),
  // ✅ 筛选状态（Map: session_id -> filter status）
  filterStatus: new Map(),
  // ✅ 行选择状态（Map: session_id -> Set<row_id>，row_id = "form_id|record_type|subrecord_type"）
  selectedRows: new Map(),

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
          activeSessionId: newActiveSessionId,
          isLoading: false,
        };
      });
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
        const key = `${t.form_id}|${t.record_type}|${t.subrecord_type}`;
        translationMap!.set(key, t.translated_text);
      });

      // 4. ✅ 使用 Immer 原地更新，避免创建新数组（节省约 60% 内存）
      const updatedSession = produce(session, (draft) => {
        draft.strings.forEach((s) => {
          const key = `${s.form_id}|${s.record_type}|${s.subrecord_type}`;
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
   */
  updateStringRecord: (
    sessionId: string,
    formId: string,
    recordType: string,
    subrecordType: string,
    translatedText: string,
    translationStatus: string,
  ) => {
    const { openedSessions } = get();
    const session = openedSessions.get(sessionId);

    if (!session) {
      console.warn(`Session 不存在: ${sessionId}`);
      return;
    }

    // ✅ 使用 Immer 原地更新，避免创建新数组
    const updatedSession = produce(session, (draft) => {
      const record = draft.strings.find(
        (s) =>
          s.form_id === formId &&
          s.record_type === recordType &&
          s.subrecord_type === subrecordType,
      );

      if (record) {
        record.translated_text = translatedText;
        record.translation_status = translationStatus as any;
      }
    });

    // 更新 Session 数据
    set((state) => {
      const newSessions = new Map(state.openedSessions);
      newSessions.set(sessionId, updatedSession);

      // ✅ 标记为待保存
      const newPendingChanges = new Map(state.pendingChanges);
      const changes = newPendingChanges.get(sessionId) || new Set<string>();
      changes.add(formId);
      newPendingChanges.set(sessionId, changes);

      return {
        openedSessions: newSessions,
        pendingChanges: newPendingChanges,
      };
    });

    console.log(`✓ 已更新记录: ${formId} (${sessionId})`);
  },

  /**
   * 初始化编辑窗口事件监听器
   *
   * 监听来自编辑窗口的翻译更新事件
   */
  initEditorEventListener: async () => {
    const unlisten = await listen<TranslationUpdatedPayload>(
      "translation-updated",
      (event) => {
        const {
          form_id,
          record_type,
          subrecord_type,
          translated_text,
          translation_status,
        } = event.payload;

        // 查找对应的 Session（遍历所有打开的 Session）
        const { openedSessions, updateStringRecord } =
          useSessionStore.getState();

        for (const [sessionId, session] of openedSessions.entries()) {
          const record = session.strings.find(
            (s) =>
              s.form_id === form_id &&
              s.record_type === record_type &&
              s.subrecord_type === subrecord_type,
          );

          if (record && updateStringRecord) {
            // 找到对应的 Session，更新记录
            updateStringRecord(
              sessionId,
              form_id,
              record_type,
              subrecord_type,
              translated_text,
              translation_status,
            );
            console.log(`✓ 编辑窗口更新已应用: ${form_id} (${sessionId})`);
            break;
          }
        }
      },
    );

    return () => {
      unlisten();
    };
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
        // ✅ 只保存在 pendingChanges 中的记录
        if (changedFormIds.has(record.form_id)) {
          const now = Math.floor(Date.now() / 1000);

          translationsToSave.push({
            form_id: record.form_id,
            record_type: record.record_type,
            subrecord_type: record.subrecord_type,
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
      // ✅ 只保存在 pendingChanges 中的记录
      if (changedFormIds.has(record.form_id)) {
        const now = Math.floor(Date.now() / 1000);

        translationsToSave.push({
          form_id: record.form_id,
          record_type: record.record_type,
          subrecord_type: record.subrecord_type,
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

      // ✅ 清空该 session 的 pendingChanges
      if (pendingChanges && pendingChanges.has(sessionId)) {
        const newPendingChanges = new Map(pendingChanges);
        newPendingChanges.delete(sessionId);
        set({ pendingChanges: newPendingChanges });
      }

      return translationsToSave.length;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Session ${sessionId}: 保存翻译失败:`, errorMsg);
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
   * @param rowIds - 行ID集合（格式："form_id|record_type|subrecord_type"）
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
   * @returns 行ID集合（格式："form_id|record_type|subrecord_type"）
   */
  getSelectedRows: (sessionId: string): Set<string> => {
    const { selectedRows } = get();
    return selectedRows?.get(sessionId) || new Set<string>();
  },
}));
