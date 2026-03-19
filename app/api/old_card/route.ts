import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import JSZip from "jszip";

// 表A记录类型 - 卡信息
interface TableARecord {
  cardNumber: string;      // 卡号
  balance: number;         // 开卡金额
  activateTime: Date;      // 激活时间
  remainingBalance: number; // 剩余余额（处理过程中使用）
}

// 表B记录类型 - 交易记录
interface TableBRecord {
  transactionAmount: number; // 交易金额
  shopName: string;          // 店铺名称
  transactionDate: Date;     // 交易日期
}

// 表C记录类型 - 店铺编码
interface TableCRecord {
  shopName: string;    // 店铺名称
  shopCode: string;    // 店铺编码
}

// 匹配结果记录
interface MatchedRecord {
  date: string;              // 日期 YYYYMMDD
  shopName: string;          // 店铺名称
  shopCode: string;          // 店铺编码
  cardNumber: string;        // 卡号
  transactionAmount: number; // 交易金额
}

// 卡余额记录
interface CardBalanceRecord {
  date: string;              // 日期 YYYYMMDD
  cardNumber: string;        // 卡号
  initialBalance: number;    // 初始金额
  usedAmount: number;        // 已使用金额
  remainingBalance: number;  // 剩余余额
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
 * 支持格式: YYYY-MM-DD, YYYY/MM/DD, YYYY-MM-DD HH:mm:ss, YYYYMMDD
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
    return new Date(year, month, day);
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
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * 解析表A数据
 */
function parseTableA(data: unknown[]): TableARecord[] {
  const records: TableARecord[] = [];

  for (const row of data) {
    const rowData = row as Record<string, unknown>;

    const cardNumber = String(getValue(rowData, ["卡号", "cardNumber", "卡片号", "卡号/账号"]) ?? "");
    const balance = Number(getValue(rowData, ["开卡金额", "balance", "金额", "余额", "开卡余额"]) ?? 0);
    const activateTimeValue = getValue(rowData, ["激活时间", "activateTime", "开卡时间", "启用时间", "日期"]);

    if (!cardNumber || !activateTimeValue) {
      console.log(`表A记录跳过: 卡号=${cardNumber}, 激活时间=${activateTimeValue}`);
      continue;
    }

    const activateTime = parseDate(String(activateTimeValue));
    if (!activateTime) {
      console.log(`表A记录日期解析失败: ${activateTimeValue}`);
      continue;
    }

    records.push({
      cardNumber,
      balance,
      activateTime,
      remainingBalance: balance,
    });
  }

  return records;
}

/**
 * 解析表B数据
 */
function parseTableB(data: unknown[]): TableBRecord[] {
  const records: TableBRecord[] = [];

  for (const row of data) {
    const rowData = row as Record<string, unknown>;

    const transactionAmount = Number(getValue(rowData, ["交易金额", "transactionAmount", "金额", "消费金额"]) ?? 0);
    const shopName = String(getValue(rowData, ["店铺名称", "shopName", "商户名称", "门店名称", "商户"]) ?? "");
    const transactionDateValue = getValue(rowData, ["日期", "transactionDate", "交易日期", "时间", "交易时间"]);

    if (!shopName || !transactionDateValue) {
      console.log(`表B记录跳过: 店铺名称=${shopName}, 日期=${transactionDateValue}`);
      continue;
    }

    const transactionDate = parseDate(String(transactionDateValue));
    if (!transactionDate) {
      console.log(`表B记录日期解析失败: ${transactionDateValue}`);
      continue;
    }

    records.push({
      transactionAmount,
      shopName,
      transactionDate,
    });
  }

  return records;
}

/**
 * 解析表C数据
 */
function parseTableC(data: unknown[]): TableCRecord[] {
  const records: TableCRecord[] = [];

  for (const row of data) {
    const rowData = row as Record<string, unknown>;

    const shopName = String(getValue(rowData, ["店铺名称", "shopName", "商户名称", "门店名称", "商户"]) ?? "");
    const shopCode = String(getValue(rowData, ["店铺编码", "shopCode", "商户编码", "门店编码", "编码"]) ?? "");

    if (!shopName || !shopCode) {
      console.log(`表C记录跳过: 店铺名称=${shopName}, 店铺编码=${shopCode}`);
      continue;
    }

    records.push({
      shopName,
      shopCode,
    });
  }

  return records;
}

/**
 * 构建店铺名称到编码的映射
 */
function buildShopCodeMap(tableC: TableCRecord[]): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const record of tableC) {
    const codes = map.get(record.shopName) || [];
    if (!codes.includes(record.shopCode)) {
      codes.push(record.shopCode);
    }
    map.set(record.shopName, codes);
  }

  return map;
}

/**
 * 随机打乱数组
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * 随机选择一个编码
 */
function randomSelect<T>(array: T[]): T | null {
  if (array.length === 0) return null;
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * 核心匹配逻辑
 * 1. 将表A的卡号匹配至表B的交易中，且交易时间不得早于激活时间
 * 2. 按交易金额从大到小遍历B，优先处理大额交易
 * 3. 选择余额大于等于交易金额且余额最多的卡
 * 4. 匹配后扣除卡的余额，继续下一条交易
 * 5. 表B的店铺名称随机匹配一个表C中相同店铺名称的店铺编码
 */
function matchTables(
  tableA: TableARecord[],
  tableB: TableBRecord[],
  tableC: TableCRecord[],
  targetDate: Date
): { matchedRecords: MatchedRecord[]; cardBalancesByDate: Map<string, CardBalanceRecord[]> } {
  const shopCodeMap = buildShopCodeMap(tableC);
  const matchedRecords: MatchedRecord[] = [];

  // 复制表A数据用于处理，记录每张卡的每日余额变化
  // 卡可以重复匹配，所以每张卡独立维护余额状态
  const cards = tableA.map(a => ({
    ...a,
    remainingBalance: a.balance,
    dailyBalances: new Map<string, number>(), // 记录每日结束时的余额
  }));

  // 过滤出在目标日期之前的交易
  const validTransactions = tableB.filter(t => t.transactionDate <= targetDate);

  // 按交易金额从大到小排序（全局排序，不按日期分组）
  validTransactions.sort((a, b) => b.transactionAmount - a.transactionAmount);

  // 按日期分组处理交易（用于记录每日余额快照）
  const transactionsByDate = new Map<string, TableBRecord[]>();
  for (const t of validTransactions) {
    const dateKey = formatDate(t.transactionDate);
    const list = transactionsByDate.get(dateKey) || [];
    list.push(t);
    transactionsByDate.set(dateKey, list);
  }

  // 按日期排序（用于生成每日余额快照）
  const sortedDates = Array.from(transactionsByDate.keys()).sort();

  // 按交易金额从大到小遍历所有交易（全局顺序）
  for (const transaction of validTransactions) {
    const dateStr = formatDate(transaction.transactionDate);

    // 获取可用的卡（激活时间 <= 交易日期，且余额 >= 交易金额）
    const availableCards = cards.filter(c =>
      c.activateTime <= transaction.transactionDate &&
      c.remainingBalance >= transaction.transactionAmount
    );

    if (availableCards.length === 0) {
      console.log(`日期 ${dateStr}: 无可用卡匹配交易金额 ${transaction.transactionAmount}`);
      continue;
    }

    // 选择余额最多的卡（在余额大于等于交易金额的卡中）
    const selectedCard = availableCards.reduce((maxCard, currentCard) =>
      currentCard.remainingBalance > maxCard.remainingBalance ? currentCard : maxCard
    );

    // 扣除卡余额
    selectedCard.remainingBalance -= transaction.transactionAmount;

    // 获取店铺编码
    const codes = shopCodeMap.get(transaction.shopName) || [];
    const selectedCode = randomSelect(codes) || "";

    matchedRecords.push({
      date: dateStr,
      shopName: transaction.shopName,
      shopCode: selectedCode,
      cardNumber: selectedCard.cardNumber,
      transactionAmount: transaction.transactionAmount,
    });
  }

  // 记录每天结束时的余额状态（按日期顺序）
  for (const dateStr of sortedDates) {
    for (const card of cards) {
      card.dailyBalances.set(dateStr, card.remainingBalance);
    }
  }

  // 按日期生成卡余额记录
  const cardBalancesByDate = new Map<string, CardBalanceRecord[]>();

  for (const dateStr of sortedDates) {
    const dailyRecords: CardBalanceRecord[] = [];

    for (const card of cards) {
      const balanceAtDate = card.dailyBalances.get(dateStr);
      if (balanceAtDate === undefined) continue;

      // 获取前一天的余额
      const dateIndex = sortedDates.indexOf(dateStr);
      let previousBalance = card.balance;
      if (dateIndex > 0) {
        const prevDate = sortedDates[dateIndex - 1];
        previousBalance = card.dailyBalances.get(prevDate) ?? card.balance;
      }

      // 如果当天有余额变化，则记录
      const usedAmount = previousBalance - balanceAtDate;
      if (usedAmount > 0 || balanceAtDate !== card.balance) {
        dailyRecords.push({
          date: dateStr,
          cardNumber: card.cardNumber,
          initialBalance: card.balance,
          usedAmount: card.balance - balanceAtDate,
          remainingBalance: balanceAtDate,
        });
      }
    }

    if (dailyRecords.length > 0) {
      cardBalancesByDate.set(dateStr, dailyRecords);
    }
  }

  return { matchedRecords, cardBalancesByDate };
}

/**
 * 生成交易记录Excel
 */
function generateTransactionExcel(records: MatchedRecord[]): Buffer {
  const data = records.map(r => ({
    "日期": r.date,
    "店铺名称": r.shopName,
    "店铺编码": r.shopCode,
    "卡号": r.cardNumber,
    "交易金额": r.transactionAmount,
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "交易记录");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

/**
 * 生成卡余额Excel
 */
function generateBalanceExcel(records: CardBalanceRecord[]): Buffer {
  const data = records.map(r => ({
    "日期": r.date,
    "卡号": r.cardNumber,
    "初始金额": r.initialBalance,
    "已使用金额": r.usedAmount,
    "剩余余额": r.remainingBalance,
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "卡余额");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

/**
 * POST /api/22
 * 处理三表匹配
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

    if (!fileC) {
      return NextResponse.json(
        { success: false, message: "请上传表C" },
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

    // 读取并解析表C
    let tableCData: TableCRecord[];
    try {
      const bufferC = Buffer.from(await fileC.arrayBuffer());
      const rawDataC = parseFile(bufferC, fileC.name);
      console.log(`表C原始数据: ${rawDataC.length} 条记录`);
      tableCData = parseTableC(rawDataC);
      console.log(`表C解析完成，有效记录: ${tableCData.length} 条`);
    } catch (error) {
      console.error("表C解析错误:", error);
      return NextResponse.json(
        { success: false, message: "表C解析失败，请检查文件格式" },
        { status: 400 }
      );
    }

    if (tableAData.length === 0) {
      return NextResponse.json(
        { success: false, message: "表A没有有效数据" },
        { status: 400 }
      );
    }

    if (tableBData.length === 0) {
      return NextResponse.json(
        { success: false, message: "表B没有有效数据" },
        { status: 400 }
      );
    }

    if (tableCData.length === 0) {
      return NextResponse.json(
        { success: false, message: "表C没有有效数据" },
        { status: 400 }
      );
    }

    // 目标日期：2025年12月31日
    const targetDate = new Date(2025, 11, 31); // 月份从0开始

    // 执行匹配逻辑
    const { matchedRecords, cardBalancesByDate } = matchTables(
      tableAData,
      tableBData,
      tableCData,
      targetDate
    );

    const totalCardRecords = Array.from(cardBalancesByDate.values()).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`匹配完成: ${matchedRecords.length} 条交易记录, ${totalCardRecords} 条卡余额记录`);

    // 按日期分组交易记录
    const recordsByDate = new Map<string, MatchedRecord[]>();
    for (const record of matchedRecords) {
      const list = recordsByDate.get(record.date) || [];
      list.push(record);
      recordsByDate.set(record.date, list);
    }

    // 生成ZIP文件
    const zip = new JSZip();

    // 获取所有日期并排序
    const allDates = new Set([...recordsByDate.keys(), ...cardBalancesByDate.keys()]);
    const sortedDates = Array.from(allDates).sort();

    // 生成每日文件（交易记录和卡余额）
    for (const date of sortedDates) {
      // 生成交易记录
      const transactionRecords = recordsByDate.get(date);
      if (transactionRecords && transactionRecords.length > 0) {
        const transactionBuffer = generateTransactionExcel(transactionRecords);
        zip.file(`交易记录_${date}.xlsx`, transactionBuffer);
      }

      // 生成卡余额记录
      const balanceRecords = cardBalancesByDate.get(date);
      if (balanceRecords && balanceRecords.length > 0) {
        const balanceBuffer = generateBalanceExcel(balanceRecords);
        zip.file(`卡余额_${date}.xlsx`, balanceBuffer);
      }
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    // 对中文文件名进行编码，避免ByteString错误
    const filename = encodeURIComponent("三表匹配结果.zip");

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
