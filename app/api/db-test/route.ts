import { NextResponse } from 'next/server';
import { testConnection } from '@/lib/db';

// 数据库连接健康检查 API
export async function GET() {
  try {
    const connected = await testConnection();
    
    if (connected) {
      return NextResponse.json({ 
        success: true, 
        message: '数据库连接正常' 
      });
    } else {
      return NextResponse.json(
        { 
          success: false, 
          message: '数据库连接失败' 
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('数据库健康检查出错:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: '数据库健康检查出错',
        error: error instanceof Error ? error.message : '未知错误'
      },
      { status: 500 }
    );
  }
}
