import { useState, useEffect, useMemo } from 'react';
import {
  Stack,
  Button,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Chip,
  Alert,
  Snackbar,
  Typography,
  IconButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { MaterialReactTable, type MRT_ColumnDef } from 'material-react-table';
import type { RowSelectionState } from '@tanstack/react-table';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { invoke } from '@tauri-apps/api/core';

interface AtomTranslation {
  id: number;
  original: string;
  translated: string;
  usage_count: number;
  source: 'Base' | 'AI' | 'Manual';
  created_at: number;
  updated_at: number;
}

export default function AtomDbTermsPanel() {
  const [atoms, setAtoms] = useState<AtomTranslation[]>([]);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newOriginal, setNewOriginal] = useState('');
  const [newTranslated, setNewTranslated] = useState('');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });
  // 编辑相关状态
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingAtom, setEditingAtom] = useState<AtomTranslation | null>(null);
  const [editTranslated, setEditTranslated] = useState('');
  const [editSource, setEditSource] = useState<AtomTranslation['source']>('Manual');
  const selectedIds = useMemo(() => {
    return Object.entries(rowSelection)
      .filter(([, selected]) => selected)
      .map(([id]) => Number(id))
      .filter((value) => Number.isFinite(value));
  }, [rowSelection]);
  const selectedCount = selectedIds.length;

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
    if (selectedCount === 0) {
      showSnackbar('请先选择要删除的条目', 'error');
      return;
    }

    try {
      // 批量删除
      for (const id of selectedIds) {
        const atom = atoms.find((a) => a.id === Number(id));
        if (atom) {
          await invoke('delete_atom_translation', {
            original: atom.original,
          });
        }
      }

      showSnackbar(`成功删除 ${selectedCount} 条记录`, 'success');
      setRowSelection({});
      loadAtoms(); // 重新加载数据
    } catch (error) {
      showSnackbar('删除失败: ' + String(error), 'error');
    }
  };

  // 打开编辑对话框
  const handleEditClick = (atom: AtomTranslation) => {
    setEditingAtom(atom);
    setEditTranslated(atom.translated);
    setEditSource(atom.source);
    setEditDialogOpen(true);
  };

  // 提交编辑
  const handleEditSubmit = async () => {
    if (!editingAtom) return;
    if (!editTranslated.trim()) {
      showSnackbar('译文不能为空', 'error');
      return;
    }

    try {
      await invoke('update_atom_translation', {
        id: editingAtom.id,
        translated: editTranslated.trim(),
        source: editSource,
      });

      showSnackbar('修改成功', 'success');
      setEditDialogOpen(false);
      setEditingAtom(null);
      loadAtoms(); // 重新加载数据
    } catch (error) {
      showSnackbar('修改失败: ' + String(error), 'error');
    }
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
  const columns: MRT_ColumnDef<AtomTranslation>[] = [
    {
      header: '原文',
      accessorKey: 'original',
      size: 200,
      grow: 1,
    },
    {
      header: '译文',
      accessorKey: 'translated',
      size: 200,
      grow: 1,
    },
    {
      header: '使用次数',
      accessorKey: 'usage_count',
      size: 120,
    },
    {
      header: '来源',
      accessorKey: 'source',
      size: 100,
      Cell: ({ cell }) => {
        const source = cell.getValue<AtomTranslation['source']>();
        return (
          <Chip
            label={getSourceLabel(source)}
            color={getSourceColor(source)}
            size="small"
          />
        );
      },
    },
    {
      header: '创建时间',
      accessorKey: 'created_at',
      size: 180,
      Cell: ({ cell }) =>
        new Date(cell.getValue<number>() * 1000).toLocaleString('zh-CN'),
    },
    {
      header: '操作',
      size: 80,
      enableSorting: false,
      enableColumnActions: false,
      Cell: ({ row }) => (
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            handleEditClick(row.original as AtomTranslation);
          }}
          title="编辑"
        >
          <EditIcon fontSize="small" />
        </IconButton>
      ),
    },
  ];

  return (
    <Stack spacing={2} sx={{ height: '100%' }}>
      {/* 说明 */}
      <Alert severity="info">
        原子数据库用于存储游戏术语的对照翻译,系统会自动在文本中标注这些术语,例如:savangard → savangard(松加德)
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
          disabled={selectedCount === 0}
        >
          删除选中 ({selectedCount})
        </Button>
      </Box>

      {/* 术语表格 */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <MaterialReactTable
          columns={columns}
          data={atoms}
          enableRowSelection
          enableMultiRowSelection
          enableTopToolbar={false}
          getRowId={(row, index) =>
            row?.id !== undefined && row?.id !== null
              ? row.id.toString()
              : `row-${index}`
          }
          initialState={{
            pagination: { pageIndex: 0, pageSize: 100 },
            sorting: [{ id: 'usage_count', desc: true }],
          }}
          muiTablePaperProps={{
            elevation: 0,
            sx: { height: '100%', display: 'flex', flexDirection: 'column' },
          }}
          muiTableContainerProps={{ sx: { flex: 1 } }}
          muiTableBodyRowProps={{
            sx: {
              cursor: 'pointer',
            },
          }}
          muiTableBodyCellProps={{
            sx: {
              '&:focus': {
                outline: 'none',
              },
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%',
            },
          }}
          muiPaginationProps={{
            rowsPerPageOptions: [50, 100, 300],
          }}
          layoutMode="grid"
          positionPagination="bottom"
          state={{
            rowSelection,
            isLoading: loading,
            showProgressBars: loading,
          }}
          onRowSelectionChange={setRowSelection}
        />
      </Box>

      {/* 底部统计 */}
      <Typography variant="body2" color="text.secondary">
        共 {atoms.length} 条术语
      </Typography>

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
              placeholder="例如:savangard"
              helperText="将自动转换为小写存储"
            />
            <TextField
              label="中文译文"
              value={newTranslated}
              onChange={(e) => setNewTranslated(e.target.value)}
              fullWidth
              placeholder="例如:松加德"
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

      {/* 编辑对话框 */}
      <Dialog
        open={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>编辑术语</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="英文原文"
              value={editingAtom?.original || ''}
              fullWidth
              disabled
              helperText="原文不可修改"
            />
            <TextField
              label="中文译文"
              value={editTranslated}
              onChange={(e) => setEditTranslated(e.target.value)}
              fullWidth
              autoFocus
            />
            <FormControl fullWidth>
              <InputLabel id="edit-source-label">来源</InputLabel>
              <Select
                labelId="edit-source-label"
                value={editSource}
                label="来源"
                onChange={(e) => setEditSource(e.target.value as AtomTranslation['source'])}
              >
                <MenuItem value="Base">基础</MenuItem>
                <MenuItem value="AI">AI</MenuItem>
                <MenuItem value="Manual">手动</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>取消</Button>
          <Button onClick={handleEditSubmit} variant="contained">
            保存
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
    </Stack>
  );
}
