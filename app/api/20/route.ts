import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import JSZip from "jszip";

// 中间数据类型（表A和表B处理后的统一格式）
interface IntermediateRecord {
  date: string; // YYYYMMDD格式
  originalFields: Record<string, unknown>; // 原始记录的所有字段
  paymentDirection: string; // 收付方向: 11或10
  adjustmentRecordNo: string; // 调账记录号: YYYYMMDD-11/10-序号
  customerId: string; // 客户id
  amount: number; // 金额（交易金额或开卡金额）
  source: 'A' | 'B'; // 数据来源: A或B
}

// 表C记录类型
interface TableCRecord {
  date: string;                    // 日期 YYYYMMDD
  paymentOrgCode: string;          // 支付机构编码
  adjustmentRecordNo: string;      // 调账记录号
  customerId: string;              // 客户id
  businessType: string;            // 业务类型
  paymentDirection: string;        // 收付方向
  sameCustomerAdjustment: string;  // 是否为同一客户id间的调账
  adjustmentAmount: number;        // 调账合计金额
  remark: string;                  // 备注
  reserved1: string;               // 预留字段1
  reserved2: string;               // 预留字段2
  reserved3: string;               // 预留字段3
  reserved4: string;               // 预留字段4
  reserved5: string;               // 预留字段5
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

  const firstLine = lines[0];
  const delimiter = firstLine.includes('\t') ? '\t' : ',';

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
 * - YYYY年M月D日 (如: 2025年7月11日 或 2025年07月01日)
 */
function extractDate(dateStr: string): string | null {
  const trimmedStr = dateStr.trim();

  // 尝试解析 YYYY-MM-DD HH:mm:ss 或 YYYY-MM-DD 或 YYYY/MM/DD
  const isoPattern = /^(\d{4})[-\/](\d{2})[-\/](\d{2})/;
  const isoMatch = trimmedStr.match(isoPattern);
  if (isoMatch) {
    return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;
  }

  // 尝试解析 YYYY年M月D日 格式 (支持 2025年7月11日 或 2025年07月01日)
  const chinesePattern = /^(\d{4})年(\d{1,2})月(\d{1,2})日/;
  const chineseMatch = trimmedStr.match(chinesePattern);
  if (chineseMatch) {
    const year = chineseMatch[1];
    const month = chineseMatch[2].padStart(2, '0');
    const day = chineseMatch[3].padStart(2, '0');
    return `${year}${month}${day}`;
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
 * 处理表A数据
 * 每条记录生成两条数据：收款方(11)和付款方(10)
 * 返回记录列表和每个日期的最大序号Map
 */
function processTableA(data: Record<string, unknown>[]): {
  records: IntermediateRecord[];
  maxSeqMap: Map<string, number>;
} {
  const records: IntermediateRecord[] = [];
  const maxSeqMap = new Map<string, number>();

  // 按日期分组计数
  const dateGroups = new Map<string, Array<{ row: Record<string, unknown>; date: string }>>();

  for (const row of data) {
    const shopId = String(getValue(row, ["店铺编号", "shopId", "店铺ID"]) ?? "");
    const cardNumber = String(getValue(row, ["卡号", "cardNumber", "卡片号"]) ?? "");
    const amount = Number(getValue(row, ["交易金额", "amount", "金额"]) ?? 0);
    const transactionTimeValue = getValue(row, ["交易时间", "transactionTime", "时间", "日期"]);

    if (!shopId || !cardNumber || !transactionTimeValue) {
      console.log(`表A记录跳过: 店铺编号=${shopId}, 卡号=${cardNumber}, 交易时间=${transactionTimeValue}`);
      continue;
    }

    const date = extractDate(String(transactionTimeValue));
    if (!date) {
      console.log(`表A记录日期解析失败: ${transactionTimeValue}`);
      continue;
    }

    const group = dateGroups.get(date) || [];
    group.push({ row, date });
    dateGroups.set(date, group);
  }

  // 生成记录，每个日期内序号从0001自增
  for (const [date, group] of dateGroups) {
    let seq = 1;

    for (const { row, date: recordDate } of group) {
      const shopId = String(getValue(row, ["店铺编号", "shopId", "店铺ID"]) ?? "");
      const cardNumber = String(getValue(row, ["卡号", "cardNumber", "卡片号"]) ?? "");
      const rawAmount = Number(getValue(row, ["交易金额", "amount", "金额"]) ?? 0);

      const seqStr = String(seq).padStart(4, '0');

      // 判断是否为退款（金额为负数）
      const isRefund = rawAmount < 0;
      // 金额转为正数
      const amount = Math.abs(rawAmount);

      if (isRefund) {
        // 退款情况：收款方=卡号，付款方=店铺编号
        // 第一条：收款方数据（收付方向=11，客户id=卡号）
        records.push({
          date: recordDate,
          originalFields: { ...row },
          paymentDirection: "11",
          adjustmentRecordNo: `${recordDate}-11-${seqStr}`,
          customerId: cardNumber,
          amount,
          source: 'A',
        });

        // 第二条：付款方数据（收付方向=10，客户id=店铺编号）
        records.push({
          date: recordDate,
          originalFields: { ...row },
          paymentDirection: "10",
          adjustmentRecordNo: `${recordDate}-10-${seqStr}`,
          customerId: shopId,
          amount,
          source: 'A',
        });
      } else {
        // 正常消费情况：收款方=店铺编号，付款方=卡号
        // 第一条：收款方数据（收付方向=11，客户id=店铺编号）
        records.push({
          date: recordDate,
          originalFields: { ...row },
          paymentDirection: "11",
          adjustmentRecordNo: `${recordDate}-11-${seqStr}`,
          customerId: shopId,
          amount,
          source: 'A',
        });

        // 第二条：付款方数据（收付方向=10，客户id=卡号）
        records.push({
          date: recordDate,
          originalFields: { ...row },
          paymentDirection: "10",
          adjustmentRecordNo: `${recordDate}-10-${seqStr}`,
          customerId: cardNumber,
          amount,
          source: 'A',
        });
      }

      seq++;
    }

    // 保存该日期的最大序号（seq在最后一次循环后已经自增，所以要减1）
    maxSeqMap.set(date, seq - 1);
  }

  return { records, maxSeqMap };
}

/**
 * 处理表B数据
 * 每条记录生成两条数据：收款方(11)和付款方(10)
 * 调账记录号继续表A的编号顺序
 */
function processTableB(
  data: Record<string, unknown>[],
  tableAMaxSeqMap: Map<string, number>
): IntermediateRecord[] {
  const records: IntermediateRecord[] = [];

  // 按日期分组计数
  const dateGroups = new Map<string, Array<{ row: Record<string, unknown>; date: string }>>();

  for (const row of data) {
    const cardNumber = String(getValue(row, ["卡号", "cardNumber", "卡片号"]) ?? "");
    const openAmount = Number(getValue(row, ["开卡金额", "openAmount", "金额"]) ?? 0);
    const activationTimeValue = getValue(row, ["激活时间", "activationTime", "时间", "日期"]);

    if (!cardNumber || !activationTimeValue) {
      console.log(`表B记录跳过: 卡号=${cardNumber}, 激活时间=${activationTimeValue}`);
      continue;
    }

    const date = extractDate(String(activationTimeValue));
    if (!date) {
      console.log(`表B记录日期解析失败: ${activationTimeValue}`);
      continue;
    }

    const group = dateGroups.get(date) || [];
    group.push({ row, date });
    dateGroups.set(date, group);
  }

  // 生成记录，每个日期内序号从表A的最大序号+1开始自增
  for (const [date, group] of dateGroups) {
    // 获取该日期表A的最大序号，如果没有则从0开始
    const maxSeqA = tableAMaxSeqMap.get(date) || 0;
    let seq = maxSeqA + 1;

    for (const { row, date: recordDate } of group) {
      const cardNumber = String(getValue(row, ["卡号", "cardNumber", "卡片号"]) ?? "");
      const openAmount = Number(getValue(row, ["开卡金额", "openAmount", "金额"]) ?? 0);

      const seqStr = String(seq).padStart(4, '0');

      // 第一条：收款方数据（收付方向=11，客户id=卡号）
      records.push({
        date: recordDate,
        originalFields: { ...row },
        paymentDirection: "11",
        adjustmentRecordNo: `${recordDate}-11-${seqStr}`,
        customerId: cardNumber,
        amount: openAmount,
        source: 'B',
      });

      // 第二条：付款方数据（收付方向=10，客户id=118）
      records.push({
        date: recordDate,
        originalFields: { ...row },
        paymentDirection: "10",
        adjustmentRecordNo: `${recordDate}-10-${seqStr}`,
        customerId: "118",
        amount: openAmount,
        source: 'B',
      });

      seq++;
    }
  }

  return records;
}

/**
 * 合并表A和表B的中间数据，按日期分组生成表C
 */
function mergeAndGenerateTableC(tableARecords: IntermediateRecord[], tableBRecords: IntermediateRecord[]): DateGroup[] {
  const dateMap = new Map<string, TableCRecord[]>();

  // 处理表A数据
  for (const record of tableARecords) {
    const tableCRecord: TableCRecord = {
      date: record.date,
      paymentOrgCode: "Z2013011000013",
      adjustmentRecordNo: record.adjustmentRecordNo,
      customerId: record.customerId,
      businessType: "13",
      paymentDirection: record.paymentDirection,
      sameCustomerAdjustment: "02",
      adjustmentAmount: Math.round(record.amount * 100),
      remark: "预付卡消费",
      reserved1: "",
      reserved2: "",
      reserved3: "",
      reserved4: "",
      reserved5: "",
    };

    const existing = dateMap.get(record.date) || [];
    existing.push(tableCRecord);
    dateMap.set(record.date, existing);
  }

  // 处理表B数据
  for (const record of tableBRecords) {
    const tableCRecord: TableCRecord = {
      date: record.date,
      paymentOrgCode: "Z2013011000013",
      adjustmentRecordNo: record.adjustmentRecordNo,
      customerId: record.customerId,
      businessType: "13",
      paymentDirection: record.paymentDirection,
      sameCustomerAdjustment: "02",
      adjustmentAmount: Math.round(record.amount * 100),
      remark: "预付卡充值",
      reserved1: "",
      reserved2: "",
      reserved3: "",
      reserved4: "",
      reserved5: "",
    };

    const existing = dateMap.get(record.date) || [];
    existing.push(tableCRecord);
    dateMap.set(record.date, existing);
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
    "日期",
    "支付机构编码",
    "调账记录号",
    "客户id",
    "业务类型",
    "收付方向",
    "是否为同一客户id间的调账",
    "调账合计金额",
    "备注",
    "预留字段1",
    "预留字段2",
    "预留字段3",
    "预留字段4",
    "预留字段5",
  ];

  const lines: string[] = [headers.join(",")];

  for (const record of records) {
    const values = [
      record.date,
      record.paymentOrgCode,
      record.adjustmentRecordNo,
      record.customerId,
      record.businessType,
      record.paymentDirection,
      record.sameCustomerAdjustment,
      record.adjustmentAmount,
      record.remark,
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
      record.date,
      record.paymentOrgCode,
      record.adjustmentRecordNo,
      record.customerId,
      record.businessType,
      record.paymentDirection,
      record.sameCustomerAdjustment,
      record.adjustmentAmount,
      record.remark,
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
 * POST /api/20
 * 处理表A和表B数据，生成调账记录表C（CSV和TXT格式）
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
    let tableAData: Record<string, unknown>[];
    try {
      const bufferA = Buffer.from(await fileA.arrayBuffer());
      tableAData = parseFile(bufferA, fileA.name);
      console.log(`表A解析完成，共 ${tableAData.length} 条记录`);
    } catch (error) {
      console.error("表A解析错误:", error);
      return NextResponse.json(
        { success: false, message: "表A解析失败，请检查文件格式" },
        { status: 400 }
      );
    }

    // 读取并解析表B
    let tableBData: Record<string, unknown>[];
    try {
      const bufferB = Buffer.from(await fileB.arrayBuffer());
      tableBData = parseFile(bufferB, fileB.name);
      console.log(`表B解析完成，共 ${tableBData.length} 条记录`);
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

    // 处理表A数据
    const { records: tableARecords, maxSeqMap: tableAMaxSeqMap } = processTableA(tableAData);
    console.log(`表A处理完成，生成 ${tableARecords.length} 条中间记录`);

    // 处理表B数据（继续表A的编号顺序）
    const tableBRecords = processTableB(tableBData, tableAMaxSeqMap);
    console.log(`表B处理完成，生成 ${tableBRecords.length} 条中间记录`);

    // 合并数据并按日期分组生成表C
    const dateGroups = mergeAndGenerateTableC(tableARecords, tableBRecords);
    console.log(`日期分组数: ${dateGroups.length}, 日期: ${dateGroups.map(g => g.date).join(", ")}`);

    if (dateGroups.length === 0) {
      return NextResponse.json(
        { success: false, message: "没有生成有效数据" },
        { status: 400 }
      );
    }

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
