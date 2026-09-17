// Scholar metadata
// Mô tả capability của phân hệ Hội thảo & Tạp chí.

export const SCHOLAR_METADATA = {

  // =====================================================
  // GENERAL
  // =====================================================

  name:
    "Hội thảo & Tạp chí",

  description:
    "Tìm kiếm, hỏi đáp và gợi ý các hội thảo và tạp chí khoa học uy tín trong nước và quốc tế, hỗ trợ hoạt động nghiên cứu và công bố khoa học.",

  version:
    "2.1.0",

  developer:
    "Nhóm thầy V Huy, V Minh, X Lâm",


  // =====================================================
  // CAPABILITIES
  // =====================================================

  capabilities: [
    "search",
    "recommendation",
    "ranking",
    "summarize"
  ],


  // =====================================================
  // SUPPORTED LLM
  //
  // Đây phải là model_id mà Portal gửi về Scholar API.
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
        "Mô hình Qwen2.5 14B Instruct với ngữ cảnh 16K, sử dụng cho tư vấn học thuật."
    }
  ],


  // =====================================================
  // DOMAINS
  // =====================================================

  domains: [
    "conference",
    "journal"
  ],


  // =====================================================
  // SAMPLE PROMPTS
  // =====================================================

  sample_prompts: [
    "Danh sách 5 hội thảo uy tín liên quan đến Trí tuệ nhân tạo, Học máy,...?",
    "Một số hội thảo nổi bật được tổ chức tại Đại học Kinh tế quốc dân năm 2026?",
    "Tạp chí phù hợp liên quan tới ngành Hệ thống thông tin quản lý?",
    "Một số tạp chí nổi bật ngành Ngôn ngữ học?"
  ],


  // =====================================================
  // PROVIDED DATA
  // =====================================================

  provided_data_types: [
    {
      type:
        "conferences",

      description:
        "Danh sách hội thảo trong nước và quốc tế, bao gồm thông tin về hạn nộp bài, thời gian tổ chức, địa điểm và lĩnh vực nghiên cứu."
    },

    {
      type:
        "journals",

      description:
        "Danh sách tạp chí khoa học, bao gồm thông tin về quartile, nhà xuất bản, quốc gia và lĩnh vực nghiên cứu."
    }
  ],


  // =====================================================
  // RANKING
  // =====================================================

  ranking_logic: [
    "Relevance to research topic",
    "Deadline proximity",
    "Quartile (Q1, Q2, ...)",
    "Location / country preference"
  ],


  // =====================================================
  // CONTACT
  // =====================================================

  contact:
    "kcntt@neu.edu.vn",

  status:
    "active"
};