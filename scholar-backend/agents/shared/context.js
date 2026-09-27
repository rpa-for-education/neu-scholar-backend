// agents/shared/context.js

const MAX_HISTORY_ITEMS = 10;
const MAX_HISTORY_CHARS_PER_ITEM = 2000;
const MAX_DOC_CHARS_PER_ITEM = 50000;
const MAX_DOCUMENTS = 10;

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readable(value) {
  if (typeof value === "string") return value.trim();

  if (Array.isArray(value)) {
    return value.map(readable).filter(Boolean).join(", ");
  }

  return "";
}

function firstText(...values) {
  return values.map(readable).find(Boolean) || "";
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function buildHistory(context, body) {
  const raw = Array.isArray(context.history)
    ? context.history
    : Array.isArray(body.history)
      ? body.history
      : [];

  return raw
    .filter(item =>
      item &&
      ["user", "assistant"].includes(item.role) &&
      typeof item.content === "string" &&
      item.content.trim()
    )
    .slice(-MAX_HISTORY_ITEMS)
    .map(item => ({
      role: item.role,
      content: item.content
        .trim()
        .slice(0, MAX_HISTORY_CHARS_PER_ITEM)
    }));
}

function buildProfile(context, body) {
  const raw = context.user_profile ?? body.user_profile;

  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    return null;
  }

  const profile = {
    email: cleanString(raw.email),
    full_name: cleanString(raw.full_name),
    display_name: cleanString(raw.display_name),
    position: cleanString(raw.position),
    academic_title: cleanString(raw.academic_title),
    academic_degree: cleanString(raw.academic_degree),
    department_name: cleanString(raw.department_name),
    direction: asArray(raw.direction)
      .map(readable)
      .filter(Boolean)
  };

  const hasData = Object.values(profile).some(value =>
    Array.isArray(value)
      ? value.length > 0
      : Boolean(value)
  );

  return hasData ? profile : null;
}

function buildProject(context, body) {
  const raw =
    context.project_info ??
    context.project ??
    body.project_info ??
    body.project;

  const projectId = firstText(
    context.project_id,
    body.project_id
  );

  if (typeof raw === "string") {
    return raw.trim() || projectId
      ? {
          id: projectId,
          name: raw.trim(),
          description: ""
        }
      : null;
  }

  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    return projectId
      ? {
          id: projectId,
          name: "",
          description: ""
        }
      : null;
  }

  const project = {
    id: firstText(projectId, raw.id),

    name: firstText(
      raw.name,
      raw.title,
      raw.project_name
    ),

    description: firstText(
      raw.description,
      raw.summary,
      raw.abstract
    ),

    abstract: firstText(
      raw.abstract,
      raw.summary
    ),

    objectives: firstText(
      raw.objectives,
      raw.objective,
      raw.goals
    ),

    methodology: firstText(
      raw.methodology,
      raw.methods,
      raw.method
    ),

    fields: firstText(
      raw.fields,
      raw.field
    ),

    tags: firstText(
      raw.tags,
      raw.keywords
    ),

    applicants: firstText(
      raw.applicants,
      raw.participants,
      raw.researchers
    ),

    organization: firstText(
      raw.organization,
      raw.institution
    ),

    files: asArray(
      raw.files ??
      raw.documents ??
      raw.attachments
    )
  };

  const hasData = Object.entries(project).some(
    ([key, value]) =>
      key === "files"
        ? value.length > 0
        : Boolean(value)
  );

  return hasData ? project : null;
}

function buildDocuments(context, body, project) {
  const sources = [
    context.extra_data?.document,
    context.document,
    context.files,
    body.extra_data?.document,
    body.document,
    body.files,
    project?.files
  ];

  const docs = [];
  const seen = new Set();

  for (const source of sources) {
    for (const raw of asArray(source)) {
      if (
        !raw ||
        typeof raw !== "object" ||
        Array.isArray(raw)
      ) {
        continue;
      }

      const content = firstText(
        raw.text,
        raw.extracted_text,
        raw.extractedText,
        raw.content,
        raw.file_content,
        raw.plain_text,
        raw.data?.text,
        raw.data?.content
      );

      // Tên file, URL và file ID không phải nội dung đã đọc được.
      if (!content) continue;

      const name = firstText(
        raw.name,
        raw.file_name,
        raw.filename,
        raw.original_name,
        raw.originalName
      ) || "document";

      const url = firstText(
        raw.url,
        raw.link
      );

      const key = `${name}\u0000${content}`;

      if (seen.has(key)) continue;
      seen.add(key);

      docs.push({
        name,
        url,
        text: content.slice(0, MAX_DOC_CHARS_PER_ITEM),
        truncated: content.length > MAX_DOC_CHARS_PER_ITEM
      });

      if (docs.length >= MAX_DOCUMENTS) {
        return docs;
      }
    }
  }

  return docs;
}

export function buildLLMContext(req) {
  const body =
    req?.body &&
    typeof req.body === "object"
      ? req.body
      : {};

  const context =
    body.context &&
    typeof body.context === "object"
      ? body.context
      : {};

  const project = buildProject(
    context,
    body
  );

  return {
    language:
      firstText(
        context.language,
        body.language
      ) || "vi",

    history: buildHistory(
      context,
      body
    ),

    profile: buildProfile(
      context,
      body
    ),

    project,

    project_id: firstText(
      context.project_id,
      body.project_id,
      project?.id
    ),

    docs: buildDocuments(
      context,
      body,
      project
    )
  };
}