import { useState, useEffect } from 'react';
import {
  Container,
  Stack,
  Typography,
  Button,
  IconButton,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Chip,
  Alert,
  Snackbar,
} from '@mui/material';
import { DataGrid, GridColDef, GridRowsProp, GridRowSelectionModel } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

interface AtomTranslation {
  id: number;
  original: string;
  translated: string;
  usage_count: number;
  source: 'Base' | 'AI' | 'Manual';
  created_at: number;
  updated_at: number;
}

export default function AtomicDbWindow() {
  const [atoms, setAtoms] = useState<AtomTranslation[]>([]);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newOriginal, setNewOriginal] = useState('');
  const [newTranslated, setNewTranslated] = useState('');
  // ✅ 使用GridRowSelectionModel v8格式
  const [selectedRowsModel, setSelectedRowsModel] = useState<GridRowSelectionModel>({
    type: 'include',
    ids: new Set(),
  });
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // 加载原子数据
  const loadAtoms = async () => {
    try {
      setLoading(true);
      const data = await invoke<AtomTranslation[]>('get_all_atoms');
      setAtoms(data);
    } catch (error) {
      showSnackbar('加载原子数据失败: ' + String(error), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAtoms();
  }, []);

  // 显示提示消息
  const showSnackbar = (message: string, severity: 'success' | 'error') => {
    setSnackbar({ open: true, message, severity });
  };

  // 关闭提示消息
  const handleCloseSnackbar = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  // 添加原子翻译
  const handleAddAtom = async () => {
    if (!newOriginal.trim() || !newTranslated.trim()) {
      showSnackbar('原文和译文不能为空', 'error');
      return;
    }

    try {
      await invoke('add_atom_translation', {
        original: newOriginal.trim(),
        translated: newTranslated.trim(),
        source: 'manual',
      });

      showSnackbar('添加成功', 'success');
      setAddDialogOpen(false);
      setNewOriginal('');
      setNewTranslated('');
      loadAtoms(); // 重新加载数据
    } catch (error) {
      showSnackbar('添加失败: ' + String(error), 'error');
    }
  };

  // 删除选中的原子翻译
  const handleDeleteSelected = async () => {
    if (selectedRowsModel.ids.size === 0) {
      showSnackbar('请先选择要删除的条目', 'error');
      return;
    }

    try {
      // 批量删除
      for (const id of selectedRowsModel.ids) {
        const atom = atoms.find((a) => a.id === Number(id));
        if (atom) {
          await invoke('delete_atom_translation', {
            original: atom.original,
          });
        }
      }

      showSnackbar(`成功删除 ${selectedRowsModel.ids.size} 条记录`, 'success');
      setSelectedRowsModel({ type: 'include', ids: new Set() });
      loadAtoms(); // 重新加载数据
    } catch (error) {
      showSnackbar('删除失败: ' + String(error), 'error');
    }
  };

  // 关闭窗口
  const handleClose = () => {
    getCurrentWebviewWindow().close();
  };

  // 获取来源标签
  const getSourceLabel = (source: AtomTranslation['source']) => {
    switch (source) {
      case 'Base': return '基础';
      case 'AI': return 'AI';
      case 'Manual': return '手动';
      default: return '未知';
    }
  };

  // 获取来源颜色
  const getSourceColor = (source: AtomTranslation['source']): 'primary' | 'success' | 'default' => {
    switch (source) {
      case 'Base': return 'primary';
      case 'AI': return 'success';
      case 'Manual': return 'default';
      default: return 'default';
    }
  };

  // 定义表格列
  const columns: GridColDef[] = [
    {
      field: 'original',
      headerName: '原文',
      flex: 2,
      minWidth: 200,
    },
    {
      field: 'translated',
      headerName: '译文',
      flex: 2,
      minWidth: 200,
    },
    {
      field: 'usage_count',
      headerName: '使用次数',
      width: 120,
      type: 'number',
    },
    {
      field: 'source',
      headerName: '来源',
      width: 100,
      renderCell: (params) => (
        <Chip
          label={getSourceLabel(params.value)}
          color={getSourceColor(params.value)}
          size="small"
        />
      ),
    },
    {
      field: 'created_at',
      headerName: '创建时间',
      width: 180,
      valueFormatter: (value) => new Date(value * 1000).toLocaleString('zh-CN'),
    },
  ];

  // 转换为 DataGrid 所需的行数据
  const rows: GridRowsProp = atoms.map((atom) => ({
    id: atom.id,
    original: atom.original,
    translated: atom.translated,
    usage_count: atom.usage_count,
    source: atom.source,
    created_at: atom.created_at,
  }));

  return (
    <Container maxWidth="xl" sx={{ height: '100vh', py: 3 }}>
      <Stack spacing={2} sx={{ height: '100%' }}>
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h5">原子数据库管理</Typography>
          <IconButton onClick={handleClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>

        {/* 说明 */}
        <Alert severity="info">
          原子数据库用于存储游戏术语的对照翻译，系统会自动在文本中标注这些术语，例如：savangard → savangard(松加德)
        </Alert>

        {/* 工具栏 */}
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setAddDialogOpen(true)}
          >
            添加术语
          </Button>
          <Button
            variant="outlined"
            color="error"
            startIcon={<DeleteIcon />}
            onClick={handleDeleteSelected}
            disabled={selectedRowsModel.ids.size === 0}
          >
            删除选中 ({selectedRowsModel.ids.size})
          </Button>
        </Box>

        {/* DataGrid */}
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <DataGrid
            rows={rows}
            columns={columns}
            loading={loading}
            checkboxSelection
            disableRowSelectionOnClick
            density="compact"
            pageSizeOptions={[25, 50, 100]}
            rowSelectionModel={selectedRowsModel}
            initialState={{
              pagination: { paginationModel: { pageSize: 50 } },
              sorting: {
                sortModel: [{ field: 'usage_count', sort: 'desc' }],
              },
            }}
            onRowSelectionModelChange={(newSelection) => {
              setSelectedRowsModel(newSelection);
            }}
            sx={{
              '& .MuiDataGrid-cell:focus': {
                outline: 'none',
              },
              '& .MuiDataGrid-row:hover': {
                cursor: 'pointer',
              },
            }}
          />
        </Box>

        {/* 底部统计 */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            共 {atoms.length} 条术语
          </Typography>
          <Button variant="outlined" onClick={handleClose}>
            关闭
          </Button>
        </Box>
      </Stack>

      {/* 添加对话框 */}
      <Dialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>添加新术语</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="英文原文"
              value={newOriginal}
              onChange={(e) => setNewOriginal(e.target.value)}
              fullWidth
              autoFocus
              placeholder="例如：savangard"
              helperText="将自动转换为小写存储"
            />
            <TextField
              label="中文译文"
              value={newTranslated}
              onChange={(e) => setNewTranslated(e.target.value)}
              fullWidth
              placeholder="例如：松加德"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddDialogOpen(false)}>取消</Button>
          <Button onClick={handleAddAtom} variant="contained">
            添加
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar 提示 */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Container>
  );
}
