// agents/shared/context.js


// =====================================================
// LIMITS
// =====================================================

// Portal có thể gửi nhiều history,
// chỉ giữ các lượt gần nhất.
const MAX_HISTORY_ITEMS = 10;

// Chặn một message quá dài.
// scholar.prompt.js cũng giới hạn lại lần nữa.
const MAX_HISTORY_CHARS_PER_ITEM = 2000;

// Không cắt document quá mạnh ở tầng context.
// scholar.prompt.js sẽ quản lý tổng document context = 12000 chars.
//
// Mục đích của giới hạn này chỉ là bảo vệ backend
// nếu Portal gửi một document text cực lớn.
const MAX_DOC_CHARS_PER_ITEM = 50000;

// Giới hạn số document nhận từ request.
const MAX_DOCUMENTS = 10;


// =====================================================
// HELPERS
// =====================================================

function cleanString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}


// =====================================================
// HISTORY
// =====================================================

function buildHistory(context) {

  if (
    !Array.isArray(context?.history)
  ) {
    return [];
  }


  return context.history
    .filter(
      h =>
        h &&
        ["user", "assistant"].includes(
          h.role
        ) &&
        typeof h.content === "string" &&
        h.content.trim()
    )
    .slice(-MAX_HISTORY_ITEMS)
    .map(h => ({
      role:
        h.role,

      content:
        h.content
          .trim()
          .slice(
            0,
            MAX_HISTORY_CHARS_PER_ITEM
          )
    }));
}


// =====================================================
// USER PROFILE
// =====================================================

function buildProfile(context) {

  const raw =
    context?.user_profile;


  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return null;
  }


  const directions =
    Array.isArray(raw.direction)
      ? raw.direction
          .filter(Boolean)
          .map(String)
          .map(v => v.trim())
          .filter(Boolean)
      : [];


  const profile = {

    email:
      cleanString(raw.email),

    full_name:
      cleanString(raw.full_name),

    display_name:
      cleanString(raw.display_name),

    position:
      cleanString(raw.position),

    academic_title:
      cleanString(raw.academic_title),

    academic_degree:
      cleanString(raw.academic_degree),

    department_name:
      cleanString(raw.department_name),

    direction:
      directions
  };


  const hasData =
    profile.email ||
    profile.full_name ||
    profile.display_name ||
    profile.position ||
    profile.academic_title ||
    profile.academic_degree ||
    profile.department_name ||
    profile.direction.length;


  return hasData
    ? profile
    : null;
}


// =====================================================
// PROJECT
// =====================================================

function buildProject(context) {

  const projectInfo =
    context?.project_info;


  // -----------------------------------------------------
  // Ưu tiên project_info
  // -----------------------------------------------------

  if (
    projectInfo &&
    typeof projectInfo === "object"
  ) {

    const project = {

      id:
        cleanString(
          context?.project_id
        ),

      name:
        cleanString(
          projectInfo.name
        ),

      description:
        cleanString(
          projectInfo.description
        )
    };


    if (
      project.id ||
      project.name ||
      project.description
    ) {
      return project;
    }
  }


  // -----------------------------------------------------
  // Fallback context.project
  // -----------------------------------------------------

  const projectName =
    cleanString(
      context?.project
    );


  if (projectName) {
    return {

      id:
        cleanString(
          context?.project_id
        ),

      name:
        projectName,

      description:
        ""
    };
  }


  return null;
}


// =====================================================
// DOCUMENTS
// =====================================================

function buildDocuments(context) {

  const documents =
    context
      ?.extra_data
      ?.document;


  if (
    !Array.isArray(documents)
  ) {
    return [];
  }


  return documents
    .filter(
      d =>
        d &&
        typeof d.text === "string" &&
        d.text.trim()
    )
    .slice(
      0,
      MAX_DOCUMENTS
    )
    .map(d => {

      const rawText =
        d.text.trim();


      return {

        name:
          cleanString(d.name) ||
          "document",

        // Giữ URL để sau này có thể dùng
        // cho citation / metadata nếu cần.
        url:
          cleanString(d.url),

        text:
          rawText.slice(
            0,
            MAX_DOC_CHARS_PER_ITEM
          ),

        truncated:
          rawText.length >
          MAX_DOC_CHARS_PER_ITEM
      };
    });
}


// =====================================================
// BUILD LLM CONTEXT
// =====================================================

export function buildLLMContext(req) {

  const context =
    req?.body?.context &&
    typeof req.body.context === "object"
      ? req.body.context
      : {};


  const history =
    buildHistory(context);


  const profile =
    buildProfile(context);


  const project =
    buildProject(context);


  const docs =
    buildDocuments(context);


  return {

    // Ngôn ngữ Portal gửi.
    language:
      cleanString(
        context.language
      ) ||
      "vi",

    history,

    profile,

    project,

    docs
  };
}