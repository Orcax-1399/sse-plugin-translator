import { useMemo } from 'react';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { Box } from '@mui/material';
import type { StringRecord } from '../types';

interface StringTableProps {
  /** 字符串记录列表 */
  rows: StringRecord[];
}

/**
 * 字符串表格组件
 *
 * 显示插件的字符串数据，支持列宽调整和虚拟滚动
 */
export default function StringTable({ rows }: StringTableProps) {
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

  return (
    <Box
      sx={{
        height: '100%',
        width: '100%',
      }}
    >
      <DataGrid
        rows={rowsWithId}
        columns={columns}
        initialState={{
          pagination: {
            paginationModel: { pageSize: 50 },
          },
        }}
        pageSizeOptions={[25, 50, 100]}
        disableRowSelectionOnClick
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
}
