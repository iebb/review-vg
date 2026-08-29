const SVG_NS = "http://www.w3.org/2000/svg";
const DAY = 24 * 60 * 60 * 1000;
const timelinesNode = document.querySelector("#timelines");
const I18N = window.ReviewI18n || {
  locale: "en",
  t: (key, variables = {}) => String(key).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => variables[name] ?? match),
  category: (value) => value,
  number: (value) => new Intl.NumberFormat("en").format(Number(value || 0)),
};
const t = (key, variables) => I18N.t(key, variables);

document.querySelector("#copy-address")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText("report@review.vg");
    button.classList.add("is-copied");
    button.querySelector(".copy-label").textContent = t("common.copied");
    window.setTimeout(() => {
      button.classList.remove("is-copied");
      button.querySelector(".copy-label").textContent = t("common.copy");
    }, 1600);
  } catch {
    window.location.href = "mailto:report@review.vg";
  }
});

async function loadTimelines() {
  timelinesNode.setAttribute("aria-busy", "true");
  try {
    const response = await fetch("/api/timeline");
    if (!response.ok) throw new Error(`Timeline request failed: ${response.status}`);
    const data = await response.json();
    renderTimelines(Array.isArray(data.events) ? data.events : []);
  } catch (error) {
    timelinesNode.replaceChildren(emptyState(
      t("timeline.errorTitle"),
      t("timeline.errorCopy"),
    ));
    console.error(error);
  } finally {
    timelinesNode.removeAttribute("aria-busy");
  }
}

function renderTimelines(events) {
  if (events.length === 0) {
    timelinesNode.replaceChildren(emptyState(
      t("timeline.emptyTitle"),
      t("timeline.emptyCopy"),
    ));
    return;
  }

  const apps = groupApps(events);
  timelinesNode.replaceChildren(createSharedTimeline(apps));
}

function groupApps(events) {
  const groups = new Map();
  for (const event of events) {
    const appStoreId = normalizedAppStoreId(event.appStoreId);
    const knownName = normalizedPublicName(event.appName);
    const category = normalizedPublicCategory(event.appCategory);
    const key = appStoreId ? `id:${appStoreId}` : `submission:${event.submissionId}`;
    const app = groups.get(key) || {
      knownName: null,
      hasApproved: false,
      revealedName: null,
      nameRevealListeners: new Set(),
      appStoreId,
      appIconUrl: null,
      appCategory: null,
      latestEventAt: 0,
      events: [],
      platforms: new Map(),
    };
    const timestamp = eventTime(event);
    if (timestamp >= app.latestEventAt) {
      app.latestEventAt = timestamp;
      app.appStoreId = appStoreId || app.appStoreId;
    }
    if (knownName) app.knownName = knownName;
    if (event.hasApproved === true) app.hasApproved = true;
    if (event.appIconUrl) app.appIconUrl = event.appIconUrl;
    if (category) app.appCategory = category;
    app.events.push(event);
    const platform = app.platforms.get(event.platform) || { platform: event.platform, events: [] };
    platform.events.push(event);
    app.platforms.set(event.platform, platform);
    groups.set(key, app);
  }

  return [...groups.values()]
    .map((app) => ({
      ...app,
      appName: app.hasApproved && app.knownName ? app.knownName : t("timeline.unapproved"),
      appCategory: app.appCategory || "Uncategorized",
      isApproved: app.hasApproved,
      events: app.events.sort(compareEvents),
      platforms: [...app.platforms.values()]
        .map((platform) => {
          const platformEvents = platform.events.sort(compareEvents);
          return {
            ...platform,
            events: platformEvents,
            appVersion: latestAppVersion(platformEvents),
          };
        })
        .sort((left, right) => platformRank(left.platform) - platformRank(right.platform) || left.platform.localeCompare(right.platform, I18N.locale)),
    }))
    .sort((left, right) => right.latestEventAt - left.latestEventAt || left.appName.localeCompare(right.appName, I18N.locale));
}

function createSharedTimeline(apps) {
  const experience = element("div", "timeline-experience");
  const board = element("article", "timeline-board");
  const toolbar = element("header", "timeline-board-toolbar");
  const summary = element("div", "timeline-board-summary");
  const summaryTitle = element("strong");
  summaryTitle.textContent = t("timeline.allApps");
  const summaryCopy = element("span");
  summaryCopy.textContent = appCount(apps.length);
  summary.append(summaryTitle, summaryCopy);

  const controls = element("div", "timeline-controls");
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", t("timeline.zoomAria"));
  const zoomOut = controlButton("−", t("timeline.zoomOut"));
  const rangeLabel = element("span", "zoom-level");
  rangeLabel.textContent = t("timeline.latestRange");
  rangeLabel.setAttribute("aria-live", "polite");
  const zoomIn = controlButton("+", t("timeline.zoomIn"));
  const reset = controlButton(t("timeline.latest"), t("timeline.latestAria"));
  reset.classList.add("reset-button");
  controls.append(zoomOut, rangeLabel, zoomIn, reset);

  const categoryField = element("label", "timeline-filter-field");
  const categoryLabel = element("span");
  categoryLabel.textContent = t("timeline.category");
  const categorySelect = element("select", "timeline-filter-input timeline-filter-select");
  categorySelect.setAttribute("aria-label", t("timeline.filterCategory"));
  const allCategories = document.createElement("option");
  allCategories.value = "";
  allCategories.textContent = t("timeline.allCategories");
  categorySelect.append(allCategories);
  const categories = [...new Set(apps.map((app) => app.appCategory))]
    .sort((left, right) => localizedCategory(left).localeCompare(localizedCategory(right), I18N.locale));
  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = localizedCategory(category);
    categorySelect.append(option);
  }
  categoryField.append(categoryLabel, categorySelect);

  const toolbarActions = element("div", "timeline-toolbar-actions");
  toolbarActions.append(categoryField, controls);
  toolbar.append(summary, toolbarActions);

  const body = element("div", "timeline-board-body");
  const lanes = [];
  const appRows = [];
  for (const app of apps) {
    const group = element("section", "timeline-app-group");
    const updateGroupLabel = () => {
      group.setAttribute("aria-label", t("timeline.appAria", { app: displayedAppName(app) }));
    };
    subscribeAppName(app, updateGroupLabel);
    const identity = createAppIdentity(app);
    identity.style.gridRow = `1 / span ${app.platforms.length}`;
    for (const cell of identity.children) {
      cell.style.gridRow = `1 / span ${app.platforms.length}`;
    }
    group.append(identity);

    app.platforms.forEach((platform, index) => {
      const row = index + 1;
      const platformLabel = element("span", "timeline-platform-label");
      const platformName = element("span", "timeline-platform-name");
      platformName.textContent = platform.platform;
      platformLabel.append(platformName);
      if (platform.appVersion) {
        const platformVersion = element("span", "timeline-platform-version");
        platformVersion.textContent = platform.appVersion;
        platformLabel.append(platformVersion);
      }
      platformLabel.style.gridRow = String(row);
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.classList.add("timeline-lane");
      svg.style.gridRow = String(row);
      svg.setAttribute("role", "group");
      const updateLaneLabel = () => {
        svg.setAttribute("aria-label", t("timeline.laneAria", {
          app: displayedAppName(app),
          platform: platform.platform,
        }));
      };
      subscribeAppName(app, updateLaneLabel);
      group.append(platformLabel, svg);
      lanes.push({ svg, app, platform: platform.platform, events: platform.events });
    });
    body.append(group);
    appRows.push({ app, group });
  }

  const axisRow = element("div", "timeline-axis-row");
  const axisIconSpacer = element("span", "timeline-axis-icon-spacer");
  axisIconSpacer.setAttribute("aria-hidden", "true");
  const axisSpacer = element("span", "timeline-axis-spacer");
  axisSpacer.setAttribute("aria-hidden", "true");
  const axis = document.createElementNS(SVG_NS, "svg");
  axis.classList.add("timeline-shared-axis");
  axis.setAttribute("role", "img");
  axis.setAttribute("aria-label", t("timeline.axisAria"));
  axisRow.append(axisIconSpacer, axisSpacer, axis);
  body.append(axisRow);

  const footer = element("footer", "timeline-board-footer");
  const hint = element("p", "timeline-interaction-hint");
  hint.textContent = t("timeline.hint");
  footer.append(hint);

  const tooltip = element("div", "timeline-tooltip");
  tooltip.setAttribute("role", "tooltip");
  tooltip.setAttribute("aria-hidden", "true");
  const noMatches = emptyState(
    t("timeline.noMatchesTitle"),
    t("timeline.noMatchesCopy"),
  );
  noMatches.classList.add("timeline-filter-empty");
  noMatches.hidden = true;
  board.append(toolbar, noMatches, body, footer, tooltip);
  const leaderboards = createLeaderboards();
  experience.append(board, leaderboards.node);

  const applyFilters = () => {
    const selectedCategory = categorySelect.value;
    const hasFilters = Boolean(selectedCategory);
    let visibleApps = 0;
    const filteredApps = [];
    for (const row of appRows) {
      const visible = !selectedCategory || row.app.appCategory === selectedCategory;
      row.group.hidden = !visible;
      if (visible) {
        visibleApps += 1;
        filteredApps.push(row.app);
      }
    }
    summaryTitle.textContent = hasFilters ? t("timeline.filteredApps") : t("timeline.allApps");
    summaryCopy.textContent = appCount(visibleApps);
    noMatches.hidden = visibleApps !== 0;
    body.hidden = visibleApps === 0;
    footer.hidden = visibleApps === 0;
    leaderboards.node.hidden = visibleApps === 0;
    leaderboards.render(filteredApps);
  };
  categorySelect.addEventListener("change", applyFilters);
  applyFilters();

  const chart = new SharedTimelineChart(axis, lanes, tooltip, {
    zoomIn,
    zoomOut,
    reset,
    rangeLabel,
  });
  for (const app of new Set(lanes.map((lane) => lane.app))) {
    subscribeAppName(app, () => chart.render(), false);
  }
  return experience;
}

function createLeaderboards() {
  const node = element("section", "review-leaderboards");
  node.setAttribute("aria-labelledby", "leaderboard-heading");
  const header = element("div", "review-leaderboard-header");
  const heading = element("h3");
  heading.id = "leaderboard-heading";
  heading.textContent = t("leaderboard.title");
  const intro = element("p");
  intro.textContent = t("leaderboard.intro");
  header.append(heading, intro);

  const grid = element("div", "review-leaderboard-grid");
  const specifications = [
    { key: "slowReject", status: "issue", slowest: true, tone: "issue" },
    { key: "slowApproval", status: "success", slowest: true, tone: "success" },
    { key: "fastApproval", status: "success", slowest: false, tone: "fast" },
  ];
  const lists = specifications.map((specification) => {
    const card = element("article", `review-leaderboard-card ${specification.tone}`);
    const cardHeading = element("h4");
    const dot = element("i");
    dot.setAttribute("aria-hidden", "true");
    const title = element("span");
    title.textContent = t(`leaderboard.${specification.key}`);
    cardHeading.append(dot, title);
    const list = element("ol", "review-leaderboard-list");
    card.append(cardHeading, list);
    grid.append(card);
    return { ...specification, list };
  });
  node.append(header, grid);

  return {
    node,
    render(apps) {
      for (const specification of lists) {
        const entries = leaderboardEntries(apps, specification.status, specification.slowest);
        if (entries.length === 0) {
          const empty = element("li", "review-leaderboard-empty");
          empty.textContent = t("leaderboard.empty");
          specification.list.replaceChildren(empty);
          continue;
        }
        specification.list.replaceChildren(...entries.map((entry, index) => (
          createLeaderboardEntry(entry, index + 1)
        )));
      }
    },
  };
}

function leaderboardEntries(apps, status, slowest) {
  const entries = apps.flatMap((app) => app.events
    .filter((event) => event.status === status)
    .map((event) => ({ app, event, duration: reviewDuration(event) }))
    .filter((entry) => entry.duration !== null));
  entries.sort((left, right) => (
    (slowest ? right.duration - left.duration : left.duration - right.duration) ||
    eventTime(right.event) - eventTime(left.event) ||
    String(left.event.submissionId).localeCompare(String(right.event.submissionId))
  ));
  return entries.slice(0, 20);
}

function createLeaderboardEntry(entry, rank) {
  const item = element("li", "review-leaderboard-entry");
  const rankNode = element("span", "review-leaderboard-rank");
  rankNode.textContent = String(rank).padStart(2, "0");
  const icon = element("span", "review-leaderboard-icon");
  icon.append(createAppIcon(entry.app));
  const copy = element("span", "review-leaderboard-copy");
  const name = createAppNameLabel(entry.app, "review-leaderboard-name");
  const details = element("span", "review-leaderboard-meta");
  details.textContent = [entry.event.platform, entry.event.appVersion].filter(Boolean).join(" · ");
  copy.append(name, details);
  const guideline = publicGuideline(entry.event);
  if (entry.event.status === "issue") {
    const guidelineNode = element("span", "review-leaderboard-guideline");
    guidelineNode.textContent = guideline || "\u00a0";
    copy.append(guidelineNode);
  } else {
    const acceptedDate = element("span", "review-leaderboard-accepted-date");
    acceptedDate.textContent = t("leaderboard.acceptedDate", {
      date: shortDate(entry.event.occurredAt),
    });
    copy.append(acceptedDate);
  }
  const duration = element("strong", "review-leaderboard-duration");
  duration.textContent = formatReviewDuration(entry.duration);
  item.append(rankNode, icon, copy, duration);
  return item;
}

function createAppIdentity(app) {
  const identity = element("div", "timeline-app-identity");
  const iconCell = element("div", "timeline-app-icon-cell");
  iconCell.append(createAppIcon(app));
  const nameBlock = element("div", "timeline-name");
  const title = element("h3");
  title.append(createAppNameLabel(app, "timeline-app-name"));
  const meta = element("div", "timeline-app-meta");
  const category = element("span", "timeline-app-category");
  category.textContent = localizedCategory(app.appCategory);
  category.title = localizedCategory(app.appCategory);
  meta.append(category);
  nameBlock.append(title, meta);
  identity.append(iconCell, nameBlock);
  return identity;
}

function createAppIcon(group) {
  const fallback = element("span", "app-icon app-icon-fallback");
  fallback.textContent = group.isApproved ? (displayedAppName(group).slice(0, 1).toUpperCase() || "A") : "#";
  fallback.setAttribute("aria-hidden", "true");
  if (!group.appIconUrl && canRevealAppName(group)) {
    const control = element("span", "app-name-reveal-control");
    const button = element("button", "app-icon app-icon-fallback app-name-reveal-icon");
    button.type = "button";
    button.textContent = "#";
    const popover = element("span", "app-name-reveal-popover");
    popover.hidden = true;
    const update = () => {
      const revealed = Boolean(group.revealedName);
      button.disabled = revealed;
      button.setAttribute("aria-label", revealed
        ? t("timeline.revealedNameAria", { app: displayedAppName(group) })
        : t("timeline.revealNameAria"));
      popover.textContent = group.knownName;
      popover.hidden = !revealed;
    };
    subscribeAppName(group, update);
    button.addEventListener("click", () => revealAppName(group));
    control.append(button, popover);
    return control;
  }
  if (!group.appIconUrl) return fallback;

  const image = document.createElement("img");
  image.className = "app-icon";
  image.src = group.appIconUrl;
  image.alt = t("timeline.iconAlt", { app: displayedAppName(group) });
  image.loading = "lazy";
  image.referrerPolicy = "no-referrer";
  image.addEventListener("error", () => image.replaceWith(fallback), { once: true });

  const storeUrl = appStoreUrl(group.appStoreId);
  if (!storeUrl) return image;
  const link = element("a", "app-icon-link");
  link.href = storeUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", t("timeline.openInStore", { app: displayedAppName(group) }));
  link.append(image);
  return link;
}

class SharedTimelineChart {
  constructor(axis, lanes, tooltip, controls) {
    this.axis = axis;
    this.lanes = lanes.map((lane) => {
      const points = lane.events
        .map((event) => timelinePoint(event, lane.app))
        .filter((point) => Number.isFinite(point.startTime) && Number.isFinite(point.endTime))
        .sort((left, right) => (
          (right.endTime - right.startTime) - (left.endTime - left.startTime) ||
          left.startTime - right.startTime ||
          left.event.submissionId.localeCompare(right.event.submissionId)
        ));
      const trackCount = assignPointTracks(points);
      return { ...lane, points, trackCount };
    });
    this.tooltip = tooltip;
    this.controls = controls;
    this.points = this.lanes.flatMap((lane) => lane.points);
    this.surfaces = [axis, ...this.lanes.map((lane) => lane.svg)];
    this.viewStart = 0;
    this.drag = null;
    this.width = 0;
    this.setDomain();
    this.bindControls();
    this.bindGestures();

    if ("ResizeObserver" in window) {
      this.resizeObserver = new ResizeObserver(() => this.render());
      this.resizeObserver.observe(axis.parentElement);
    } else {
      window.addEventListener("resize", () => this.render());
    }
    this.render();
  }

  setDomain() {
    const now = Date.now();
    const observedMinimum = this.points.length > 0
      ? Math.min(...this.points.map((point) => point.startTime))
      : now;
    const observedMaximum = this.points.length > 0
      ? Math.max(...this.points.map((point) => point.endTime))
      : now;
    this.domainEnd = Math.max(now, observedMaximum);
    this.domainStart = Math.min(observedMinimum, this.domainEnd - 30 * DAY);
    this.domainSpan = this.domainEnd - this.domainStart;
    this.defaultSpan = Math.min(30 * DAY, this.domainSpan);
    this.defaultZoom = this.domainSpan / this.defaultSpan;
    this.maximumZoom = Math.max(256, this.defaultZoom * 32);
    this.zoom = this.defaultZoom;
    this.viewStart = this.domainEnd - this.defaultSpan;
  }

  bindControls() {
    this.controls.zoomIn.addEventListener("click", () => this.zoomAt(1.7, 0.5));
    this.controls.zoomOut.addEventListener("click", () => this.zoomAt(1 / 1.7, 0.5));
    this.controls.reset.addEventListener("click", () => this.reset());
  }

  bindGestures() {
    for (const surface of this.surfaces) this.bindGestureSurface(surface);
  }

  bindGestureSurface(surface) {
    surface.addEventListener("wheel", (event) => {
      event.preventDefault();
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY) && !event.ctrlKey) {
        this.panByPixels(event.deltaX);
        return;
      }
      const bounds = surface.getBoundingClientRect();
      const svgX = bounds.width > 0 ? ((event.clientX - bounds.left) / bounds.width) * this.width : this.width / 2;
      const ratio = clamp((svgX - this.marginLeft) / this.plotWidth(), 0, 1);
      this.zoomAt(Math.exp(-event.deltaY * 0.002), ratio);
    }, { passive: false });

    surface.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.pointerType === "touch") return;
      if (event.target instanceof Element && event.target.closest(".timeline-event")) return;
      this.hideTooltip();
      this.drag = { surface, pointerX: event.clientX, viewStart: this.viewStart };
      surface.setPointerCapture(event.pointerId);
      surface.classList.add("is-dragging");
    });
    surface.addEventListener("pointermove", (event) => {
      if (!this.drag || this.drag.surface !== surface) return;
      const bounds = surface.getBoundingClientRect();
      const cssPlotWidth = this.plotWidth() * (bounds.width / this.width);
      if (cssPlotWidth <= 0) return;
      const delta = event.clientX - this.drag.pointerX;
      this.viewStart = this.clampViewStart(
        this.drag.viewStart - (delta / cssPlotWidth) * this.viewSpan(),
      );
      this.render();
    });
    const stopDragging = (event) => {
      if (!this.drag || this.drag.surface !== surface) return;
      this.drag = null;
      surface.classList.remove("is-dragging");
      if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    };
    surface.addEventListener("pointerup", stopDragging);
    surface.addEventListener("pointercancel", stopDragging);

    surface.addEventListener("keydown", (event) => {
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        this.zoomAt(1.7, 0.5);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        this.zoomAt(1 / 1.7, 0.5);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        this.panByTime(-this.viewSpan() * 0.12);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        this.panByTime(this.viewSpan() * 0.12);
      } else if (event.key === "Home" || event.key === "0") {
        event.preventDefault();
        this.reset();
      }
    });
  }

  zoomAt(factor, anchorRatio) {
    const oldSpan = this.viewSpan();
    const anchor = this.viewStart + oldSpan * anchorRatio;
    this.zoom = clamp(this.zoom * factor, 1, this.maximumZoom);
    const newSpan = this.viewSpan();
    this.viewStart = this.clampViewStart(anchor - newSpan * anchorRatio);
    this.render();
  }

  panByPixels(pixels) {
    if (!this.plotWidth()) return;
    this.panByTime((pixels / this.plotWidth()) * this.viewSpan());
  }

  panByTime(milliseconds) {
    this.viewStart = this.clampViewStart(this.viewStart + milliseconds);
    this.render();
  }

  reset() {
    this.zoom = this.defaultZoom;
    this.viewStart = this.domainEnd - this.defaultSpan;
    this.render();
  }

  clampViewStart(value) {
    return clamp(value, this.domainStart, this.domainEnd - this.viewSpan());
  }

  viewSpan() {
    return this.domainSpan / this.zoom;
  }

  plotWidth() {
    return Math.max(1, this.width - this.marginLeft - this.marginRight);
  }

  render() {
    this.hideTooltip();
    const measuredWidth = Math.floor(this.axis.clientWidth || this.axis.parentElement?.clientWidth || 700);
    this.width = Math.max(300, measuredWidth);
    this.marginLeft = this.width < 500 ? 8 : 14;
    this.marginRight = this.width < 500 ? 8 : 14;

    const viewEnd = this.viewStart + this.viewSpan();
    const ticks = timeTicks(this.viewStart, viewEnd, this.width < 520 ? 4 : 7);
    for (const lane of this.lanes) this.renderLane(lane, ticks, viewEnd);
    this.renderAxis(ticks);

    this.controls.rangeLabel.textContent = formatRange(this.viewSpan());
    this.controls.zoomOut.disabled = this.zoom <= 1.001;
    this.controls.zoomIn.disabled = this.zoom >= this.maximumZoom - 0.001;
  }

  renderLane(lane, ticks, viewEnd) {
    const height = 46;
    lane.svg.setAttribute("viewBox", `0 0 ${this.width} ${height}`);
    lane.svg.style.height = `${height}px`;
    lane.svg.replaceChildren();
    for (const tick of ticks) {
      const x = this.x(tick);
      const gridLine = svgElement("line", "timeline-grid-line");
      setAttributes(gridLine, { x1: x, x2: x, y1: 0, y2: height });
      lane.svg.append(gridLine);
    }

    const centerLine = svgElement("line", "timeline-lane-line");
    setAttributes(centerLine, {
      x1: this.marginLeft,
      x2: this.width - this.marginRight,
      y1: height / 2,
      y2: height / 2,
    });
    lane.svg.append(centerLine);

    for (const point of lane.points) {
      if (point.endTime < this.viewStart || point.startTime > viewEnd) continue;
      const clippedStart = Math.max(point.startTime, this.viewStart);
      const clippedEnd = Math.min(point.endTime, viewEnd);
      const startX = this.x(clippedStart);
      const endX = this.x(clippedEnd);
      const accepted = point.event.status === "success";
      const outcome = accepted ? t("timeline.accepted") : t("timeline.rejected");
      const version = point.event.appVersion
        ? t("timeline.versionPhrase", { version: point.event.appVersion })
        : "";
      const label = t("timeline.eventAria", {
        app: displayedAppName(lane.app),
        platform: lane.platform,
        outcome,
        version,
        submitted: dateTime(point.startTime),
        replied: dateTime(point.endTime),
      });
      const guideline = accepted ? "" : publicGuideline(point.event);
      const accessibleLabel = guideline ? `${label} ${guideline}` : label;

      const marker = svgElement("g", `timeline-event ${accepted ? "success" : "issue"}`);
      marker.setAttribute("tabindex", "0");
      marker.setAttribute("role", "img");
      marker.setAttribute("aria-label", accessibleLabel);
      const block = svgElement("rect", "timeline-event-block");
      const track = trackLayout(lane.trackCount, point.track);
      const durationWidth = Math.max(0, endX - startX);
      const width = Math.max(track.height, durationWidth);
      const midpoint = (startX + endX) / 2;
      const unclampedX = durationWidth < track.height ? midpoint - width / 2 : startX;
      const rightEdge = this.width - this.marginRight;
      const blockX = clamp(unclampedX, this.marginLeft, rightEdge - width);
      const radius = track.height / 2;
      setAttributes(block, { x: blockX, y: track.y, width, height: track.height, rx: radius, ry: radius });
      marker.append(block);
      marker.addEventListener("pointerenter", (event) => this.showTooltip(point, event.clientX, event.clientY));
      marker.addEventListener("pointermove", (event) => this.positionTooltip(event.clientX, event.clientY));
      marker.addEventListener("pointerleave", () => this.hideTooltip());
      marker.addEventListener("focus", () => {
        const bounds = block.getBoundingClientRect();
        this.showTooltip(point, bounds.left + bounds.width / 2, bounds.top);
      });
      marker.addEventListener("blur", () => this.hideTooltip());
      marker.addEventListener("keydown", (event) => {
        if (event.key === "Escape") this.hideTooltip();
      });
      marker.addEventListener("click", (event) => {
        event.stopPropagation();
        const bounds = block.getBoundingClientRect();
        this.showTooltip(point, bounds.left + bounds.width / 2, bounds.top);
      });
      lane.svg.append(marker);
    }
  }

  renderAxis(ticks) {
    const height = 38;
    this.axis.setAttribute("viewBox", `0 0 ${this.width} ${height}`);
    this.axis.style.height = `${height}px`;
    this.axis.replaceChildren();
    const line = svgElement("line", "timeline-axis-line");
    setAttributes(line, {
      x1: this.marginLeft,
      x2: this.width - this.marginRight,
      y1: 1,
      y2: 1,
    });
    this.axis.append(line);
    for (const tick of ticks) {
      const x = this.x(tick);
      const label = svgElement("text", "timeline-axis-label");
      setAttributes(label, { x, y: 24, "text-anchor": "middle" });
      label.textContent = formatAxisDate(tick, this.viewSpan());
      this.axis.append(label);
    }
  }

  x(timestamp) {
    return this.marginLeft + ((timestamp - this.viewStart) / this.viewSpan()) * this.plotWidth();
  }

  showTooltip(point, clientX, clientY) {
    const accepted = point.event.status === "success";
    const heading = element("strong", "timeline-tooltip-title");
    heading.textContent = `${displayedAppName(point.app)} · ${point.event.platform}`;
    const timing = element("span", "timeline-tooltip-timing");
    const timingLines = [
      accepted ? t("timeline.accepted") : t("timeline.rejected"),
      ...(point.event.appVersion ? [t("tooltip.version", { version: point.event.appVersion })] : []),
      t("tooltip.submitted", { date: dateTime(point.startTime) }),
      t("tooltip.replied", { date: dateTime(point.endTime) }),
    ];
    timing.textContent = timingLines.join("\n");
    const content = [heading, timing];
    const guideline = accepted ? "" : publicGuideline(point.event);
    if (guideline) {
      const copy = element("span", "timeline-tooltip-reason");
      copy.textContent = guideline;
      content.push(copy);
    }
    this.tooltip.replaceChildren(...content);
    this.tooltip.classList.add("is-visible");
    this.tooltip.setAttribute("aria-hidden", "false");
    this.positionTooltip(clientX, clientY);
  }

  positionTooltip(clientX, clientY) {
    if (!this.tooltip.classList.contains("is-visible")) return;
    const bounds = this.tooltip.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const left = clamp(clientX + 14, 10, Math.max(10, viewportWidth - bounds.width - 10));
    let top = clientY - bounds.height - 14;
    if (top < 10) top = clientY + 18;
    top = clamp(top, 10, Math.max(10, viewportHeight - bounds.height - 10));
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
  }

  hideTooltip() {
    this.tooltip.classList.remove("is-visible");
    this.tooltip.setAttribute("aria-hidden", "true");
  }
}

function timelinePoint(event, app) {
  const endTime = Date.parse(event?.occurredAt);
  const submittedTime = Date.parse(event?.submittedAt);
  const startTime = Number.isFinite(submittedTime) && submittedTime <= endTime
    ? submittedTime
    : endTime;
  return { event, app, startTime, endTime };
}

function reviewDuration(event) {
  const endTime = Date.parse(event?.occurredAt);
  const startTime = Date.parse(event?.submittedAt);
  return Number.isFinite(startTime) && Number.isFinite(endTime) && startTime <= endTime
    ? endTime - startTime
    : null;
}

function assignPointTracks(points) {
  const trackEnds = [];
  const ordered = [...points].sort((left, right) => (
    left.startTime - right.startTime ||
    left.endTime - right.endTime ||
    left.event.submissionId.localeCompare(right.event.submissionId)
  ));
  for (const point of ordered) {
    let track = trackEnds.findIndex((endTime) => point.startTime >= endTime);
    if (track === -1) track = trackEnds.length;
    trackEnds[track] = point.endTime;
    point.track = track;
  }
  return Math.max(1, trackEnds.length);
}

function trackLayout(trackCount, trackIndex) {
  const available = 28;
  const gap = trackCount > 5 ? 1 : 3;
  const maximumHeight = trackCount === 1 ? 12 : 8;
  const height = Math.max(2, Math.min(maximumHeight, (available - gap * (trackCount - 1)) / trackCount));
  const used = height * trackCount + gap * (trackCount - 1);
  return {
    height,
    y: (46 - used) / 2 + trackIndex * (height + gap),
  };
}

function timeTicks(start, end, requestedCount) {
  const span = Math.max(1, end - start);
  const steps = [
    5 * 60 * 1000,
    15 * 60 * 1000,
    30 * 60 * 1000,
    60 * 60 * 1000,
    3 * 60 * 60 * 1000,
    6 * 60 * 60 * 1000,
    12 * 60 * 60 * 1000,
    DAY,
    2 * DAY,
    7 * DAY,
    14 * DAY,
    30 * DAY,
    90 * DAY,
    180 * DAY,
    365 * DAY,
    2 * 365 * DAY,
    5 * 365 * DAY,
  ];
  const target = span / requestedCount;
  const step = steps.find((candidate) => candidate >= target) || steps.at(-1);
  const first = Math.ceil(start / step) * step;
  const values = [];
  for (let value = first; value <= end && values.length <= requestedCount + 2; value += step) {
    values.push(value);
  }
  if (values.length === 0) values.push(start + span / 2);
  return values;
}

function formatAxisDate(timestamp, span) {
  const options = span <= 2 * DAY
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : span <= 120 * DAY
      ? { month: "short", day: "numeric" }
      : span <= 2 * 365 * DAY
        ? { month: "short", year: "numeric" }
        : { year: "numeric" };
  return new Intl.DateTimeFormat(I18N.locale, options).format(new Date(timestamp));
}

function formatRange(span) {
  if (span < 2 * DAY) {
    const hours = Math.max(1, Math.round(span / (60 * 60 * 1000)));
    return timeCount("hour", hours);
  }
  if (span < 60 * DAY) {
    const days = Math.max(2, Math.round(span / DAY));
    return timeCount("day", days);
  }
  if (span < 2 * 365 * DAY) {
    const months = Math.max(2, Math.round(span / (30 * DAY)));
    return timeCount("month", months);
  }
  const years = Math.max(2, Math.round(span / (365 * DAY)));
  return timeCount("year", years);
}

function formatReviewDuration(duration) {
  const totalMinutes = Math.floor(duration / (60 * 1000));
  if (totalMinutes < 1) return t("leaderboard.underMinute");
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return t("leaderboard.daysHours", { days: number(days), hours: number(hours) });
  if (hours > 0) return t("leaderboard.hoursMinutes", { hours: number(hours), minutes: number(minutes) });
  return t("leaderboard.minutes", { minutes: number(minutes) });
}

function dateTime(value) {
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) return t("time.unknownDate");
  return new Intl.DateTimeFormat(I18N.locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(timestamp));
}

function shortDate(value) {
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) return t("time.unknownDate");
  return new Intl.DateTimeFormat(I18N.locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp));
}

function compareEvents(left, right) {
  return eventTime(left) - eventTime(right) || String(left.submissionId).localeCompare(String(right.submissionId));
}

function latestAppVersion(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const value = events[index]?.appVersion;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function eventTime(event) {
  const timestamp = Date.parse(event?.occurredAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function publicGuideline(event) {
  const code = typeof event?.guidelineCode === "string" ? event.guidelineCode.trim() : "";
  const title = typeof event?.guidelineTitle === "string" ? event.guidelineTitle.trim() : "";
  const guideline = code ? t("tooltip.guideline", { code }) : "";
  return [guideline, title].filter(Boolean).join(" · ");
}

function normalizedPublicName(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedPublicCategory(value) {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim() : null;
}

function normalizedAppStoreId(value) {
  const id = String(value || "");
  return /^\d{6,20}$/.test(id) ? id : null;
}

function platformRank(platform) {
  const normalized = String(platform || "").toLocaleLowerCase();
  if (normalized === "ios") return 0;
  if (normalized === "macos") return 1;
  if (normalized === "tvos") return 2;
  if (normalized === "visionos") return 3;
  return 4;
}

function canRevealAppName(app) {
  return !app.isApproved && Boolean(app.knownName);
}

function displayedAppName(app) {
  return app.revealedName || app.appName;
}

function subscribeAppName(app, listener, callImmediately = true) {
  app.nameRevealListeners ||= new Set();
  app.nameRevealListeners.add(listener);
  if (callImmediately) listener();
}

function notifyAppName(app) {
  for (const listener of app.nameRevealListeners || []) listener();
}

function createAppNameLabel(app, className) {
  if (!canRevealAppName(app)) {
    const label = element("span", className);
    label.textContent = displayedAppName(app);
    return label;
  }

  const button = element("button", `${className} app-name-reveal-label`);
  button.type = "button";
  const update = () => {
    const revealed = Boolean(app.revealedName);
    button.textContent = displayedAppName(app);
    button.disabled = revealed;
    button.setAttribute("aria-label", revealed
      ? t("timeline.revealedNameAria", { app: displayedAppName(app) })
      : t("timeline.revealNameAria"));
  };
  subscribeAppName(app, update);
  button.addEventListener("click", () => revealAppName(app));
  return button;
}

function revealAppName(app) {
  if (!canRevealAppName(app) || app.revealedName) return;
  app.revealedName = app.knownName;
  notifyAppName(app);
}

function appStoreUrl(appStoreId) {
  return /^\d{6,20}$/.test(String(appStoreId || ""))
    ? `https://apps.apple.com/app/id${appStoreId}`
    : null;
}

function controlButton(label, ariaLabel) {
  const button = element("button", "timeline-control");
  button.type = "button";
  button.textContent = label;
  button.setAttribute("aria-label", ariaLabel);
  return button;
}

function emptyState(title, copy) {
  const wrapper = element("div", "empty-state");
  const strong = element("strong");
  strong.textContent = title;
  const paragraph = element("p");
  paragraph.textContent = copy;
  wrapper.append(strong, paragraph);
  return wrapper;
}

function element(tagName, className = "") {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  return node;
}

function svgElement(tagName, className = "") {
  const node = document.createElementNS(SVG_NS, tagName);
  if (className) node.setAttribute("class", className);
  return node;
}

function setAttributes(node, attributes) {
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function number(value) {
  return I18N.number(value);
}

function appCount(value) {
  const key = Number(value) === 1 ? "timeline.appCount.one" : "timeline.appCount.other";
  return t(key, { count: number(value) });
}

function timeCount(unit, value) {
  const key = Number(value) === 1 ? `time.${unit}.one` : `time.${unit}.other`;
  return t(key, { count: number(value) });
}

function localizedCategory(value) {
  return I18N.category(value);
}

loadTimelines();
