import { AppBar, Toolbar, Typography, IconButton, Tooltip, Box } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import SettingsIcon from "@mui/icons-material/Settings";
import StorageIcon from "@mui/icons-material/Storage";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import ClearIcon from "@mui/icons-material/Clear";

interface WorkspaceAppBarProps {
  onToggleDrawer: () => void;
  gamePath: string | null;
  dsdOutputDir: string | null;
  onOpenSettings: () => void;
  onOpenAtomicDb: () => void;
  onResetWorkspace?: () => void;
  onSetDsdOutputDir?: () => void;
  onClearDsdOutputDir?: () => void;
}

/**
 * 工作区顶部工具栏
 *
 * 职责：
 * - 显示菜单切换按钮
 * - 显示应用标题
 * - 显示游戏路径
 * - 提供原子数据库和设置入口
 *
 * 设计：纯 UI 组件，不使用任何 store hooks
 */
export default function WorkspaceAppBar({
  onToggleDrawer,
  gamePath,
  dsdOutputDir,
  onOpenSettings,
  onOpenAtomicDb,
  onResetWorkspace,
  onSetDsdOutputDir,
  onClearDsdOutputDir,
}: WorkspaceAppBarProps) {
  return (
    <AppBar
      position="fixed"
      sx={{
        zIndex: (theme) => theme.zIndex.drawer + 1,
      }}
    >
      <Toolbar>
        <IconButton
          color="inherit"
          edge="start"
          onClick={onToggleDrawer}
          sx={{ mr: 2 }}
        >
          <MenuIcon />
        </IconButton>

        <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
          esp translator
        </Typography>

        {/* 工作区路径 */}
        <Typography
          component="button"
          type="button"
          variant="body2"
          sx={{
            mr: 2,
            opacity: gamePath ? 0.8 : 0.6,
            cursor: gamePath ? "pointer" : "default",
            background: "none",
            border: "none",
            color: "inherit",
            font: "inherit",
            textDecoration: gamePath ? "underline dotted" : "none",
            p: 0,
          }}
          title={gamePath ? "点击重新选择工作区" : undefined}
          onClick={gamePath ? onResetWorkspace : undefined}
          tabIndex={gamePath ? 0 : -1}
        >
          {gamePath || "未选择工作区"}
        </Typography>

        {/* DSD 导出目录 */}
        <Box sx={{ display: "flex", alignItems: "center", mr: 1 }}>
          <Tooltip title={dsdOutputDir ? `DSD导出目录: ${dsdOutputDir}\n点击修改` : "点击设置DSD导出目录"}>
            <Box
              component="button"
              type="button"
              onClick={onSetDsdOutputDir}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                height: 32,
                px: 1,
                borderRadius: dsdOutputDir ? "4px 0 0 4px" : 1,
                background: "rgba(255,255,255,0.1)",
                border: "1px dashed rgba(255,255,255,0.3)",
                borderRight: dsdOutputDir ? "none" : undefined,
                color: "inherit",
                font: "inherit",
                fontSize: "0.75rem",
                cursor: "pointer",
                "&:hover": {
                  background: "rgba(255,255,255,0.2)",
                },
              }}
            >
              <FolderOpenIcon sx={{ fontSize: 16 }} />
              <Typography variant="caption" sx={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {dsdOutputDir ? dsdOutputDir.split(/[/\\]/).pop() : "无导出目录"}
              </Typography>
            </Box>
          </Tooltip>
          {dsdOutputDir && (
            <Tooltip title="清除导出目录设置">
              <Box
                component="button"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClearDsdOutputDir?.();
                }}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: 32,
                  minWidth: 32,
                  borderRadius: "0 4px 4px 0",
                  background: "rgba(255,255,255,0.1)",
                  border: "1px dashed rgba(255,255,255,0.3)",
                  borderLeft: "none",
                  color: "inherit",
                  cursor: "pointer",
                  "&:hover": {
                    background: "rgba(255,100,100,0.3)",
                  },
                }}
              >
                <ClearIcon sx={{ fontSize: 14 }} />
              </Box>
            </Tooltip>
          )}
        </Box>

        <IconButton color="inherit" onClick={onOpenAtomicDb} title="原子数据库">
          <StorageIcon />
        </IconButton>

        <IconButton color="inherit" onClick={onOpenSettings}>
          <SettingsIcon />
        </IconButton>
      </Toolbar>
    </AppBar>
  );
}
