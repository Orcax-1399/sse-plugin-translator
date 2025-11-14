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
import StorageIcon from '@mui/icons-material/Storage';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../stores/appStore';
import { useSessionStore, type TranslationUpdatedPayload } from '../stores/sessionStore';
import SettingsModal from '../components/SettingsModal';
import BatchApplyConfirmModal from '../components/BatchApplyConfirmModal';
import SessionTabBar from '../components/SessionTabBar';
import SessionPanel from '../components/SessionPanel';
import type { PluginInfo, StringRecord } from '../types';
import { showSuccess } from '../stores/notificationStore';

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
  } = useSessionStore();

  const [drawerOpen, setDrawerOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 批量应用确认 Modal 状态
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<TranslationUpdatedPayload | null>(null);
  const [matchingRecords, setMatchingRecords] = useState<StringRecord[]>([]);

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

  // 监听翻译更新事件并处理批量应用逻辑
  useEffect(() => {
    let cleanup: (() => void) | null = null;

    const setupListener = async () => {
      const unlisten = await listen<TranslationUpdatedPayload>(
        'translation-updated',
        (event) => {
          const payload = event.payload;
          console.log('→ 主窗口接收到翻译更新事件:', payload);

          // 查找包含该记录的 session
          const { openedSessions, updateStringRecord } = useSessionStore.getState();

          for (const [sessionId, session] of openedSessions.entries()) {
            const record = session.strings.find(
              (s) =>
                s.form_id === payload.form_id &&
                s.record_type === payload.record_type &&
                s.subrecord_type === payload.subrecord_type
            );

            if (record) {
              // 找到了包含该记录的 session，检测是否有多个相同的 original_text
              const currentOriginalText = payload.original_text.trim();
              const matching = session.strings.filter(
                (r) => r.original_text.trim() === currentOriginalText
              );

              console.log('批量检测:', {
                currentOriginalText,
                matchingCount: matching.length,
              });

              if (matching.length > 1) {
                // 有多个匹配项，弹出 Modal
                setPendingUpdate(payload);
                setMatchingRecords(matching);
                setBatchModalOpen(true);
              } else {
                // 只有一个匹配项，直接更新
                if (updateStringRecord) {
                  updateStringRecord(
                    sessionId,
                    payload.form_id,
                    payload.record_type,
                    payload.subrecord_type,
                    payload.translated_text,
                    payload.translation_status
                  );
                  console.log(`✓ 翻译已更新: ${payload.form_id}`);
                }
              }

              break;
            }
          }
        }
      );

      cleanup = unlisten;
    };

    setupListener();

    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, []);

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

  // 打开原子数据库管理窗口
  const handleOpenAtomicDb = async () => {
    try {
      await invoke('open_atomic_db_window');
    } catch (error) {
      console.error('打开原子数据库窗口失败:', error);
    }
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

  // 处理批量应用确认
  const handleBatchConfirm = (applyAll: boolean) => {
    setBatchModalOpen(false);

    if (!pendingUpdate) return;

    const { openedSessions, updateStringRecord } = useSessionStore.getState();

    // 查找包含该记录的 session
    for (const [sessionId, session] of openedSessions.entries()) {
      const record = session.strings.find(
        (s) =>
          s.form_id === pendingUpdate.form_id &&
          s.record_type === pendingUpdate.record_type &&
          s.subrecord_type === pendingUpdate.subrecord_type
      );

      if (record && updateStringRecord) {
        if (applyAll && matchingRecords.length > 0) {
          // 批量应用所有匹配项
          matchingRecords.forEach((r) => {
            updateStringRecord(
              sessionId,
              r.form_id,
              r.record_type,
              r.subrecord_type,
              pendingUpdate.translated_text,
              pendingUpdate.translation_status
            );
          });
          showSuccess(`已批量应用 ${matchingRecords.length} 个翻译`);
          console.log(`✓ 批量应用翻译: ${matchingRecords.length} 个`);
        } else {
          // 仅应用当前单条
          updateStringRecord(
            sessionId,
            pendingUpdate.form_id,
            pendingUpdate.record_type,
            pendingUpdate.subrecord_type,
            pendingUpdate.translated_text,
            pendingUpdate.translation_status
          );
          showSuccess('翻译已应用');
          console.log(`✓ 单条应用翻译: ${pendingUpdate.form_id}`);
        }

        break;
      }
    }

    // 清空状态
    setPendingUpdate(null);
    setMatchingRecords([]);
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

          <IconButton color="inherit" onClick={handleOpenAtomicDb} title="原子数据库">
            <StorageIcon />
          </IconButton>

          <IconButton color="inherit" onClick={handleOpenSettings}>
            <SettingsIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* 设置模态框 */}
      <SettingsModal open={settingsOpen} onClose={handleCloseSettings} />

      {/* 批量应用确认对话框 */}
      {pendingUpdate && (
        <BatchApplyConfirmModal
          open={batchModalOpen}
          originalText={pendingUpdate.original_text}
          matchCount={matchingRecords.length}
          onConfirm={handleBatchConfirm}
          onClose={() => setBatchModalOpen(false)}
        />
      )}

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
