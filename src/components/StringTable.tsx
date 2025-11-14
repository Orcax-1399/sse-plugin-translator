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

  // 为 DataGrid 添加唯一 ID
  const rowsWithId = rows.map((row, index) => ({
    id: index, // 使用索引作为唯一 ID
    ...row,
  }));

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
        sx={{
          border: 0,
          width: '100%',
          '& .MuiDataGrid-cell': {
            borderBottom: '1px solid #e0e0e0',
          },
        }}
      />
    </Box>
  );
}
