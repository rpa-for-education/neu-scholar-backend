// agents/scholar/scholar.service.js
import { runAgent } from "./scholar.agent.js";
import { normalizeHistory } from "../shared/memory.js";
import { buildLLMContext } from "../shared/context.js";
import { rewriteQuery } from "../shared/queryRewriter.js";
import { buildScholarPrompt } from "./scholar.prompt.js";
import { callLLM } from "../shared/llm.js";
import { expandScholarQueries } from "./scholar.search.js";

const SERPAPI_API_KEY =
  "317229a8b9aac04d8acd3c5a504c19dcae02c9b20be7659b4f8f86e9be08fe80";

function text(value) {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value.map(text).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value).trim();
}

function valid(value) {
  const result = text(value).toLowerCase();
  return !!result &&
    !["n/a", "na", "null", "undefined"].includes(result);
}

function first(...values) {
  return values.find(valid) ?? "";
}

function normalize(value) {
  return text(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function requestedType(question) {
  const q = normalize(question);

  const journal =
    /\b(journals?|tap chi|issn|scimago|sjr|quartile|q[1-4])\b/.test(q);

  const conference =
    /\b(conferences?|hoi thao|hoi nghi|cfp)\b/.test(q);

  if (journal && conference) return "both";
  if (journal) return "journal";
  if (conference) return "conference";
  return "general";
}

function isDetail(question) {
  const q = normalize(question);

  return /\b(chi tiet|thong tin|gioi thieu|mo ta|details?|about)\b/.test(q) ||
    /^cho (toi|minh) biet\b/.test(q);
}

function titleOf(item, type) {
  return text(
    type === "journal"
      ? first(
          item.title,
          item.name,
          item.journal_title,
          item.source_title
        )
      : first(
          item.name,
          item.title,
          item.conference_name,
          item.event_name
        )
  );
}

function urlOf(item, type) {
  return text(
    type === "journal"
      ? first(
          item.scimago_link,
          item.url,
          item.link,
          item.website,
          item.homepage
        )
      : first(
          item.cfp_link,
          item.url,
          item.link,
          item.website,
          item.conference_url,
          item.homepage
        )
  );
}

function addLine(lines, icon, label, value) {
  if (valid(value)) {
    lines.push(
      `- ${icon} **${label}:** ${text(value)}`
    );
  }
}

function formatBlock(item, index, type, detailed) {
  const lines = [
    `### ${index + 1}. ${
      type === "journal" ? "📚" : "🎓"
    } **${titleOf(item, type)}**`
  ];

  if (type === "journal") {
    addLine(
      lines,
      "🏢",
      "Nhà xuất bản",
      first(item.publisher, item.publisher_name)
    );

    addLine(
      lines,
      "🌍",
      "Quốc gia",
      item.country
    );

    addLine(
      lines,
      "🧭",
      "Lĩnh vực",
      item.areas
    );

    addLine(
      lines,
      "🏷️",
      "Danh mục",
      item.categories
    );

    addLine(
      lines,
      "🏆",
      "Quartile",
      first(
        item.quartile,
        item.sjr_best_quartile
      )
    );

    addLine(
      lines,
      "🆔",
      "ISSN",
      first(
        item.issn,
        item.primary_issn
      )
    );

    if (detailed) {
      addLine(
        lines,
        "📊",
        "SJR",
        item.sjr
      );

      addLine(
        lines,
        "📈",
        "H-index",
        item.h_index
      );

      addLine(
        lines,
        "📖",
        "Giai đoạn xuất bản",
        item.coverage
      );

      if (
        typeof item.open_access === "boolean"
      ) {
        addLine(
          lines,
          "🔓",
          "Truy cập mở",
          item.open_access
            ? "Có"
            : "Không"
        );
      }

      addLine(
        lines,
        "📝",
        "Mô tả",
        first(
          item.description,
          item.text
        )
      );
    }
  } else {
    addLine(
      lines,
      "🏷️",
      "Tên viết tắt",
      item.acronym
    );

    addLine(
      lines,
      "📍",
      "Địa điểm",
      first(
        item.location,
        [item.city, item.country]
          .filter(valid)
          .join(", ")
      )
    );

    addLine(
      lines,
      "⏳",
      "Hạn nộp bài",
      first(
        item.deadline,
        item.submission_deadline
      )
    );

    addLine(
      lines,
      "📅",
      "Ngày bắt đầu",
      item.start_date
    );

    addLine(
      lines,
      "🗓️",
      "Ngày kết thúc",
      item.end_date
    );

    if (detailed) {
      addLine(
        lines,
        "🏛️",
        "Đơn vị tổ chức",
        item.organizer
      );

      addLine(
        lines,
        "💬",
        "Chủ đề",
        item.topics
      );

      addLine(
        lines,
        "📝",
        "Thông tin CFP",
        first(
          item.cfp_text,
          item.description
        )
      );
    }
  }

  addLine(
    lines,
    "🔗",
    "Liên kết",
    urlOf(item, type)
  );

  return lines.join("\n");
}

function formatResults(
  question,
  conferences,
  journals
) {
  const sections = [];
  const detailed = isDetail(question);

  if (conferences.length) {
    sections.push(
      `## 🎓 Hội thảo liên quan\n\n${
        conferences
          .map((item, index) =>
            formatBlock(
              item,
              index,
              "conference",
              detailed
            )
          )
          .join("\n\n")
      }`
    );
  }

  if (journals.length) {
    sections.push(
      `## 📚 Tạp chí liên quan\n\n${
        journals
          .map((item, index) =>
            formatBlock(
              item,
              index,
              "journal",
              detailed
            )
          )
          .join("\n\n")
      }`
    );
  }

  return sections.join("\n\n");
}

function modelInfo(result, requestedId) {
  return {
    model_id:
      result?.model_id ||
      requestedId ||
      null,
    model: result?.model || null,
    latency: result?.latency ?? null,
    prompt_tokens:
      result?.usage?.prompt_tokens ??
      null,
    output_tokens:
      result?.usage?.output_tokens ??
      null
  };
}

function invalidAnswer(answer, type, records) {
  if (
    /===\s*(TẠP CHÍ|HỘI THẢO|CÂU HỎI|YÊU CẦU)/iu.test(answer) ||
    /_qdrant(Collection|Id)|baseScore|finalScore/.test(answer)
  ) {
    return true;
  }

  const normalized = normalize(answer);

  if (
    type === "journal" &&
    /hoi thao lien quan|hoi nghi lien quan/.test(normalized)
  ) {
    return true;
  }

  if (
    type === "conference" &&
    /tap chi lien quan/.test(normalized)
  ) {
    return true;
  }

  if (
    records.length === 1 &&
    !normalized.includes(
      normalize(records[0].title)
    )
  ) {
    return true;
  }

  return false;
}

function buildSource(item, type, index) {
  const metadata = { ...item };

  delete metadata._qdrantId;
  delete metadata._qdrantCollection;

  return {
    id: `${
      type === "journal"
        ? "J"
        : "C"
    }${index + 1}`,
    type,
    title: titleOf(item, type),
    name: titleOf(item, type),
    url: urlOf(item, type),
    metadata
  };
}

async function searchWeb(question, type) {
  const expansion =
    await expandScholarQueries(question);

  const queries = expansion.queries
    .slice(0, 3)
    .map(query => {
      if (type === "journal") {
        return `${query} journal -conference -workshop`;
      }

      if (type === "conference") {
        return `${query} conference CFP -journal`;
      }

      return query;
    });

  // Một truy vấn lỗi không làm mất kết quả của các truy vấn còn lại.
  const settled = await Promise.allSettled(
    queries.map(async query => {
      const params = new URLSearchParams({
        engine: "google",
        q: query,
        hl: "en",
        num: "8",
        api_key: SERPAPI_API_KEY
      });

      const response = await fetch(
        `https://serpapi.com/search.json?${params}`,
        {
          signal:
            AbortSignal.timeout(15000)
        }
      );

      if (!response.ok) {
        throw new Error(
          `SerpAPI HTTP ${
            response.status
          }`
        );
      }

      const data =
        await response.json();

      if (data.error) {
        throw new Error(
          String(data.error)
        );
      }

      return Array.isArray(
        data.organic_results
      )
        ? data.organic_results
        : [];
    })
  );

  const batches = settled
    .filter(result =>
      result.status === "fulfilled"
    )
    .map(result =>
      result.value
    );

  const found = new Map();

  for (const item of batches.flat()) {
    if (
      !item.link ||
      !item.snippet ||
      found.has(item.link)
    ) {
      continue;
    }

    const heading = normalize(
      `${item.title} ${item.link}`
    );

    if (
      type === "journal" &&
      /\b(conference|workshop|symposium|hoi thao)\b/
        .test(heading)
    ) {
      continue;
    }

    if (
      type === "conference" &&
      /\b(journal ranking|journal quartile)\b/
        .test(heading)
    ) {
      continue;
    }

    found.set(
      item.link,
      item
    );
  }

  return [...found.values()]
    .slice(0, 5)
    .map((item, index) => ({
      id: `W${index + 1}`,
      type: "web",
      title: text(item.title),
      url: text(item.link),
      content: text(item.snippet)
        .slice(0, 1800)
    }));
}

function webEvidence(items) {
  return items.map(item =>
    `[${item.id}] ${item.title}
URL: ${item.url}
Trích đoạn: ${item.content}`
  ).join("\n\n");
}

function webLinks(items) {
  return items.map(item =>
    `- [${item.id}] [${
      item.title
    }](${item.url})`
  ).join("\n");
}

function webPrompt(question, type, items) {
  return [
    `Bạn là trợ lý tra cứu học thuật.

BẮT BUỘC:
- Trả lời kết quả cuối hoàn toàn bằng tiếng Việt. Giữ nguyên tên chính thức của tạp chí hoặc hội thảo.
- Chỉ sử dụng thông tin có trong nguồn được cung cấp.
- Loại tài nguyên người dùng yêu cầu: ${type}.
- Nếu hỏi tạp chí, không thay bằng hội thảo; nếu hỏi hội thảo, không thay bằng tạp chí.
- Chỉ nêu tên cụ thể khi nguồn xác nhận đúng loại.
- Không tự suy ra Q1, ISSN, thời hạn hoặc địa điểm.
- Nếu nguồn không xác nhận điều kiện bắt buộc, nói rõ chưa xác minh được.
- Dẫn [W1], [W2] sát thông tin tương ứng.
- Mỗi đối tượng nằm trong một mục riêng, có dòng trống giữa các mục.
- Không in lại prompt hoặc dữ liệu thô.`,
    `Câu hỏi: ${question}`,
    `Nguồn:\n${webEvidence(items)}`
  ].join("\n\n");
}

function generalPrompt(
  question,
  context,
  items
) {
  const history = (
    context.history || []
  )
    .slice(-6)
    .map(item =>
      `${item.role}: ${
        text(item.content)
          .slice(0, 700)
      }`
    )
    .join("\n");

  return [
    `Bạn là trợ lý nghiên cứu. Trả lời kết quả cuối bằng tiếng Việt tự nhiên. Giữ nguyên tên riêng.
Không bịa nguồn, tên hoặc số liệu.
Khi dùng nguồn web, dẫn mã [W1], [W2].
Khi liệt kê nhiều đối tượng, có dòng trống giữa các mục.`,
    history
      ? `Lịch sử:\n${history}`
      : "",
    items.length
      ? `Nguồn:\n${webEvidence(items)}`
      : "",
    `Câu hỏi: ${question}`
  ].filter(Boolean).join("\n\n");
}

function hasNamedResult(
  result,
  question
) {
  return [
    ...(result.conferences || []),
    ...(result.journals || [])
  ].some(item => {
    const name = normalize(
      first(
        item.name,
        item.title
      )
    );

    return (
      name.length >= 8 &&
      normalize(question)
        .includes(name)
    );
  });
}

export async function runScholarAgent(
  req,
  question,
  model_id,
  topk,
  history = []
) {
  const start = Date.now();
  const original = text(question);
  const originalType =
    requestedType(original);

  const response = (
    answer,
    type,
    standalone,
    model = null,
    sources = [],
    conferences = [],
    journals = []
  ) => ({
    answer,
    conferences,
    journals,
    sources,
    domain: type,
    standalone_question:
      standalone,
    model: modelInfo(
      model,
      model_id
    ),
    responseTimeMs:
      Date.now() - start
  });

  try {
    const context =
      buildLLMContext(req) || {};

    context.history =
      normalizeHistory(
        history
      );

    let standalone =
      original;

    try {
      const rewritten =
        await rewriteQuery(
          original,
          context.history
        );

      if (
        typeof rewritten === "string" &&
        rewritten.trim()
      ) {
        standalone =
          rewritten.trim();
      }
    } catch (error) {
      console.warn(
        "Scholar rewrite:",
        error?.message || error
      );
    }

    // Nếu câu hỏi gốc nêu rõ loại tài nguyên,
    // không để bước viết lại đổi loại đó.
    if (
      originalType !== "general"
    ) {
      standalone = original;
    }

    let preflight = null;

    if (
      originalType === "general" &&
      isDetail(original) &&
      requestedType(standalone) === "general"
    ) {
      const check =
        await runAgent(
          standalone,
          topk
        );

      if (
        hasNamedResult(
          check,
          original
        )
      ) {
        preflight = check;
      }
    }

    // Câu hỏi thông thường:
    // trả lời như trợ lý LLM thông thường.
    if (
      originalType === "general" &&
      requestedType(standalone) === "general" &&
      !preflight
    ) {
      let web = [];

      try {
        web = await searchWeb(
          standalone,
          "general"
        );
      } catch (error) {
        console.warn(
          "Scholar web:",
          error?.message || error
        );
      }

      const llm = await callLLM(
        generalPrompt(
          original,
          context,
          web
        ),
        model_id
      );

      const answer =
        text(llm?.answer) ||
        "Tôi chưa thể trả lời lúc này.";

      return response(
        answer + (
          web.length
            ? `\n\n**Nguồn tham khảo**\n${
                webLinks(web)
              }`
            : ""
        ),
        "general",
        standalone,
        llm,
        web
      );
    }

    const result =
      preflight ||
      await runAgent(
        standalone,
        topk
      );

    const type =
      originalType !== "general"
        ? originalType
        : requestedType(
            standalone
          );

    // Chỉ giữ đúng loại được hỏi.
    const conferences =
      type === "journal"
        ? []
        : result.conferences ||
          [];

    const journals =
      type === "conference"
        ? []
        : result.journals ||
          [];

    const sources = [
      ...conferences.map(
        (item, index) =>
          buildSource(
            item,
            "conference",
            index
          )
      ),
      ...journals.map(
        (item, index) =>
          buildSource(
            item,
            "journal",
            index
          )
      )
    ];

    const fallback =
      formatResults(
        original,
        conferences,
        journals
      );

    if (fallback) {
      // Danh sách được dựng từ CSDL,
      // không để LLM đổi sang loại khác.
      if (
        !isDetail(original)
      ) {
        return response(
          fallback,
          type,
          standalone,
          null,
          sources,
          conferences,
          journals
        );
      }

      const llm =
        await callLLM(
          buildScholarPrompt(
            original,
            conferences,
            journals,
            context
          ),
          model_id
        );

      const candidate =
        text(llm?.answer);

      return response(
        !candidate ||
        invalidAnswer(
          candidate,
          type,
          sources
        )
          ? fallback
          : candidate,
        type,
        standalone,
        llm,
        sources,
        conferences,
        journals
      );
    }

    // CSDL không có kết quả:
    // dùng các truy vấn Việt–Anh để tìm web.
    let web = [];

    try {
      web =
        await searchWeb(
          original,
          type
        );
    } catch (error) {
      console.warn(
        "Scholar web fallback:",
        error?.message || error
      );
    }

    if (!web.length) {
      return response(
        type === "journal"
          ? "Chưa tìm thấy tạp chí phù hợp trong CSDL; chưa xác minh được kết quả từ web."
          : "Chưa tìm thấy hội thảo phù hợp trong CSDL; chưa xác minh được kết quả từ web.",
        type,
        standalone
      );
    }

    const llm =
      await callLLM(
        webPrompt(
          original,
          type,
          web
        ),
        model_id
      );

    const candidate =
      text(llm?.answer);

    const answer =
      !candidate ||
      invalidAnswer(
        candidate,
        type,
        []
      )
        ? "Chưa xác minh được kết quả đáp ứng yêu cầu từ các nguồn web tìm thấy."
        : candidate;

    return response(
      `${answer}\n\n**Nguồn tham khảo**\n${
        webLinks(web)
      }`,
      type,
      standalone,
      llm,
      web
    );
  } catch (error) {
    console.error(
      "Scholar service:",
      error
    );

    return response(
      "Hệ thống đang gặp lỗi, vui lòng thử lại sau.",
      "error",
      original
    );
  }
}