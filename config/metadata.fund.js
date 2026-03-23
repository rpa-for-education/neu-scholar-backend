export const FUND_METADATA = {
  name: "Quỹ tài trợ nghiên cứu",
  description:
    "Tìm kiếm, phân tích và gợi ý các quỹ tài trợ nghiên cứu trong nước và quốc tế, hỗ trợ nhà nghiên cứu xác định cơ hội funding phù hợp.",

  version: "2.0.0",
  developer: "Nhóm thầy V Huy, V Minh, X Lâm",

  capabilities: [
    "search",
    "filter",
    "recommendation",
    "eligibility_check",
    "summarize"
  ],

  supported_models: [
    {
      model_id: "qwen3-8b",
      provider: "ollama",
      model: "qwen3:8b",
      name: "Qwen3 8B",
      description: "Mô hình tối ưu cho phân tích funding"
    }
  ],

  domains: ["funding", "grant"],

  sample_prompts: [
    "Các quỹ tài trợ về AI còn hạn nộp năm 2026",
    "Quỹ tài trợ liên quan tới đổi mới và sáng tạo khởi nghiệp",
    "Quỹ tài trợ phù hợp cho nghiên cứu sinh ngành Marketing",
    "Danh sách quỹ tài trợ về Phát triển bền vững"
  ],

  provided_data_types: [
    {
      type: "funds",
      description:
        "Danh sách các quỹ tài trợ nghiên cứu (agency, deadline, funding amount, eligibility)"
    }
  ],

  decision_support: [
    "Eligibility (đối tượng được apply)",
    "Funding amount",
    "Deadline",
    "Agency uy tín",
    "Funding type (grant, cooperative agreement, etc.)"
  ],

  key_fields: [
    "OPPORTUNITY_TITLE",
    "AGENCY_NAME",
    "ESTIMATED_APPLICATION_DUE_DATE",
    "ESTIMATED_TOTAL_FUNDING",
    "ELIGIBLE_APPLICANTS",
    "FUNDING_INSTRUMENT_TYPE"
  ],

  contact: "kcntt@neu.edu.vn",
  status: "active"
};