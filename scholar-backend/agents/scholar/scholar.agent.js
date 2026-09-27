// agents/scholar/scholar.agent.js
import { searchConferenceJournalByVector } from "./scholar.search.js";
import {
  detectDomain,
  analyzeQuestion,
  countryMatches
} from "./agentReasoning.js";
import { rankItems, smartFilter } from "./scholar.ranking.js";

const MAX_CANDIDATES = 15;
const FINAL_TOPK = 5;

function text(value) {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value.map(text).filter(Boolean).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).trim();
}
function hasValue(value) {
  const result = text(value).toLowerCase();
  return Boolean(result) &&
    !["n/a", "na", "null", "undefined"].includes(result);
}
function first(...values) {
  return values.find(hasValue) ?? "";
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
function countryState(item, target) {
  const values = [
    item.country,
    item.country_name,
    item.location_country,
    item.nation,
    item.country_code,
    item.iso_code
  ].filter(hasValue);
  if (!values.length) return "unknown";
  return values.some(value => countryMatches(value, target))
    ? "match"
    : "mismatch";
}
function titleOf(item, type) {
  return text(
    type === "conference"
      ? first(
          item.name,
          item.title,
          item.conference_name,
          item.event_name,
          item.acronym
        )
      : first(
          item.title,
          item.name,
          item.journal_title,
          item.source_title
        )
  );
}
function identity(item, type) {
  const id = first(
    item._key, item.u_key, item.sourceid, item.source_id
  );
  if (id) return `${type}|${normalize(id)}`;

  if (type === "journal") {
    const issn = first(item.primary_issn, item.issn);
    if (issn) return `journal|${normalize(issn)}`;
  }

  const date = type === "conference"
    ? normalize(first(
        item.start_date, item.event_date, item.conference_date
      ))
    : "";
  return `${type}|${normalize(titleOf(item, type))}|${date}`;
}
function dedupe(items, type) {
  const found = new Map();
  for (const item of items) {
    if (!normalize(titleOf(item, type))) continue;
    const key = identity(item, type);
    const previous = found.get(key);
    const score = Number(
      item.score ?? item.baseScore ?? item._score
    ) || 0;
    const previousScore = Number(
      previous?.score ?? previous?.baseScore ?? previous?._score
    ) || 0;
    if (!previous || score > previousScore) {
      found.set(key, item);
    }
  }
  return [...found.values()];
}
function isDetailQuestion(question) {
  const q = normalize(question);
  return /\b(chi tiet|thong tin|gioi thieu|mo ta|noi dung|about|details?)\b/.test(q)
    || /^cho (toi|minh) biet/.test(q);
}
function namedMatches(items, question, type) {
  const q = normalize(question);
  return items.filter(item => {
    const name = normalize(titleOf(item, type));
    return name.length >= 8 && q.includes(name);
  });
}
function chooseResults(items, question, analysis, type, topk) {
  const unique = dedupe(items, type).filter(
    item =>
      !analysis.wantsCountryCode ||
      countryState(item, analysis.wantsCountryCode) !== "mismatch"
  );

  const named = namedMatches(unique, question, type);
  if (named.length) {
    return rankItems(named, question, analysis).slice(0, 1);
  }
  return smartFilter(
    rankItems(unique, question, analysis)
  ).slice(0, topk);
}
function addLine(lines, label, value) {
  if (hasValue(value)) {
    lines.push(`- **${label}:** ${text(value)}`);
  }
}
function conferenceBlock(item, index, detailed) {
  const lines = [
    `### ${index + 1}. **${titleOf(item, "conference")}**`
  ];
  addLine(lines, "Tên viết tắt", first(
    item.acronym, item.short_name
  ));
  addLine(lines, "Địa điểm", first(
    item.location,
    item.venue,
    item.place,
    [item.city, item.country].filter(hasValue).join(", ")
  ));
  addLine(lines, "Hạn nộp bài", first(
    item.deadline,
    item.submission_deadline,
    item.paper_deadline,
    item.cfp_deadline
  ));
  addLine(lines, "Ngày bắt đầu", first(
    item.start_date, item.event_date, item.conference_date
  ));
  addLine(lines, "Ngày kết thúc", first(
    item.end_date, item.event_end_date
  ));

  if (detailed) {
    addLine(lines, "Đơn vị tổ chức", item.organizer);
    addLine(lines, "Lĩnh vực", first(
      item.fields, item.areas, item.categories
    ));
    addLine(lines, "Chủ đề", first(
      item.topics, item.topic, item.keywords
    ));
    addLine(lines, "Thông tin CFP", first(
      item.cfp_text, item.cfp,
      item.description, item.summary
    ));
  }
  addLine(lines, "Liên kết", first(
    item.cfp_link, item.url, item.link,
    item.website, item.conference_url, item.homepage
  ));
  return lines.join("\n");
}
function journalBlock(item, index, detailed) {
  const lines = [
    `### ${index + 1}. **${titleOf(item, "journal")}**`
  ];
  addLine(lines, "Nhà xuất bản", first(
    item.publisher, item.publisher_name, item.publisher_alt
  ));
  addLine(lines, "Quốc gia", first(
    item.country, item.country_name, item.nation
  ));
  addLine(lines, "Quartile", first(
    item.quartile, item.sjr_best_quartile, item.best_quartile
  ));

  if (detailed) {
    addLine(lines, "Lĩnh vực", first(
      item.areas, item.fields
    ));
    addLine(lines, "Danh mục", first(
      item.categories, item.category
    ));
    addLine(lines, "ISSN", first(
      item.primary_issn, item.issn
    ));
    addLine(lines, "SJR", item.sjr);
    addLine(lines, "H-index", item.h_index);
    addLine(lines, "Phạm vi xuất bản", item.coverage);
    addLine(lines, "Mô tả", first(
      item.description, item.text
    ));
  }
  addLine(lines, "Liên kết", first(
    item.scimago_link, item.url, item.link,
    item.website, item.homepage
  ));
  return lines.join("\n");
}
function fallbackAnswer(question, conferences, journals) {
  if (!conferences.length && !journals.length) {
    return "Chưa tìm thấy hội thảo hoặc tạp chí phù hợp trong kết quả truy xuất.";
  }
  const detailed = isDetailQuestion(question);
  const sections = [];

  if (conferences.length) {
    sections.push(
      `## 🎓 Hội thảo liên quan\n\n${
        conferences.map((item, index) =>
          conferenceBlock(item, index, detailed)
        ).join("\n\n")
      }`
    );
  }
  if (journals.length) {
    sections.push(
      `## 📚 Tạp chí liên quan\n\n${
        journals.map((item, index) =>
          journalBlock(item, index, detailed)
        ).join("\n\n")
      }`
    );
  }
  return sections.join("\n\n");
}

export async function runAgent(
  question,
  topk = FINAL_TOPK,
  history = []
) {
  const start = Date.now();
  const safeTopK = Math.max(
    1,
    Math.min(
      Math.trunc(Number(topk)) || FINAL_TOPK,
      MAX_CANDIDATES
    )
  );

  try {
    const domain = detectDomain(question);
    const analysis = analyzeQuestion(question);
    const found = await searchConferenceJournalByVector({
      question,
      topk: MAX_CANDIDATES
    });

    let conferences = chooseResults(
      found?.conferences || [],
      question,
      analysis,
      "conference",
      safeTopK
    );
    let journals = chooseResults(
      found?.journals || [],
      question,
      analysis,
      "journal",
      safeTopK
    );

    const namedConferences = namedMatches(
      conferences, question, "conference"
    );
    const namedJournals = namedMatches(
      journals, question, "journal"
    );

    if (namedConferences.length && !namedJournals.length) {
      conferences = namedConferences;
      journals = [];
    }
    if (namedJournals.length && !namedConferences.length) {
      journals = namedJournals;
      conferences = [];
    }

    return {
      answer: fallbackAnswer(
        question, conferences, journals
      ),
      conferences,
      journals,
      domain: found?.domain || domain,
      analysis,
      history,
      responseTimeMs: Date.now() - start
    };
  } catch (error) {
    console.error("❌ Scholar agent error:", error);
    return {
      answer: "Hệ thống đang gặp lỗi, vui lòng thử lại sau.",
      conferences: [],
      journals: [],
      domain: "error",
      analysis: {},
      history,
      responseTimeMs: Date.now() - start
    };
  }
}