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

  const groups = new Map();
  for (const event of events) {
    const appIdentity = event.appStoreId || event.appName;
    const key = `${appIdentity}\u0000${event.platform}`;
    const group = groups.get(key) || {
      appName: event.appName,
      appStoreId: event.appStoreId,
      appIconUrl: null,
      platform: event.platform,
      events: [],
    };
    if (event.appIconUrl) group.appIconUrl = event.appIconUrl;
    group.events.push(event);
    groups.set(key, group);
  }

  const ordered = [...groups.values()]
    .map((group) => ({
      ...group,
      events: group.events.sort(compareEvents),
    }))
    .sort((left, right) => {
      const latestDifference = eventTime(right.events.at(-1)) - eventTime(left.events.at(-1));
      return latestDifference || left.appName.localeCompare(right.appName) || left.platform.localeCompare(right.platform);
    });

  timelinesNode.replaceChildren(...ordered.map(createTimelineRow));
}

function createTimelineRow(group) {
  const row = element("article", "timeline-row");
  const header = element("header", "timeline-row-header");
  const identity = element("div", "timeline-identity");
  identity.append(createAppIcon(group));

  const nameBlock = element("div", "timeline-name");
  const title = element("h3");
  title.textContent = group.appName;
  const meta = element("div", "timeline-meta");
  const platform = element("span", "platform-pill");
  platform.textContent = group.platform;
  const count = element("span");
  count.textContent = `${number(group.events.length)} ${group.events.length === 1 ? "submission" : "submissions"}`;
  meta.append(platform, count);
  nameBlock.append(title, meta);
  identity.append(nameBlock);

  const controls = element("div", "timeline-controls");
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", `Zoom controls for ${group.appName} on ${group.platform}`);
  const zoomOut = controlButton("−", "Zoom out");
  zoomOut.dataset.action = "out";
  const zoomLevel = element("span", "zoom-level");
  zoomLevel.textContent = "1×";
  zoomLevel.setAttribute("aria-live", "polite");
  const zoomIn = controlButton("+", "Zoom in");
  zoomIn.dataset.action = "in";
  const reset = controlButton("Reset", "Reset timeline zoom");
  reset.dataset.action = "reset";
  reset.classList.add("reset-button");
  controls.append(zoomOut, zoomLevel, zoomIn, reset);
  header.append(identity, controls);

  const chartWrap = element("div", "timeline-chart-wrap");
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add("timeline-chart");
  svg.setAttribute("role", "img");
  svg.setAttribute("tabindex", "0");
  svg.setAttribute("aria-label", `${group.appName} ${group.platform} review outcomes by date`);
  const hint = element("p", "timeline-interaction-hint");
  hint.textContent = "Scroll or pinch to zoom · drag to pan · use arrow keys to move";
  chartWrap.append(svg, hint);

  row.append(header, chartWrap);
  const reasons = createRejectionReasons(group);
  if (reasons) row.append(reasons);

  new TimelineChart(svg, group.events, {
    zoomIn,
    zoomOut,
    reset,
    zoomLevel,
  });
  return row;
}

function createAppIcon(group) {
  const fallback = element("span", "app-icon app-icon-fallback");
  fallback.textContent = group.appName.slice(0, 1).toUpperCase() || "A";
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

function createRejectionReasons(group) {
  const failures = group.events.filter((event) => event.status === "issue" && event.rejectionReason);
  if (failures.length === 0) return null;

  const section = element("section", "rejection-reasons");
  const heading = element("h4");
  heading.textContent = failures.length === 1 ? "Rejection reason" : "Rejection reasons";
  const list = element("div", "rejection-list");

  for (const event of [...failures].reverse()) {
    const item = element("article", "rejection-item");
    const context = element("p", "rejection-context");
    const version = event.appVersion ? `Version ${event.appVersion}` : "Version unavailable";
    context.textContent = `${version} · ${dateTime(event.occurredAt)}`;
    const reason = element("p", "rejection-copy");
    reason.textContent = event.rejectionReason;
    item.append(context, reason);
    list.append(item);
  }
  section.append(heading, list);
  return section;
}

class TimelineChart {
  constructor(svg, events, controls) {
    this.svg = svg;
    this.controls = controls;
    this.points = events
      .map((event) => ({ event, time: eventTime(event), slot: 0 }))
      .filter((point) => Number.isFinite(point.time))
      .sort((left, right) => left.time - right.time || left.event.submissionId.localeCompare(right.event.submissionId));
    this.zoom = 1;
    this.maximumZoom = 256;
    this.viewStart = 0;
    this.drag = null;
    this.width = 0;
    this.slotCount = 1;
    this.setDomain();
    this.bindControls();
    this.bindGestures();

    if ("ResizeObserver" in window) {
      this.resizeObserver = new ResizeObserver(() => this.render());
      this.resizeObserver.observe(svg.parentElement);
    } else {
      window.addEventListener("resize", () => this.render());
    }
    this.render();
  }

  setDomain() {
    const minimum = this.points[0]?.time ?? Date.now();
    const maximum = this.points.at(-1)?.time ?? minimum;
    const observedSpan = maximum - minimum;
    if (observedSpan < 2 * DAY) {
      const middle = (minimum + maximum) / 2;
      this.domainStart = middle - DAY;
      this.domainEnd = middle + DAY;
    } else {
      const padding = observedSpan * 0.08;
      this.domainStart = minimum - padding;
      this.domainEnd = maximum + padding;
    }
    this.domainSpan = this.domainEnd - this.domainStart;
    this.viewStart = this.domainStart;
  }

  bindControls() {
    this.controls.zoomIn.addEventListener("click", () => this.zoomAt(1.7, 0.5));
    this.controls.zoomOut.addEventListener("click", () => this.zoomAt(1 / 1.7, 0.5));
    this.controls.reset.addEventListener("click", () => this.reset());
  }

  bindGestures() {
    this.svg.addEventListener("wheel", (event) => {
      event.preventDefault();
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY) && !event.ctrlKey) {
        this.panByPixels(event.deltaX);
        return;
      }
      const bounds = this.svg.getBoundingClientRect();
      const svgX = bounds.width > 0 ? ((event.clientX - bounds.left) / bounds.width) * this.width : this.width / 2;
      const ratio = clamp((svgX - this.marginLeft) / this.plotWidth(), 0, 1);
      this.zoomAt(Math.exp(-event.deltaY * 0.002), ratio);
    }, { passive: false });

    this.svg.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.drag = { pointerX: event.clientX, viewStart: this.viewStart };
      this.svg.setPointerCapture(event.pointerId);
      this.svg.classList.add("is-dragging");
    });
    this.svg.addEventListener("pointermove", (event) => {
      if (!this.drag) return;
      const bounds = this.svg.getBoundingClientRect();
      const cssPlotWidth = this.plotWidth() * (bounds.width / this.width);
      if (cssPlotWidth <= 0) return;
      const delta = event.clientX - this.drag.pointerX;
      this.viewStart = this.clampViewStart(
        this.drag.viewStart - (delta / cssPlotWidth) * this.viewSpan(),
      );
      this.render();
    });
    const stopDragging = (event) => {
      if (!this.drag) return;
      this.drag = null;
      this.svg.classList.remove("is-dragging");
      if (this.svg.hasPointerCapture(event.pointerId)) this.svg.releasePointerCapture(event.pointerId);
    };
    this.svg.addEventListener("pointerup", stopDragging);
    this.svg.addEventListener("pointercancel", stopDragging);

    this.svg.addEventListener("keydown", (event) => {
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
    this.zoom = 1;
    this.viewStart = this.domainStart;
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

  assignSlots() {
    const lastXBySlot = [];
    const plotWidth = this.plotWidth();
    for (const point of this.points) {
      const x = this.marginLeft + ((point.time - this.domainStart) / this.domainSpan) * plotWidth;
      let slot = lastXBySlot.findIndex((lastX) => x - lastX >= 20);
      if (slot === -1) slot = lastXBySlot.length;
      lastXBySlot[slot] = x;
      point.slot = slot;
    }
    this.slotCount = Math.max(1, lastXBySlot.length);
  }

  render() {
    const measuredWidth = Math.floor(this.svg.clientWidth || this.svg.parentElement?.clientWidth || 700);
    this.width = Math.max(300, measuredWidth);
    this.marginLeft = this.width < 500 ? 22 : 34;
    this.marginRight = this.width < 500 ? 18 : 28;
    this.assignSlots();

    const markerTop = 22;
    const markerStep = 29;
    const axisY = markerTop + this.slotCount * markerStep + 12;
    const height = axisY + 42;
    this.svg.setAttribute("viewBox", `0 0 ${this.width} ${height}`);
    this.svg.style.height = `${height}px`;
    this.svg.replaceChildren();

    const viewEnd = this.viewStart + this.viewSpan();
    const ticks = timeTicks(this.viewStart, viewEnd, this.width < 520 ? 4 : 7);
    for (const tick of ticks) {
      const x = this.x(tick);
      const gridLine = svgElement("line", "timeline-grid-line");
      setAttributes(gridLine, { x1: x, x2: x, y1: 8, y2: axisY });
      const label = svgElement("text", "timeline-axis-label");
      setAttributes(label, { x, y: axisY + 25, "text-anchor": "middle" });
      label.textContent = formatAxisDate(tick, this.viewSpan());
      this.svg.append(gridLine, label);
    }

    const axis = svgElement("line", "timeline-axis-line");
    setAttributes(axis, {
      x1: this.marginLeft,
      x2: this.width - this.marginRight,
      y1: axisY,
      y2: axisY,
    });
    this.svg.append(axis);

    for (const point of this.points) {
      if (point.time < this.viewStart || point.time > viewEnd) continue;
      const x = this.x(point.time);
      const y = markerTop + point.slot * markerStep;
      const accepted = point.event.status === "success";
      const outcome = accepted ? "Accepted" : "Failed";
      const version = point.event.appVersion ? `, version ${point.event.appVersion}` : "";
      const label = `${outcome}${version}, ${dateTime(point.event.occurredAt)}`;

      const stem = svgElement("line", "timeline-event-stem");
      setAttributes(stem, { x1: x, x2: x, y1: y + 22, y2: axisY });
      const marker = svgElement("g", `timeline-event ${accepted ? "success" : "issue"}`);
      marker.setAttribute("tabindex", "0");
      marker.setAttribute("role", "img");
      marker.setAttribute("aria-label", label);
      const title = document.createElementNS(SVG_NS, "title");
      title.textContent = label;
      const block = svgElement("rect", "timeline-event-block");
      setAttributes(block, { x: x - 8, y, width: 16, height: 22, rx: 7, ry: 7 });
      marker.append(title, block);
      this.svg.append(stem, marker);
    }

    const roundedZoom = this.zoom >= 10 ? Math.round(this.zoom) : Math.round(this.zoom * 10) / 10;
    this.controls.zoomLevel.textContent = `${roundedZoom}×`;
    this.controls.zoomOut.disabled = this.zoom <= 1.001;
    this.controls.zoomIn.disabled = this.zoom >= this.maximumZoom - 0.001;
  }

  x(timestamp) {
    return this.marginLeft + ((timestamp - this.viewStart) / this.viewSpan()) * this.plotWidth();
  }
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

function dateTime(value) {
  const timestamp = Date.parse(value);
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

function eventTime(event) {
  const timestamp = Date.parse(event?.occurredAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
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
