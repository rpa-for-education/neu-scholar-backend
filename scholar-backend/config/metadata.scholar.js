export const SCHOLAR_METADATA = {
  name: "Hội thảo & Tạp chí",
  description:
    "Tìm kiếm, hỏi đáp và gợi ý các hội thảo và tạp chí khoa học uy tín trong nước và quốc tế, hỗ trợ hoạt động nghiên cứu và công bố khoa học.",

  version: "2.0.0",
  developer: "Nhóm thầy V Huy, V Minh, X Lâm",

  capabilities: [
    "search",
    "recommendation",
    "ranking",
    "summarize"
  ],

  supported_models: [
    {
      model_id: "qwen3-8b",
      provider: "ollama",
      model: "qwen3:8b",
      name: "Qwen3 8B",
      description: "Mô hình tối ưu cho tư vấn học thuật"
    }
  ],

  domains: ["conference", "journal"],

  sample_prompts: [
    "Danh sách 5 hội thảo uy tín liên quan đến Trí tuệ nhân tạo, Học máy,...?",
    "Một số hội thảo nổi bật được tổ chức tại Đại học Kinh tế quốc dân năm 2026?",
    "Tạp chí phù hợp liên quan tới ngành Hệ thống thông tin quản lý?",
    "Một số tạp chí nổi bật ngành Ngôn ngữ học?"
  ],

  provided_data_types: [
    {
      type: "conferences",
      description:
        "Danh sách hội thảo trong nước và quốc tế (deadline, địa điểm, lĩnh vực)"
    },
    {
      type: "journals",
      description:
        "Danh sách tạp chí khoa học (quartile, publisher, lĩnh vực)"
    }
  ],

  ranking_logic: [
    "Relevance to research topic",
    "Deadline proximity",
    "Quartile (Q1, Q2, ...)",
    "Location / country preference"
  ],

  contact: "kcntt@neu.edu.vn",
  status: "active"
};