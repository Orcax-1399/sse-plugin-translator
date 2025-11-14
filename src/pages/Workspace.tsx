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
  Button,
  Badge,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import SettingsIcon from '@mui/icons-material/Settings';
import SaveIcon from '@mui/icons-material/Save';
import { useAppStore } from '../stores/appStore';
import { useSessionStore } from '../stores/sessionStore';
import SettingsModal from '../components/SettingsModal';
import SessionTabBar from '../components/SessionTabBar';
import SessionPanel from '../components/SessionPanel';
import type { PluginInfo } from '../types';
import { showSuccess, showError } from '../stores/notificationStore';

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

  const {
    openedSessions,
    activeSessionId,
    openSession,
    switchSession,
    checkSessionExists,
    initEventListener,
    initEditorEventListener,
    batchSaveTranslations,
    getPendingChangesCount,
  } = useSessionStore();

  const [drawerOpen, setDrawerOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // 获取未保存的修改数量
  const pendingCount = getPendingChangesCount ? getPendingChangesCount() : 0;

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

  // 管理 Event 监听器生命周期（防止内存泄漏）
  useEffect(() => {
    let cleanup: (() => void) | null = null;

    // 初始化监听器
    initEventListener().then((unlistenFn) => {
      cleanup = unlistenFn;
    });

    // 组件卸载时清理监听器
    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, [initEventListener]);

  // 初始化编辑窗口事件监听器（监听翻译更新）
  useEffect(() => {
    let cleanup: (() => void) | null = null;

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
  }, [initEditorEventListener]);

  // 过滤插件列表
  const filteredPlugins = plugins.filter((plugin) =>
    plugin.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleToggleDrawer = () => {
    setDrawerOpen(!drawerOpen);
  };

  const handleOpenSettings = () => {
    setSettingsOpen(true);
  };

  const handleCloseSettings = () => {
    setSettingsOpen(false);
  };

  // 处理插件点击：检查是否已打开，已打开则切换，未打开则新建
  const handlePluginClick = (plugin: PluginInfo) => {
    const pluginName = plugin.name;

    if (checkSessionExists(pluginName)) {
      // 已打开，切换到该 Session
      switchSession(pluginName);
    } else {
      // 未打开，创建新 Session
      openSession(plugin.path);
    }
  };

  // 保存所有翻译到数据库
  const handleSaveTranslations = async () => {
    if (!batchSaveTranslations) {
      showError('批量保存功能不可用');
      return;
    }

    setIsSaving(true);

    try {
      const savedCount = await batchSaveTranslations();
      if (savedCount > 0) {
        showSuccess(`成功保存 ${savedCount} 条翻译到数据库`);
      } else {
        showSuccess('没有需要保存的翻译');
      }
    } catch (error) {
      showError('保存翻译失败: ' + String(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
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

          <Badge badgeContent={pendingCount} color="error" sx={{ mr: 2 }}>
            <Button
              variant="contained"
              color="secondary"
              startIcon={<SaveIcon />}
              onClick={handleSaveTranslations}
              disabled={isSaving || openedSessions.size === 0}
              size="small"
            >
              {isSaving ? '保存中...' : '保存翻译'}
            </Button>
          </Badge>

          <IconButton color="inherit" onClick={handleOpenSettings}>
            <SettingsIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* 设置模态框 */}
      <SettingsModal open={settingsOpen} onClose={handleCloseSettings} />

      {/* 左侧插件列表 */}
      <Drawer
        variant="persistent"
        anchor="left"
        open={drawerOpen}
        sx={{
          width: drawerOpen ? DRAWER_WIDTH : 0,
          flexShrink: 0,
          transition: (theme) =>
            theme.transitions.create('width', {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.leavingScreen,
            }),
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
                    selected={checkSessionExists(plugin.name)}
                    onClick={() => handlePluginClick(plugin)}
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
          width: drawerOpen ? `calc(100vw - ${DRAWER_WIDTH}px)` : '100vw',
          transition: (theme) =>
            theme.transitions.create('width', {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.leavingScreen,
            }),
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          overflow: 'hidden',
        }}
      >
        <Toolbar />

        {/* Session TabBar + Panel */}
        <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {openedSessions.size > 0 ? (
            <>
              <SessionTabBar />
              {activeSessionId && openedSessions.get(activeSessionId) && (
                <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
                  <SessionPanel sessionData={openedSessions.get(activeSessionId)!} />
                </Box>
              )}
            </>
          ) : (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
              }}
            >
              <Typography variant="h6" color="text.secondary">
                请从左侧选择一个插件开始翻译
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
