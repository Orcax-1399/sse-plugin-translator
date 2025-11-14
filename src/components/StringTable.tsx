import { useMemo, memo } from 'react';
import { DataGrid, GridColDef, GridRowParams } from '@mui/x-data-grid';
import { Box } from '@mui/material';
import { invoke } from '@tauri-apps/api/core';
import type { StringRecord } from '../types';
import { showError } from '../stores/notificationStore';

interface StringTableProps {
  /** 字符串记录列表 */
  rows: StringRecord[];
  /** Session ID，用作 DataGrid 的 key，强制在 session 切换时重新挂载 */
  sessionId?: string;
}

/**
 * 字符串表格组件
 *
 * 显示插件的字符串数据，支持列宽调整和虚拟滚动
 *
 * ✅ 使用 React.memo 包装，避免不必要的重渲染
 */
const StringTable = memo(function StringTable({ rows, sessionId }: StringTableProps) {
  // 定义列（按需求顺序）
  const columns: GridColDef[] = [
    {
      field: 'form_id_short',
      headerName: 'Form ID',
      width: 120,
      valueGetter: (_value, row) => {
        // 前端处理：仅显示 | 左侧部分
        return row.form_id.split('|')[0];
      },
    },
    {
      field: 'editor_id',
      headerName: 'Editor ID',
      width: 150,
      valueGetter: (_value, row) => row.editor_id || '(无)',
    },
    {
      field: 'type',
      headerName: 'Type',
      width: 150,
      valueGetter: (_value, row) => {
        // 组合 record_type + subrecord_type
        return `${row.record_type} ${row.subrecord_type}`;
      },
    },
    {
      field: 'original_text',
      headerName: 'Original Text',
      flex: 1, // 自适应宽度
      minWidth: 200,
    },
    {
      field: 'translated_text',
      headerName: 'Translated Text',
      flex: 1, // 自适应宽度
      minWidth: 200,
    },
  ];

  // ✅ 使用 useMemo 缓存计算结果（防止重渲染时重新创建数组）
  const rowsWithId = useMemo(() => {
    return rows.map((row, index) => ({
      id: index, // 使用索引作为唯一 ID
      ...row,
    }));
  }, [rows]);

  // 双击行打开编辑窗口
  const handleRowDoubleClick = (params: GridRowParams) => {
    const record = params.row as StringRecord;

    console.log('→ 双击行，准备打开编辑窗口');

    // ✅ Fire-and-forget: 不等待也不处理结果
    // 这样即使后端阻塞也不会影响主窗口
    invoke('open_editor_window', { record }).catch((error) => {
      console.error('打开编辑窗口失败:', error);
      showError('打开编辑窗口失败: ' + String(error));
    });

    console.log('→ 调用已发出，不等待返回');
  };

  return (
    <Box
      sx={{
        height: '100%',
        width: '100%',
      }}
    >
      <DataGrid
        key={sessionId} // ✅ 强制在 session 切换时重新挂载，确保旧缓存释放
        rows={rowsWithId}
        columns={columns}
        initialState={{
          pagination: {
            paginationModel: { pageSize: 50 },
          },
        }}
        pageSizeOptions={[25, 50, 100]}
        disableRowSelectionOnClick
        onRowDoubleClick={handleRowDoubleClick}
        getRowClassName={(params) => {
          const row = params.row as StringRecord;
          switch (row.translation_status) {
            case 'untranslated':
              return 'row-untranslated';
            case 'manual':
              return 'row-manual';
            case 'ai':
              return 'row-ai';
            default:
              return '';
          }
        }}
        sx={{
          border: 0,
          width: '100%',
          '& .MuiDataGrid-cell': {
            borderBottom: '1px solid #e0e0e0',
          },
          // 行颜色样式
          '& .row-untranslated': {
            backgroundColor: '#ffebee !important', // 淡红色（未翻译）
            '&:hover': {
              backgroundColor: '#ffcdd2 !important',
            },
          },
          '& .row-manual': {
            backgroundColor: '#e3f2fd !important', // 淡蓝色（已翻译）
            '&:hover': {
              backgroundColor: '#bbdefb !important',
            },
          },
          '& .row-ai': {
            backgroundColor: '#e8f5e9 !important', // 淡绿色（AI翻译，预留）
            '&:hover': {
              backgroundColor: '#c8e6c9 !important',
            },
          },
        }}
      />
    </Box>
  );
});

export default StringTable;
