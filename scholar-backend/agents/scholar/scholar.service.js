// agents/scholar/scholar.service.js
import { runAgent } from "./scholar.agent.js";
import { buildLLMContext } from "../shared/context.js";
import { rewriteQuery } from "../shared/queryRewriter.js";
import { buildScholarPrompt } from "./scholar.prompt.js";
import { callLLM } from "../shared/llm.js";
import { expandScholarQueries } from "./scholar.search.js";

const SERPAPI_API_KEY = "317229a8b9aac04d8acd3c5a504c19dcae02c9b20be7659b4f8f86e9be08fe80";
const RECORDS = new Map();
const RECORD_TTL = 3 * 60 * 60 * 1000;

const text = x =>
  x == null
    ? ""
    : Array.isArray(x)
      ? x.map(text).filter(Boolean).join(", ")
      : typeof x === "object"
        ? JSON.stringify(x)
        : String(x).trim();

const first = (...xs) =>
  xs.find(
    x =>
      text(x) &&
      !/^(n\/a|na|null|undefined)$/i.test(text(x))
  ) ?? "";

const norm = x =>
  text(x)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const matches = (q, pattern) => pattern.test(norm(q));

const kindOf = q => {
  const j = matches(
    q,
    /\b(tap chi|journal|issn|scimago|quartile|sjr|q[1-4])\b/
  );

  const c = matches(
    q,
    /\b(hoi thao|hoi nghi|conference|cfp|symposium)\b/
  );

  return j && c
    ? "both"
    : j
      ? "journal"
      : c
        ? "conference"
        : "general";
};

const isAdvice = q =>
  matches(
    q,
    /\b(bai bao|ban thao|manuscript|paper|nghien cuu nay)\b/
  ) &&
  matches(
    q,
    /\b(dang|gui|nop|phu hop|nen chon|o dau)\b/
  );

const attachedPaper = q =>
  matches(
    q,
    /\b(bai bao|ban thao|manuscript|paper)\b/
  ) &&
  matches(
    q,
    /\b(dinh kem|tai len|trong du an|cua du an|trong project|nay|do|this|attached)\b/
  );

const isDetail = q =>
  matches(
    q,
    /\b(chi tiet|thong tin|gioi thieu|mo ta|details?|about|tren|do)\b/
  );

const isFollowup = q =>
  matches(
    q,
    /\b(q[1-4]|con (q[1-4]|loai|nhung)|the (con|va)|tuong tu|khac nua|them nua|o tren|ben tren|vua neu|tap chi (do|nay|tren)|hoi thao (do|nay|tren)|hoi nghi (do|nay|tren)|chung|no|cai do)\b/
  );

const isContextual = q =>
  matches(
    q,
    /\b(cua toi|cho toi|de tai|du an|project|file|tai lieu|ho so|phu hop|goi y|nen chon)\b/
  );

const fileInventory = q =>
  matches(q, /\b(file|tep|tai lieu|van ban)\b/) &&
  matches(
    q,
    /\b(nao|nhung|cac|danh sach|bao nhieu|da dinh kem|da tai len|co gi)\b/
  ) &&
  matches(
    q,
    /\b(dinh kem|tai len|upload|du an|project|cua toi|trong)\b/
  );

const explainPrevious = q =>
  matches(
    q,
    /\b(tai sao|vi sao|giai thich|ly do)\b/
  ) &&
  matches(
    q,
    /\b(tren|do|nay|cac tap chi|cac hoi thao|cac noi|nhung noi)\b/
  );

const title = (x, k) =>
  text(
    k === "journal"
      ? first(
          x.title,
          x.name,
          x.journal_title,
          x.source_title
        )
      : first(
          x.name,
          x.title,
          x.conference_name,
          x.event_name,
          x.acronym
        )
  );

const url = (x, k) =>
  text(
    k === "journal"
      ? first(
          x.scimago_link,
          x.url,
          x.link,
          x.website,
          x.homepage
        )
      : first(
          x.cfp_link,
          x.url,
          x.link,
          x.website,
          x.conference_url,
          x.homepage
        )
  );

function contextOf(req, passedHistory) {
  const base = buildLLMContext(req) || {};

  const history = (
    Array.isArray(base.history) && base.history.length
      ? base.history
      : passedHistory || []
  )
    .filter(
      x =>
        x &&
        ["user", "assistant"].includes(x.role) &&
        typeof x.content === "string" &&
        x.content.trim()
    )
    .slice(-10)
    .map(x => ({
      role: x.role,
      content: x.content.trim().slice(0, 2500)
    }));

  // Dùng tài liệu đã được shared/context.js chuẩn hóa.
  const docs = (
    Array.isArray(base.docs)
      ? base.docs
      : []
  )
    .filter(
      x =>
        x &&
        typeof x.text === "string" &&
        x.text.trim()
    )
    .slice(0, 10)
    .map(x => ({
      ...x,
      name: text(x.name) || "document",
      text: x.text.trim()
    }));

  return {
    ...base,
    history,
    profile: base.profile ?? null,
    project: base.project ?? null,
    project_id:
      base.project_id ||
      base.project?.id ||
      null,
    docs
  };
}

function hasDocumentBody(doc) {
  // Bỏ link và markup trước khi kiểm tra.
  // svg[ten-file.pdf](URL) không phải nội dung PDF.
  const body = text(doc?.text)
    .replace(
      /!?\[[^\]]*\]\(https?:\/\/[^)]+\)/gi,
      " "
    )
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(
      /\b(svg|download|file_url|url)\b/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();

  return (
    body.length >= 60 &&
    (body.match(/[\p{L}]{3,}/gu) || []).length >= 10
  );
}

function scopeText(ctx, max = 5500) {
  const p = ctx.project || {};

  const header = [
    ["Dự án", p.name],
    ["Mô tả", p.description],
    ["Tóm tắt", p.abstract],
    ["Mục tiêu", p.objectives],
    ["Phương pháp", p.methodology],
    ["Lĩnh vực", p.fields]
  ]
    .filter(([, v]) => text(v))
    .map(
      ([label, v]) =>
        `${label}: ${text(v)}`
    )
    .join("\n");

  const budget = Math.max(
    0,
    max - header.length - 2
  );

  const readableDocs = ctx.docs.filter(
    hasDocumentBody
  );

  const perDoc = readableDocs.length
    ? Math.max(
        300,
        Math.floor(
          budget / readableDocs.length
        ) - 70
      )
    : 0;

  const files = readableDocs
    .map(
      d =>
        `File ${d.name}: ${d.text.slice(
          0,
          perDoc
        )}`
    )
    .join("\n");

  return `${header}\n${files}`
    .slice(0, max)
    .trim();
}

function paperText(question, ctx) {
  const readable = ctx.docs.filter(
    hasDocumentBody
  );

  const named = readable.filter(d =>
    /\b(bai bao|ban thao|manuscript|paper|article|abstract)\b/.test(
      norm(d.name)
    )
  );

  const docs = (
    named.length
      ? named
      : readable
  )
    .sort(
      (a, b) =>
        Number(
          /\b(bai bao|ban thao|manuscript|paper|article|abstract)\b/.test(
            norm(b.name)
          )
        ) -
        Number(
          /\b(bai bao|ban thao|manuscript|paper|article|abstract)\b/.test(
            norm(a.name)
          )
        )
    )
    .map(
      d =>
        `Tài liệu ${d.name}:\n${d.text.slice(
          0,
          3500
        )}`
    );

  const history = ctx.history
    .slice()
    .reverse()
    .find(
      h =>
        h.role === "user" &&
        h.content.length > 180 &&
        matches(
          h.content,
          /\b(tom tat|abstract|phuong phap|ket qua nghien cuu)\b/
        )
    )?.content;

  return [
    ctx.project?.name,
    ...docs,
    ctx.project?.description,
    ctx.project?.abstract,
    ctx.project?.objectives,
    ctx.project?.methodology,
    ctx.project?.fields,
    history,
    text(question).length > 250
      ? question
      : ""
  ]
    .filter(
      x => text(x).length >= 30
    )
    .join("\n")
    .slice(0, 9000);
}

function articleDocuments(ctx) {
  const readable = ctx.docs.filter(
    hasDocumentBody
  );

  const named = readable.filter(d =>
    /\b(bai bao|ban thao|manuscript|paper|article|abstract)\b/.test(
      norm(d.name)
    )
  );

  return named.length
    ? named
    : readable;
}

function inventory(req, ctx) {
  const p = ctx.project || {};

  const raw = [
    p.files,
    p.documents,
    p.attachments,
    req?.body?.context?.extra_data?.document,
    req?.body?.context?.document
  ];

  const names = [
    ...new Set(
      raw
        .flatMap(x =>
          Array.isArray(x)
            ? x
            : x
              ? [x]
              : []
        )
        .map(x =>
          typeof x === "object"
            ? text(
                first(
                  x.name,
                  x.file_name,
                  x.filename,
                  x.original_name
                )
              )
            : text(x).split("/").pop()
        )
        .filter(Boolean)
    )
  ];

  return names.length
    ? `Các file được Portal khai báo cho dự án:\n\n${names
        .map(
          (n, i) =>
            `${i + 1}. ${n}`
        )
        .join("\n")}`
    : "Portal chưa gửi danh sách file của dự án trong ngữ cảnh request. Tôi chưa thể xác định những file đã được tải lên.";
}

function line(lines, icon, label, x) {
  if (text(first(x))) {
    lines.push(
      `- ${icon} **${label}:** ${text(x)}`
    );
  }
}

function block(x, i, k, full) {
  const lines = [
    `### ${i + 1}. ${
      k === "journal" ? "📚" : "🎓"
    } **${title(x, k)}**`
  ];

  if (k === "journal") {
    line(
      lines,
      "🏢",
      "Nhà xuất bản",
      first(
        x.publisher,
        x.publisher_name
      )
    );

    line(
      lines,
      "🌍",
      "Quốc gia",
      first(
        x.country,
        x.country_name
      )
    );

    line(
      lines,
      "🧭",
      "Lĩnh vực",
      first(
        x.areas,
        x.fields
      )
    );

    line(
      lines,
      "🏷️",
      "Danh mục",
      first(
        x.categories,
        x.category
      )
    );

    line(
      lines,
      "🏆",
      "Quartile",
      first(
        x.quartile,
        x.sjr_best_quartile,
        x.best_quartile
      )
    );

    line(
      lines,
      "🆔",
      "ISSN",
      first(
        x.issn,
        x.primary_issn,
        x.issns,
        x.e_issn,
        x.p_issn
      )
    );

    if (full) {
      line(
        lines,
        "📊",
        "SJR",
        x.sjr
      );

      line(
        lines,
        "📈",
        "H-index",
        first(
          x.h_index,
          x.hindex
        )
      );

      line(
        lines,
        "📖",
        "Giai đoạn xuất bản",
        x.coverage
      );

      line(
        lines,
        "📝",
        "Mô tả",
        first(
          x.description,
          x.text
        )
      );
    }
  } else {
    line(
      lines,
      "🏷️",
      "Tên viết tắt",
      x.acronym
    );

    line(
      lines,
      "📍",
      "Địa điểm",
      first(
        x.location,
        x.venue,
        [x.city, x.country]
          .filter(Boolean)
          .join(", ")
      )
    );

    line(
      lines,
      "⏳",
      "Hạn nộp bài",
      first(
        x.deadline,
        x.submission_deadline,
        x.paper_deadline
      )
    );

    line(
      lines,
      "📅",
      "Ngày bắt đầu",
      first(
        x.start_date,
        x.event_date
      )
    );

    line(
      lines,
      "🗓️",
      "Ngày kết thúc",
      x.end_date
    );

    if (full) {
      line(
        lines,
        "🏛️",
        "Đơn vị tổ chức",
        x.organizer
      );

      line(
        lines,
        "🧭",
        "Lĩnh vực",
        first(
          x.fields,
          x.areas,
          x.categories
        )
      );

      line(
        lines,
        "💬",
        "Chủ đề",
        first(
          x.topics,
          x.topic
        )
      );
    }

    line(
      lines,
      "📝",
      "Tóm tắt CFP",
      first(
        x.cfp_summary,
        x.topics,
        x.topic
      )
    );
  }

  line(
    lines,
    "🔗",
    "Liên kết",
    url(x, k)
  );

  return lines.join("\n");
}

function format(cs, js, full) {
  return [
    cs.length
      ? `## 🎓 Hội thảo liên quan\n\n${cs
          .map(
            (x, i) =>
              block(
                x,
                i,
                "conference",
                full
              )
          )
          .join("\n\n")}`
      : "",
    js.length
      ? `## 📚 Tạp chí liên quan\n\n${js
          .map(
            (x, i) =>
              block(
                x,
                i,
                "journal",
                full
              )
          )
          .join("\n\n")}`
      : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function summarizeCFP(cs, modelId) {
  if (!cs.length) return [];

  const input = cs.map((x, i) => ({
    index: i + 1,
    title: title(x, "conference"),
    topics: text(
      first(
        x.topics,
        x.topic
      )
    ),
    cfp: text(
      first(
        x.cfp_text,
        x.cfp,
        x.description,
        x.text
      )
    ).slice(0, 4500)
  }));

  let summaries = {};

  try {
    const r = await callLLM(
      `Tóm tắt riêng CFP từng hội thảo bằng tiếng Việt. Mỗi mục tối đa 45 từ, 1–2 câu nêu chủ đề và loại bài nhận đăng. Chỉ dùng dữ liệu có thật. Chỉ trả JSON dạng {"1":"tóm tắt"}.\n${JSON.stringify(
        input
      )}`,
      modelId
    );

    summaries = JSON.parse(
      text(r?.answer)
        .replace(
          /^```(?:json)?\s*/i,
          ""
        )
        .replace(
          /```\s*$/,
          ""
        )
    );
  } catch (e) {
    console.warn(
      "Scholar CFP summary:",
      e?.message || e
    );
  }

  return cs.map((x, i) => ({
    ...x,
    cfp_summary:
      text(
        summaries?.[
          String(i + 1)
        ]
      )
        .replace(/\s+/g, " ")
        .slice(0, 300) ||
      text(
        first(
          x.topics,
          x.topic
        )
      ).slice(0, 250)
  }));
}

const recordKey = (req, ctx) => {
  const id = first(
    req?.body?.session_id,
    req?.sessionID
  );

  return id
    ? `${text(id)}|${text(
        ctx.project_id
      )}`
    : "";
};

function remember(req, ctx, cs, js) {
  const state = {
    conferences: cs,
    journals: js,
    time: Date.now()
  };

  if (req?.session) {
    req.session.scholarContext = state;
  }

  const key = recordKey(
    req,
    ctx
  );

  if (key) {
    RECORDS.set(key, state);

    if (RECORDS.size > 500) {
      RECORDS.delete(
        RECORDS.keys().next().value
      );
    }
  }
}

function prior(req, ctx) {
  const state =
    RECORDS.get(
      recordKey(req, ctx)
    ) ||
    req?.session?.scholarContext;

  return state &&
    Date.now() - state.time <
      RECORD_TTL
    ? state
    : null;
}

const previousAnswer = ctx =>
  ctx.history
    .slice()
    .reverse()
    .find(
      x =>
        x.role === "assistant" &&
        /##\s*(?:🎓|📚)|###\s*1\./.test(
          x.content
        )
    )?.content || "";

const lastTopic = ctx =>
  ctx.history
    .slice()
    .reverse()
    .find(
      x =>
        x.role === "user" &&
        kindOf(x.content) !==
          "general"
    )?.content || "";

const namedFromHistory = ctx =>
  previousAnswer(ctx).match(
    /###\s*\d+\.\s*(?:🎓|📚)?\s*\*\*([^*]+)\*\*/
  )?.[1]?.trim() || "";

async function selectForPaper(
  paper,
  cs,
  js,
  modelId
) {
  const candidates = [
    ...cs.map((x, i) => ({
      type: "conference",
      index: i + 1,
      title: title(
        x,
        "conference"
      ),
      topics: text(
        first(
          x.topics,
          x.fields,
          x.categories,
          x.cfp_text
        )
      ).slice(0, 750),
      deadline: x.deadline
    })),
    ...js.map((x, i) => ({
      type: "journal",
      index: i + 1,
      title: title(
        x,
        "journal"
      ),
      topics: text(
        first(
          x.areas,
          x.categories,
          x.fields,
          x.description
        )
      ).slice(0, 750)
    }))
  ];

  if (!candidates.length) {
    return {
      conferences: [],
      journals: []
    };
  }

  try {
    const r = await callLLM(
      `Chọn nơi đăng phù hợp THẬT SỰ. Loại nơi lệch chủ đề và hội thảo đã qua hạn. Chỉ trả JSON {"conferences":[1],"journals":[2]}; có thể trả mảng rỗng.\nBài báo:\n${paper}\nỨng viên:\n${JSON.stringify(
        candidates
      )}`,
      modelId
    );

    const parsed = JSON.parse(
      text(r?.answer)
        .replace(
          /^```(?:json)?\s*/i,
          ""
        )
        .replace(
          /```\s*$/,
          ""
        )
    );

    if (
      !Array.isArray(
        parsed.conferences
      ) ||
      !Array.isArray(
        parsed.journals
      )
    ) {
      throw new Error(
        "Invalid selection"
      );
    }

    return {
      conferences: cs.filter(
        (x, i) =>
          parsed.conferences.includes(
            i + 1
          ) &&
          (
            !x.deadline ||
            !Number.isFinite(
              Date.parse(
                x.deadline
              )
            ) ||
            Date.parse(
              x.deadline
            ) >= Date.now()
          )
      ),
      journals: js.filter(
        (_, i) =>
          parsed.journals.includes(
            i + 1
          )
      )
    };
  } catch (e) {
    console.warn(
      "Scholar venue selection:",
      e?.message || e
    );

    return {
      conferences: [],
      journals: []
    };
  }
}

async function retrievalQuery(
  q,
  ctx,
  modelId
) {
  if (
    kindOf(q) === "general" &&
    !isFollowup(q) &&
    !isContextual(q) &&
    !isAdvice(q)
  ) {
    return q;
  }

  const quartile =
    norm(q).match(
      /\bq[1-4]\b/
    )?.[0];

  const previous =
    lastTopic(ctx);

  if (
    quartile &&
    previous &&
    kindOf(q) === "journal"
  ) {
    return `${previous.replace(
      /\bq[1-4]\b/gi,
      quartile
    )}. ${q}`;
  }

  let result = q;

  try {
    const rewritten =
      await rewriteQuery(
        q,
        ctx.history
      );

    if (
      typeof rewritten ===
        "string" &&
      rewritten.trim()
    ) {
      result = rewritten.trim();
    }
  } catch (e) {
    console.warn(
      "Scholar rewrite:",
      e?.message || e
    );
  }

  if (
    kindOf(result) ===
      "general" &&
    previous &&
    isFollowup(q)
  ) {
    result = `${previous}. ${q}`;
  }

  const named =
    namedFromHistory(ctx);

  if (
    named &&
    matches(
      q,
      /\b(tren|do|nay|chi tiet|thong tin)\b/
    ) &&
    !norm(result).includes(
      norm(named)
    )
  ) {
    result += `. ${named}`;
  }

  const subject =
    scopeText(ctx);

  if (
    subject &&
    (
      isAdvice(q) ||
      isContextual(q)
    )
  ) {
    try {
      const r = await callLLM(
        `Viết MỘT câu truy vấn tạp chí/hội thảo bằng tiếng Việt và từ khóa tiếng Anh dựa trên đề tài/file. Giữ loại, Q1/Q2, quốc gia, năm. Chỉ xuất truy vấn, tối đa 220 ký tự.\nCâu hỏi: ${result}\nNgữ cảnh: ${subject}`,
        modelId
      );

      const candidate = text(
        r?.answer
      )
        .replace(/\s+/g, " ")
        .slice(0, 220);

      if (
        candidate &&
        kindOf(candidate) !==
          "general" &&
        (
          kindOf(q) ===
            "general" ||
          kindOf(q) ===
            kindOf(candidate)
        )
      ) {
        result = candidate;
      }
    } catch (e) {
      console.warn(
        "Scholar contextual query:",
        e?.message || e
      );
    }

    if (
      kindOf(result) !==
      "general"
    ) {
      result +=
        ` ${subject.slice(
          0,
          350
        )}`;
    }
  }

  return result;
}

async function searchWeb(
  query,
  kind
) {
  if (!SERPAPI_API_KEY) {
    return [];
  }

  let expanded;

  try {
    expanded =
      await expandScholarQueries(
        query
      );
  } catch (e) {
    console.warn(
      "Scholar query expansion:",
      e?.message || e
    );
  }

  const queries = (
    expanded?.queries?.length
      ? expanded.queries
      : [query]
  ).slice(0, 3);

  const batches =
    await Promise.allSettled(
      queries.map(
        async q => {
          const typed =
            kind === "journal"
              ? `${q} journal -conference -workshop`
              : kind ===
                  "conference"
                ? `${q} conference CFP -journal`
                : q;

          const params =
            new URLSearchParams({
              engine:
                "google",
              q: typed,
              num: "8",
              api_key:
                SERPAPI_API_KEY
            });

          const response =
            await fetch(
              `https://serpapi.com/search.json?${params}`,
              {
                signal:
                  AbortSignal.timeout(
                    15000
                  )
              }
            );

          if (!response.ok) {
            throw new Error(
              `SerpAPI HTTP ${response.status}`
            );
          }

          const data =
            await response.json();

          if (data.error) {
            throw new Error(
              data.error
            );
          }

          return (
            data.organic_results ||
            []
          );
        }
      )
    );

  const found = new Map();

  for (const batch of batches) {
    if (
      batch.status !==
      "fulfilled"
    ) {
      continue;
    }

    for (const x of batch.value) {
      if (
        !x.link ||
        !x.snippet ||
        found.has(x.link)
      ) {
        continue;
      }

      const heading = norm(
        `${x.title} ${x.link}`
      );

      if (
        kind === "journal" &&
        /\b(conference|workshop|symposium|hoi thao)\b/.test(
          heading
        )
      ) {
        continue;
      }

      if (
        kind ===
          "conference" &&
        /\b(journal ranking|journal quartile)\b/.test(
          heading
        )
      ) {
        continue;
      }

      found.set(x.link, {
        id: `W${found.size + 1}`,
        type: "web",
        title: text(x.title),
        url: x.link,
        content:
          text(x.snippet).slice(
            0,
            1500
          )
      });

      if (found.size === 5) {
        break;
      }
    }

    if (found.size === 5) {
      break;
    }
  }

  return [
    ...found.values()
  ];
}

const evidence = web =>
  web
    .map(
      x =>
        `[${x.id}] ${x.title}\nURL: ${x.url}\nTrích đoạn: ${x.content}`
    )
    .join("\n\n");

function webAnswer(
  answer,
  web
) {
  const ids = [
    ...new Set(
      [
        ...answer.matchAll(
          /\[W(\d+)\]/g
        )
      ].map(
        m =>
          `W${m[1]}`
      )
    )
  ];

  const used =
    web.filter(
      x =>
        ids.includes(
          x.id
        )
    );

  return used.length
    ? `${answer}\n\n**Nguồn tham khảo**\n${used
        .map(
          x =>
            `- [${x.id}] [${x.title}](${x.url})`
        )
        .join("\n")}`
    : answer;
}

function validAnswer(
  answer,
  kind,
  cs,
  js
) {
  if (
    !answer ||
    /===\s*(TẠP CHÍ|HỘI THẢO)|_qdrant|finalScore|baseScore/i.test(
      answer
    )
  ) {
    return false;
  }

  if (
    (cs.length || js.length) &&
    /\[W\d+\]|\*\*Nguồn tham khảo\*\*/i.test(
      answer
    )
  ) {
    return false;
  }

  if (
    kind === "journal" &&
    /##\s*🎓\s*Hội thảo/i.test(
      answer
    )
  ) {
    return false;
  }

  if (
    kind ===
      "conference" &&
    /##\s*📚\s*Tạp chí/i.test(
      answer
    )
  ) {
    return false;
  }

  return [
    ...cs.map(
      x =>
        title(
          x,
          "conference"
        )
    ),
    ...js.map(
      x =>
        title(
          x,
          "journal"
        )
    )
  ].every(
    x =>
      norm(answer).includes(
        norm(x)
      )
  );
}

export async function runScholarAgent(
  req,
  question,
  model_id,
  topk,
  history = []
) {
  const started = Date.now();

  const original = text(
    first(
      question,
      req?.body?.message,
      req?.body?.question
    )
  );

  const reply = (
    answer,
    domain,
    standalone,
    llm = null,
    sources = [],
    conferences = [],
    journals = []
  ) => ({
    answer,
    conferences,
    journals,
    sources,
    domain,
    standalone_question:
      standalone,
    model: {
      model_id:
        llm?.model_id ||
        model_id ||
        null,
      model:
        llm?.model ||
        null,
      latency:
        llm?.latency ??
        null,
      prompt_tokens:
        llm?.usage
          ?.prompt_tokens ??
        null,
      output_tokens:
        llm?.usage
          ?.output_tokens ??
        null
    },
    responseTimeMs:
      Date.now() -
      started
  });

  if (!original) {
    return reply(
      "Vui lòng nhập câu hỏi.",
      "general",
      ""
    );
  }

  try {
    const ctx =
      contextOf(
        req,
        history
      );

    // Chỉ ghi metadata, không ghi nội dung bài báo vào log.
    console.info(
      "Scholar document context:",
      {
        project_id:
          ctx.project_id ||
          null,
        documents:
          ctx.docs.map(d => ({
            name: d.name,
            chars: d.text.length,
            readable:
              hasDocumentBody(d)
          }))
      }
    );

    if (
      fileInventory(
        original
      )
    ) {
      return reply(
        inventory(
          req,
          ctx
        ),
        "general",
        original
      );
    }

    const paper =
      paperText(
        original,
        ctx
      );

    // Tên file hoặc URL không phải văn bản PDF.
    if (
      attachedPaper(
        original
      ) &&
      !articleDocuments(
        ctx
      ).length
    ) {
      const files =
        ctx.project?.files;

      const declared =
        Array.isArray(
          files
        )
          ? files.length
          : Boolean(files);

      return reply(
        declared
          ? "Tôi thấy dự án có file đính kèm nhưng request hiện chỉ có metadata, chưa có văn bản bài báo. Portal cần tải file bằng quyền truy cập của người dùng, trích xuất PDF rồi gửi nội dung trong `context.extra_data.document[].text` (hoặc `content`/`extracted_text`). PDF quét hoặc ảnh cần OCR trước."
          : "Tôi chưa nhận được văn bản bài báo trong request. URL hoặc `project_id` không phải nội dung PDF. Portal cần tải file, trích xuất văn bản và gửi trong `context.extra_data.document[].text` (hoặc `content`/`extracted_text`).",
        "general",
        original
      );
    }

    if (
      explainPrevious(
        original
      )
    ) {
      const saved =
        prior(
          req,
          ctx
        );

      const previous =
        previousAnswer(
          ctx
        );

      if (
        !saved &&
        !previous
      ) {
        return reply(
          "Tôi chưa thấy danh sách tạp chí hoặc hội thảo được nhắc tới trong lịch sử phiên này.",
          "general",
          original
        );
      }

      const facts =
        saved
          ? format(
              saved.conferences,
              saved.journals,
              true
            )
          : previous.slice(
              0,
              12000
            );

      const llm =
        await callLLM(
          `Trả lời bằng tiếng Việt vì sao nên hoặc không nên chọn TỪNG nơi trong danh sách trước. So sánh phạm vi, CFP và hạn nộp, nêu nơi lệch chủ đề hoặc hết hạn. Không gợi ý thêm nơi mới. Không khẳng định phù hợp nếu thiếu nội dung bài.\nBài báo:\n${paper || "Chưa có nội dung"}\nDanh sách trước:\n${facts}\nCâu hỏi: ${original}`,
          model_id
        );

      return reply(
        text(llm?.answer) ||
          "Tôi cần nội dung bài báo để đánh giá.",
        "general",
        original,
        llm
      );
    }

    if (
      isAdvice(
        original
      ) &&
      !paper
    ) {
      return reply(
        "Bạn gửi giúp tôi tiêu đề, tóm tắt, từ khóa và phương pháp bài báo, hoặc để Portal chuyển văn bản trích xuất từ file đính kèm vào ngữ cảnh.",
        "general",
        original
      );
    }

    const explicit =
      kindOf(
        original
      );

    const followup =
      isFollowup(
        original
      );

    const independent =
      explicit ===
        "general" &&
      !followup &&
      !isAdvice(
        original
      );

    const standalone =
      independent
        ? original
        : await retrievalQuery(
            original,
            ctx,
            model_id
          );

    let kind =
      independent
        ? "general"
        : explicit !==
            "general"
          ? explicit
          : kindOf(
              standalone
            );

    let preflight = null;

    if (
      kind ===
        "general" &&
      isDetail(
        original
      ) &&
      !independent
    ) {
      const result =
        await runAgent(
          standalone,
          topk,
          ctx.history
        );

      const named = (
        xs,
        k
      ) =>
        (xs || []).filter(
          x =>
            norm(
              title(
                x,
                k
              )
            ).length >= 8 &&
            norm(
              original
            ).includes(
              norm(
                title(
                  x,
                  k
                )
              )
            )
        );

      const cs = named(
        result?.conferences,
        "conference"
      );

      const js = named(
        result?.journals,
        "journal"
      );

      if (
        cs.length ||
        js.length
      ) {
        kind =
          cs.length &&
          js.length
            ? "both"
            : cs.length
              ? "conference"
              : "journal";

        preflight = {
          conferences: cs,
          journals: js
        };
      }
    }

    if (
      kind ===
        "general" &&
      followup
    ) {
      kind = kindOf(
        lastTopic(
          ctx
        )
      );
    }

    if (
      kind ===
        "general" &&
      isAdvice(
        original
      )
    ) {
      kind = "both";
    }

    if (
      kind ===
      "general"
    ) {
      const prompt = [
        "Trả lời câu hỏi hiện tại bằng tiếng Việt tự nhiên. Lịch sử chỉ giúp hiểu câu nối tiếp. Dùng hồ sơ, dự án và file khi liên quan. Không bịa thông tin.",
        ctx.profile
          ? `Hồ sơ: ${JSON.stringify(
              ctx.profile
            ).slice(
              0,
              1500
            )}`
          : "",
        scopeText(
          ctx
        ),
        ctx.history
          .map(
            x =>
              `${x.role}: ${x.content.slice(
                0,
                700
              )}`
          )
          .join(
            "\n"
          ),
        `Câu hỏi: ${original}`
      ]
        .filter(Boolean)
        .join("\n\n");

      const llm =
        await callLLM(
          prompt,
          model_id
        );

      return reply(
        text(
          llm?.answer
        ) ||
          "Tôi chưa thể trả lời lúc này.",
        "general",
        standalone,
        llm
      );
    }

    const found =
      preflight ||
      await runAgent(
        standalone,
        topk,
        ctx.history
      );

    let cs =
      kind ===
      "journal"
        ? []
        : found?.conferences ||
          [];

    let js =
      kind ===
      "conference"
        ? []
        : found?.journals ||
          [];

    if (
      isAdvice(
        original
      ) &&
      paper
    ) {
      const selected =
        await selectForPaper(
          paper,
          cs,
          js,
          model_id
        );

      cs =
        selected.conferences;

      js =
        selected.journals;
    }

    if (
      cs.length
    ) {
      cs =
        await summarizeCFP(
          cs,
          model_id
        );
    }

    if (
      cs.length ||
      js.length
    ) {
      remember(
        req,
        ctx,
        cs,
        js
      );
    }

    const sources = [
      ...cs.map(
        (x, i) => ({
          id: `C${i + 1}`,
          type:
            "conference",
          title:
            title(
              x,
              "conference"
            ),
          url:
            url(
              x,
              "conference"
            ),
          metadata: x
        })
      ),
      ...js.map(
        (x, i) => ({
          id: `J${i + 1}`,
          type:
            "journal",
          title:
            title(
              x,
              "journal"
            ),
          url:
            url(
              x,
              "journal"
            ),
          metadata: x
        })
      )
    ];

    const full =
      isDetail(
        original
      );

    const fallback =
      format(
        cs,
        js,
        full
      );

    if (
      fallback
    ) {
      const needsLLM =
        isAdvice(
          original
        ) ||
        full ||
        (
          isContextual(
            original
          ) &&
          (
            ctx.project ||
            ctx.profile ||
            ctx.docs.length
          )
        );

      if (
        !needsLLM
      ) {
        return reply(
          fallback,
          kind,
          standalone,
          null,
          sources,
          cs,
          js
        );
      }

      try {
        // Danh sách dùng CFP tóm tắt.
        // Câu hỏi chi tiết dùng CFP gốc.
        const promptCs =
          full
            ? cs
            : cs.map(
                x => ({
                  ...x,
                  cfp_text:
                    x.cfp_summary ||
                    "",
                  cfp: "",
                  description:
                    x.cfp_summary ||
                    "",
                  text: ""
                })
              );

        const base =
          buildScholarPrompt(
            original,
            promptCs,
            js,
            ctx
          );

        const cfp =
          full
            ? "Nếu hỏi chi tiết hội thảo, trình bày có căn cứ chủ đề, yêu cầu bản thảo, hạn nộp, cách gửi, phản biện, xuất bản; dẫn liên kết toàn văn."
            : "Khi liệt kê hội thảo, tóm tắt CFP trong 1–2 câu, không in toàn văn.";

        const advice =
          isAdvice(
            original
          )
            ? `\nBài báo:\n${paper}\nSo sánh từng nơi với nội dung bài. Giải thích cụ thể vì sao phù hợp, nơi nào lệch chủ đề, và có nên chọn hội thảo hay tạp chí. Không chỉ in danh sách.`
            : "";

        const llm =
          await callLLM(
            `${base}\n\n${cfp}${advice}`,
            model_id
          );

        const answer =
          text(
            llm?.answer
          );

        return reply(
          validAnswer(
            answer,
            kind,
            cs,
            js
          ) &&
          (
            !cs.length ||
            full ||
            answer.length <
              5000
          )
            ? answer
            : fallback,
          kind,
          standalone,
          llm,
          sources,
          cs,
          js
        );
      } catch (
        e
      ) {
        console.warn(
          "Scholar generation:",
          e?.message ||
            e
        );

        return reply(
          fallback,
          kind,
          standalone,
          null,
          sources,
          cs,
          js
        );
      }
    }

    // Chỉ dùng web khi không có kết quả CSDL.
    let web = [];

    try {
      web =
        await searchWeb(
          standalone,
          kind
        );
    } catch (
      e
    ) {
      console.warn(
        "Scholar web:",
        e?.message ||
          e
      );
    }

    if (
      !web.length
    ) {
      return reply(
        "Chưa tìm thấy kết quả phù hợp trong CSDL và chưa xác minh được nguồn web phù hợp.",
        kind,
        standalone
      );
    }

    const prompt = [
      `Trả lời bằng tiếng Việt, đúng loại ${kind}. Chỉ nêu thông tin nguồn xác nhận, dẫn [W1] sát nhận định. Không đoán ISSN, Q1, hạn nộp. Mỗi bản ghi một mục riêng.`,
      scopeText(
        ctx
      ),
      isAdvice(
        original
      )
        ? `Bài báo:\n${paper}`
        : "",
      ctx.profile
        ? `Hồ sơ: ${JSON.stringify(
            ctx.profile
          ).slice(
            0,
            900
          )}`
        : "",
      ctx.history
        .map(
          x =>
            `${x.role}: ${x.content.slice(
              0,
              500
            )}`
        )
        .join(
          "\n"
        ),
      `Câu hỏi: ${original}`,
      `Nguồn:\n${evidence(
        web
      )}`
    ]
      .filter(Boolean)
      .join("\n\n");

    const llm =
      await callLLM(
        prompt,
        model_id
      );

    const answer =
      text(
        llm?.answer
      );

    const grounded =
      validAnswer(
        answer,
        kind,
        [],
        []
      ) &&
      /\[W\d+\]/.test(
        answer
      );

    return reply(
      webAnswer(
        grounded
          ? answer
          : "Chưa xác minh được kết quả đáp ứng yêu cầu từ các nguồn web tìm thấy.",
        web
      ),
      kind,
      standalone,
      llm,
      grounded
        ? web.filter(
            x =>
              answer.includes(
                `[${x.id}]`
              )
          )
        : []
    );
  } catch (
    e
  ) {
    console.error(
      "Scholar service:",
      e
    );

    return reply(
      "Hệ thống đang gặp lỗi, vui lòng thử lại sau.",
      "error",
      original
    );
  }
}