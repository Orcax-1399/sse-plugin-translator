import { Box, Typography, Paper, IconButton, LinearProgress, Fade, Tooltip, Button, Badge, Chip, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import SaveIcon from '@mui/icons-material/Save';
import TranslateIcon from '@mui/icons-material/Translate';
import type { PluginStringsResponse } from '../types';
import StringTable from './StringTable';
import { useSessionStore } from '../stores/sessionStore';
import { useApiConfigStore } from '../stores/apiConfigStore';
import { showSuccess, showError, showInfo as showInfoNotification } from '../stores/notificationStore';
import { useState, useMemo, useRef } from 'react';
import { translateBatchWithAI, createCancellationToken, type TranslationEntry, type CancellationToken } from '../utils/aiTranslation';

interface SessionPanelProps {
  /** Session 数据 */
  sessionData: PluginStringsResponse;
}

/**
 * Session 面板组件
 *
 * 显示单个插件 Session 的内容：
 * - 顶部状态栏（动态高度，包含进度信息）
 * - 字符串表格（占满剩余空间）
 *
 * ✅ 使用 selector 精确订阅，避免引用整个 store 对象
 */
export default function SessionPanel({ sessionData }: SessionPanelProps) {
  // ✅ 使用 selector 精确订阅状态和方法
  const translationProgress = useSessionStore((state) => state.translationProgress);
  const getSessionPendingCount = useSessionStore((state) => state.getSessionPendingCount);
  const saveSessionTranslations = useSessionStore((state) => state.saveSessionTranslations);
  const setFilterStatus = useSessionStore((state) => state.setFilterStatus);
  const updateStringRecord = useSessionStore((state) => state.updateStringRecord);

  // ✅ 使用selector订阅selectedRows的size，避免无限循环
  const selectedCount = useSessionStore(
    (state) => state.selectedRows?.get(sessionData.session_id)?.size || 0
  );

  // ✅ 使用selector订阅filterStatus，确保响应式更新
  const currentFilter = useSessionStore(
    (state) => state.filterStatus?.get(sessionData.session_id) || 'all'
  );

  // API配置
  const currentApi = useApiConfigStore((state) => state.currentApi);

  const progress = translationProgress.get(sessionData.session_id);
  const [showInfo, setShowInfo] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // AI翻译状态
  const [isAiTranslating, setIsAiTranslating] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [aiCompleted, setAiCompleted] = useState(0);
  const [aiTotal, setAiTotal] = useState(0);

  // 取消令牌（使用 useRef 避免重新创建）
  const cancellationTokenRef = useRef<CancellationToken | null>(null);

  // 是否正在加载翻译
  const isLoadingTranslations = progress !== undefined && progress < 100;

  // 获取当前 session 的未保存数量
  const pendingCount = getSessionPendingCount ? getSessionPendingCount(sessionData.session_id) : 0;

  // 根据筛选状态过滤数据
  const filteredStrings = useMemo(() => {
    if (currentFilter === 'all') {
      return sessionData.strings;
    }
    return sessionData.strings.filter((s) => s.translation_status === currentFilter);
  }, [sessionData.strings, currentFilter]);

  // 处理筛选状态变更
  const handleFilterChange = (status: 'all' | 'untranslated' | 'manual' | 'ai') => {
    if (setFilterStatus) {
      setFilterStatus(sessionData.session_id, status);
    }
  };

  // 保存当前 session 的翻译
  const handleSaveTranslations = async () => {
    if (!saveSessionTranslations) {
      showError('保存功能不可用');
      return;
    }

    setIsSaving(true);

    try {
      const savedCount = await saveSessionTranslations(sessionData.session_id);
      if (savedCount > 0) {
        showSuccess(`成功保存 ${savedCount} 条翻译`);
      } else {
        showSuccess('没有需要保存的翻译');
      }
    } catch (error) {
      showError('保存翻译失败: ' + String(error));
    } finally {
      setIsSaving(false);
    }
  };

  // AI翻译处理
  const handleAiTranslate = async () => {
    // 检查API配置
    if (!currentApi) {
      showError('请先在设置中配置API');
      return;
    }

    // 检查是否有选中行
    if (selectedCount === 0) {
      showInfoNotification('请先选择需要翻译的行');
      return;
    }

    // 获取选中的行ID（在函数内部获取，避免闭包问题）
    const selectedRowIds = useSessionStore.getState().selectedRows?.get(sessionData.session_id) || new Set<string>();

    console.log('[AI翻译] 选中的行数:', selectedRowIds.size);

    // 构建翻译条目列表
    const entries: TranslationEntry[] = [];
    let index = 0;
    for (const rowId of selectedRowIds) {
      // ⚠️ 重要：rowId格式是 "form_id|record_type|subrecord_type"
      // 但form_id本身包含'|'，格式是 "00012345|Skyrim.esm"
      // 所以实际rowId是："00012345|Skyrim.esm|WEAP|FULL"（4个部分）
      // 我们需要从最后往前取：最后一个是subrecord_type，倒数第二个是record_type，前面的都是form_id
      const parts = rowId.split('|');

      if (parts.length < 3) {
        console.warn('[AI翻译] 无效的rowId格式:', rowId);
        continue;
      }

      // 从后往前取
      const subrecordType = parts[parts.length - 1];
      const recordType = parts[parts.length - 2];
      const formId = parts.slice(0, parts.length - 2).join('|'); // 剩余部分用|连接回去

      // 查找对应的StringRecord
      const record = sessionData.strings.find(
        (s) =>
          s.form_id === formId &&
          s.record_type === recordType &&
          s.subrecord_type === subrecordType,
      );

      if (record) {
        entries.push({
          index: index++,
          recordIndex: record.index,
          formId: record.form_id,
          recordType: record.record_type,
          subrecordType: record.subrecord_type,
          originalText: record.original_text,
        });
      } else {
        console.warn('[AI翻译] 未找到记录:', { formId, recordType, subrecordType });
      }
    }

    console.log('[AI翻译] 找到的有效条目数:', entries.length);

    if (entries.length === 0) {
      showError('未找到有效的翻译条目');
      return;
    }

    // 开始AI翻译
    setIsAiTranslating(true);
    setAiProgress(0);
    setAiCompleted(0);
    setAiTotal(entries.length);

    // 创建取消令牌
    const cancellationToken = createCancellationToken();
    cancellationTokenRef.current = cancellationToken;

    try {
      const result = await translateBatchWithAI(
        entries,
        currentApi,
        (completed, total) => {
          // 进度回调
          setAiCompleted(completed);
          setAiTotal(total);
          setAiProgress((completed / total) * 100);
        },
        (_index, recIndex, formId, recordType, subrecordType, translated) => {
          // Apply回调：更新UI
          if (updateStringRecord) {
            updateStringRecord(
              sessionData.session_id,
              formId,
              recordType,
              subrecordType,
              recIndex,
              translated,
              'ai', // 标记为AI翻译
            );
          }
        },
        cancellationToken, // 传递取消令牌
      );

      if (result.success) {
        showSuccess(`AI翻译完成！已翻译 ${result.translatedCount} 条，请检查后保存`);
      } else {
        if (result.error === '用户取消翻译') {
          showInfoNotification(`AI翻译已取消，已翻译 ${result.translatedCount} 条`);
        } else {
          showError(`AI翻译失败: ${result.error || '未知错误'}`);
        }
      }
    } catch (error) {
      showError('AI翻译失败: ' + String(error));
    } finally {
      setIsAiTranslating(false);
      setAiProgress(0);
      cancellationTokenRef.current = null;
    }
  };

  // 取消AI翻译
  const handleCancelTranslation = () => {
    if (cancellationTokenRef.current) {
      cancellationTokenRef.current.cancel();
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 状态栏（动态高度） */}
      <Paper
        elevation={0}
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          px: 2,
          py: 1,
        }}
      >
        {/* 第一行：总计 + 筛选Chips + 保存按钮 + 信息按钮 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: isLoadingTranslations ? 1 : 0 }}>
          <Typography variant="body2" color="text.secondary">
            总计: <strong>{sessionData.total_count}</strong> 条
            {currentFilter !== 'all' && (
              <span> · 筛选: <strong>{filteredStrings.length}</strong> 条</span>
            )}
          </Typography>

          {/* 筛选Chips */}
          <Box sx={{ display: 'flex', gap: 0.5, ml: 2 }}>
            <Chip
              label="全部"
              size="small"
              variant={currentFilter === 'all' ? 'filled' : 'outlined'}
              color={currentFilter === 'all' ? 'primary' : 'default'}
              onClick={() => handleFilterChange('all')}
            />
            <Chip
              label="未翻译"
              size="small"
              variant={currentFilter === 'untranslated' ? 'filled' : 'outlined'}
              color={currentFilter === 'untranslated' ? 'primary' : 'default'}
              onClick={() => handleFilterChange('untranslated')}
            />
            <Chip
              label="已翻译"
              size="small"
              variant={currentFilter === 'manual' ? 'filled' : 'outlined'}
              color={currentFilter === 'manual' ? 'primary' : 'default'}
              onClick={() => handleFilterChange('manual')}
            />
            <Chip
              label="AI翻译"
              size="small"
              variant={currentFilter === 'ai' ? 'filled' : 'outlined'}
              color={currentFilter === 'ai' ? 'primary' : 'default'}
              onClick={() => handleFilterChange('ai')}
            />
          </Box>

          {/* AI翻译按钮 */}
          <Badge badgeContent={selectedCount} color="primary" sx={{ ml: 'auto' }}>
            <Tooltip title={!currentApi ? '请先在设置中配置并激活API' : selectedCount === 0 ? '请先选择需要翻译的行' : ''}>
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  color="primary"
                  startIcon={<TranslateIcon />}
                  onClick={handleAiTranslate}
                  disabled={isAiTranslating || selectedCount === 0 || !currentApi}
                >
                  {isAiTranslating ? 'AI翻译中...' : 'AI翻译'}
                </Button>
              </span>
            </Tooltip>
          </Badge>

          <Badge badgeContent={pendingCount} color="error" sx={{ ml: 1 }}>
            <Button
              size="small"
              variant="contained"
              color="secondary"
              startIcon={<SaveIcon />}
              onClick={handleSaveTranslations}
              disabled={isSaving || pendingCount === 0}
            >
              {isSaving ? '保存中...' : '保存翻译'}
            </Button>
          </Badge>

          {/* 应用到插件按钮 */}
          <Button
            size="small"
            variant="contained"
            color="success"
            sx={{ ml: 1 }}
            onClick={async () => {
              if (useSessionStore.getState().applyTranslations) {
                try {
                  setIsSaving(true);
                  await useSessionStore.getState().applyTranslations!(sessionData.session_id);
                  showSuccess('成功应用翻译到插件文件');
                } catch (error) {
                  showError('应用翻译失败: ' + String(error));
                } finally {
                  setIsSaving(false);
                }
              }
            }}
            disabled={isSaving}
          >
            应用到插件
          </Button>

          <Tooltip title={showInfo ? '隐藏详情' : '查看插件详情'}>
            <IconButton
              size="small"
              onClick={() => setShowInfo(!showInfo)}
            >
              <InfoIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        {/* 信息详情（可折叠） */}
        <Fade in={showInfo}>
          <Box sx={{ display: showInfo ? 'block' : 'none', mb: 1 }}>
            <Typography variant="caption" color="text.disabled">
              插件路径: {sessionData.plugin_path}
            </Typography>
          </Box>
        </Fade>

        {/* 进度区域（动态显示） */}
        <Fade in={isLoadingTranslations}>
          <Box sx={{ display: isLoadingTranslations ? 'block' : 'none' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Typography variant="caption" color="primary">
                📥 获取数据库翻译
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {progress?.toFixed(1)}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={progress || 0}
              sx={{ height: 4, borderRadius: 2 }}
            />
          </Box>
        </Fade>
      </Paper>

      {/* 表格区域（占满剩余空间） */}
      <Box sx={{ flex: 1, overflow: 'hidden' }}>
        <StringTable rows={filteredStrings} sessionId={sessionData.session_id} />
      </Box>

      {/* AI翻译进度对话框 */}
      <Dialog open={isAiTranslating} disableEscapeKeyDown>
        <DialogTitle>AI翻译中...</DialogTitle>
        <DialogContent sx={{ minWidth: 400 }}>
          <DialogContentText>
            正在使用 {currentApi?.name} 进行翻译，请稍候...
          </DialogContentText>
          <Box sx={{ mt: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2" color="text.secondary">
                进度: {aiCompleted} / {aiTotal}
              </Typography>
              <Typography variant="body2" color="primary">
                {aiProgress.toFixed(1)}%
              </Typography>
            </Box>
            <LinearProgress variant="determinate" value={aiProgress} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelTranslation} color="error" variant="outlined">
            取消翻译
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
