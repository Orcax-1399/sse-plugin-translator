import { create } from "zustand";
import type { StringRecord } from "../types";

/**
 * 历史记录配置
 */
const MAX_HISTORY_SIZE = 30; // 最大历史记录数量（可配置）

/**
 * 历史操作的单条记录快照
 */
export interface HistoryRecord {
  /** 记录唯一标识: "formId|recordType|subrecordType|index" */
  recordId: string;
  /** 修改前的完整状态（深拷贝） */
  beforeState: StringRecord;
  /** 修改后的完整状态（深拷贝） */
  afterState: StringRecord;
}

/**
 * 历史命令（单次操作单元，可能包含多条记录）
 */
export interface HistoryCommand {
  /** 唯一标识 */
  id: string;
  /** 操作时间戳 */
  timestamp: number;
  /** 操作类型：单条修改 / 批量操作 */
  type: 'single' | 'batch';
  /** 操作描述（用于UI显示，如 "Edit 1 item" 或 "Replace 15 items"） */
  description: string;
  /** 关联的 session ID */
  sessionId: string;
  /** 受影响的记录列表 */
  records: HistoryRecord[];
}

/**
 * 历史管理状态
 */
interface HistoryState {
  /** 历史命令栈（按时间顺序，最新的在末尾）- Map: sessionId -> Command[] */
  historyStack: Map<string, HistoryCommand[]>;

  // Actions
  /** 添加历史命令（自动处理 FIFO） */
  pushCommand: (command: HistoryCommand) => void;
  /** 撤销最近的一次操作（弹出并返回命令） */
  undo: (sessionId: string) => HistoryCommand | null;
  /** 检查是否可以撤销 */
  canUndo: (sessionId: string) => boolean;
  /** 清空指定 session 的历史（session 关闭时调用） */
  clearSession: (sessionId: string) => void;
  /** 清空所有历史 */
  clearAll: () => void;
  /** 获取指定 session 的历史列表（用于调试/UI展示） */
  getHistory: (sessionId: string) => HistoryCommand[];
  /** 获取可撤销的操作数量 */
  getUndoCount: (sessionId: string) => number;
}

/**
 * 历史管理 Store
 */
export const useHistoryStore = create<HistoryState>((set, get) => ({
  historyStack: new Map(),

  /**
   * 添加历史命令
   * - 自动处理 FIFO（超过限制时删除最旧的）
   * - 按 session 隔离
   */
  pushCommand: (command: HistoryCommand) => {
    set((state) => {
      const newStack = new Map(state.historyStack);
      const sessionHistory = newStack.get(command.sessionId) || [];

      // 添加新命令到末尾
      const updatedHistory = [...sessionHistory, command];

      // FIFO：超过限制时删除最旧的（头部）
      if (updatedHistory.length > MAX_HISTORY_SIZE) {
        updatedHistory.shift(); // 删除第一个（最旧的）
        console.log(
          `⚠️ 历史记录已满，删除最旧的记录。当前限制: ${MAX_HISTORY_SIZE}`
        );
      }

      newStack.set(command.sessionId, updatedHistory);

      console.log(
        `📝 添加历史记录: ${command.description} (${command.records.length} 条记录)`
      );

      return { historyStack: newStack };
    });
  },

  /**
   * 撤销最近的一次操作（LIFO）
   * - 弹出栈顶命令
   * - 返回命令对象供调用者执行恢复逻辑
   */
  undo: (sessionId: string) => {
    const { historyStack } = get();
    const sessionHistory = historyStack.get(sessionId);

    if (!sessionHistory || sessionHistory.length === 0) {
      console.warn("⚠️ 没有可撤销的操作");
      return null;
    }

    // 弹出最后一个命令
    const command = sessionHistory[sessionHistory.length - 1];

    set((state) => {
      const newStack = new Map(state.historyStack);
      const updatedHistory = sessionHistory.slice(0, -1); // 移除最后一个

      if (updatedHistory.length === 0) {
        newStack.delete(sessionId); // 空栈时删除 key
      } else {
        newStack.set(sessionId, updatedHistory);
      }

      console.log(`↶ 撤销操作: ${command.description}`);

      return { historyStack: newStack };
    });

    return command;
  },

  /**
   * 检查是否可以撤销
   */
  canUndo: (sessionId: string) => {
    const { historyStack } = get();
    const sessionHistory = historyStack.get(sessionId);
    return sessionHistory !== undefined && sessionHistory.length > 0;
  },

  /**
   * 清空指定 session 的历史（session 关闭时调用）
   */
  clearSession: (sessionId: string) => {
    set((state) => {
      const newStack = new Map(state.historyStack);
      newStack.delete(sessionId);
      console.log(`🗑️ 清空 session 历史: ${sessionId}`);
      return { historyStack: newStack };
    });
  },

  /**
   * 清空所有历史
   */
  clearAll: () => {
    set({ historyStack: new Map() });
    console.log("🗑️ 清空所有历史记录");
  },

  /**
   * 获取指定 session 的历史列表
   */
  getHistory: (sessionId: string) => {
    const { historyStack } = get();
    return historyStack.get(sessionId) || [];
  },

  /**
   * 获取可撤销的操作数量
   */
  getUndoCount: (sessionId: string) => {
    const { historyStack } = get();
    const sessionHistory = historyStack.get(sessionId);
    return sessionHistory ? sessionHistory.length : 0;
  },
}));
