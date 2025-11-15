import { Tabs, Tab, IconButton, Box, Tooltip } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useSessionStore } from "../stores/sessionStore";

/**
 * Session TabBar 组件
 *
 * 显示所有已打开的 Session，支持切换和关闭
 *
 * ✅ 使用 selector 精确订阅，避免引用整个 store 对象
 */
export default function SessionTabBar() {
  // ✅ 使用 selector 精确订阅状态
  const openedSessions = useSessionStore((state) => state.openedSessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const switchSession = useSessionStore((state) => state.switchSession);
  const closeSession = useSessionStore((state) => state.closeSession);

  // 将 Map 转换为数组以便渲染
  const sessions = Array.from(openedSessions.values());

  // 处理 Tab 切换
  const handleChange = (_event: React.SyntheticEvent, newValue: string) => {
    switchSession(newValue);
  };

  // 处理关闭按钮点击
  const handleClose = (sessionId: string, event: React.MouseEvent) => {
    event.stopPropagation(); // 防止触发 Tab 切换
    closeSession(sessionId);
  };

  if (sessions.length === 0) {
    return null;
  }

  return (
    <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
      <Tabs
        value={activeSessionId || false}
        onChange={handleChange}
        variant="scrollable"
        scrollButtons="auto"
        aria-label="plugin session tabs"
      >
        {sessions.map((session) => (
          <Tab
            key={session.session_id}
            value={session.session_id}
            sx={{ maxWidth: 200 }}
            label={
              <Tooltip title={session.plugin_name} placement="bottom">
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                  }}
                >
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: "140px",
                    }}
                  >
                    {session.plugin_name}
                  </span>
                  <IconButton
                    size="small"
                    onClick={(e) => handleClose(session.session_id, e)}
                    sx={{
                      ml: 0.5,
                      padding: "2px",
                      "&:hover": {
                        backgroundColor: "rgba(0, 0, 0, 0.1)",
                      },
                    }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Tooltip>
            }
          />
        ))}
      </Tabs>
    </Box>
  );
}
