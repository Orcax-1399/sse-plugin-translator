import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  PluginStringsResponse,
  SessionState,
  FormIdentifier,
  Translation,
  TranslationProgressPayload
} from '../types';

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

  /**
   * 打开插件 Session
   *
   * @param pluginPath - 插件文件的完整路径
   */
  openSession: async (pluginPath: string) => {
    const { checkSessionExists, refreshTranslations } = get();

    // 提取插件名称
    const pluginName = pluginPath.split(/[/\\]/).pop() || '';

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
        'load_plugin_session',
        { pluginPath }
      );

      console.log(`✓ 成功加载 Session: ${response.session_id}, ${response.total_count} 条字符串`);

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
        console.error('自动刷新翻译失败:', err);
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('加载 Session 失败:', errorMsg);
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

    try {
      // 调用后端命令关闭 Session
      await invoke('close_plugin_session', { sessionId });

      console.log(`✓ 成功关闭 Session: ${sessionId}`);

      // 更新状态并清理所有相关数据
      set((state) => {
        const newSessions = new Map(state.openedSessions);
        newSessions.delete(sessionId);

        // ✅ 同时清理进度数据（防止内存泄漏）
        const newProgress = new Map(state.translationProgress);
        newProgress.delete(sessionId);

        // 如果关闭的是当前激活的 Session，切换到其他 Session 或 null
        let newActiveSessionId = state.activeSessionId;
        if (newActiveSessionId === sessionId) {
          const remainingSessions = Array.from(newSessions.keys());
          newActiveSessionId = remainingSessions.length > 0 ? remainingSessions[0] : null;
        }

        return {
          openedSessions: newSessions,
          translationProgress: newProgress,
          activeSessionId: newActiveSessionId,
          isLoading: false,
        };
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('关闭 Session 失败:', errorMsg);
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

    console.log(`开始刷新翻译: ${sessionId}, 共 ${session.total_count} 条字符串`);

    try {
      // 1. 构造查询参数
      const forms: FormIdentifier[] = session.strings.map((s) => ({
        form_id: s.form_id,
        record_type: s.record_type,
        subrecord_type: s.subrecord_type,
      }));

      // 2. 批量查询翻译（带进度通知）
      const translations = await invoke<Translation[]>(
        'batch_query_translations_with_progress',
        {
          sessionId,
          forms,
        }
      );

      console.log(`✓ 查询到 ${translations.length} 条翻译`);

      // 3. ✅ 优化：只存储译文字符串，减少内存占用
      const translationMap = new Map<string, string>();
      translations.forEach((t) => {
        const key = `${t.form_id}|${t.record_type}|${t.subrecord_type}`;
        translationMap.set(key, t.translated_text);
      });

      // 4. 更新字符串的译文和状态
      const updatedStrings = session.strings.map((s) => {
        const key = `${s.form_id}|${s.record_type}|${s.subrecord_type}`;
        const translatedText = translationMap.get(key);

        if (translatedText) {
          // ✅ 优化：直接返回新对象，减少展开操作
          return {
            ...s,
            translated_text: translatedText,
            translation_status: 'manual' as const,
          };
        }
        // ✅ 优化：只更新状态字段
        return {
          ...s,
          translation_status: 'untranslated' as const,
        };
      });

      // 5. 更新 Session 数据
      const updatedSession: PluginStringsResponse = {
        ...session,
        strings: updatedStrings,
      };

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
      console.error('刷新翻译失败:', errorMsg);
      set({ error: errorMsg });

      // 清除进度状态
      set((state) => {
        const newProgress = new Map(state.translationProgress);
        newProgress.delete(sessionId);
        return { translationProgress: newProgress };
      });
    }
  },

  /**
   * 初始化Event监听器（返回清理函数）
   *
   * 在 Workspace 组件中调用，确保监听器生命周期与组件绑定
   */
  initEventListener: async () => {
    const unlisten = await listen<TranslationProgressPayload>(
      'translation_progress',
      (event) => {
        const { session_id, percentage } = event.payload;

        useSessionStore.setState((state) => {
          const newProgress = new Map(state.translationProgress);
          newProgress.set(session_id, percentage);
          return { translationProgress: newProgress };
        });
      }
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
}));
