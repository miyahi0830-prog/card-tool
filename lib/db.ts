import mysql from 'mysql2/promise';

// 数据库配置
const dbConfig = {
  host: '127.0.0.1',
  port: 6363,
  user: 'root',
  password: 'root',
  database: 'ytpay',
};

// 创建连接池
const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// 模块加载时立即测试连接（服务器启动时）
console.log('[DB] 正在初始化数据库连接...');
pool.getConnection()
  .then((connection) => {
    console.log('[DB] MySQL 数据库连接成功');
    connection.release();
  })
  .catch((error) => {
    console.error('[DB] MySQL 数据库连接失败:', error);
  });

// 测试数据库连接
export async function testConnection(): Promise<boolean> {
  try {
    const connection = await pool.getConnection();
    console.log('MySQL 数据库连接成功');
    connection.release();
    return true;
  } catch (error) {
    console.error('MySQL 数据库连接失败:', error);
    return false;
  }
}

// 执行查询
export async function query<T>(sql: string, params?: unknown[]): Promise<T[]> {
  try {
    const [rows] = await pool.execute(sql, params);
    return rows as T[];
  } catch (error) {
    console.error('查询执行失败:', error);
    throw error;
  }
}

// 获取单条记录
export async function queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
  const results = await query<T>(sql, params);
  return results.length > 0 ? results[0] : null;
}

// 执行插入/更新/删除
export async function execute(sql: string, params?: unknown[]): Promise<mysql.ResultSetHeader> {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    const [result] = await pool.execute(sql, params);
    return result as mysql.ResultSetHeader;
  } catch (error) {
    console.error('执行失败:', error);
    throw error;
  }
}

// 获取连接池实例
export function getPool() {
  return pool;
}

export default pool;
