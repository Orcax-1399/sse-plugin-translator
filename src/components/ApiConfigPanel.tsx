import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  ListItemButton,
  IconButton,
  TextField,
  Button,
  Radio,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Chip,
  InputAdornment,
  MenuItem,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import {
  useApiConfigStore,
  type ApiConfig,
  type ApiStyle,
} from '../stores/apiConfigStore';

/**
 * API配置面板组件
 */
export default function ApiConfigPanel() {
  const {
    configs,
    isLoading,
    error,
    loadConfigs,
    createConfig,
    updateConfig,
    deleteConfig,
    activateConfig,
    setError,
  } = useApiConfigStore();

  // 当前选中的配置ID
  const [selectedConfigId, setSelectedConfigId] = useState<number | null>(null);

  // 编辑表单数据
  const [formData, setFormData] = useState({
    name: '',
    endpoint: '',
    apiKey: '',
    modelName: '',
    maxTokens: 2000,
    apiStyle: 'openai_chat_completions' as ApiStyle,
    contextWindow: 128000,
  });

  // 显示API Key
  const [showApiKey, setShowApiKey] = useState(false);

  // 添加配置对话框
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newConfigName, setNewConfigName] = useState('');

  // 删除确认对话框
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [configToDelete, setConfigToDelete] = useState<number | null>(null);

  // 组件挂载时加载配置列表
  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  // 当配置列表或选中ID变化时，同步formData
  useEffect(() => {
    // 如果没有选中配置，且有配置列表，自动选中第一个
    if (configs.length > 0 && selectedConfigId === null) {
      const firstConfig = configs[0];
      setSelectedConfigId(firstConfig.id);
        setFormData({
          name: firstConfig.name || '',
          endpoint: firstConfig.endpoint || '',
          apiKey: firstConfig.apiKey || '',
          modelName: firstConfig.modelName || '',
          maxTokens: firstConfig.maxTokens || 2000,
          apiStyle: firstConfig.apiStyle || 'openai_chat_completions',
          contextWindow: firstConfig.contextWindow || 128000,
        });
      setShowApiKey(false);
      return;
    }

    // 如果已选中配置，同步更新formData
    if (selectedConfigId !== null) {
      const currentConfig = configs.find(c => c.id === selectedConfigId);
      if (currentConfig) {
        setFormData({
          name: currentConfig.name || '',
          endpoint: currentConfig.endpoint || '',
          apiKey: currentConfig.apiKey || '',
          modelName: currentConfig.modelName || '',
          maxTokens: currentConfig.maxTokens || 2000,
          apiStyle: currentConfig.apiStyle || 'openai_chat_completions',
          contextWindow: currentConfig.contextWindow || 128000,
        });
      }
    }
  }, [configs, selectedConfigId]);

  // 选择配置
  const handleSelectConfig = (config: ApiConfig) => {
    setSelectedConfigId(config.id);
    setFormData({
      name: config.name || '',
      endpoint: config.endpoint || '',
      apiKey: config.apiKey || '',
      modelName: config.modelName || '',
      maxTokens: config.maxTokens || 2000,
      apiStyle: config.apiStyle || 'openai_chat_completions',
      contextWindow: config.contextWindow || 128000,
    });
    setShowApiKey(false);
  };

  // 更新表单字段
  const handleFieldChange = (field: keyof typeof formData, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // 字段失去焦点时自动保存
  const handleFieldBlur = async (field: keyof typeof formData) => {
    if (selectedConfigId === null) return;

    try {
      await updateConfig(selectedConfigId, { [field]: formData[field] });
    } catch (err) {
      console.error('更新配置失败:', err);
    }
  };

  // 激活配置
  const handleActivate = async (id: number) => {
    try {
      await activateConfig(id);
    } catch (err) {
      console.error('激活配置失败:', err);
    }
  };

  // 打开创建对话框
  const handleOpenCreateDialog = () => {
    setNewConfigName('');
    setCreateDialogOpen(true);
  };

  // 创建新配置
  const handleCreate = async () => {
    if (!newConfigName.trim()) {
      return;
    }

    try {
      const id = await createConfig(newConfigName.trim());
      setCreateDialogOpen(false);

      // 选中新创建的配置
      const newConfig = configs.find(c => c.id === id);
      if (newConfig) {
        handleSelectConfig(newConfig);
      }
    } catch (err) {
      console.error('创建配置失败:', err);
    }
  };

  // 打开删除确认对话框
  const handleOpenDeleteDialog = (id: number) => {
    setConfigToDelete(id);
    setDeleteDialogOpen(true);
  };

  // 确认删除
  const handleConfirmDelete = async () => {
    if (configToDelete === null) return;

    try {
      await deleteConfig(configToDelete);
      setDeleteDialogOpen(false);
      setConfigToDelete(null);

      // 如果删除的是当前选中的配置，清空选择
      if (configToDelete === selectedConfigId) {
        setSelectedConfigId(null);
        setFormData({
          name: '',
          endpoint: '',
          apiKey: '',
          modelName: '',
          maxTokens: 2000,
          apiStyle: 'openai_chat_completions',
          contextWindow: 128000,
        });
      }
    } catch (err) {
      console.error('删除配置失败:', err);
    }
  };

  return (
    <Box sx={{ display: 'flex', height: '500px', gap: 2, pt: 1 }}>
      {/* 左侧：配置列表 */}
      <Box sx={{ width: '40%', display: 'flex', flexDirection: 'column', borderRight: 1, borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, py: 1 }}>
          <Typography variant="subtitle2">配置列表</Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={handleOpenCreateDialog}
            disabled={isLoading}
          >
            添加
          </Button>
        </Box>

        <List sx={{ flex: 1, overflow: 'auto', py: 0 }}>
          {configs.map((config) => (
            <ListItem
              key={config.id}
              disablePadding
              secondaryAction={
                <IconButton
                  edge="end"
                  size="small"
                  onClick={() => handleOpenDeleteDialog(config.id)}
                  disabled={isLoading}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              }
            >
              <ListItemButton
                selected={selectedConfigId === config.id}
                onClick={() => handleSelectConfig(config)}
              >
                <Radio
                  checked={config.isActive}
                  onChange={() => handleActivate(config.id)}
                  size="small"
                  sx={{ mr: 1 }}
                />
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2">{config.name}</Typography>
                      {config.isActive && (
                        <Chip label="激活" size="small" color="primary" sx={{ height: 20 }} />
                      )}
                    </Box>
                  }
                  secondary={config.endpoint || '未配置端点'}
                  secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>

        {configs.length === 0 && (
          <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
            <Typography variant="body2">暂无配置</Typography>
            <Typography variant="caption">点击"添加"按钮创建配置</Typography>
          </Box>
        )}
      </Box>

      {/* 右侧：配置编辑区 */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', px: 2, overflow: 'auto' }}>
        {selectedConfigId !== null ? (
          <>
            <Typography variant="subtitle2" sx={{ mb: 2 }}>
              配置详情
            </Typography>

            {error && (
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                {error}
              </Alert>
            )}

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* 配置名称 */}
              <TextField
                label="配置名称"
                size="small"
                fullWidth
                value={formData.name}
                onChange={(e) => handleFieldChange('name', e.target.value)}
                onBlur={() => handleFieldBlur('name')}
                disabled={isLoading}
              />

              {/* API端点 */}
              <TextField
                label="API端点"
                size="small"
                fullWidth
                placeholder="https://api.openai.com/v1"
                value={formData.endpoint}
                onChange={(e) => handleFieldChange('endpoint', e.target.value)}
                onBlur={() => handleFieldBlur('endpoint')}
                disabled={isLoading}
              />

              {/* API Key */}
              <TextField
                label="API Key"
                size="small"
                fullWidth
                type={showApiKey ? 'text' : 'password'}
                value={formData.apiKey}
                onChange={(e) => handleFieldChange('apiKey', e.target.value)}
                onBlur={() => handleFieldBlur('apiKey')}
                disabled={isLoading}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={() => setShowApiKey(!showApiKey)}
                        edge="end"
                      >
                        {showApiKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />

              {/* 模型名称 */}
              <TextField
                label="模型名称"
                size="small"
                fullWidth
                placeholder="gpt-4"
                value={formData.modelName}
                onChange={(e) => handleFieldChange('modelName', e.target.value)}
                onBlur={() => handleFieldBlur('modelName')}
                disabled={isLoading}
              />

              {/* API风格 */}
              <TextField
                label="API 风格"
                size="small"
                fullWidth
                select
                value={formData.apiStyle}
                onChange={(e) =>
                  handleFieldChange('apiStyle', e.target.value as ApiStyle)
                }
                onBlur={() => handleFieldBlur('apiStyle')}
                disabled={isLoading}
              >
                <MenuItem value="openai_chat_completions">
                  OpenAI Compatible (chat/completions, 完整支持)
                </MenuItem>
                <MenuItem value="openai_responses">
                  OpenAI Responses API（实验性）
                </MenuItem>
                <MenuItem value="anthropic_messages">
                  Anthropic Messages API（实验性）
                </MenuItem>
                <MenuItem value="google_v1beta_generate_content">
                  Google Gemini v1beta generateContent（实验性）
                </MenuItem>
              </TextField>
              <Typography variant="caption" color="text.secondary">
                说明：当前仅 OpenAI Compatible（chat/completions）为完整支持，其他 API 风格为实验性兼容。
              </Typography>

              {/* Max Tokens */}
              <TextField
                label="Max Tokens"
                size="small"
                fullWidth
                type="number"
                value={formData.maxTokens}
                onChange={(e) => handleFieldChange('maxTokens', parseInt(e.target.value) || 2000)}
                onBlur={() => handleFieldBlur('maxTokens')}
                disabled={isLoading}
                inputProps={{ min: 100 }}
                helperText="支持200k+上下文的模型（如GPT-4、Claude等）"
              />

              {/* Context Window */}
              <TextField
                label="Context Window"
                size="small"
                fullWidth
                type="number"
                value={formData.contextWindow}
                onChange={(e) =>
                  handleFieldChange(
                    'contextWindow',
                    parseInt(e.target.value, 10) || 128000,
                  )
                }
                onBlur={() => handleFieldBlur('contextWindow')}
                disabled={isLoading}
                inputProps={{ min: 2048 }}
                helperText="用于估算上下文占用百分比（例如 128000 / 200000）"
              />

              {/* Temperature（只读显示） */}
              <TextField
                label="Temperature"
                size="small"
                fullWidth
                value="0.1（固定）"
                disabled
                helperText="翻译任务使用固定的低温度值以确保确定性"
              />

              {/* 说明文本 */}
              <Box sx={{ bgcolor: 'info.lighter', p: 2, borderRadius: 1, mt: 1 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  💡 <strong>使用说明</strong>：
                </Typography>
                <Typography variant="caption" color="text.secondary" component="div">
                  • 修改任意字段后失去焦点会自动保存
                </Typography>
                <Typography variant="caption" color="text.secondary" component="div">
                  • 点击配置项前的圆圈可激活该配置
                </Typography>
                <Typography variant="caption" color="text.secondary" component="div">
                  • 同一时间只能有一个配置处于激活状态
                </Typography>
              </Box>
            </Box>
          </>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Typography variant="body2" color="text.secondary">
              请从左侧选择一个配置
            </Typography>
          </Box>
        )}
      </Box>

      {/* 创建配置对话框 */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>创建新配置</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="配置名称"
            fullWidth
            value={newConfigName}
            onChange={(e) => setNewConfigName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleCreate();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>取消</Button>
          <Button onClick={handleCreate} variant="contained" disabled={!newConfigName.trim()}>
            创建
          </Button>
        </DialogActions>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <Typography>
            确定要删除此配置吗？此操作不可恢复。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>取消</Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained">
            删除
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
