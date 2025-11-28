import { useState } from "react";
import {
  Drawer,
  TextField,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Divider,
  CircularProgress,
  Alert,
  Box,
  Toolbar,
  Typography,
  IconButton,
  Tooltip,
} from "@mui/material";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../stores/appStore";
import type { PluginInfo } from "../../types";

export const DRAWER_WIDTH = 300;

/**
 * 过渡动画函数
 */
export const createWidthTransition = (theme: any) =>
  theme.transitions.create("width", {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  });

interface WorkspaceDrawerProps {
  open: boolean;
  onPluginClick: (plugin: PluginInfo) => void;
}

/**
 * 工作区左侧插件列表抽屉
 *
 * 职责：
 * - 显示插件列表
 * - 提供搜索筛选功能
 * - 处理插件点击事件
 *
 * 设计：
 * - 内部使用 useAppStore() 获取插件数据
 * - 不访问 sessionStore，保持独立性
 */
export default function WorkspaceDrawer({
  open,
  onPluginClick,
}: WorkspaceDrawerProps) {
  const { plugins, isLoading, error } = useAppStore();
  const [searchQuery, setSearchQuery] = useState("");

  // 过滤插件列表
  const filteredPlugins = plugins.filter((plugin) =>
    plugin.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleCoverageDatabaseClick = async () => {
    try {
      await invoke("open_coverage_window");
    } catch (error) {
      console.error("打开覆盖数据库窗口失败:", error);
    }
  };

  return (
    <Drawer
      variant="persistent"
      anchor="left"
      open={open}
      sx={{
        width: open ? DRAWER_WIDTH : 0,
        flexShrink: 0,
        transition: createWidthTransition,
        "& .MuiDrawer-paper": {
          width: DRAWER_WIDTH,
          boxSizing: "border-box",
        },
      }}
    >
      <Toolbar />

      <Box sx={{ p: 2 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="搜索插件..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </Box>

      <Divider />

      <Box sx={{ overflow: "auto", flexGrow: 1 }}>
        {isLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", p: 3 }}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Alert severity="error" sx={{ m: 2 }}>
            {error}
          </Alert>
        ) : filteredPlugins.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            align="center"
            sx={{ p: 3 }}
          >
            {searchQuery ? "未找到匹配的插件" : "未检测到插件文件"}
          </Typography>
        ) : (
          <List disablePadding>
            {filteredPlugins.map((plugin) => (
              <ListItem key={plugin.path} disablePadding>
                <ListItemButton onClick={() => onPluginClick(plugin)}>
                  <ListItemText
                    primary={plugin.name}
                    primaryTypographyProps={{
                      variant: "body2",
                      noWrap: true,
                    }}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}
      </Box>

      <Divider />

      <Box
        sx={{
          p: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Typography variant="caption" color="text.secondary">
          共 {plugins.length} 个插件
        </Typography>

        <Tooltip title="覆盖关系数据库" placement="top">
          <IconButton
            size="small"
            color="primary"
            onClick={handleCoverageDatabaseClick}
          >
            <ArchiveOutlinedIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      </Box>
    </Drawer>
  );
}
