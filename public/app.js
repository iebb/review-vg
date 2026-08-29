const SVG_NS = "http://www.w3.org/2000/svg";
const DAY = 24 * 60 * 60 * 1000;
const timelinesNode = document.querySelector("#timelines");

document.querySelector("#copy-address")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText("report@review.vg");
    button.classList.add("is-copied");
    button.querySelector(".copy-label").textContent = "Copied";
    window.setTimeout(() => {
      button.classList.remove("is-copied");
      button.querySelector(".copy-label").textContent = "Copy";
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
      "Timeline temporarily unavailable",
      "Please try again in a moment.",
    ));
    console.error(error);
  } finally {
    timelinesNode.removeAttribute("aria-busy");
  }
}

function renderTimelines(events) {
  if (events.length === 0) {
    timelinesNode.replaceChildren(emptyState(
      "No timelines yet",
      "Forward a review result to begin an app timeline.",
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
    const approvedName = normalizedPublicName(event.appName);
    const category = normalizedPublicCategory(event.appCategory);
    const key = appStoreId ? `id:${appStoreId}` : `submission:${event.submissionId}`;
    const app = groups.get(key) || {
      approvedName: null,
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
    if (approvedName) app.approvedName = approvedName;
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
      appName: app.approvedName || "Unapproved app",
      appCategory: app.appCategory || "Uncategorized",
      isApproved: Boolean(app.approvedName),
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
        .sort((left, right) => platformRank(left.platform) - platformRank(right.platform) || left.platform.localeCompare(right.platform)),
    }))
    .sort((left, right) => right.latestEventAt - left.latestEventAt || left.appName.localeCompare(right.appName));
}

function createSharedTimeline(apps) {
  const board = element("article", "timeline-board");
  const toolbar = element("header", "timeline-board-toolbar");
  const summary = element("div", "timeline-board-summary");
  const summaryTitle = element("strong");
  summaryTitle.textContent = "All apps";
  const summaryCopy = element("span");
  summaryCopy.textContent = `${number(apps.length)} ${apps.length === 1 ? "app" : "apps"}`;
  summary.append(summaryTitle, summaryCopy);

  const controls = element("div", "timeline-controls");
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", "Shared timeline zoom controls");
  const zoomOut = controlButton("−", "Zoom out");
  const rangeLabel = element("span", "zoom-level");
  rangeLabel.textContent = "30 days";
  rangeLabel.setAttribute("aria-live", "polite");
  const zoomIn = controlButton("+", "Zoom in");
  const reset = controlButton("Latest", "Show the latest 30 days");
  reset.classList.add("reset-button");
  controls.append(zoomOut, rangeLabel, zoomIn, reset);
  toolbar.append(summary, controls);

  const filterBar = element("div", "timeline-filter-bar");
  const categoryField = element("label", "timeline-filter-field");
  const categoryLabel = element("span");
  categoryLabel.textContent = "Category";
  const categorySelect = element("select", "timeline-filter-input timeline-filter-select");
  categorySelect.setAttribute("aria-label", "Filter by app category");
  const allCategories = document.createElement("option");
  allCategories.value = "";
  allCategories.textContent = "All categories";
  categorySelect.append(allCategories);
  const categories = [...new Set(apps.map((app) => app.appCategory))]
    .sort((left, right) => left.localeCompare(right));
  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    categorySelect.append(option);
  }
  categoryField.append(categoryLabel, categorySelect);

  const appIdField = element("label", "timeline-filter-field");
  const appIdLabel = element("span");
  appIdLabel.textContent = "App ID";
  const appIdInput = element("input", "timeline-filter-input");
  appIdInput.type = "search";
  appIdInput.inputMode = "numeric";
  appIdInput.autocomplete = "off";
  appIdInput.placeholder = "Enter App Store ID";
  appIdInput.setAttribute("aria-label", "Filter by App Store app ID");
  appIdField.append(appIdLabel, appIdInput);

  const clearFilters = element("button", "timeline-filter-clear");
  clearFilters.type = "button";
  clearFilters.textContent = "Clear";
  clearFilters.disabled = true;
  const filterStatus = element("span", "timeline-filter-status");
  filterStatus.setAttribute("aria-live", "polite");
  filterBar.append(categoryField, appIdField, clearFilters, filterStatus);

  const body = element("div", "timeline-board-body");
  const lanes = [];
  const appRows = [];
  for (const app of apps) {
    const group = element("section", "timeline-app-group");
    group.setAttribute("aria-label", `${app.appName} review timeline`);
    const identity = createAppIdentity(app);
    identity.style.gridRow = `1 / span ${app.platforms.length}`;
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
      svg.setAttribute("aria-label", `${app.appName} ${platform.platform} review durations`);
      group.append(platformLabel, svg);
      lanes.push({ svg, appName: app.appName, platform: platform.platform, events: platform.events });
    });
    body.append(group);
    appRows.push({ app, group });
  }

  const axisRow = element("div", "timeline-axis-row");
  const axisSpacer = element("span", "timeline-axis-spacer");
  axisSpacer.setAttribute("aria-hidden", "true");
  const axis = document.createElementNS(SVG_NS, "svg");
  axis.classList.add("timeline-shared-axis");
  axis.setAttribute("role", "img");
  axis.setAttribute("aria-label", "Shared review date axis");
  axisRow.append(axisSpacer, axis);
  body.append(axisRow);

  const footer = element("footer", "timeline-board-footer");
  const hint = element("p", "timeline-interaction-hint");
  hint.textContent = "Hover or focus a bar for details · scroll or pinch to zoom · drag to pan";
  footer.append(hint);

  const tooltip = element("div", "timeline-tooltip");
  tooltip.setAttribute("role", "tooltip");
  tooltip.setAttribute("aria-hidden", "true");
  const noMatches = emptyState(
    "No matching apps",
    "Try another category or App Store ID.",
  );
  noMatches.classList.add("timeline-filter-empty");
  noMatches.hidden = true;
  board.append(toolbar, filterBar, noMatches, body, footer, tooltip);

  const applyFilters = () => {
    const selectedCategory = categorySelect.value;
    const appIdQuery = appIdInput.value.replace(/\D/g, "");
    if (appIdInput.value !== appIdQuery) appIdInput.value = appIdQuery;
    const hasFilters = Boolean(selectedCategory || appIdQuery);
    let visibleApps = 0;
    for (const row of appRows) {
      const visible = (!selectedCategory || row.app.appCategory === selectedCategory) &&
        (!appIdQuery || String(row.app.appStoreId || "").includes(appIdQuery));
      row.group.hidden = !visible;
      if (visible) visibleApps += 1;
    }
    summaryTitle.textContent = hasFilters ? "Filtered apps" : "All apps";
    summaryCopy.textContent = `${number(visibleApps)} ${visibleApps === 1 ? "app" : "apps"}`;
    filterStatus.textContent = hasFilters ? `${number(visibleApps)} shown` : "";
    clearFilters.disabled = !hasFilters;
    noMatches.hidden = visibleApps !== 0;
    body.hidden = visibleApps === 0;
    footer.hidden = visibleApps === 0;
  };
  categorySelect.addEventListener("change", applyFilters);
  appIdInput.addEventListener("input", applyFilters);
  clearFilters.addEventListener("click", () => {
    categorySelect.value = "";
    appIdInput.value = "";
    applyFilters();
    categorySelect.focus();
  });
  applyFilters();

  new SharedTimelineChart(axis, lanes, tooltip, {
    zoomIn,
    zoomOut,
    reset,
    rangeLabel,
  });
  return board;
}

function createAppIdentity(app) {
  const identity = element("div", "timeline-app-identity");
  identity.append(createAppIcon(app));
  const nameBlock = element("div", "timeline-name");
  const title = element("h3");
  title.textContent = app.appName;
  const meta = element("div", "timeline-app-meta");
  const category = element("span", "timeline-app-category");
  category.textContent = app.appCategory;
  category.title = app.appCategory;
  meta.append(category);
  nameBlock.append(title, meta);
  identity.append(nameBlock);
  return identity;
}

function createAppIcon(group) {
  const fallback = element("span", "app-icon app-icon-fallback");
  fallback.textContent = group.isApproved ? (group.appName.slice(0, 1).toUpperCase() || "A") : "#";
  fallback.setAttribute("aria-hidden", "true");
  if (!group.appIconUrl) return fallback;

  const image = document.createElement("img");
  image.className = "app-icon";
  image.src = group.appIconUrl;
  image.alt = `${group.appName} icon`;
  image.loading = "lazy";
  image.referrerPolicy = "no-referrer";
  image.addEventListener("error", () => image.replaceWith(fallback), { once: true });

  const storeUrl = appStoreUrl(group.appStoreId);
  if (!storeUrl) return image;
  const link = element("a", "app-icon-link");
  link.href = storeUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", `Open ${group.appName} in the App Store`);
  link.append(image);
  return link;
}

class SharedTimelineChart {
  constructor(axis, lanes, tooltip, controls) {
    this.axis = axis;
    this.lanes = lanes.map((lane) => {
      const points = lane.events
        .map((event) => timelinePoint(event, lane.appName))
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
      const outcome = accepted ? "Accepted" : "Failed";
      const version = point.event.appVersion ? `, version ${point.event.appVersion}` : "";
      const label = `${lane.appName}, ${lane.platform}. ${outcome}${version}. Submitted ${dateTime(point.startTime)}. Apple replied ${dateTime(point.endTime)}.`;
      const reason = accepted ? "" : publicRejectionReason(point.event.rejectionReason);
      const accessibleLabel = reason ? `${label} ${reason}` : label;

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
    heading.textContent = `${point.appName} · ${point.event.platform}`;
    const timing = element("span", "timeline-tooltip-timing");
    timing.textContent = `${accepted ? "Accepted" : "Failed"}${point.event.appVersion ? ` · Version ${point.event.appVersion}` : ""}\nSubmitted ${dateTime(point.startTime)}\nApple replied ${dateTime(point.endTime)}`;
    const content = [heading, timing];
    const reason = accepted ? "" : publicRejectionReason(point.event.rejectionReason);
    if (reason) {
      const copy = element("span", "timeline-tooltip-reason");
      copy.textContent = reason;
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

function timelinePoint(event, appName) {
  const endTime = Date.parse(event?.occurredAt);
  const submittedTime = Date.parse(event?.submittedAt);
  const startTime = Number.isFinite(submittedTime) && submittedTime <= endTime
    ? submittedTime
    : endTime;
  return { event, appName, startTime, endTime };
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
  return new Intl.DateTimeFormat(undefined, options).format(new Date(timestamp));
}

function formatRange(span) {
  if (span < 2 * DAY) {
    const hours = Math.max(1, Math.round(span / (60 * 60 * 1000)));
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  if (span < 60 * DAY) {
    const days = Math.max(2, Math.round(span / DAY));
    return `${days} days`;
  }
  if (span < 2 * 365 * DAY) {
    const months = Math.max(2, Math.round(span / (30 * DAY)));
    return `${months} months`;
  }
  const years = Math.max(2, Math.round(span / (365 * DAY)));
  return `${years} years`;
}

function dateTime(value) {
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
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

function publicRejectionReason(value) {
  if (typeof value !== "string") return "";
  return value.replace(/(?:^|\n)\s*Next Steps\b[\s\S]*$/i, "").trim();
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
  return 2;
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
  return new Intl.NumberFormat().format(Number(value || 0));
}

loadTimelines();
