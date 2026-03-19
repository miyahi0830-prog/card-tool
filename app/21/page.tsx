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

export default function Page21() {
  const [fileA, setFileA] = useState<UploadFile | null>(null);
  const [fileB, setFileB] = useState<UploadFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [downloadUrl, setDownloadUrl] = useState<string>("");
  const [downloadFilename, setDownloadFilename] = useState<string>("");

  const handleProcess = async () => {
    if (!fileA?.originFileObj) {
      setError("请上传表A");
      return;
    }

    if (!fileB?.originFileObj) {
      setError("请上传表B");
      return;
    }

    setLoading(true);
    setError("");
    setDownloadUrl("");
    setDownloadFilename("");

    try {
      const formData = new FormData();
      formData.append("fileA", fileA.originFileObj);
      formData.append("fileB", fileB.originFileObj);

      const response = await fetch("/api/21", {
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
    setFileA(null);
    setFileB(null);
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
      <Card style={{ maxWidth: 1200, margin: "0 auto" }}>
        <Title level={2} style={{ textAlign: "center", marginBottom: 16 }}>
          数据合并处理系统
        </Title>

        <Paragraph style={{ textAlign: "center", color: "#666", marginBottom: 32 }}>
          合并表A和表B数据，按结算时间分组生成标准格式文件
        </Paragraph>

        <Row gutter={[32, 32]}>
          {/* 表A上传区域 */}
          <Col span={12}>
            <Card
              title={<Tag color="blue">表 A (含序号)</Tag>}
            >
              <Dragger
                name="fileA"
                multiple={false}
                accept=".xlsx,.xls,.csv"
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
                  需包含: 店铺编号、银行账号、序号、结算金额、结算时间
                </p>
              </Dragger>
            </Card>
          </Col>

          {/* 表B上传区域 */}
          <Col span={12}>
            <Card
              title={<Tag color="green">表 B (无序号)</Tag>}
            >
              <Dragger
                name="fileB"
                multiple={false}
                accept=".xlsx,.xls,.csv"
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
                  需包含: 店铺编号、银行账号、结算金额、结算时间
                  <br />
                  序号将自动生成: YYYYMMDD-0001
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
