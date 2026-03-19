import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import JSZip from "jszip";

// 原始表格记录类型
interface OriginalRecord {
  cardNumber: string;      // 卡号
  activateTime: Date;      // 激活时间
  openAmount: number;      // 开卡金额
  idType: string;          // 客户证件类型
  idNumber: string;        // 证件号码
  customerName: string;    // 客户名称
}

// 输出表格记录类型
interface OutputRecord {
  paymentOrgCode: string;    // 支付机构编码
  customerId: string;        // 客户id（卡号）
  isPrepaidCard: string;     // 是否预付卡卡片
  idType: string;            // 证件类型
  idNumber: string;          // 单位证照号码
  customerName: string;      // 单位客户名称
  customerType: string;      // 客户类型
  customerStatus: string;    // 客户状态
  modifyTime: string;        // 修改时间
  signTime: string;          // 签约时间
  cancelTime: string;        // 注销时间
  reserved1: string;         // 预留字段1
  reserved2: string;         // 预留字段2
  reserved3: string;         // 预留字段3
  reserved4: string;         // 预留字段4
  reserved5: string;         // 预留字段5
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
 * 解析日期字符串
 */
function parseDate(dateStr: string): Date | null {
  const trimmedStr = dateStr.trim();

  // 尝试解析 YYYY-MM-DD HH:mm:ss 或 YYYY-MM-DD 或 YYYY/MM/DD
  const isoPattern = /^(\d{4})[-\/](\d{2})[-\/](\d{2})/;
  const isoMatch = trimmedStr.match(isoPattern);
  if (isoMatch) {
    const year = parseInt(isoMatch[1]);
    const month = parseInt(isoMatch[2]) - 1;
    const day = parseInt(isoMatch[3]);
    const date = new Date(year, month, day);

    // 尝试解析时间部分
    const timePattern = /(\d{2}):(\d{2}):(\d{2})/;
    const timeMatch = trimmedStr.match(timePattern);
    if (timeMatch) {
      date.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), parseInt(timeMatch[3]));
    }
    return date;
  }

  // 尝试解析 YYYYMMDD (纯数字，8位)
  const compactPattern = /^(\d{4})(\d{2})(\d{2})$/;
  const compactMatch = trimmedStr.match(compactPattern);
  if (compactMatch) {
    const year = parseInt(compactMatch[1]);
    const month = parseInt(compactMatch[2]) - 1;
    const day = parseInt(compactMatch[3]);
    return new Date(year, month, day);
  }

  // 尝试直接解析为日期
  try {
    const date = new Date(trimmedStr);
    if (!isNaN(date.getTime())) {
      return date;
    }
  } catch {
    // 解析失败
  }

  return null;
}

/**
 * 格式化日期为 YYYYMMDD
 */
function formatDateYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * 格式化日期为 YYYY-MM-DD HH:MM:SS
 */
function formatDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 解析原始表格数据
 */
function parseOriginalData(data: unknown[]): OriginalRecord[] {
  const records: OriginalRecord[] = [];

  for (const row of data) {
    const rowData = row as Record<string, unknown>;

    const cardNumber = String(getValue(rowData, ["卡号", "cardNumber", "卡片号"]) ?? "");
    const activateTimeValue = getValue(rowData, ["激活时间", "activateTime", "开卡时间", "日期"]);
    const openAmount = Number(getValue(rowData, ["开卡金额", "openAmount", "金额", "余额"]) ?? 0);
    const idType = String(getValue(rowData, ["客户证件类型", "idType", "证件类型"]) ?? "");
    const idNumber = String(getValue(rowData, ["证件号码", "idNumber", "证件号"]) ?? "");
    const customerName = String(getValue(rowData, ["客户名称", "customerName", "名称"]) ?? "");

    if (!cardNumber || !activateTimeValue) {
      console.log(`记录跳过: 卡号=${cardNumber}, 激活时间=${activateTimeValue}`);
      continue;
    }

    const activateTime = parseDate(String(activateTimeValue));
    if (!activateTime) {
      console.log(`记录日期解析失败: ${activateTimeValue}`);
      continue;
    }

    records.push({
      cardNumber,
      activateTime,
      openAmount,
      idType,
      idNumber,
      customerName,
    });
  }

  return records;
}

/**
 * 转换单条记录
 */
function transformRecord(record: OriginalRecord): OutputRecord {
  // 固定值
  const paymentOrgCode = "Z2013011000013";
  const isPrepaidCard = "01";
  const customerStatus = "10";
  const cancelTime = "99991231";
  const reserved1 = "";
  const reserved2 = "";
  const reserved3 = "";
  const reserved4 = "";
  const reserved5 = "";

  // 根据规则计算字段
  let outputIdType = "";
  let outputIdNumber = "";
  let outputCustomerName = "";
  let customerType = "";

  if (record.openAmount <= 100000) {
    // 开卡金额小于等于100000
    outputIdType = "24";
    outputIdNumber = "";
    outputCustomerName = "不记名预付卡";
    customerType = "12";
  } else {
    // 开卡金额大于等于100000
    if (record.idType === "10") {
      // 客户证件类型为10
      outputIdType = "";
      outputIdNumber = "B";
      outputCustomerName = "A";
      customerType = "10";
    } else if (record.idType === "20") {
      // 客户证件类型为20
      outputIdType = "20";
      outputIdNumber = record.idNumber;
      outputCustomerName = record.customerName;
      customerType = "11";
    } else {
      // 其他情况，按空处理
      outputIdType = "";
      outputIdNumber = "B";
      outputCustomerName = "A";
      customerType = "10";
    }
  }

  return {
    paymentOrgCode,
    customerId: record.cardNumber,
    isPrepaidCard,
    idType: outputIdType,
    idNumber: outputIdNumber,
    customerName: outputCustomerName,
    customerType,
    customerStatus,
    modifyTime: formatDateTime(record.activateTime),
    signTime: formatDateYYYYMMDD(record.activateTime),
    cancelTime,
    reserved1,
    reserved2,
    reserved3,
    reserved4,
    reserved5,
  };
}

/**
 * 生成Excel文件
 */
function generateExcel(records: OutputRecord[]): Buffer {
  const data = records.map(r => ({
    "支付机构编码": r.paymentOrgCode,
    "客户id": r.customerId,
    "是否预付卡卡片": r.isPrepaidCard,
    "证件类型": r.idType,
    "单位证照号码": r.idNumber,
    "单位客户名称": r.customerName,
    "客户类型": r.customerType,
    "客户状态": r.customerStatus,
    "修改时间": r.modifyTime,
    "签约时间": r.signTime,
    "注销时间": r.cancelTime,
    "预留字段1": r.reserved1,
    "预留字段2": r.reserved2,
    "预留字段3": r.reserved3,
    "预留字段4": r.reserved4,
    "预留字段5": r.reserved5,
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "整理结果");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

/**
 * 生成TXT文件（无表头，|分隔）
 */
function generateTXT(records: OutputRecord[]): string {
  if (records.length === 0) return "";

  const lines: string[] = [];

  for (const r of records) {
    const values = [
      r.paymentOrgCode,
      r.customerId,
      r.isPrepaidCard,
      r.idType,
      r.idNumber,
      r.customerName,
      r.customerType,
      r.customerStatus,
      r.modifyTime,
      r.signTime,
      r.cancelTime,
      r.reserved1,
      r.reserved2,
      r.reserved3,
      r.reserved4,
      r.reserved5,
    ];
    lines.push(values.join("|"));
  }

  return lines.join("\n");
}

/**
 * POST /api/1
 * 处理表格整理
 */
export async function POST(request: NextRequest) {
  try {
    // 解析表单数据
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    // 验证文件
    if (!file) {
      return NextResponse.json(
        { success: false, message: "请上传表格文件" },
        { status: 400 }
      );
    }

    // 读取并解析文件
    let originalData: OriginalRecord[];
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const rawData = parseFile(buffer, file.name);
      console.log(`原始数据: ${rawData.length} 条记录`);
      originalData = parseOriginalData(rawData);
      console.log(`解析完成，有效记录: ${originalData.length} 条`);
    } catch (error) {
      console.error("文件解析错误:", error);
      return NextResponse.json(
        { success: false, message: "文件解析失败，请检查文件格式" },
        { status: 400 }
      );
    }

    if (originalData.length === 0) {
      return NextResponse.json(
        { success: false, message: "没有有效数据" },
        { status: 400 }
      );
    }

    // 转换数据
    const outputRecords = originalData.map(transformRecord);

    // 按日期分组
    const recordsByDate = new Map<string, OutputRecord[]>();
    for (let i = 0; i < originalData.length; i++) {
      const dateKey = formatDateYYYYMMDD(originalData[i].activateTime);
      const list = recordsByDate.get(dateKey) || [];
      list.push(outputRecords[i]);
      recordsByDate.set(dateKey, list);
    }

    console.log(`日期分组数: ${recordsByDate.size}, 日期: ${Array.from(recordsByDate.keys()).join(", ")}`);

    // 生成ZIP文件
    const zip = new JSZip();

    for (const [date, records] of recordsByDate) {
      // 生成Excel文件
      const excelBuffer = generateExcel(records);
      zip.file(`整理结果_${date}.xlsx`, excelBuffer);

      // 生成TXT文件
      const txtContent = generateTXT(records);
      zip.file(`整理结果_${date}.txt`, txtContent);

      console.log(`日期 ${date}: ${records.length} 条记录`);
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    // 对中文文件名进行编码
    const filename = encodeURIComponent("表格整理结果.zip");

    return new NextResponse(zipBuffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
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
