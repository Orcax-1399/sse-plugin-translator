import { AppBar, Toolbar, Typography, IconButton } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import SettingsIcon from "@mui/icons-material/Settings";
import StorageIcon from "@mui/icons-material/Storage";

interface WorkspaceAppBarProps {
  onToggleDrawer: () => void;
  gamePath: string | null;
  onOpenSettings: () => void;
  onOpenAtomicDb: () => void;
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
  onOpenSettings,
  onOpenAtomicDb,
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
          游戏Mod翻译器
        </Typography>

        <Typography variant="body2" sx={{ mr: 2, opacity: 0.8 }}>
          {gamePath}
        </Typography>

        <IconButton
          color="inherit"
          onClick={onOpenAtomicDb}
          title="原子数据库"
        >
          <StorageIcon />
        </IconButton>

        <IconButton color="inherit" onClick={onOpenSettings}>
          <SettingsIcon />
        </IconButton>
      </Toolbar>
    </AppBar>
  );
}
