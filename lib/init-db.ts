import { testConnection } from './db';

let isInitialized = false;

export async function initDatabase(): Promise<boolean> {
  if (isInitialized) {
    return true;
  }

  console.log('正在初始化数据库连接...');
  const connected = await testConnection();
  
  if (connected) {
    isInitialized = true;
    console.log('数据库初始化完成');
  } else {
    console.error('数据库初始化失败');
  }
  
  return connected;
}

export function isDatabaseInitialized(): boolean {
  return isInitialized;
}
