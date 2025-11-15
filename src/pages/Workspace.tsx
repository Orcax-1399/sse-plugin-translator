import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import { useSessionStore } from "../stores/sessionStore";
import SettingsModal from "../components/SettingsModal";
import TranslationUpdatedListener from "../components/workspace/TranslationUpdatedListener";
import WorkspaceAppBar from "../components/workspace/WorkspaceAppBar";
import WorkspaceDrawer from "../components/workspace/WorkspaceDrawer";
import SessionArea from "../components/workspace/SessionArea";
import type { PluginInfo } from "../types";

/**
 * 打开原子数据库管理窗口（独立函数，避免闭包捕获 openedSessions）
 */
const openAtomicDbWindow = async () => {
  try {
    await invoke("open_atomic_db_window");
  } catch (error) {
    console.error("打开原子数据库窗口失败:", error);
  }
};

/**
 * 主工作界面
 *
 * 职责：
 * - 协调各个子组件的通信
 * - 管理全局状态（抽屉开关、设置弹窗）
 * - 初始化应用配置和事件监听器
 *
 * 架构：
 * - TranslationUpdatedListener: 独立监听翻译更新事件
 * - WorkspaceAppBar: 顶部工具栏
 * - WorkspaceDrawer: 左侧插件列表
 * - SessionArea: Session 标签页和内容区
 */
export default function Workspace() {
  const navigate = useNavigate();

  const { gamePath, loadSettings } = useAppStore();

  // ✅ 只获取需要的 action 函数（zustand actions 引用稳定）
  const openSession = useSessionStore((state) => state.openSession);
  const switchSession = useSessionStore((state) => state.switchSession);
  const checkSessionExists = useSessionStore((state) => state.checkSessionExists);

  const [drawerOpen, setDrawerOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 加载配置和插件列表
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // 如果没有游戏路径，跳转到首屏
  useEffect(() => {
    if (!gamePath) {
      navigate("/");
    }
  }, [gamePath, navigate]);

  // ✅ 管理 Session 进度监听器生命周期（使用 getState 避免闭包捕获）
  useEffect(() => {
    let cleanup: (() => void) | null = null;

    // 从 getState 获取函数，不在组件作用域解构
    const { initEventListener } = useSessionStore.getState();

    initEventListener().then((unlistenFn) => {
      cleanup = unlistenFn;
    });

    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, []); // ✅ 空依赖，只在挂载时执行一次

  // ✅ 初始化编辑窗口事件监听器（使用 getState 避免闭包捕获）
  useEffect(() => {
    let cleanup: (() => void) | null = null;

    // 从 getState 获取函数，不在组件作用域解构
    const { initEditorEventListener } = useSessionStore.getState();

    if (initEditorEventListener) {
      initEditorEventListener().then((unlistenFn) => {
        cleanup = unlistenFn;
      });
    }

    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, []); // ✅ 空依赖，只在挂载时执行一次

  // === 事件处理器 ===

  const handleToggleDrawer = useCallback(() => {
    setDrawerOpen((prev) => !prev);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  // 处理插件点击：检查是否已打开，已打开则切换，未打开则新建
  const handlePluginClick = useCallback(
    (plugin: PluginInfo) => {
      const pluginName = plugin.name;

      if (checkSessionExists(pluginName)) {
        // 已打开，切换到该 Session
        switchSession(pluginName);
      } else {
        // 未打开，创建新 Session
        openSession(plugin.path);
      }
    },
    [checkSessionExists, switchSession, openSession],
  );

  return (
    <Box sx={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* 监听 translation-updated 事件 */}
      <TranslationUpdatedListener />

      {/* 顶部工具栏 */}
      <WorkspaceAppBar
        onToggleDrawer={handleToggleDrawer}
        gamePath={gamePath}
        onOpenSettings={handleOpenSettings}
        onOpenAtomicDb={openAtomicDbWindow}
      />

      {/* 左侧插件列表 */}
      <WorkspaceDrawer open={drawerOpen} onPluginClick={handlePluginClick} />

      {/* 主内容区域：Session 标签页和面板 */}
      <SessionArea drawerOpen={drawerOpen} />

      {/* 设置模态框 */}
      <SettingsModal open={settingsOpen} onClose={handleCloseSettings} />
    </Box>
  );
}
