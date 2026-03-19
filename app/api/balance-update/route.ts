import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

// 表A记录类型 - 保留原始结构，只通过key访问
interface TableARecord {
  [key: string]: unknown;
}

interface TableBRecord {
  cardNumber: string;
  transactionAmount: number;
  date: string;
  [key: string]: unknown;
}

// 表C记录状态类型
type TableCStatus = "新增" | "充值";

interface TableCRecord {
  cardNumber: string;
  date: string;
  status: TableCStatus;  // 状态：新增 或 充值
  amount?: number;       // 充值金额（当状态为"充值"时使用）
  [key: string]: unknown;
}

interface DateGroup {
  date: string;
  tableB: TableBRecord[];
  tableC: TableCRecord[];
}

interface ProcessResult {
  date: string;  // 调整后的日期（前一天）
  originalDate?: string;  // 原始日期
  tableA: TableARecord[];
  unmatchedB: TableBRecord[];
}

/**
 * 解析CSV文件
 */
function parseCSV(buffer: Buffer): any[] {
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
          // 转义的引号
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
    const obj: any = {};
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
function parseExcel(buffer: Buffer): any[] {
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
  }) as any[][];

  if (rawData.length === 0) return [];

  const headers = rawData[0];
  const rows = rawData.slice(1);

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
 * 根据文件名解析文件（支持Excel和CSV）
 */
function parseFile(buffer: Buffer, filename: string): any[] {
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
 * 从数据行中提取日期
 * 表A使用: 资金划付日期
 * 表B/表C使用: 交易时间
 */
function extractDateFromRow(row: Record<string, unknown>, isTableA: boolean = false): string | null {
  // 表A优先使用"资金划付日期"，表B/表C优先使用"交易时间"
  const possibleKeys = isTableA
    ? ["资金划付日期", "日期", "date", "划付日期"]
    : ["交易时间", "资金划付日期", "日期", "date", "交易日期"];

  const dateValue = getValue(row, possibleKeys);
  if (!dateValue) return null;

  const dateStr = String(dateValue).trim();

  // 尝试解析各种日期格式
  // 格式: YYYY-MM-DD 或 YYYY/MM/DD
  const isoPattern = /(\d{4})[-\/](\d{2})[-\/](\d{2})/;
  const isoMatch = dateStr.match(isoPattern);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // 格式: YYYYMMDD (纯数字)
  const compactPattern = /(\d{4})(\d{2})(\d{2})/;
  const compactMatch = dateStr.match(compactPattern);
  if (compactMatch) {
    return `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;
  }

  // 尝试直接解析为日期
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch {
    // 解析失败
  }

  return null;
}

/**
 * 按日期对表B和表C数据进行分组
 */
function groupDataByDate(
  tableBData: unknown[],
  tableCData: unknown[]
): DateGroup[] {
  const dateMap = new Map<string, DateGroup>();

  // 处理表B数据 - 按行中的"交易时间"字段分组
  for (const row of tableBData) {
    const rowData = row as Record<string, unknown>;
    const date = extractDateFromRow(rowData, false); // 表B使用"交易时间"
    if (!date) continue;

    if (!dateMap.has(date)) {
      dateMap.set(date, { date, tableB: [], tableC: [] });
    }

    const group = dateMap.get(date)!;
    const record: TableBRecord = {
      ...rowData,
      cardNumber: String(getValue(rowData, ["卡号", "cardNumber"]) ?? ""),
      transactionAmount: Number(getValue(rowData, ["交易金额", "transactionAmount", "金额", "消费金额"]) ?? 0),
      date,
    };

    group.tableB.push(record);
  }

  // 处理表C数据 - 按行中的"交易时间"字段分组
  for (const row of tableCData) {
    const rowData = row as Record<string, unknown>;
    const date = extractDateFromRow(rowData, false); // 表C也使用"交易时间"
    if (!date) continue;

    if (!dateMap.has(date)) {
      dateMap.set(date, { date, tableB: [], tableC: [] });
    }

    const group = dateMap.get(date)!;
    
    // 解析状态字段
    const statusValue = getValue(rowData, ["状态", "status"]);
    const status: TableCStatus = statusValue === "充值" ? "充值" : "新增";
    
    // 解析金额字段（充值时使用）
    const amountValue = getValue(rowData, ["金额", "amount", "充值金额"]);
    const amount = status === "充值" ? Number(amountValue ?? 0) : undefined;
    
    const record: TableCRecord = {
      ...rowData,
      cardNumber: String(getValue(rowData, ["卡号", "cardNumber"]) ?? ""),
      date,
      status,
      amount,
    };

    group.tableC.push(record);
  }

  // 按日期倒序排列
  return Array.from(dateMap.values()).sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

/**
 * 获取表A中的卡号值
 */
function getCardNumberFromA(row: TableARecord): string {
  return String(getValue(row, ["卡号", "cardNumber"]) ?? "");
}

/**
 * 获取前一天的日期，格式化为YYYYMMDD
 */
function getPreviousDate(dateStr: string): string {
  const date = new Date(dateStr);
  date.setDate(date.getDate() - 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * 获取表A中的余额值
 */
function getBalanceFromA(row: TableARecord): number {
  return Number(getValue(row, ["余额", "balance"]) ?? 0);
}

/**
 * 设置表A中的余额值
 */
function setBalanceInA(row: TableARecord, newBalance: number): void {
  const keys = Object.keys(row);
  const balanceKey = keys.find(k => 
    ["余额", "balance"].some(pk => k.toLowerCase() === pk.toLowerCase())
  );
  if (balanceKey) {
    row[balanceKey] = newBalance;
  }
}

/**
 * 设置表A中的资金划付日期值（格式：YYYYMMDD）
 */
function setDateInA(row: TableARecord, date: string): void {
  const keys = Object.keys(row);
  const dateKey = keys.find(k => 
    ["资金划付日期"].some(pk => k === pk)
  );
  if (dateKey) {
    // 如果date是YYYY-MM-DD格式，转换为YYYYMMDD
    const formattedDate = date.replace(/-/g, '');
    row[dateKey] = formattedDate;
  }
}

/**
 * 处理单日逻辑
 */
function processSingleDay(
  originalTableA: TableARecord[],
  dateGroup: DateGroup
): ProcessResult {
  const { date, tableB, tableC } = dateGroup;
  
  console.log(`处理日期: ${date}, B记录数: ${tableB.length}, C记录数: ${tableC.length}`);

  // 深拷贝表A，避免修改原始数据
  const tableA: TableARecord[] = originalTableA.map(row => ({ ...row }));
  
  // 创建表A的索引（以卡号为key）
  const tableAIndex = new Map<string, number>();
  for (let i = 0; i < tableA.length; i++) {
    const cardNumber = getCardNumberFromA(tableA[i]);
    if (cardNumber) {
      tableAIndex.set(cardNumber, i);
    }
  }

  const unmatchedB: TableBRecord[] = [];

  // 第一步：遍历表B，累加交易金额到余额
  for (const bRecord of tableB) {
    const index = tableAIndex.get(bRecord.cardNumber);
    
    if (index !== undefined) {
      // 找到匹配，累加金额并更新余额
      const currentBalance = getBalanceFromA(tableA[index]);
      const newBalance = currentBalance + bRecord.transactionAmount;
      setBalanceInA(tableA[index], newBalance);
      console.log(`  B记录: 卡号=${bRecord.cardNumber}, 金额=${bRecord.transactionAmount}, 新余额=${newBalance}`);
    } else {
      // 未找到匹配
      unmatchedB.push(bRecord);
      console.log(`  B记录未匹配: 卡号=${bRecord.cardNumber}`);
    }
  }

  // 第二步：遍历表C，根据状态执行不同操作
  if (tableC.length > 0) {
    const cardNumbersToDelete = new Set<string>();
    const rechargeRecords: TableCRecord[] = [];
    
    // 分类处理：新增的记录需要删除，充值的记录需要扣减余额
    for (const cRecord of tableC) {
      if (cRecord.status === "充值") {
        rechargeRecords.push(cRecord);
      } else {
        cardNumbersToDelete.add(cRecord.cardNumber);
      }
    }
    
    console.log(`  表C处理: 新增记录数=${cardNumbersToDelete.size}, 充值记录数=${rechargeRecords.length}`);
    
    // 处理充值记录：从表A对应卡号的余额中减去充值金额
    for (const rechargeRecord of rechargeRecords) {
      const index = tableAIndex.get(rechargeRecord.cardNumber);
      if (index !== undefined && rechargeRecord.amount !== undefined) {
        const currentBalance = getBalanceFromA(tableA[index]);
        const newBalance = currentBalance - rechargeRecord.amount;
        setBalanceInA(tableA[index], newBalance);
        console.log(`  充值处理: 卡号=${rechargeRecord.cardNumber}, 扣除金额=${rechargeRecord.amount}, 新余额=${newBalance}`);
      } else {
        console.log(`  充值记录未匹配: 卡号=${rechargeRecord.cardNumber}`);
      }
    }
    
    // 处理新增记录：删除匹配的记录
    if (cardNumbersToDelete.size > 0) {
      console.log(`  需要删除的卡号数: ${cardNumbersToDelete.size}`);
      
      // 过滤掉需要删除的记录
      const remainingRecords = tableA.filter(record => !cardNumbersToDelete.has(getCardNumberFromA(record)));
      console.log(`  删除前记录数: ${tableA.length}, 删除后: ${remainingRecords.length}`);
      
      // 更新tableA - 使用循环避免栈溢出
      tableA.length = 0;
      for (const record of remainingRecords) {
        tableA.push(record);
      }
    }
  }

  // 第三步：更新所有记录的"资金划付日期"为当前处理日期的前一天
  const prevDate = getPreviousDate(date);
  for (const record of tableA) {
    setDateInA(record, prevDate);
  }

  return {
    date: prevDate,  // 返回调整后的日期用于文件名
    originalDate: date,  // 保留原始日期用于日志
    tableA,
    unmatchedB,
  };
}

/**
 * 处理所有日期的逻辑
 */
function processAllDates(
  tableAData: unknown[],
  tableBData: unknown[],
  tableCData: unknown[]
): ProcessResult[] {
  // 表A数据直接使用原始数据，不添加新列
  const originalTableA: TableARecord[] = tableAData.map((row) => ({ ...row as TableARecord }));
  
  // 过滤掉没有卡号的记录
  const filteredTableA = originalTableA.filter(r => getCardNumberFromA(r));

  console.log(`原始表A记录数: ${filteredTableA.length}`);
  console.log(`表B记录数: ${tableBData.length}`);
  console.log(`表C记录数: ${tableCData.length}`);

  // 按日期分组
  const dateGroups = groupDataByDate(tableBData, tableCData);
  console.log(`日期分组数: ${dateGroups.length}, 日期: ${dateGroups.map(g => g.date).join(", ")}`);

  // 按日期倒序处理每一天
  const results: ProcessResult[] = [];
  let currentTableA = filteredTableA;

  for (const dateGroup of dateGroups) {
    const result = processSingleDay(currentTableA, dateGroup);
    results.push(result);
    // 使用当前结果作为下一天的输入
    currentTableA = result.tableA;
  }

  return results;
}

/**
 * 生成Excel文件 - 使用aoa_to_sheet避免格式膨胀
 */
function generateExcel(tableA: TableARecord[]): Buffer {
  if (tableA.length === 0) {
    const workbook = XLSX.utils.book_new();
    const worksheetA = XLSX.utils.aoa_to_sheet([[]]);
    XLSX.utils.book_append_sheet(workbook, worksheetA, "表A结果");
    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  }

  // 获取表头（保持原始顺序）
  const headers = Object.keys(tableA[0]);
  
  // 构建二维数组数据
  const data: unknown[][] = [headers];
  for (const row of tableA) {
    const rowData = headers.map(header => row[header] ?? "");
    data.push(rowData);
  }

  const workbook = XLSX.utils.book_new();
  const worksheetA = XLSX.utils.aoa_to_sheet(data);

  // 设置列宽
  worksheetA["!cols"] = headers.map(() => ({ wch: 20 }));

  XLSX.utils.book_append_sheet(workbook, worksheetA, "表A结果");
  
  // 使用压缩选项写入
  return XLSX.write(workbook, { 
    type: "buffer", 
    bookType: "xlsx",
    compression: true,
  });
}

/**
 * 生成TXT文件（无表头，|分隔）
 */
function generateTxt(tableA: TableARecord[]): string {
  if (tableA.length === 0) return "";

  const keys = Object.keys(tableA[0]).filter(k => k !== 'key');
  const lines = tableA.map(record => {
    return keys.map(key => String(record[key] ?? "")).join("|");
  });

  return lines.join("\n");
}

/**
 * POST /api/balance-update
 * 处理多日期余额更新逻辑（表B和表C为单文件多日期）
 */
export async function POST(request: NextRequest) {
  try {
    // 解析表单数据
    const formData = await request.formData();

    const fileA = formData.get("fileA") as File | null;
    const fileB = formData.get("fileB") as File | null;
    const fileC = formData.get("fileC") as File | null;

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
    let tableAData: unknown[];
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

    if (tableAData.length === 0) {
      return NextResponse.json(
        { success: false, message: "表A数据为空" },
        { status: 400 }
      );
    }

    // 读取并解析表B
    let tableBData: unknown[];
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

    // 读取并解析表C（可选）
    let tableCData: unknown[] = [];
    if (fileC) {
      try {
        const bufferC = Buffer.from(await fileC.arrayBuffer());
        tableCData = parseFile(bufferC, fileC.name);
        console.log(`表C解析完成，共 ${tableCData.length} 条记录`);
      } catch (error) {
        console.error("表C解析错误:", error);
        return NextResponse.json(
          { success: false, message: "表C解析失败，请检查文件格式" },
          { status: 400 }
        );
      }
    }

    // 处理所有日期的逻辑
    const results = processAllDates(tableAData, tableBData, tableCData);
    
    // 如果有多个日期，打包成zip返回；如果只有一个日期，直接返回Excel
    if (results.length === 1) {
      // 单个日期，直接返回Excel文件
      const result = results[0];
      const excelBuffer = generateExcel(result.tableA);
          
      return new NextResponse(excelBuffer, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="tableA_${result.date}.xlsx"`,
        },
      });
    } else {
      // 多个日期，生成zip文件返回
      const JSZip = await import("jszip");
      const zip = new JSZip.default();
          
      for (const result of results) {
        const excelBuffer = generateExcel(result.tableA);
        const txtContent = generateTxt(result.tableA);
            
        // 添加Excel到zip
        zip.file(`tableA_${result.date}.xlsx`, excelBuffer);
        // 添加TXT到zip
        zip.file(`tableA_${result.date}.txt`, txtContent);
      }
          
      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
          
      return new NextResponse(zipBuffer, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="tableA_all_dates.zip"`,
        },
      });
    }
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


