import { NextRequest, NextResponse } from "next/server";

/**
 * GET 请求处理器
 * 访问地址: /api/hello
 */
export async function GET(request: NextRequest) {
  // 获取查询参数
  const searchParams = request.nextUrl.searchParams;
  const name = searchParams.get("name") || "World";

  return NextResponse.json({
    success: true,
    message: `Hello, ${name}!`,
    timestamp: new Date().toISOString(),
    method: "GET",
  });
}

/**
 * POST 请求处理器
 * 访问地址: /api/hello
 */
export async function POST(request: NextRequest) {
  try {
    // 解析请求体
    const body = await request.json();

    return NextResponse.json({
      success: true,
      message: "Data received successfully",
      data: body,
      timestamp: new Date().toISOString(),
      method: "POST",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "Failed to parse request body",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}

/**
 * PUT 请求处理器
 */
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}));

  return NextResponse.json({
    success: true,
    message: "Resource updated",
    data: body,
    timestamp: new Date().toISOString(),
    method: "PUT",
  });
}

/**
 * DELETE 请求处理器
 */
export async function DELETE(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      {
        success: false,
        message: "ID parameter is required",
      },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: true,
    message: `Resource ${id} deleted`,
    timestamp: new Date().toISOString(),
    method: "DELETE",
  });
}
