const state = {
  catalog: null,
  weekly: null,
  relations: null,
  knowledgeMap: null,
  processing: null,
  itemMap: new Map(),
  activeView: "list",
  activeNoteId: null,
  detailHistory: [],
  expandedMapNodes: new Set(),
  mapExpansionInitialized: false,
  processingPlanMinutes: 90,
  filters: {
    search: "",
    readStatus: "all",
    value: "all",
    knowledgeType: "all",
    topic: "all",
    stars: "all",
    sort: "stars",
  },
};

const TYPE_ORDER = ["tool", "opinion", "method", "case", "inspiration"];
const SCORE_LABELS = {
  engagement: "互动",
  actionability: "行动",
  relevance: "相关",
  informationDensity: "信息",
  novelty: "新颖",
};
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeUrl(value) {
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin === window.location.origin || ["http:", "https:"].includes(url.protocol)) {
      return url.href;
    }
  } catch {
    return "";
  }
  return "";
}

function formatDate(value, includeTime = false) {
  if (!value) return "未知";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
}

function showToast(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    let message = "操作失败，请稍后重试。";
    try {
      message = (await response.json()).error || message;
    } catch {
      // Keep the fallback message.
    }
    throw new Error(message);
  }
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("application/json") ? response.json() : response.text();
}

function applyBootstrap(data) {
  state.catalog = data.catalog;
  state.weekly = data.weekly;
  state.relations = data.relations;
  state.knowledgeMap = data.knowledgeMap;
  state.processing = data.processing || null;
  state.itemMap = new Map(data.catalog.items.map((item) => [item.noteId, item]));
}

async function loadData() {
  try {
    applyBootstrap(await apiRequest("/api/bootstrap"));
    populateTopicFilter();
    renderAll();
    $("#loadingScreen").classList.add("is-hidden");
  } catch (error) {
    $("#loadingScreen p").textContent = `载入失败：${error.message}`;
    showToast(error.message, true);
  }
}

function renderAll() {
  renderHeaderStats();
  renderFilterCounts();
  renderList();
  renderWeekly();
  renderMapLegend();
  renderKnowledgeMap();
  renderProcessingDashboard();
  if (state.activeNoteId) {
    const item = state.itemMap.get(state.activeNoteId);
    if (item) renderDetail(item);
  }
}

function renderHeaderStats() {
  const { stats, generatedAt } = state.catalog;
  const fullyRead = stats.byReadStatus.read || 0;
  const progress = stats.total
    ? Math.round((fullyRead / stats.total) * 100)
    : 0;
  $("#readProgressNumber").textContent = `${progress}%`;
  $("#readProgressBar").style.width = `${progress}%`;
  $("#readProgressMeta").textContent = `${fullyRead} / ${stats.total} 已读`;
  $("#weeklyTabCount").textContent = state.weekly.items.length;
  $("#lastGenerated").textContent = `索引更新于 ${formatDate(generatedAt, true)}`;
  const mapNewCount = state.knowledgeMap?.root?.newCount || 0;
  const mapTabNew = $("#mapTabNew");
  mapTabNew.textContent = `NEW ${mapNewCount}`;
  mapTabNew.hidden = mapNewCount === 0;
}

function renderFilterCounts() {
  const counts = state.catalog.stats.byReadStatus;
  $("#filterCountAll").textContent = state.catalog.stats.total;
  $("#filterCountUnread").textContent = counts.unread || 0;
  $("#filterCountRead").textContent = counts.read || 0;
  $("#filterCountSkipped").textContent = counts.skipped || 0;
}

function populateTopicFilter() {
  const select = $("#topicFilter");
  const current = state.filters.topic;
  const topics = Object.keys(state.catalog.stats.byTopic);
  select.innerHTML = [
    '<option value="all">全部主题</option>',
    ...topics.map(
      (topic) => `<option value="${escapeHtml(topic)}">${escapeHtml(topic)}</option>`,
    ),
  ].join("");
  select.value = topics.includes(current) ? current : "all";
}

function filteredItems() {
  const query = state.filters.search.trim().toLowerCase();
  const items = state.catalog.items.filter((item) => {
    if (
      state.filters.readStatus !== "all" &&
      item.readStatus !== state.filters.readStatus
    ) {
      return false;
    }
    if (
      state.filters.value !== "all" &&
      item.readingValue.tier !== state.filters.value
    ) {
      return false;
    }
    if (
      state.filters.knowledgeType !== "all" &&
      item.knowledgeType !== state.filters.knowledgeType
    ) {
      return false;
    }
    if (state.filters.topic !== "all" && item.topic !== state.filters.topic) {
      return false;
    }
    if (
      state.filters.stars !== "all" &&
      (state.filters.stars === "0"
        ? item.stars !== 0
        : item.stars < Number(state.filters.stars))
    ) {
      return false;
    }
    if (!query) return true;
    const haystack = [
      item.title,
      item.sourceTitle,
      item.summary,
      item.author,
      item.topic,
      item.category,
      ...item.searchTags,
      ...item.references.map((reference) => reference.name),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });

  const compare = {
    stars: (left, right) =>
      right.stars - left.stars ||
      Number(right.isNew) - Number(left.isNew) ||
      new Date(right.collectedAt).valueOf() - new Date(left.collectedAt).valueOf(),
    latest: (left, right) =>
      Number(right.isNew) - Number(left.isNew) ||
      new Date(right.collectedAt).valueOf() - new Date(left.collectedAt).valueOf(),
    saves: (left, right) => right.engagement.saves - left.engagement.saves,
    likes: (left, right) => right.engagement.likes - left.engagement.likes,
  }[state.filters.sort];
  return items.sort(compare);
}

function itemImage(item, className = "") {
  if (!item.previewImage) {
    return `<span class="row-image-fallback ${className}">${escapeHtml(item.knowledgeTypeShortLabel.slice(0, 1))}</span>`;
  }
  return `<img class="${className}" src="${escapeHtml(item.previewImage)}" alt="${escapeHtml(item.title)}" loading="lazy" />`;
}

function badgeMarkup(item, includeStatus = true) {
  return `
    <span class="badge" style="--badge-color:${item.knowledgeTypeColor}">
      ${escapeHtml(item.knowledgeTypeLabel)}
    </span>
    <span class="badge status-badge" data-status="${item.readStatus}">
      ${escapeHtml(item.readStatusLabel)}
    </span>
    ${item.isNew ? '<span class="new-indicator">NEW</span>' : ""}
    ${item.stars ? `<span class="star-badge" aria-label="${item.stars} 星">${"★".repeat(item.stars)}</span>` : ""}
    ${includeStatus && item.pinned ? '<span class="badge status-badge">本周固定</span>' : ""}
  `;
}

function starControlMarkup(item, compact = false) {
  return `
    <button
      class="star-control ${compact ? "is-compact" : ""}"
      data-star-action
      data-note-id="${item.noteId}"
      type="button"
      aria-label="当前 ${item.stars} 星，点击切换"
      title="点击在未标星、一星、两星之间切换"
    >
      <span aria-hidden="true">${item.stars ? "★".repeat(item.stars) : "☆"}</span>
      ${compact ? "" : `<small>${item.stars ? `${item.stars} 星` : "标星"}</small>`}
    </button>
  `;
}

function renderList() {
  const items = filteredItems();
  $("#listResultCount").textContent = items.length;
  if (!items.length) {
    $("#contentList").innerHTML = `
      <div class="empty-state">
        <strong>没有匹配的收藏</strong>
        <span>换一个筛选条件，或者清除搜索词。</span>
      </div>
    `;
    return;
  }

  $("#contentList").innerHTML = items
    .map(
      (item) => `
        <article
          class="content-row"
          data-note-id="${item.noteId}"
          tabindex="0"
          style="--type-color:${item.knowledgeTypeColor}"
          aria-label="查看 ${escapeHtml(item.title)}"
        >
          <div class="row-image">
            ${itemImage(item)}
            <span class="row-image-type">${item.sourceTypeLabel}</span>
          </div>
          <div class="row-main">
            <div class="row-badges">${badgeMarkup(item)}</div>
            <h3>${escapeHtml(item.title)}</h3>
            <p class="row-summary">${escapeHtml(item.summary)}</p>
            <div class="row-meta">
              <span>${escapeHtml(item.topic)}</span>
              <span>收藏 ${escapeHtml(item.engagement.display.saves)}</span>
              <span>点赞 ${escapeHtml(item.engagement.display.likes)}</span>
              <span>${formatDate(item.collectedAt)}</span>
            </div>
          </div>
          <div class="row-value">
            <div class="value-score">
              <strong>${item.readingValue.score}</strong>
              <span>READING VALUE</span>
              <em class="value-tier" data-tier="${item.readingValue.tier}">
                ${escapeHtml(item.readingValue.tierLabel)}
              </em>
            </div>
            <div class="quick-actions">
              ${starControlMarkup(item, true)}
              <button data-note-action="read" data-note-id="${item.noteId}" type="button">
                ${item.readStatus === "read" ? "已读" : "标为已读"}
              </button>
            </div>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderWeekly() {
  const weeklyItems = state.weekly.items
    .map((weekly) => ({
      weekly,
      item: state.itemMap.get(weekly.noteId),
    }))
    .filter(({ item }) => item);
  const completed = weeklyItems.filter(({ item }) => item.readStatus === "read").length;
  $("#weeklyProgressLabel").textContent = `${completed} / ${weeklyItems.length}`;
  $("#weeklyGrid").innerHTML = weeklyItems
    .map(
      ({ item, weekly }) => `
        <article
          class="weekly-card ${item.readStatus === "read" ? "is-complete" : ""}"
          data-note-id="${item.noteId}"
          tabindex="0"
        >
          <div class="weekly-image">
            <span class="weekly-rank">${weekly.rank}</span>
            ${itemImage(item)}
          </div>
          <div class="weekly-body">
            <div class="row-badges">${badgeMarkup(item)}</div>
            <h3>${escapeHtml(item.title)}</h3>
            <p class="weekly-reason">${escapeHtml(weekly.reason)}</p>
            <div class="weekly-footer">
              <span>价值 ${item.readingValue.score} · ${escapeHtml(item.readingValue.tierLabel)}</span>
              <div class="quick-actions">
                ${starControlMarkup(item, true)}
                <button data-note-action="read" data-note-id="${item.noteId}" type="button">
                  ${item.readStatus === "read" ? "已读" : "标为已读"}
                </button>
              </div>
            </div>
          </div>
        </article>
      `,
    )
    .join("");
}

const PROCESSING_BUCKET_COLORS = {
  "text-fast": "#0f766e",
  "image-light": "#2563eb",
  "image-heavy": "#7c3aed",
  "video-short": "#ea580c",
  "video-medium": "#c82937",
  "video-long": "#1d1d1b",
  "video-unknown": "#979187",
};

function processingPlanFor(minutes) {
  if (minutes <= 30) {
    return {
      target: 6,
      quick: "6 条文字快速 / 轻图片",
      deep: "暂不安排重图片与长视频",
      note: "适合只做一次快速复核。",
    };
  }
  if (minutes <= 60) {
    return {
      target: 12,
      quick: "8 条文字快速 / 轻图片",
      deep: "4 条短视频或重图片",
      note: "先清掉低成本内容，再留一小段深度处理时间。",
    };
  }
  if (minutes <= 90) {
    return {
      target: 15,
      quick: "10 条文字快速 / 轻图片 / 短视频",
      deep: "5 条重图片，或 2–3 条中视频",
      note: "这是当前推荐节奏，兼顾速度和复核质量。",
    };
  }
  return {
    target: 20,
    quick: "12 条文字快速 / 轻图片 / 短视频",
    deep: "8 条重图片，或 3–4 条中视频，或 1 条长视频",
    note: "适合专门留出一段清洗时间的日期。",
  };
}

function processingPipelineMarkup(stage) {
  const progress = stage.denominator
    ? Math.min(100, Math.round((stage.count / stage.denominator) * 100))
    : 0;
  const statusLabel = {
    complete: "完成",
    partial: "边界已知",
    "in-progress": "进行中",
  }[stage.status] || "待处理";
  return `
    <li class="processing-stage" data-stage-status="${escapeHtml(stage.status)}">
      <span class="processing-stage-mark" aria-hidden="true"></span>
      <div class="processing-stage-main">
        <div>
          <strong>${escapeHtml(stage.label)}</strong>
          <em>${statusLabel}</em>
        </div>
        <div class="processing-stage-track" aria-hidden="true">
          <i style="--stage-progress:${progress}%"></i>
        </div>
      </div>
      <span class="processing-stage-count">
        <strong>${formatNumber(stage.count)}</strong>
        <small>/ ${formatNumber(stage.denominator)}</small>
      </span>
    </li>
  `;
}

function renderProcessingDashboard() {
  const root = $("#processingDashboard");
  if (!root) return;
  const processing = state.processing;
  if (!processing) {
    root.innerHTML = `
      <div class="empty-state">
        <strong>还没有快速盘点数据</strong>
        <span>先运行盘点脚本，工作台只会读取聚合结果，不会自动抓取收藏。</span>
      </div>
    `;
    return;
  }

  const archivedStage = processing.pipeline.find(
    (stage) => stage.id === "archived",
  );
  const enrichedStage = processing.pipeline.find(
    (stage) => stage.id === "enriched",
  );
  const archivedProgress = processing.inventory.fetchableCount
    ? Math.round(
        (archivedStage.count / processing.inventory.fetchableCount) * 1_000,
      ) / 10
    : 0;
  const plan = processingPlanFor(state.processingPlanMinutes);
  const knownMediaTotal =
    processing.media.known.image +
    processing.media.known.video +
    processing.media.known.unknown;
  const imagePercent = knownMediaTotal
    ? Math.round((processing.media.known.image / knownMediaTotal) * 1_000) / 10
    : 0;
  const videoPercent = knownMediaTotal
    ? Math.round((processing.media.known.video / knownMediaTotal) * 1_000) / 10
    : 0;
  const videoProjection = processing.workload.videoProjection;
  const capturedAt = formatDate(
    processing.inventory.sourceCapturedAt || processing.generatedAt,
    true,
  );

  root.innerHTML = `
    <div class="processing-summary-grid">
      <article class="processing-stat processing-stat-primary">
        <span>已知收藏</span>
        <strong>${formatNumber(processing.inventory.knownCount)}</strong>
        <small>页面标称 ${formatNumber(processing.inventory.expectedCount)} 条</small>
      </article>
      <article class="processing-stat">
        <span>图文</span>
        <strong>${formatNumber(processing.media.known.image)}</strong>
        <small>${imagePercent}% · 含 ${processing.media.blocked.image} 条受阻</small>
      </article>
      <article class="processing-stat">
        <span>视频</span>
        <strong>${formatNumber(processing.media.known.video)}</strong>
        <small>${videoPercent}% · 当前主要工作量</small>
      </article>
      <article class="processing-stat">
        <span>待归档</span>
        <strong>${formatNumber(processing.planning.backlogCount)}</strong>
        <small>已归档 ${formatNumber(archivedStage.count)} 条 · ${archivedProgress}%</small>
      </article>
    </div>

    <aside class="processing-boundary">
      <div>
        <span class="processing-boundary-label">数据口径</span>
        <strong>
          ${formatNumber(processing.inventory.expectedCount)} 页面标称
          ≠ ${formatNumber(processing.inventory.knownCount)} 已知
          ≠ ${formatNumber(processing.inventory.fetchableCount)} 可处理
        </strong>
      </div>
      <p>
        ${formatNumber(processing.inventory.unresolvedCount)} 条当前网页未暴露，
        ${formatNumber(processing.inventory.blockedCount)} 条缺少正文入口；不会把它们误报为已完成。
      </p>
      <small>快照：${capturedAt} · 已知覆盖 ${processing.quality.completeness}%</small>
    </aside>

    <div class="processing-layout">
      <section class="processing-panel processing-media-panel">
        <div class="processing-panel-heading">
          <div>
            <span>CONTENT MIX</span>
            <h3>内容结构</h3>
          </div>
          <small>${processing.media.knownVideoShare}% 是视频</small>
        </div>
        <div class="media-ratio" aria-label="图文与视频比例">
          <span style="--ratio:${imagePercent}%" data-media="image"></span>
          <span style="--ratio:${videoPercent}%" data-media="video"></span>
        </div>
        <div class="media-ratio-legend">
          <span><i data-media="image"></i>图文 ${formatNumber(processing.media.known.image)}</span>
          <span><i data-media="video"></i>视频 ${formatNumber(processing.media.known.video)}</span>
        </div>
        <div class="processing-divider"></div>
        <div class="processing-panel-heading processing-panel-heading-compact">
          <div>
            <span>VIDEO LENGTH</span>
            <h3>视频长短分布</h3>
          </div>
          <em>样本估算</em>
        </div>
        <div class="duration-list">
          <div>
            <span>短视频</span>
            <strong>${formatNumber(videoProjection.short)}</strong>
            <small>预计 ≤ 5 分钟</small>
          </div>
          <div>
            <span>中视频</span>
            <strong>${formatNumber(videoProjection.medium)}</strong>
            <small>预计 5–15 分钟</small>
          </div>
          <div>
            <span>长视频</span>
            <strong>${formatNumber(videoProjection.long)}</strong>
            <small>预计 &gt; 15 分钟</small>
          </div>
        </div>
        <p class="processing-footnote">
          以上按 ${videoProjection.sampleSize} 条已归档视频的转写长度外推；
          剩余 ${formatNumber(videoProjection.remainingVideoCount)} 条视频完成轻量预检后才会变成精确数。
        </p>
      </section>

      <section class="processing-panel processing-pipeline-panel">
        <div class="processing-panel-heading">
          <div>
            <span>PIPELINE</span>
            <h3>处理管线</h3>
          </div>
          <small>${formatNumber(enrichedStage.count)} 条完成深度清洗</small>
        </div>
        <ol class="processing-pipeline">
          ${processing.pipeline.map(processingPipelineMarkup).join("")}
        </ol>
        <div class="processing-next-gate">
          <span>当前瓶颈</span>
          <strong>${formatNumber(processing.planning.backlogCount)} 条尚未完成轻量预检与归档</strong>
          <small>先建立成本标签，再决定是否下载原图、视频和运行 OCR / 转写。</small>
        </div>
      </section>

      <section class="processing-panel processing-workload-panel">
        <div class="processing-panel-heading">
          <div>
            <span>WORKLOAD</span>
            <h3>清洗成本分桶</h3>
          </div>
          <small>已归档样本 ${formatNumber(processing.workload.archivedSampleSize)} 条</small>
        </div>
        <div class="workload-grid">
          ${processing.workload.buckets
            .filter((bucket) => bucket.id !== "video-unknown" || bucket.count)
            .map(
              (bucket) => `
                <article
                  class="workload-card"
                  style="--bucket-color:${PROCESSING_BUCKET_COLORS[bucket.id] || "#979187"}"
                >
                  <span>${escapeHtml(bucket.label)}</span>
                  <strong>${formatNumber(bucket.count)}</strong>
                  <p>${escapeHtml(bucket.description)}</p>
                  <small>${bucket.confidence === "confirmed" ? "已确认" : "样本估算"}</small>
                </article>
              `,
            )
            .join("")}
          <article class="workload-card workload-card-pending">
            <span>待预检</span>
            <strong>${formatNumber(processing.workload.pending.requiresInspection)}</strong>
            <p>尚未获得精确图片数或视频时长</p>
            <small>下一步先处理这里</small>
          </article>
        </div>
      </section>

      <section class="processing-panel processing-priority-panel">
        <div class="processing-panel-heading">
          <div>
            <span>PRIORITY DRAFT</span>
            <h3>不平均处理全部收藏</h3>
          </div>
          <small>容量草案，不是逐条分类结果</small>
        </div>
        <div class="priority-stack">
          ${processing.priorityDraft.tiers
            .map(
              (tier) => `
                <div class="priority-tier" data-priority="${tier.id}">
                  <span>${tier.id}</span>
                  <div>
                    <strong>${escapeHtml(tier.label)}</strong>
                    <small>${escapeHtml(tier.treatment)}</small>
                  </div>
                  <em>${formatNumber(tier.targetCount)} 条</em>
                </div>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="processing-panel processing-plan-panel">
        <div class="processing-panel-heading">
          <div>
            <span>DAILY PLAN</span>
            <h3>今天留多少时间？</h3>
          </div>
          <small>只生成计划，不自动执行</small>
        </div>
        <div class="processing-time-options" role="group" aria-label="每日清洗时间">
          ${[30, 60, 90, 120]
            .map(
              (minutes) => `
                <button
                  class="${state.processingPlanMinutes === minutes ? "is-active" : ""}"
                  data-processing-minutes="${minutes}"
                  type="button"
                >${minutes} 分钟</button>
              `,
            )
            .join("")}
        </div>
        <div class="processing-plan-result">
          <span>建议目标</span>
          <strong>${plan.target}<small>条 / 今天</small></strong>
          <div>
            <p>${escapeHtml(plan.quick)}</p>
            <p>${escapeHtml(plan.deep)}</p>
          </div>
          <em>${escapeHtml(plan.note)}</em>
        </div>
        <button class="primary-button processing-plan-button" data-generate-processing-plan type="button">
          生成今日计划
        </button>
      </section>

      <section class="processing-panel processing-automation-panel">
        <div class="processing-panel-heading">
          <div>
            <span>AUTOMATION</span>
            <h3>自动化留到下一步</h3>
          </div>
          <em class="processing-disabled-badge">未启用</em>
        </div>
        <p>
          这一版只把入口、状态和边界搭好，不会在后台继续抓取，也不会创建定时任务。
        </p>
        <div class="automation-list">
          ${processing.automation.availableNext
            .map(
              (item) => `
                <div>
                  <span aria-hidden="true"></span>
                  <strong>${escapeHtml(item)}</strong>
                  <small>下一阶段</small>
                </div>
              `,
            )
            .join("")}
        </div>
      </section>
    </div>
  `;
}

const MAP_BRANCH_COLORS = [
  "#c82937",
  "#2563eb",
  "#7c3aed",
  "#059669",
  "#d97706",
  "#db2777",
  "#0f766e",
  "#6b7280",
];

function newIndicatorMarkup(count) {
  return count
    ? `<em class="new-indicator">NEW ${count}</em>`
    : "";
}

function renderMapLegend() {
  $("#mapLegend").innerHTML = TYPE_ORDER.map((type) => {
    const info = state.catalog.labels.knowledgeTypes[type];
    return `
      <span class="legend-item">
        <i class="legend-dot" style="--legend-color:${info.color}"></i>
        ${escapeHtml(info.label)}
      </span>
    `;
  }).join("");
}

function walkMapNodes(node, callback) {
  callback(node);
  for (const child of node.children || []) walkMapNodes(child, callback);
}

function initializeMapExpansion() {
  if (state.mapExpansionInitialized || !state.knowledgeMap?.root) return;
  for (const node of state.knowledgeMap.root.children) {
    if (node.kind === "category") state.expandedMapNodes.add(node.nodeId);
  }
  state.mapExpansionInitialized = true;
}

function renderMapLeaf(node, accent) {
  const item = state.itemMap.get(node.noteId);
  if (!item || item.readStatus === "skipped") return "";
  return `
    <li class="map-tree-item map-tree-leaf">
      <article
        class="map-knowledge-card"
        data-note-id="${item.noteId}"
        data-map-leaf
        data-map-node-id="${node.nodeId}"
        data-new-count="${node.newCount}"
        tabindex="0"
        style="--type-color:${item.knowledgeTypeColor};--branch-accent:${accent}"
      >
        <div class="map-card-topline">
          <span class="map-type-label">${escapeHtml(item.knowledgeTypeShortLabel)}</span>
          ${newIndicatorMarkup(node.newCount)}
          ${starControlMarkup(item, true)}
        </div>
        <h4>${escapeHtml(item.title)}</h4>
        <p>${escapeHtml(item.summary)}</p>
        <div class="map-card-meta">
          <span>${escapeHtml(item.readStatusLabel)}</span>
          <span>${item.stars ? `${"★".repeat(item.stars)} ${item.stars} 星` : "未标星"}</span>
          <strong>价值 ${item.readingValue.score}</strong>
        </div>
      </article>
    </li>
  `;
}

function mapNodeIsVisible(node) {
  if (node.kind === "item") {
    const item = state.itemMap.get(node.noteId);
    return Boolean(item && item.readStatus !== "skipped");
  }
  return (node.children || []).some(mapNodeIsVisible);
}

function renderMapCategory(node, level, accent) {
  const expanded = state.expandedMapNodes.has(node.nodeId);
  const visibleChildren = (node.children || []).filter(mapNodeIsVisible);
  const hasChildren = visibleChildren.length > 0;
  return `
    <li class="map-tree-item map-tree-category" style="--branch-accent:${accent}">
      <button
        class="map-category-node ${expanded ? "is-expanded" : ""}"
        data-map-toggle
        data-map-node-id="${escapeHtml(node.nodeId)}"
        data-new-count="${node.newCount}"
        type="button"
        aria-expanded="${expanded}"
      >
        <span class="map-chevron" aria-hidden="true">${hasChildren ? (expanded ? "−" : "+") : "·"}</span>
        <span class="map-category-title">
          <strong>${escapeHtml(node.label)}</strong>
          <small>${node.count} 条 · 未读 ${node.unreadCount} · 标星 ${node.starredCount}</small>
        </span>
        ${newIndicatorMarkup(node.newCount)}
      </button>
      ${
        expanded && hasChildren
          ? `
            <ul class="map-tree-children" data-map-level="${level + 1}">
              ${visibleChildren
                .map((child) =>
                  child.kind === "item"
                    ? renderMapLeaf(child, accent)
                    : renderMapCategory(child, level + 1, accent),
                )
                .join("")}
            </ul>
          `
          : ""
      }
    </li>
  `;
}

function renderKnowledgeMap() {
  if (!state.knowledgeMap?.root) return;
  initializeMapExpansion();
  const { root } = state.knowledgeMap;
  const rootNew = $("#mapRootNew");
  rootNew.textContent = `NEW ${root.newCount}`;
  rootNew.hidden = root.newCount === 0;

  const visibleRoots = root.children.filter(mapNodeIsVisible);
  $("#knowledgeMapTree").innerHTML = visibleRoots.length
    ? `
      <ul class="map-tree-root">
        ${visibleRoots
          .map((node, index) =>
            renderMapCategory(
              node,
              1,
              MAP_BRANCH_COLORS[index % MAP_BRANCH_COLORS.length],
            ),
          )
          .join("")}
      </ul>
    `
    : `
      <div class="empty-state">
        <strong>知识地图还是空的</strong>
        <span>先把清洗完成的 Markdown 放入本地知识库，再点击刷新。</span>
      </div>
    `;
}

async function acknowledgeMapNode(nodeId) {
  try {
    const data = await apiRequest("/api/knowledge-map/acknowledge", {
      method: "POST",
      body: JSON.stringify({ nodeId }),
    });
    applyBootstrap(data);
    renderAll();
  } catch (error) {
    showToast(error.message, true);
  }
}

function relatedItems(noteId) {
  return state.relations.edges
    .filter((edge) => edge.source === noteId || edge.target === noteId)
    .sort((left, right) => right.score - left.score)
    .map((edge) => ({
      edge,
      item: state.itemMap.get(edge.source === noteId ? edge.target : edge.source),
    }))
    .filter(({ item }) => item);
}

function referenceMarkup(reference) {
  const url = safeUrl(reference.url);
  return `
    <div class="reference-item">
      <strong>${escapeHtml(reference.name)}</strong>
      <span>
        ${escapeHtml(reference.description || reference.type || "专有名词 / 参考对象")}
        ${url ? ` · <a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">访问链接</a>` : ""}
      </span>
    </div>
  `;
}

function renderDetail(item) {
  const related = relatedItems(item.noteId);
  const previousEntry = state.detailHistory.at(-1);
  const previousItem = previousEntry
    ? state.itemMap.get(previousEntry.noteId)
    : null;
  const interactionText = [
    `点赞 ${item.engagement.display.likes}`,
    `收藏 ${item.engagement.display.saves}`,
    `评论 ${item.engagement.display.comments}`,
    `分享 ${item.engagement.display.shares}`,
  ].join(" · ");
  const sourceUrl = safeUrl(item.canonicalUrl);
  const authorUrl = safeUrl(item.authorUrl);
  const scoreRows = Object.entries(item.readingValue.breakdown)
    .map(
      ([key, score]) => `
        <div class="score-row">
          <span>${SCORE_LABELS[key]}</span>
          <span class="score-bar"><i style="--score:${score}%"></i></span>
          <strong>${score}</strong>
        </div>
      `,
    )
    .join("");
  const gallery = item.sourceType === "image" && item.images.length
    ? `
      <section class="drawer-section">
        <h3>原图 · ${item.images.length} 张</h3>
        <div class="image-gallery">
          ${item.images
            .map(
              (image) => `
                <a href="${escapeHtml(image.url)}" target="_blank" aria-label="放大查看第 ${image.index} 张图片">
                  <img src="${escapeHtml(image.url)}" alt="${escapeHtml(item.title)} 第 ${image.index} 张" loading="lazy" />
                </a>
              `,
            )
            .join("")}
        </div>
      </section>
    `
    : "";
  const translation = item.translatedText
    ? `
      <details class="drawer-details" open>
        <summary>英文内容速译</summary>
        <p>${escapeHtml(item.translatedText)}</p>
      </details>
    `
    : "";
  const transcript =
    item.sourceType === "video" && item.transcript
      ? `
        <details class="drawer-details" open>
          <summary>视频旁白整理</summary>
          <p>${escapeHtml(item.transcript)}</p>
        </details>
      `
      : "";

  $("#detailContent").innerHTML = `
    <div class="drawer-content">
      ${
        previousItem
          ? `
            <nav class="drawer-back-nav" aria-label="相关内容导航">
              <button class="drawer-back-button" data-detail-back type="button">
                ← 返回
                <span>${escapeHtml(previousItem.title)}</span>
              </button>
            </nav>
          `
          : ""
      }
      ${
        item.previewImage
          ? `
            <div class="drawer-cover">
              <img src="${escapeHtml(item.previewImage)}" alt="${escapeHtml(item.title)}" />
              ${
                item.sourceType === "video" && sourceUrl
                  ? `<a class="video-watch-link" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">观看原视频 ↗</a>`
                  : ""
              }
            </div>
          `
          : ""
      }
      <div class="row-badges">${badgeMarkup(item)}</div>
      <h2 id="drawerTitle">${escapeHtml(item.title)}</h2>
      <p class="drawer-lead">${escapeHtml(item.summary)}</p>

      <div class="detail-action-grid" aria-label="知识卡操作">
        <div class="detail-action-row detail-action-row-five">
          <button
            class="detail-action-button ${item.stars ? "is-active is-starred" : ""}"
            data-star-action
            data-note-id="${item.noteId}"
            type="button"
            aria-label="当前 ${item.stars} 星，点击切换"
            title="点击在未标星、一星、两星之间切换"
          >
            <span class="detail-action-icon" aria-hidden="true">${item.stars ? "★".repeat(item.stars) : "☆"}</span>
            <span>${item.stars ? `已标 ${item.stars} 星` : "标星"}</span>
          </button>
          <button
            class="detail-action-button ${item.readStatus === "read" ? "is-active" : ""}"
            data-note-action="read"
            data-note-id="${item.noteId}"
            type="button"
            title="${item.readStatus === "read" ? "已阅读" : "标为已阅读"}"
          >
            <span class="detail-action-icon" aria-hidden="true">✓</span>
            <span>${item.readStatus === "read" ? "已阅读" : "标为已阅读"}</span>
          </button>
          <button
            class="detail-action-button detail-action-ignore ${item.readStatus === "skipped" ? "is-active" : ""}"
            data-note-action="skipped"
            data-note-id="${item.noteId}"
            type="button"
            title="忽略这条内容"
          >
            <span class="detail-action-icon" aria-hidden="true">×</span>
            <span>${item.readStatus === "skipped" ? "已忽略" : "忽略"}</span>
          </button>
          <button
            class="detail-action-button ${item.pinned ? "is-active" : ""}"
            data-toggle-pin
            data-note-id="${item.noteId}"
            type="button"
            title="${item.pinned ? "取消本周固定" : "固定到本周清单"}"
          >
            <span class="detail-action-icon" aria-hidden="true">⌁</span>
            <span>${item.pinned ? "已固定本周" : "固定到本周"}</span>
          </button>
          ${
            sourceUrl
              ? `
                <a
                  class="detail-action-button"
                  href="${escapeHtml(sourceUrl)}"
                  target="_blank"
                  rel="noreferrer"
                  title="打开小红书原文"
                >
                  <span class="detail-action-icon" aria-hidden="true">↗</span>
                  <span>打开小红书原文</span>
                </a>
              `
              : `
                <span class="detail-action-button is-disabled">
                  <span class="detail-action-icon" aria-hidden="true">↗</span>
                  <span>暂无原文链接</span>
                </span>
              `
          }
        </div>
      </div>

      <section class="drawer-section">
        <h3>核心要点</h3>
        <ol class="key-point-list">
          ${item.keyPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}
        </ol>
      </section>

      ${translation}
      ${transcript}

      ${
        item.references.length
          ? `
            <section class="drawer-section">
              <h3>链接与专有名词</h3>
              <div class="reference-list">${item.references.map(referenceMarkup).join("")}</div>
            </section>
          `
          : ""
      }

      ${gallery}

      ${
        related.length
          ? `
            <section class="drawer-section">
              <h3>相关内容 · ${related.length} 条</h3>
              <div class="related-list">
                ${related
                  .map(
                    ({ item: relatedItem, edge }) => `
                      <button class="related-item" data-open-note="${relatedItem.noteId}" type="button">
                        <strong>${escapeHtml(relatedItem.title)}</strong>
                        <span>${escapeHtml(edge.reasons.join("；"))} · 查看并可返回</span>
                      </button>
                    `,
                  )
                  .join("")}
              </div>
            </section>
          `
          : ""
      }

      <details class="drawer-details" data-markdown-details>
        <summary>查看本地 Markdown 原文</summary>
        <pre class="markdown-raw" data-markdown-content>展开后载入…</pre>
      </details>

      <details class="drawer-details score-details">
        <summary>
          <span>阅读价值</span>
          <span class="detail-summary-title">
            <strong>${item.readingValue.score}</strong>
            <em>${escapeHtml(item.readingValue.tierLabel)}</em>
          </span>
        </summary>
        <div class="score-breakdown">${scoreRows}</div>
      </details>

      <details class="drawer-details source-details" open>
        <summary>
          <span>来源信息</span>
          <span class="fold-hint">${escapeHtml(item.author)} · 小红书</span>
        </summary>
        <dl class="source-grid">
          <dt>收藏夹</dt><dd>${escapeHtml(state.catalog.board.name)}</dd>
          <dt>作者</dt><dd>${authorUrl ? `<a href="${escapeHtml(authorUrl)}" target="_blank" rel="noreferrer">${escapeHtml(item.author)}</a>` : escapeHtml(item.author)}</dd>
          <dt>发布时间</dt><dd>${formatDate(item.publishedAt)}</dd>
          <dt>收藏时间</dt><dd>${formatDate(item.collectedAt, true)}</dd>
          <dt>分类</dt><dd>${escapeHtml(item.category)}</dd>
          <dt>标签</dt><dd>${escapeHtml(item.searchTags.map((tag) => `#${tag}`).join(" "))}</dd>
          <dt>采集时互动</dt><dd>${escapeHtml(interactionText)}</dd>
          <dt>小红书原文标题</dt><dd>${escapeHtml(item.sourceTitle)}</dd>
          <dt>小红书原文</dt><dd>${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">查看原文 ↗</a>` : "无链接"}</dd>
        </dl>
      </details>
    </div>
  `;
  bindMarkdownLoader(item);
}

function bindMarkdownLoader(item) {
  const details = $("[data-markdown-details]", $("#detailContent"));
  if (!details) return;
  details.addEventListener(
    "toggle",
    async () => {
      if (!details.open || details.dataset.loaded) return;
      const content = $("[data-markdown-content]", details);
      try {
        content.textContent = await apiRequest(item.markdownUrl);
        details.dataset.loaded = "true";
      } catch (error) {
        content.textContent = `载入失败：${error.message}`;
      }
    },
  );
}

function openDetail(noteId) {
  if (isMapFullscreen()) {
    void exitMapFullscreen().then(() => openDetail(noteId));
    return;
  }
  const item = state.itemMap.get(noteId);
  if (!item) return;
  const drawer = $("#detailDrawer");
  const panel = $(".drawer-panel", drawer);
  const isAlreadyOpen = drawer.classList.contains("is-open");
  if (!isAlreadyOpen) {
    state.detailHistory = [];
  } else if (state.activeNoteId && state.activeNoteId !== noteId) {
    state.detailHistory.push({
      noteId: state.activeNoteId,
      scrollTop: panel.scrollTop,
    });
  }
  state.activeNoteId = noteId;
  renderDetail(item);
  drawer.classList.add("is-open");
  drawer.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  if (isAlreadyOpen) panel.scrollTop = 0;
  setTimeout(() => $(".drawer-close")?.focus(), 260);
  if (item.isNew) {
    void acknowledgeMapNode(`item:${noteId}`);
  }
}

function returnToPreviousDetail() {
  const previous = state.detailHistory.pop();
  if (!previous) return;
  const item = state.itemMap.get(previous.noteId);
  if (!item) return;
  state.activeNoteId = previous.noteId;
  renderDetail(item);
  requestAnimationFrame(() => {
    $(".drawer-panel").scrollTop = previous.scrollTop || 0;
    $("[data-detail-back]")?.focus({ preventScroll: true });
  });
}

function closeDetail() {
  state.activeNoteId = null;
  state.detailHistory = [];
  const drawer = $("#detailDrawer");
  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function isMapFullscreen() {
  const shell = $("#knowledgeMapShell");
  return document.fullscreenElement === shell || shell.classList.contains("is-fullscreen");
}

function updateMapFullscreenUi() {
  const active = isMapFullscreen();
  const button = $("#toggleMapFullscreen");
  button.textContent = active ? "退出全屏" : "全屏模式";
  button.setAttribute("aria-pressed", String(active));
  document.body.classList.toggle("map-fullscreen-open", active);
}

async function enterMapFullscreen() {
  const shell = $("#knowledgeMapShell");
  if (shell.requestFullscreen) {
    try {
      await shell.requestFullscreen();
      updateMapFullscreenUi();
      return;
    } catch {
      // 浏览器拒绝原生全屏时，继续使用页面内全屏作为降级方案。
    }
  }
  shell.classList.add("is-fullscreen");
  updateMapFullscreenUi();
}

async function exitMapFullscreen() {
  const shell = $("#knowledgeMapShell");
  if (document.fullscreenElement === shell && document.exitFullscreen) {
    await document.exitFullscreen();
  }
  shell.classList.remove("is-fullscreen");
  updateMapFullscreenUi();
}

async function toggleMapFullscreen() {
  if (isMapFullscreen()) {
    await exitMapFullscreen();
  } else {
    await enterMapFullscreen();
  }
}

function activateView(view) {
  if (view === "graph") view = "map";
  if (!["list", "weekly", "map", "processing"].includes(view)) view = "list";
  if (view !== "map" && isMapFullscreen()) {
    void exitMapFullscreen();
  }
  state.activeView = view;
  $$(".view-tab").forEach((tab) => {
    const active = tab.dataset.viewTarget === view;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  $$(".view-panel").forEach((panel) => {
    const active = panel.dataset.view === view;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });
  history.replaceState(null, "", `#${view}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function patchItem(noteId, patch, successMessage) {
  try {
    const data = await apiRequest(`/api/state/${noteId}`, {
      method: "POST",
      body: JSON.stringify(patch),
    });
    applyBootstrap(data);
    renderAll();
    showToast(successMessage);
  } catch (error) {
    showToast(error.message, true);
  }
}

function resetFilters() {
  state.filters = {
    search: "",
    readStatus: "all",
    value: "all",
    knowledgeType: "all",
    topic: "all",
    stars: "all",
    sort: "stars",
  };
  $("#listSearch").value = "";
  $("#valueFilter").value = "all";
  $("#knowledgeTypeFilter").value = "all";
  $("#topicFilter").value = "all";
  $("#starsFilter").value = "all";
  $("#sortSelect").value = "stars";
  $$(".filter-chip").forEach((chip) =>
    chip.classList.toggle("is-active", chip.dataset.filterStatus === "all"),
  );
  renderList();
}

function bindEvents() {
  $$(".view-tab").forEach((tab) =>
    tab.addEventListener("click", () => activateView(tab.dataset.viewTarget)),
  );
  $("#listSearch").addEventListener("input", (event) => {
    state.filters.search = event.target.value;
    renderList();
  });
  $("#valueFilter").addEventListener("change", (event) => {
    state.filters.value = event.target.value;
    renderList();
  });
  $("#knowledgeTypeFilter").addEventListener("change", (event) => {
    state.filters.knowledgeType = event.target.value;
    renderList();
  });
  $("#topicFilter").addEventListener("change", (event) => {
    state.filters.topic = event.target.value;
    renderList();
  });
  $("#starsFilter").addEventListener("change", (event) => {
    state.filters.stars = event.target.value;
    renderList();
  });
  $("#sortSelect").addEventListener("change", (event) => {
    state.filters.sort = event.target.value;
    renderList();
  });
  $("#clearFilters").addEventListener("click", resetFilters);
  $("#readStatusFilters").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-filter-status]");
    if (!chip) return;
    state.filters.readStatus = chip.dataset.filterStatus;
    $$(".filter-chip", $("#readStatusFilters")).forEach((item) =>
      item.classList.toggle("is-active", item === chip),
    );
    renderList();
  });

  $("#expandMap").addEventListener("click", () => {
    walkMapNodes(state.knowledgeMap.root, (node) => {
      if (node.kind === "category") state.expandedMapNodes.add(node.nodeId);
    });
    renderKnowledgeMap();
  });
  $("#collapseMap").addEventListener("click", () => {
    state.expandedMapNodes.clear();
    renderKnowledgeMap();
  });
  $("#toggleMapFullscreen").addEventListener("click", () => {
    void toggleMapFullscreen();
  });
  document.addEventListener("fullscreenchange", updateMapFullscreenUi);
  $("#refreshLibrary").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "正在刷新…";
    try {
      const data = await apiRequest("/api/library/refresh", {
        method: "POST",
        body: JSON.stringify({}),
      });
      applyBootstrap(data);
      renderAll();
      const result = state.knowledgeMap.lastRefreshResult;
      showToast(
        result?.newCount
          ? `刷新完成，发现 ${result.newCount} 条新知识`
          : "刷新完成，没有发现新知识",
      );
    } catch (error) {
      showToast(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
  $("#refreshWeekly").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      applyBootstrap(
        await apiRequest("/api/weekly/refresh", {
          method: "POST",
          body: JSON.stringify({}),
        }),
      );
      renderAll();
      showToast("本周清单已重新生成");
    } catch (error) {
      showToast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  document.addEventListener("click", (event) => {
    const processingMinutes = event.target.closest("[data-processing-minutes]");
    if (processingMinutes) {
      state.processingPlanMinutes =
        Number(processingMinutes.dataset.processingMinutes) || 90;
      renderProcessingDashboard();
      return;
    }
    const generateProcessingPlan = event.target.closest(
      "[data-generate-processing-plan]",
    );
    if (generateProcessingPlan) {
      const plan = processingPlanFor(state.processingPlanMinutes);
      showToast(
        `今日计划：${state.processingPlanMinutes} 分钟，建议处理 ${plan.target} 条；尚未自动执行`,
      );
      return;
    }
    const mapToggle = event.target.closest("[data-map-toggle]");
    if (mapToggle) {
      const nodeId = mapToggle.dataset.mapNodeId;
      if (state.expandedMapNodes.has(nodeId)) {
        state.expandedMapNodes.delete(nodeId);
      } else {
        state.expandedMapNodes.add(nodeId);
      }
      const newCount = Number(mapToggle.dataset.newCount) || 0;
      renderKnowledgeMap();
      if (newCount) void acknowledgeMapNode(nodeId);
      return;
    }
    const mapRoot = event.target.closest("#mapRootNode");
    if (mapRoot) {
      if (state.knowledgeMap.root.newCount) {
        void acknowledgeMapNode("root");
      }
      return;
    }
    const closeButton = event.target.closest("[data-close-detail]");
    if (closeButton) {
      closeDetail();
      return;
    }
    const detailBackButton = event.target.closest("[data-detail-back]");
    if (detailBackButton) {
      returnToPreviousDetail();
      return;
    }
    const actionButton = event.target.closest("[data-note-action]");
    if (actionButton) {
      event.stopPropagation();
      const status = actionButton.dataset.noteAction;
      const labels = {
        read: "已标记为已读",
        skipped: "已忽略这条内容",
      };
      patchItem(
        actionButton.dataset.noteId,
        { readStatus: status },
        labels[status],
      );
      return;
    }
    const starButton = event.target.closest("[data-star-action]");
    if (starButton) {
      event.stopPropagation();
      const item = state.itemMap.get(starButton.dataset.noteId);
      const stars = (item.stars + 1) % 3;
      patchItem(
        item.noteId,
        { stars },
        stars ? `已标记为 ${stars} 星` : "已取消标星",
      );
      return;
    }
    const pinButton = event.target.closest("[data-toggle-pin]");
    if (pinButton) {
      event.stopPropagation();
      const item = state.itemMap.get(pinButton.dataset.noteId);
      patchItem(
        item.noteId,
        { pinned: !item.pinned },
        item.pinned ? "已取消固定" : "已固定到本周",
      );
      return;
    }
    const relatedButton = event.target.closest("[data-open-note]");
    if (relatedButton) {
      openDetail(relatedButton.dataset.openNote);
      return;
    }
    const item = event.target.closest("[data-note-id]");
    if (item) {
      openDetail(item.dataset.noteId);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      $("#knowledgeMapShell").classList.contains("is-fullscreen")
    ) {
      void exitMapFullscreen();
      return;
    }
    if (event.key === "Escape" && state.activeNoteId) {
      closeDetail();
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    const item = event.target.closest?.("[data-note-id]");
    if (item && !event.target.closest("button, a")) {
      event.preventDefault();
      openDetail(item.dataset.noteId);
    }
  });
}

function initialize() {
  bindEvents();
  const requestedView = window.location.hash.slice(1);
  activateView(
    ["list", "weekly", "map", "graph", "processing"].includes(requestedView)
      ? requestedView
      : "list",
  );
  loadData();
}

if (typeof document !== "undefined") initialize();
