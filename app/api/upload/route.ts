import { NextRequest, NextResponse } from "next/server";

/**
 * 处理文件上传并解析 TXT 文件内容
 * POST /api/upload
 */
export async function POST(request: NextRequest) {
  try {
    // 解析表单数据
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    // 验证文件是否存在
    if (!file) {
      return NextResponse.json(
        {
          success: false,
          message: "未找到上传的文件",
        },
        { status: 400 }
      );
    }

    // 验证文件类型
    if (file.type !== "text/plain" && !file.name.endsWith(".txt")) {
      return NextResponse.json(
        {
          success: false,
          message: "仅支持 .txt 文件",
        },
        { status: 400 }
      );
    }

    // 验证文件大小 (限制 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return NextResponse.json(
        {
          success: false,
          message: "文件大小超过限制 (最大 10MB)",
        },
        { status: 400 }
      );
    }

    // 读取文件内容
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // 尝试多种编码解析
    let content = "";
    
    // 首先尝试 UTF-8
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      // UTF-8 解码失败，尝试 GBK
      try {
        content = new TextDecoder("gbk", { fatal: true }).decode(buffer);
      } catch {
        // 如果都失败，使用 UTF-8 非严格模式
        content = new TextDecoder("utf-8").decode(buffer);
      }
    }

    // 返回解析结果
    return NextResponse.json({
      success: true,
      message: "文件解析成功",
      data: {
        filename: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
      },
      content: content,
      stats: {
        charCount: content.length,
        lineCount: content.split("\n").length,
        wordCount: content.trim().split(/\s+/).filter(Boolean).length,
      },
    });

  } catch (error) {
    console.error("文件上传处理错误:", error);
    
    return NextResponse.json(
      {
        success: false,
        message: "文件处理过程中发生错误",
        error: error instanceof Error ? error.message : "未知错误",
      },
      { status: 500 }
    );
  }
}

/**
 * 获取上传接口信息
 * GET /api/upload
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    message: "TXT 文件上传接口",
    usage: {
      method: "POST",
      endpoint: "/api/upload",
      contentType: "multipart/form-data",
      parameters: {
        file: "要上传的 .txt 文件 (必需)",
      },
      constraints: {
        maxSize: "10MB",
        allowedTypes: ["text/plain"],
        allowedExtensions: [".txt"],
      },
    },
  });
}
