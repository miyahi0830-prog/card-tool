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
  message,
} from "antd";
import {
  InboxOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  DownloadOutlined,
} from "@ant-design/icons";
import type { UploadFile } from "antd/es/upload/interface";

const { Dragger } = Upload;
const { Title, Paragraph } = Typography;

export default function Page1() {
  const [file, setFile] = useState<UploadFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [downloadUrl, setDownloadUrl] = useState<string>("");
  const [downloadFilename, setDownloadFilename] = useState<string>("");

  const handleProcess = async () => {
    if (!file?.originFileObj) {
      setError("请上传表格文件");
      return;
    }

    setLoading(true);
    setError("");
    setDownloadUrl("");
    setDownloadFilename("");

    try {
      const formData = new FormData();
      formData.append("file", file.originFileObj);

      const response = await fetch("/api/1", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "处理失败");
      }

      // 获取文件名
      const disposition = response.headers.get("Content-Disposition");
      let filename = "download.zip";
      if (disposition) {
        const match = disposition.match(/filename="(.+)"/);
        if (match) {
          filename = match[1];
        }
      }

      // 创建下载链接
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      setDownloadUrl(url);
      setDownloadFilename(filename);

      message.success(`处理完成！请下载 ${filename}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "处理过程中发生错误");
    } finally {
      setLoading(false);
    }
  };

  const clearAll = () => {
    setFile(null);
    setDownloadUrl("");
    setDownloadFilename("");
    setError("");
  };

  const customRequest = ({ onSuccess }: { onSuccess?: (value: string) => void }) => {
    setTimeout(() => {
      onSuccess?.("ok");
    }, 0);
  };

  const beforeUpload = (file: File) => {
    const isValid =
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.type === "application/vnd.ms-excel" ||
      file.type === "text/csv" ||
      file.name.endsWith(".xlsx") ||
      file.name.endsWith(".xls") ||
      file.name.endsWith(".csv");
    if (!isValid) {
      message.error("仅支持 Excel (.xlsx, .xls) 或 CSV (.csv) 文件!");
      return Upload.LIST_IGNORE;
    }
    return true;
  };

  // 下载文件
  const handleDownload = () => {
    if (!downloadUrl) return;
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = downloadFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f5", padding: "48px 24px" }}>
      <Card style={{ maxWidth: 800, margin: "0 auto" }}>
        <Title level={2} style={{ textAlign: "center", marginBottom: 16 }}>
          表格整理系统
        </Title>

        <Paragraph style={{ textAlign: "center", color: "#666", marginBottom: 32 }}>
          上传原始表格，按规则整理生成新表格，按日期分组导出
        </Paragraph>

        <Card title={<Tag color="blue">原始表格</Tag>}>
          <Dragger
            name="file"
            multiple={false}
            accept=".xlsx,.xls,.csv"
            fileList={file ? [file] : []}
            customRequest={customRequest}
            onChange={({ fileList: newFileList }) => {
              setFile(newFileList[0] || null);
              setError("");
            }}
            beforeUpload={beforeUpload}
            onRemove={() => setFile(null)}
            style={{ padding: 24 }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined style={{ fontSize: 48, color: "#1890ff" }} />
            </p>
            <p className="ant-upload-text">点击或拖拽上传表格</p>
            <p className="ant-upload-hint">
              需包含: 卡号、激活时间、开卡金额、客户证件类型、证件号码、客户名称
            </p>
          </Dragger>
        </Card>

        {/* 操作按钮 */}
        {file && (
          <>
            <Divider />
            <Space style={{ width: "100%", justifyContent: "center" }}>
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                onClick={handleProcess}
                loading={loading}
                size="large"
                disabled={!file}
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
                  onClick={handleDownload}
                  style={{ background: "#52c41a" }}
                >
                  下载 {downloadFilename}
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

        {/* 处理结果提示 */}
        {downloadUrl && !loading && (
          <>
            <Divider />
            <Alert
              message="处理完成"
              description={`文件 ${downloadFilename} 已准备好，请点击上方"下载"按钮保存`}
              type="success"
              showIcon
            />
          </>
        )}
      </Card>
    </div>
  );
}
