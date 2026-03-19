import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import JSZip from "jszip";

// 表A记录类型
interface TableARecord {
  shopId: string;
  bankAccount: string;
  serialNumber: string;
  amount: number;
  settlementTime: string;
}

// 表B记录类型
interface TableBRecord {
  shopId: string;
  bankAccount: string;
  amount: number;
  settlementTime: string;
  serialNumber: string; // 生成的序号
}

// 表C记录类型
interface TableCRecord {
  fundTransferDate: string;      // 资金划付日期 YYYYMMDD
  customerId: string;            // 客户id (店铺编号)
  paymentOrgCode: string;        // 支付机构编码
  transactionElementType: string; // 交易要素类型
  transactionElement: string;    // 交易要素 (银行账号)
  transactionElementId: string;  // 交易要素唯一标识码 (序号)
  clearingOrg: string;           // 清算机构
  businessType: string;          // 业务类型
  outAmount: number;             // 出金合计金额 (结算金额*100)
  reserved1: string;             // 预留字段1
  reserved2: string;             // 预留字段2
  reserved3: string;             // 预留字段3
  reserved4: string;             // 预留字段4
  reserved5: string;             // 预留字段5
}

// 按日期分组的数据
interface DateGroup {
  date: string; // YYYYMMDD格式
  records: TableCRecord[];
}

/**
 * 解析CSV文件
 */
function parseCSV(buffer: Buffer): Record<string, unknown>[] {
  const content = buffer.toString('utf-8');
  const lines = content.split('\n').filter(line => line.trim() !== '');

  if (lines.length === 0) return [];

  // 检测分隔符（逗号或制表符）
  const firstLine = lines[0];
  const delimiter = firstLine.includes('\t') ? '\t' : ',';

  // 解析CSV行（处理引号包裹的字段）
  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1);

  console.log(`CSV解析: 分隔符="${delimiter}", 表头=${headers.length}列, 行数=${rows.length}`);

  return rows.map((row) => {
    const values = parseLine(row);
    const obj: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      if (header) {
        obj[String(header)] = values[index] ?? "";
      }
    });
    return obj;
  });
}

/**
 * 解析Excel文件
 */
function parseExcel(buffer: Buffer): Record<string, unknown>[] {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
  });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
  console.log(`工作表范围: ${XLSX.utils.encode_range(range)}, 行数: ${range.e.r + 1}`);

  const rawData = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "",
  }) as unknown[][];

  if (rawData.length === 0) return [];

  const headers = rawData[0];
  const rows = rawData.slice(1);

  return rows.map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      if (header) {
        obj[String(header)] = row[index] ?? "";
      }
    });
    return obj;
  });
}

/**
 * 根据文件名解析文件（支持Excel和CSV）
 */
function parseFile(buffer: Buffer, filename: string): Record<string, unknown>[] {
  const lowerFilename = filename.toLowerCase();
  if (lowerFilename.endsWith('.csv')) {
    console.log(`解析CSV文件: ${filename}`);
    return parseCSV(buffer);
  } else {
    console.log(`解析Excel文件: ${filename}`);
    return parseExcel(buffer);
  }
}

/**
 * 获取对象值（支持多种可能的键名）
 */
function getValue(row: Record<string, unknown>, possibleKeys: string[]): unknown {
  for (const key of possibleKeys) {
    if (row[key] !== undefined) {
      return row[key];
    }
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
 * 从字符串中提取日期，返回YYYYMMDD格式（仅年月日）
 * 支持格式:
 * - YYYY-MM-DD HH:mm:ss (如: 2025-07-11 11:00:11)
 * - YYYY/MM/DD (如: 2025/07/11)
 * - YYYY-MM-DD
 * - YYYYMMDD
 */
function extractDate(dateStr: string): string | null {
  const trimmedStr = dateStr.trim();

  // 尝试解析 YYYY-MM-DD HH:mm:ss 或 YYYY-MM-DD 或 YYYY/MM/DD
  // 匹配年月日部分，忽略时间
  const isoPattern = /^(\d{4})[-\/](\d{2})[-\/](\d{2})/;
  const isoMatch = trimmedStr.match(isoPattern);
  if (isoMatch) {
    return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;
  }

  // 尝试解析 YYYYMMDD (纯数字，8位)
  const compactPattern = /^(\d{4})(\d{2})(\d{2})$/;
  const compactMatch = trimmedStr.match(compactPattern);
  if (compactMatch) {
    return `${compactMatch[1]}${compactMatch[2]}${compactMatch[3]}`;
  }

  // 尝试直接解析为日期（作为备选方案）
  try {
    const date = new Date(trimmedStr);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}${month}${day}`;
    }
  } catch {
    // 解析失败
  }

  return null;
}

/**
 * 解析表A数据
 */
function parseTableA(data: unknown[]): TableARecord[] {
  const records: TableARecord[] = [];

  for (const row of data) {
    const rowData = row as Record<string, unknown>;

    const shopId = String(getValue(rowData, ["店铺编号", "shopId", "店铺ID"]) ?? "");
    const bankAccount = String(getValue(rowData, ["银行账号", "bankAccount", "银行卡号"]) ?? "");
    const serialNumber = String(getValue(rowData, ["序号", "serialNumber", "编号"]) ?? "");
    const amount = Number(getValue(rowData, ["结算金额", "amount", "金额"]) ?? 0);
    const settlementTimeValue = getValue(rowData, ["结算时间", "settlementTime", "日期", "时间"]);

    if (!shopId || !settlementTimeValue) {
      console.log(`表A记录跳过: 店铺编号=${shopId}, 结算时间=${settlementTimeValue}`);
      continue;
    }

    const settlementTime = extractDate(String(settlementTimeValue));
    if (!settlementTime) {
      console.log(`表A记录日期解析失败: ${settlementTimeValue}`);
      continue;
    }

    records.push({
      shopId,
      bankAccount,
      serialNumber,
      amount,
      settlementTime,
    });
  }

  return records;
}

/**
 * 解析表B数据并生成序号
 */
function parseTableB(data: unknown[]): TableBRecord[] {
  const records: TableBRecord[] = [];

  // 首先收集所有记录并按日期分组计数
  const tempRecords: Array<{ shopId: string; bankAccount: string; amount: number; settlementTime: string }> = [];

  for (const row of data) {
    const rowData = row as Record<string, unknown>;

    const shopId = String(getValue(rowData, ["店铺编号", "shopId", "店铺ID"]) ?? "");
    const bankAccount = String(getValue(rowData, ["银行账号", "bankAccount", "银行卡号"]) ?? "");
    const amount = Number(getValue(rowData, ["结算金额", "amount", "金额"]) ?? 0);
    const settlementTimeValue = getValue(rowData, ["结算时间", "settlementTime", "日期", "时间"]);

    if (!shopId || !settlementTimeValue) {
      console.log(`表B记录跳过: 店铺编号=${shopId}, 结算时间=${settlementTimeValue}`);
      continue;
    }

    const settlementTime = extractDate(String(settlementTimeValue));
    if (!settlementTime) {
      console.log(`表B记录日期解析失败: ${settlementTimeValue}`);
      continue;
    }

    tempRecords.push({ shopId, bankAccount, amount, settlementTime });
  }

  // 生成序号: YYYYMMDD-0001 格式
  const dateCounterMap = new Map<string, number>();

  for (const temp of tempRecords) {
    const currentCounter = dateCounterMap.get(temp.settlementTime) || 0;
    const newCounter = currentCounter + 1;
    dateCounterMap.set(temp.settlementTime, newCounter);

    const serialNumber = `${temp.settlementTime}-${String(newCounter).padStart(4, '0')}`;

    records.push({
      shopId: temp.shopId,
      bankAccount: temp.bankAccount,
      amount: temp.amount,
      settlementTime: temp.settlementTime,
      serialNumber,
    });
  }

  return records;
}

/**
 * 合并表A和表B数据，按日期分组生成表C
 */
function mergeAndGroupByDate(tableA: TableARecord[], tableB: TableBRecord[]): DateGroup[] {
  const dateMap = new Map<string, TableCRecord[]>();

  // 处理表A数据
  for (const record of tableA) {
    const tableCRecord: TableCRecord = {
      fundTransferDate: record.settlementTime,
      customerId: record.shopId,
      paymentOrgCode: "Z2013011000013",
      transactionElementType: "11",
      transactionElement: record.bankAccount,
      transactionElementId: record.serialNumber,
      clearingOrg: "10",
      businessType: "13",
      outAmount: Math.round(record.amount * 100),
      reserved1: "",
      reserved2: "",
      reserved3: "",
      reserved4: "",
      reserved5: "",
    };

    const existing = dateMap.get(record.settlementTime) || [];
    existing.push(tableCRecord);
    dateMap.set(record.settlementTime, existing);
  }

  // 处理表B数据
  for (const record of tableB) {
    const tableCRecord: TableCRecord = {
      fundTransferDate: record.settlementTime,
      customerId: record.shopId,
      paymentOrgCode: "Z2013011000013",
      transactionElementType: "11",
      transactionElement: record.bankAccount,
      transactionElementId: record.serialNumber,
      clearingOrg: "10",
      businessType: "13",
      outAmount: Math.round(record.amount * 100),
      reserved1: "",
      reserved2: "",
      reserved3: "",
      reserved4: "",
      reserved5: "",
    };

    const existing = dateMap.get(record.settlementTime) || [];
    existing.push(tableCRecord);
    dateMap.set(record.settlementTime, existing);
  }

  // 转换为数组并排序
  const groups: DateGroup[] = [];
  for (const [date, records] of dateMap) {
    groups.push({ date, records });
  }

  // 按日期排序
  groups.sort((a, b) => a.date.localeCompare(b.date));

  return groups;
}

/**
 * 生成CSV内容
 */
function generateCSV(records: TableCRecord[]): string {
  if (records.length === 0) return "";

  const headers = [
    "资金划付日期",
    "客户id",
    "支付机构编码",
    "交易要素类型",
    "交易要素",
    "交易要素唯一标识码",
    "清算机构",
    "业务类型",
    "出金合计金额",
    "预留字段1",
    "预留字段2",
    "预留字段3",
    "预留字段4",
    "预留字段5",
  ];

  const lines: string[] = [headers.join(",")];

  for (const record of records) {
    const values = [
      record.fundTransferDate,
      record.customerId,
      record.paymentOrgCode,
      record.transactionElementType,
      record.transactionElement,
      record.transactionElementId,
      record.clearingOrg,
      record.businessType,
      record.outAmount,
      record.reserved1,
      record.reserved2,
      record.reserved3,
      record.reserved4,
      record.reserved5,
    ];
    lines.push(values.join(","));
  }

  return lines.join("\n");
}

/**
 * 生成TXT内容（无表头，|分隔）
 */
function generateTXT(records: TableCRecord[]): string {
  if (records.length === 0) return "";

  const lines: string[] = [];

  for (const record of records) {
    const values = [
      record.fundTransferDate,
      record.customerId,
      record.paymentOrgCode,
      record.transactionElementType,
      record.transactionElement,
      record.transactionElementId,
      record.clearingOrg,
      record.businessType,
      record.outAmount,
      record.reserved1,
      record.reserved2,
      record.reserved3,
      record.reserved4,
      record.reserved5,
    ];
    lines.push(values.join("|"));
  }

  return lines.join("\n");
}

/**
 * POST /api/21
 * 处理表A和表B数据，生成表C（CSV和TXT格式）
 */
export async function POST(request: NextRequest) {
  try {
    // 解析表单数据
    const formData = await request.formData();

    const fileA = formData.get("fileA") as File | null;
    const fileB = formData.get("fileB") as File | null;

    // 验证文件
    if (!fileA) {
      return NextResponse.json(
        { success: false, message: "请上传表A" },
        { status: 400 }
      );
    }

    if (!fileB) {
      return NextResponse.json(
        { success: false, message: "请上传表B" },
        { status: 400 }
      );
    }

    // 读取并解析表A
    let tableAData: TableARecord[];
    try {
      const bufferA = Buffer.from(await fileA.arrayBuffer());
      const rawDataA = parseFile(bufferA, fileA.name);
      console.log(`表A原始数据: ${rawDataA.length} 条记录`);
      tableAData = parseTableA(rawDataA);
      console.log(`表A解析完成，有效记录: ${tableAData.length} 条`);
    } catch (error) {
      console.error("表A解析错误:", error);
      return NextResponse.json(
        { success: false, message: "表A解析失败，请检查文件格式" },
        { status: 400 }
      );
    }

    // 读取并解析表B
    let tableBData: TableBRecord[];
    try {
      const bufferB = Buffer.from(await fileB.arrayBuffer());
      const rawDataB = parseFile(bufferB, fileB.name);
      console.log(`表B原始数据: ${rawDataB.length} 条记录`);
      tableBData = parseTableB(rawDataB);
      console.log(`表B解析完成，有效记录: ${tableBData.length} 条`);
    } catch (error) {
      console.error("表B解析错误:", error);
      return NextResponse.json(
        { success: false, message: "表B解析失败，请检查文件格式" },
        { status: 400 }
      );
    }

    if (tableAData.length === 0 && tableBData.length === 0) {
      return NextResponse.json(
        { success: false, message: "表A和表B都没有有效数据" },
        { status: 400 }
      );
    }

    // 合并数据并按日期分组
    const dateGroups = mergeAndGroupByDate(tableAData, tableBData);
    console.log(`日期分组数: ${dateGroups.length}, 日期: ${dateGroups.map(g => g.date).join(", ")}`);

    // 生成ZIP文件
    const zip = new JSZip();

    for (const group of dateGroups) {
      const csvContent = generateCSV(group.records);
      const txtContent = generateTXT(group.records);

      // 添加CSV文件到zip
      zip.file(`tableC_${group.date}.csv`, csvContent);
      // 添加TXT文件到zip
      zip.file(`tableC_${group.date}.txt`, txtContent);

      console.log(`日期 ${group.date}: CSV ${csvContent.length} 字符, TXT ${txtContent.length} 字符, 记录数 ${group.records.length}`);
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    return new NextResponse(zipBuffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="tableC_all_dates.zip"`,
      },
    });
  } catch (error) {
    console.error("处理时发生错误:", error);
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
