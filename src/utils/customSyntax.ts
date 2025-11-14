/**
 * 自定义语法高亮器 - 用于书籍描述文本
 * 支持：HTML标签、特殊标记（如 [pagebreak]）、转义字符
 */

import { html } from '@codemirror/lang-html';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { Extension } from '@codemirror/state';

/**
 * 定义高亮样式配色方案
 * 颜色遵循 Material Design 调色板
 */
const bookDescHighlightStyle = HighlightStyle.define([
  // HTML 标签 - 蓝色
  { tag: t.tagName, color: '#1976d2', fontWeight: 'bold' },
  { tag: t.angleBracket, color: '#1976d2' },

  // HTML 属性名 - 深蓝色
  { tag: t.attributeName, color: '#0d47a1' },

  // HTML 属性值/字符串 - 绿色
  { tag: t.attributeValue, color: '#2e7d32' },
  { tag: t.string, color: '#2e7d32' },

  // 特殊标记（方括号内容）- 紫色
  // 注意：CodeMirror 的 HTML 模式会把 [pagebreak] 视为普通文本
  // 我们可以通过正则高亮或者自定义解析器来处理
  { tag: t.special(t.variableName), color: '#9c27b0', fontWeight: '600' },

  // 变量/占位符 - 深紫色
  { tag: t.variableName, color: '#7b1fa2', fontStyle: 'italic' },

  // 转义字符 - 橙色
  { tag: t.escape, color: '#ed6c02', fontWeight: '500' },

  // HTML 实体 - 橙色
  { tag: t.character, color: '#ed6c02' },

  // 注释 - 灰色
  { tag: t.comment, color: '#757575', fontStyle: 'italic' },

  // 普通文本
  { tag: t.content, color: 'inherit' },
]);

/**
 * 导出语言扩展和高亮样式
 * 使用 HTML 语言模式作为基础
 */
export const bookDescExtensions: Extension[] = [
  html(),
  syntaxHighlighting(bookDescHighlightStyle),
];

/**
 * 字体配置
 * 优先 Noto Sans SC（中文优化），回退到系统无衬线字体
 * 注意：Noto Sans SC 是非等宽字体，适合自然语言文本显示
 */
export const editorFontFamily = [
  "'Noto Sans SC'",          // Google Noto 中文优化字体（从 Google Fonts CDN 加载）
  "'Noto Sans CJK SC'",      // 完整 CJK 字体（本地安装）
  "'Microsoft YaHei UI'",    // Windows 中文字体回退
  "'PingFang SC'",           // macOS 中文字体回退
  "'Source Han Sans SC'",    // 思源黑体（Adobe 版本）
  "sans-serif",              // 通用无衬线字体回退
].join(', ');
