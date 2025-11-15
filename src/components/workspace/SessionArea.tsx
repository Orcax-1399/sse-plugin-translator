import { Box, Toolbar, Typography } from "@mui/material";
import { useSessionStore } from "../../stores/sessionStore";
import SessionTabBar from "../SessionTabBar";
import SessionPanel from "../SessionPanel";
import { DRAWER_WIDTH, createWidthTransition } from "./WorkspaceDrawer";

interface SessionAreaProps {
  drawerOpen: boolean;
}

/**
 * Session 内容区域
 *
 * 职责：
 * - 显示 Session 标签页（SessionTabBar）
 * - 显示当前激活的 Session 内容（SessionPanel）
 * - 处理空状态（未打开任何插件时）
 *
 * 设计：
 * - ✅ 使用 selector 精确订阅需要的状态
 * - 负责会话的展示逻辑
 */
export default function SessionArea({ drawerOpen }: SessionAreaProps) {
  // ✅ 使用 selector 精确订阅，避免引用整个 store 对象
  const openedSessions = useSessionStore((state) => state.openedSessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);

  return (
    <Box
      component="main"
      sx={{
        flexGrow: 1,
        width: drawerOpen ? `calc(100vw - ${DRAWER_WIDTH}px)` : "100vw",
        transition: createWidthTransition,
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      <Toolbar />

      {/* Session TabBar + Panel */}
      <Box
        sx={{
          flexGrow: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {openedSessions.size > 0 ? (
          <>
            <SessionTabBar />
            {activeSessionId && openedSessions.get(activeSessionId) && (
              <Box sx={{ flexGrow: 1, overflow: "hidden" }}>
                <SessionPanel
                  sessionData={openedSessions.get(activeSessionId)!}
                />
              </Box>
            )}
          </>
        ) : (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
            }}
          >
            <Typography variant="h6" color="text.secondary">
              请从左侧选择一个插件开始翻译
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
