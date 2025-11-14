import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { PluginStringsResponse, SessionState } from '../types';

/**
 * Session 状态管理
 *
 * 管理插件加载的 Session，每个插件对应一个 Session
 * Session 在后端缓存，前端维护 Session 列表和激活状态
 */
export const useSessionStore = create<SessionState>((set, get) => ({
  openedSessions: new Map(),
  activeSessionId: null,
  isLoading: false,
  error: null,

  /**
   * 打开插件 Session
   *
   * @param pluginPath - 插件文件的完整路径
   */
  openSession: async (pluginPath: string) => {
    const { checkSessionExists } = get();

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

      // 更新状态
      set((state) => {
        const newSessions = new Map(state.openedSessions);
        newSessions.set(response.session_id, response);

        return {
          openedSessions: newSessions,
          activeSessionId: response.session_id,
          isLoading: false,
        };
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

      // 更新状态
      set((state) => {
        const newSessions = new Map(state.openedSessions);
        newSessions.delete(sessionId);

        // 如果关闭的是当前激活的 Session，切换到其他 Session 或 null
        let newActiveSessionId = state.activeSessionId;
        if (newActiveSessionId === sessionId) {
          const remainingSessions = Array.from(newSessions.keys());
          newActiveSessionId = remainingSessions.length > 0 ? remainingSessions[0] : null;
        }

        return {
          openedSessions: newSessions,
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
   * 设置错误信息
   *
   * @param error - 错误信息
   */
  setError: (error: string | null) => {
    set({ error });
  },
}));
