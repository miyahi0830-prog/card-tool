import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

interface TableARecord {
  customerId: string;
  cardNumber: string;
  balance: number;
}

interface TableBRecord {
  cardNumber: string;
  transactionAmount: number;
}

interface ProcessResult {
  tableA: TableARecord[];
  tableB: any[]; // 保留原始表B的所有列
}

/**
 * 解析Excel文件
 * 支持大数据量（超过65536行）
 */
function parseExcel(buffer: Buffer): any[] {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
  });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // 获取工作表的实际范围
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
  console.log(`工作表范围: ${XLSX.utils.encode_range(range)}, 行数: ${range.e.r + 1}`);

  // 使用实际范围读取所有数据（不指定range参数，让xlsx自动处理）
  // 或者使用 header: 1 获取数组，然后手动转换
  const rawData = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "",
  }) as any[][];

  if (rawData.length === 0) return [];

  // 第一行是表头
  const headers = rawData[0];
  const rows = rawData.slice(1);

  // 转换为对象数组
  return rows.map((row) => {
    const obj: any = {};
    headers.forEach((header, index) => {
      if (header) {
        obj[String(header)] = row[index] ?? "";
      }
    });
    return obj;
  });
}

/**
 * 查找表A中的记录（通过客户ID/卡号）
 */
function findInTableA(tableA: TableARecord[], key: string): TableARecord | undefined {
  return tableA.find(
    (record) =>
      record.customerId === key || record.cardNumber === key
  );
}

/**
 * 随机获取符合条件的卡
 * 条件：余额 >= 交易金额
 */
function getRandomCard(tableA: TableARecord[], minBalance: number): TableARecord | null {
  const eligibleCards = tableA.filter((record) => record.balance >= minBalance);
  if (eligibleCards.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * eligibleCards.length);
  return eligibleCards[randomIndex];
}

/**
 * 获取对象值（支持多种可能的键名）
 */
function getValue(row: any, possibleKeys: string[]): any {
  for (const key of possibleKeys) {
    // 精确匹配
    if (row[key] !== undefined) {
      return row[key];
    }
    // 忽略大小写匹配
    const lowerKey = key.toLowerCase();
    for (const rowKey of Object.keys(row)) {
      if (rowKey.toLowerCase() === lowerKey) {
        return row[rowKey];
      }
    }
  }
  return undefined;
}

/**
 * 获取卡号列名（在表B中）
 */
function getCardNumberKey(row: any): string | null {
  const possibleKeys = ["卡号", "cardNumber", "卡号 ", "客户id", "客户ID"];
  for (const key of possibleKeys) {
    if (row[key] !== undefined) return key;
    const lowerKey = key.toLowerCase();
    for (const rowKey of Object.keys(row)) {
      if (rowKey.toLowerCase() === lowerKey) {
        return rowKey;
      }
    }
  }
  return null;
}

/**
 * 获取交易金额列名（在表B中）
 */
function getTransactionAmountKey(row: any): string | null {
  const possibleKeys = ["交易金额", "transactionAmount", "金额", "消费金额", "支付金额"];
  for (const key of possibleKeys) {
    if (row[key] !== undefined) return key;
    const lowerKey = key.toLowerCase();
    for (const rowKey of Object.keys(row)) {
      if (rowKey.toLowerCase() === lowerKey) {
        return rowKey;
      }
    }
  }
  return null;
}

/**
 * 处理双表逻辑
 */
function processTables(
  tableAData: any[],
  tableBData: any[]
): ProcessResult {
  console.log("原始表A数据:", JSON.stringify(tableAData.slice(0, 3)));
  console.log("原始表B数据:", JSON.stringify(tableBData.slice(0, 3)));

  // 标准化表A数据 - 支持多种可能的列名
  const tableA: TableARecord[] = tableAData.map((row, index) => {
    const customerId = getValue(row, ["客户id", "客户ID", "customerId", "客户 Id", "客户 id"]);
    const cardNumber = getValue(row, ["卡号", "cardNumber", "卡号 ", "卡号id"]);
    const balance = getValue(row, ["余额", "balance", "卡余额", "剩余金额"]);

    return {
      customerId: String(customerId ?? ""),
      cardNumber: String(cardNumber ?? ""),
      balance: Number(balance ?? 0),
    };
  }).filter(r => r.customerId || r.cardNumber);

  console.log("标准化后表A:", JSON.stringify(tableA.slice(0, 3)));
  console.log("表A记录数:", tableA.length);
  console.log("表B记录数:", tableBData.length);

  // 处理结果 - 保留原始表B的所有列
  const resultB: any[] = [];

  // 获取表B中的列名
  const cardNumberKey = tableBData.length > 0 ? getCardNumberKey(tableBData[0]) : null;
  const transactionAmountKey = tableBData.length > 0 ? getTransactionAmountKey(tableBData[0]) : null;

  if (!cardNumberKey) {
    console.error("未找到表B中的卡号列");
  }
  if (!transactionAmountKey) {
    console.error("未找到表B中的交易金额列");
  }

  // 处理表B的每一行
  for (const originalRow of tableBData) {
    // 复制原始行数据
    const resultRow = { ...originalRow };

    const cardNumber = cardNumberKey ? String(originalRow[cardNumberKey] ?? "") : "";
    const transactionAmount = transactionAmountKey ? Number(originalRow[transactionAmountKey] ?? 0) : 0;

    console.log(`处理表B记录: 卡号=${cardNumber}, 金额=${transactionAmount}`);

    const aRecord = findInTableA(tableA, cardNumber);
    console.log(`  在表A中找到:`, aRecord ? `卡号=${aRecord.cardNumber}, 余额=${aRecord.balance}` : "未找到");

    if (aRecord && aRecord.balance >= transactionAmount) {
      // 情况1：存在且余额充足，扣减余额，卡号不变
      aRecord.balance -= transactionAmount;
      console.log(`  -> 余额充足，扣减后余额=${aRecord.balance}`);
    } else {
      // 情况2：不存在或余额不足，需要随机选卡
      console.log(`  -> 需要随机选卡`);
      const randomCard = getRandomCard(tableA, transactionAmount);

      if (randomCard) {
        // 找到了符合条件的卡，替换卡号
        randomCard.balance -= transactionAmount;
        console.log(`  -> 选中卡号=${randomCard.customerId}, 扣减后余额=${randomCard.balance}`);

        // 替换卡号列的值
        if (cardNumberKey) {
          resultRow[cardNumberKey] = randomCard.customerId;
        }
      } else {
        // 没有符合条件的卡，保持原样
        console.log(`  -> 未找到符合条件的卡`);
      }
    }

    resultB.push(resultRow);
  }

  console.log("处理完成，表A结果:", JSON.stringify(tableA.slice(0, 3)));
  console.log("处理完成，表B结果:", JSON.stringify(resultB.slice(0, 3)));

  return {
    tableA,
    tableB: resultB,
  };
}

/**
 * 生成Excel文件（包含表A和表B）
 */
function generateExcel(
  tableA: TableARecord[],
  tableB: any[]
): Buffer {
  const workbook = XLSX.utils.book_new();

  // 表A工作表
  const worksheetA = XLSX.utils.json_to_sheet(
    tableA.map((record) => ({
      "客户ID": record.customerId,
      "卡号": record.cardNumber,
      "余额": record.balance,
    }))
  );
  worksheetA["!cols"] = [
    { wch: 20 }, // 客户ID
    { wch: 25 }, // 卡号
    { wch: 15 }, // 余额
  ];
  XLSX.utils.book_append_sheet(workbook, worksheetA, "表A结果");

  // 表B工作表 - 保留原始所有列
  const worksheetB = XLSX.utils.json_to_sheet(tableB);
  XLSX.utils.book_append_sheet(workbook, worksheetB, "表B结果");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

/**
 * POST /api/process-tables
 * 处理双表匹配逻辑
 */
export async function POST(request: NextRequest) {
  try {
    // 解析表单数据
    const formData = await request.formData();
    const fileA = formData.get("fileA") as File | null;
    const fileB = formData.get("fileB") as File | null;

    // 验证文件
    if (!fileA || !fileB) {
      return NextResponse.json(
        { success: false, message: "请同时上传表A和表B" },
        { status: 400 }
      );
    }

    // 读取并解析Excel文件
    const bufferA = Buffer.from(await fileA.arrayBuffer());
    const bufferB = Buffer.from(await fileB.arrayBuffer());

    let tableAData: any[];
    let tableBData: any[];

    try {
      tableAData = parseExcel(bufferA);
      console.log(`表A解析完成，共 ${tableAData.length} 条记录`);
    } catch (error) {
      console.error("表A解析错误:", error);
      return NextResponse.json(
        { success: false, message: "表A解析失败，请检查文件格式" },
        { status: 400 }
      );
    }

    try {
      tableBData = parseExcel(bufferB);
      console.log(`表B解析完成，共 ${tableBData.length} 条记录`);
    } catch (error) {
      console.error("表B解析错误:", error);
      return NextResponse.json(
        { success: false, message: "表B解析失败，请检查文件格式" },
        { status: 400 }
      );
    }

    // 验证数据
    if (tableAData.length === 0) {
      return NextResponse.json(
        { success: false, message: "表A数据为空" },
        { status: 400 }
      );
    }

    if (tableBData.length === 0) {
      return NextResponse.json(
        { success: false, message: "表B数据为空" },
        { status: 400 }
      );
    }

    // 处理双表逻辑
    const result = processTables(tableAData, tableBData);

    // 生成Excel文件（包含表A和表B）
    const excelBuffer = generateExcel(result.tableA, result.tableB);

    // 将Excel转为base64
    const excelBase64 = excelBuffer.toString("base64");

    // 返回JSON结果（包含Excel文件和预览数据）
    return NextResponse.json({
      success: true,
      message: "处理完成",
      data: {
        tableA: result.tableA.map((r, i) => ({ ...r, key: String(i) })),
        tableB: result.tableB.map((r, i) => ({ ...r, key: String(i) })),
        excelBase64: excelBase64,
        filename: "result_tables.xlsx",
      },
    });
  } catch (error) {
    console.error("处理双表时发生错误:", error);
    return NextResponse.json(
      {
        success: false,
        message: "处理过程中发生错误",
        error: error instanceof Error ? error.message : "未知错误",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/process-tables
 * 获取接口信息
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    message: "双表匹配处理接口",
    usage: {
      method: "POST",
      endpoint: "/api/process-tables",
      contentType: "multipart/form-data",
      parameters: {
        fileA: "表A Excel文件 (客户信息表，包含: 客户ID、卡号、余额)",
        fileB: "表B Excel文件 (交易记录表，包含: 卡号、交易金额)",
      },
      logic: {
        description: "表A的客户ID与表B的卡号代表同一字段",
        rules: [
          "对于表B每行，检查卡号在表A是否存在且余额 >= 交易金额",
          "如果满足条件，不做操作",
          "如果不满足，从表A随机选取余额 >= 交易金额的卡",
          "替换表B的卡号，并扣减表A对应卡的余额",
        ],
      },
      response: "处理后的表A Excel文件",
    },
  });
}
