export interface ArticleMetadata {
  slug: string;
  url: string;
  [key: string]: any;
}

export interface ConversionResult {
  filename: string;
  content: string | ArrayBuffer;
  binary?: boolean;
}

// 添加新的类型定义
export type ProcessLog = {
  timestamp: number;
  type: 'info' | 'warning' | 'error';
  message: string;
}; 