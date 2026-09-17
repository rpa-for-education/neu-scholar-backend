// Fund metadata
// Mô tả capability của phân hệ Quỹ tài trợ nghiên cứu.

export const FUND_METADATA = {

  // =====================================================
  // GENERAL
  // =====================================================

  name:
    "Quỹ tài trợ nghiên cứu",

  description:
    "Tìm kiếm, phân tích và gợi ý các quỹ, chương trình và cơ hội tài trợ nghiên cứu trong nước và quốc tế, hỗ trợ nhà nghiên cứu xác định nguồn tài trợ phù hợp với chủ đề, đối tượng và nhu cầu nghiên cứu.",

  version:
    "2.1.0",

  developer:
    "Nhóm thầy V Huy, V Minh, X Lâm",


  // =====================================================
  // CAPABILITIES
  // =====================================================

  capabilities: [
    "search",
    "filter",
    "recommendation",
    "eligibility_check",
    "summarize"
  ],


  // =====================================================
  // SUPPORTED LLM
  //
  // Portal:
  //   model_id = qwen2.5-14b
  //
  // Backend:
  //   qwen2.5-14b
  //        ↓
  //   qwen2.5:14b-instruct-ctx16k
  // =====================================================

  supported_models: [
    {
      model_id:
        "qwen2.5-14b",

      provider:
        "ollama",

      model:
        "qwen2.5:14b-instruct-ctx16k",

      name:
        "Qwen2.5 14B",

      description:
        "Mô hình Qwen2.5 14B Instruct với ngữ cảnh 16K, sử dụng cho tìm kiếm, phân tích và tư vấn cơ hội tài trợ nghiên cứu."
    }
  ],


  // =====================================================
  // DOMAINS
  // =====================================================

  domains: [
    "funding",
    "grant"
  ],


  // =====================================================
  // SAMPLE PROMPTS
  // =====================================================

  sample_prompts: [
    "Quỹ tài trợ cho nghiên cứu sinh ngành Hệ thống thông tin quản lý?",
    "Hãy cho tôi một số chương trình tài trợ nghiên cứu cơ bản tại Việt Nam?",
    "Quỹ tài trợ cho hoạt động đổi mới, sáng tạo, khởi nghiệp năm 2026",
    "Danh sách quỹ tài trợ phù hợp cho các trường đại học khối ngành kinh tế?"
  ],


  // =====================================================
  // PROVIDED DATA
  // =====================================================

  provided_data_types: [
    {
      type:
        "funds",

      description:
        "Danh sách các quỹ, chương trình và cơ hội tài trợ nghiên cứu, bao gồm cơ quan tài trợ, thời hạn, mức tài trợ, loại hình tài trợ và đối tượng đủ điều kiện."
    }
  ],


  // =====================================================
  // DECISION SUPPORT
  // =====================================================

  decision_support: [
    "Mức độ phù hợp với chủ đề nghiên cứu",
    "Đối tượng đủ điều kiện nộp hồ sơ",
    "Mức tài trợ",
    "Thời hạn nộp hồ sơ",
    "Cơ quan tài trợ",
    "Loại hình tài trợ",
    "Quốc gia hoặc phạm vi tài trợ"
  ],


  // =====================================================
  // KEY DATA FIELDS
  //
  // Đồng bộ với schema Fund hiện tại trong MongoDB/API.
  // =====================================================

  key_fields: [
    "opportunity_id",
    "opportunity_number",
    "opportunity_title",
    "opportunity_status",
    "agency_code",
    "agency_name",
    "top_level_agency_name",
    "category",
    "funding_categories",
    "funding_amount",
    "award_ceiling",
    "award_floor",
    "expected_awards",
    "funding_instruments",
    "applicant_types",
    "applicant_description",
    "post_date",
    "close_date",
    "archive_date",
    "fiscal_year",
    "url",
    "description"
  ],


  // =====================================================
  // CONTACT
  // =====================================================

  contact:
    "kcntt@neu.edu.vn",

  status:
    "active"
};