import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Drawer,
  TextField,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Divider,
  CircularProgress,
  Alert,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import SettingsIcon from '@mui/icons-material/Settings';
import { useAppStore } from '../stores/appStore';
import type { PluginInfo } from '../types';

const DRAWER_WIDTH = 300;

/**
 * 主工作界面
 */
export default function Workspace() {
  const navigate = useNavigate();

  const {
    gamePath,
    plugins,
    isLoading,
    error,
    loadSettings,
  } = useAppStore();

  const [drawerOpen, setDrawerOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlugin, setSelectedPlugin] = useState<PluginInfo | null>(null);

  // 加载配置和插件列表
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // 如果没有游戏路径，跳转到首屏
  useEffect(() => {
    if (!isLoading && !gamePath) {
      navigate('/');
    }
  }, [gamePath, isLoading, navigate]);

  // 过滤插件列表
  const filteredPlugins = plugins.filter((plugin) =>
    plugin.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleToggleDrawer = () => {
    setDrawerOpen(!drawerOpen);
  };

  const handleResetGamePath = () => {
    if (confirm('确定要重新选择游戏目录吗？')) {
      navigate('/');
    }
  };

  return (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      {/* 顶部工具栏 */}
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
            onClick={handleToggleDrawer}
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

          <IconButton color="inherit" onClick={handleResetGamePath}>
            <SettingsIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* 左侧插件列表 */}
      <Drawer
        variant="persistent"
        anchor="left"
        open={drawerOpen}
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
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

        <Box sx={{ overflow: 'auto', flexGrow: 1 }}>
          {isLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
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
              {searchQuery ? '未找到匹配的插件' : '未检测到插件文件'}
            </Typography>
          ) : (
            <List disablePadding>
              {filteredPlugins.map((plugin) => (
                <ListItem key={plugin.path} disablePadding>
                  <ListItemButton
                    selected={selectedPlugin?.path === plugin.path}
                    onClick={() => setSelectedPlugin(plugin)}
                  >
                    <ListItemText
                      primary={plugin.name}
                      primaryTypographyProps={{
                        variant: 'body2',
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

        <Box sx={{ p: 2 }}>
          <Typography variant="caption" color="text.secondary">
            共 {plugins.length} 个插件
          </Typography>
        </Box>
      </Drawer>

      {/* 主内容区域 */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          ml: drawerOpen ? 0 : `-${DRAWER_WIDTH}px`,
          transition: (theme) =>
            theme.transitions.create('margin', {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.leavingScreen,
            }),
        }}
      >
        <Toolbar />

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 'calc(100vh - 100px)',
          }}
        >
          {selectedPlugin ? (
            <Box>
              <Typography variant="h5" gutterBottom>
                {selectedPlugin.name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                路径: {selectedPlugin.path}
              </Typography>
              <Typography variant="body1" sx={{ mt: 3 }} color="text.secondary">
                翻译功能待实现...
              </Typography>
            </Box>
          ) : (
            <Typography variant="h6" color="text.secondary">
              请从左侧选择一个插件开始翻译
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}
