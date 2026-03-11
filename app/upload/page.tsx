"use client";

import { useState } from "react";
import {
  Card,
  Upload,
  Button,
  Typography,
  Alert,
  Spin,
  Tag,
  Space,
  Divider,
  Row,
  Col,
  Table,
  message,
} from "antd";
import {
  InboxOutlined,
  FileExcelOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  DownloadOutlined,
} from "@ant-design/icons";
import type { UploadFile } from "antd/es/upload/interface";

const { Dragger } = Upload;
const { Title, Text } = Typography;

interface TableAData {
  key: string;
  customerId: string;
  cardNumber: string;
  balance: number;
}

interface TableBData {
  key: string;
  cardNumber: string;
  transactionAmount: number;
  isReplaced: boolean;
  originalCardNumber?: string;
}

export default function UploadPage() {
  const [fileA, setFileA] = useState<UploadFile | null>(null);
  const [fileB, setFileB] = useState<UploadFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [resultA, setResultA] = useState<TableAData[]>([]);
  const [resultB, setResultB] = useState<TableBData[]>([]);
  const [downloadUrl, setDownloadUrl] = useState<string>("");

  const columnsA = [
    { title: "客户ID", dataIndex: "customerId", key: "customerId" },
    { title: "卡号", dataIndex: "cardNumber", key: "cardNumber" },
    { title: "余额", dataIndex: "balance", key: "balance" },
  ];

  const columnsB = [
    { title: "卡号", dataIndex: "cardNumber", key: "cardNumber" },
    { title: "交易金额", dataIndex: "transactionAmount", key: "transactionAmount" },
    {
      title: "状态",
      dataIndex: "isReplaced",
      key: "isReplaced",
      render: (isReplaced: boolean, record: TableBData) =>
        isReplaced ? (
          <Tag color="orange">
            已替换 (原卡号: {record.originalCardNumber})
          </Tag>
        ) : (
          <Tag color="green">未替换</Tag>
        ),
    },
  ];

  const handleProcess = async () => {
    if (!fileA?.originFileObj || !fileB?.originFileObj) {
      setError("请同时上传表A和表B");
      return;
    }

    setLoading(true);
    setError("");
    setResultA([]);
    setResultB([]);
    setDownloadUrl("");

    try {
      const formData = new FormData();
      formData.append("fileA", fileA.originFileObj);
      formData.append("fileB", fileB.originFileObj);

      const response = await fetch("/api/process-tables", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "处理失败");
      }

      // 设置预览数据
      setResultA(result.data.tableA || []);
      setResultB(result.data.tableB || []);

      // 创建下载链接
      if (result.data.excelBase64) {
        const byteCharacters = atob(result.data.excelBase64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = window.URL.createObjectURL(blob);
        setDownloadUrl(url);
      }

      message.success("处理完成！");
    } catch (err) {
      setError(err instanceof Error ? err.message : "处理过程中发生错误");
    } finally {
      setLoading(false);
    }
  };

  const clearAll = () => {
    setFileA(null);
    setFileB(null);
    setResultA([]);
    setResultB([]);
    setError("");
    setDownloadUrl("");
  };

  const customRequest = ({ onSuccess }: any) => {
    setTimeout(() => {
      onSuccess?.("ok");
    }, 0);
  };

  const beforeUpload = (file: File) => {
    const isExcel =
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.type === "application/vnd.ms-excel" ||
      file.name.endsWith(".xlsx") ||
      file.name.endsWith(".xls");
    if (!isExcel) {
      message.error("仅支持 Excel 文件 (.xlsx, .xls)!");
      return Upload.LIST_IGNORE;
    }
    const isLt10M = file.size / 1024 / 1024 < 10;
    if (!isLt10M) {
      message.error("文件大小不能超过 10MB!");
      return Upload.LIST_IGNORE;
    }
    return true;
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f5", padding: "48px 24px" }}>
      <Card style={{ maxWidth: 1200, margin: "0 auto" }}>
        <Title level={2} style={{ textAlign: "center", marginBottom: 32 }}>
          双表匹配处理系统
        </Title>

        <Row gutter={32}>
          {/* 表A上传区域 */}
          <Col span={12}>
            <Card
              title={<Tag color="blue">表 A (客户信息表)</Tag>}
              style={{ height: "100%" }}
            >
              <Dragger
                name="fileA"
                multiple={false}
                accept=".xlsx,.xls"
                fileList={fileA ? [fileA] : []}
                customRequest={customRequest}
                onChange={({ fileList: newFileList }) => {
                  setFileA(newFileList[0] || null);
                  setError("");
                }}
                beforeUpload={beforeUpload}
                onRemove={() => setFileA(null)}
                style={{ padding: 24 }}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined style={{ fontSize: 48, color: "#1890ff" }} />
                </p>
                <p className="ant-upload-text">点击或拖拽上传表A</p>
                <p className="ant-upload-hint">
                  需包含: 客户ID、卡号、余额 列
                </p>
              </Dragger>
            </Card>
          </Col>

          {/* 表B上传区域 */}
          <Col span={12}>
            <Card
              title={<Tag color="green">表 B (交易记录表)</Tag>}
              style={{ height: "100%" }}
            >
              <Dragger
                name="fileB"
                multiple={false}
                accept=".xlsx,.xls"
                fileList={fileB ? [fileB] : []}
                customRequest={customRequest}
                onChange={({ fileList: newFileList }) => {
                  setFileB(newFileList[0] || null);
                  setError("");
                }}
                beforeUpload={beforeUpload}
                onRemove={() => setFileB(null)}
                style={{ padding: 24 }}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined style={{ fontSize: 48, color: "#52c41a" }} />
                </p>
                <p className="ant-upload-text">点击或拖拽上传表B</p>
                <p className="ant-upload-hint">
                  需包含: 卡号、交易金额 列
                </p>
              </Dragger>
            </Card>
          </Col>
        </Row>

        {/* 操作按钮 */}
        {(fileA || fileB) && (
          <>
            <Divider />
            <Space style={{ width: "100%", justifyContent: "center" }}>
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                onClick={handleProcess}
                loading={loading}
                size="large"
                disabled={!fileA || !fileB}
              >
                {loading ? "处理中..." : "开始处理"}
              </Button>
              <Button
                icon={<DeleteOutlined />}
                onClick={clearAll}
                size="large"
                danger
              >
                清除全部
              </Button>
              {downloadUrl && (
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  size="large"
                  href={downloadUrl}
                  download="result_tables.xlsx"
                >
                  下载结果
                </Button>
              )}
            </Space>
          </>
        )}

        {error && (
          <>
            <Divider />
            <Alert
              message={error}
              type="error"
              showIcon
              closable
              onClose={() => setError("")}
            />
          </>
        )}

        {loading && (
          <>
            <Divider />
            <div style={{ textAlign: "center", padding: "24px" }}>
              <Spin size="large" tip="正在处理数据..." />
            </div>
          </>
        )}

        {/* 结果显示 */}
        {(resultA.length > 0 || resultB.length > 0) && !loading && (
          <>
            <Divider />
            <Row gutter={32}>
              <Col span={12}>
                <Card
                  title={
                    <Space>
                      <FileExcelOutlined />
                      <span>处理后的表A</span>
                    </Space>
                  }
                >
                  <Table
                    dataSource={resultA}
                    columns={columnsA}
                    pagination={{ pageSize: 5 }}
                    size="small"
                    scroll={{ x: true }}
                  />
                </Card>
              </Col>
              <Col span={12}>
                <Card
                  title={
                    <Space>
                      <FileExcelOutlined />
                      <span>处理后的表B</span>
                    </Space>
                  }
                >
                  <Table
                    dataSource={resultB}
                    columns={columnsB}
                    pagination={{ pageSize: 5 }}
                    size="small"
                    scroll={{ x: true }}
                  />
                </Card>
              </Col>
            </Row>
          </>
        )}
      </Card>
    </div>
  );
}
