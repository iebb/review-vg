const resultsNode = document.querySelector("#results");
const timelinesNode = document.querySelector("#timelines");
const filters = [...document.querySelectorAll(".filter")];

document.querySelector("#copy-address")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  await navigator.clipboard.writeText("report@review.vg");
  button.classList.add("is-copied");
  button.querySelector(".copy-label").textContent = "Copied";
  window.setTimeout(() => {
    button.classList.remove("is-copied");
    button.querySelector(".copy-label").textContent = "Copy";
  }, 1600);
});

filters.forEach((button) => {
  button.addEventListener("click", () => {
    filters.forEach((item) => item.classList.toggle("is-active", item === button));
    loadReviews(button.dataset.status);
  });
});

async function loadReviews(status = "all") {
  resultsNode.setAttribute("aria-busy", "true");
  timelinesNode.setAttribute("aria-busy", "true");
  try {
    const query = status === "all" ? "" : `?status=${encodeURIComponent(status)}`;
    const [reviewsResponse, timelineResponse] = await Promise.all([
      fetch(`/api/reviews${query}`),
      fetch("/api/timeline"),
    ]);
    if (!reviewsResponse.ok || !timelineResponse.ok) {
      throw new Error(`Request failed: ${reviewsResponse.status}/${timelineResponse.status}`);
    }
    const [reviewsData, timelineData] = await Promise.all([
      reviewsResponse.json(),
      timelineResponse.json(),
    ]);
    updateStats(reviewsData.stats);
    renderReviews(reviewsData.reviews);
    renderTimelines(timelineData.events);
  } catch (error) {
    resultsNode.innerHTML = `<div class="empty-state"><strong>Signal temporarily unavailable</strong><p>Please try again in a moment.</p></div>`;
    timelinesNode.innerHTML = `<div class="empty-state"><strong>Timeline temporarily unavailable</strong><p>Please try again in a moment.</p></div>`;
    console.error(error);
  } finally {
    resultsNode.removeAttribute("aria-busy");
    timelinesNode.removeAttribute("aria-busy");
  }
}

function renderTimelines(events) {
  if (!events.length) {
    timelinesNode.innerHTML = `<div class="empty-state"><strong>No timeline events yet</strong><p>Forward a review result to begin an app timeline.</p></div>`;
    return;
  }

  const groups = new Map();
  for (const event of events) {
    const key = `${event.appName}\u0000${event.platform}`;
    const group = groups.get(key) || { appName: event.appName, platform: event.platform, events: [] };
    group.events.push(event);
    groups.set(key, group);
  }

  const ordered = [...groups.values()]
    .map((group) => ({
      ...group,
      events: group.events.sort((left, right) => new Date(left.occurredAt) - new Date(right.occurredAt)),
    }))
    .sort((left, right) => {
      const leftDate = left.events.at(-1)?.occurredAt || "";
      const rightDate = right.events.at(-1)?.occurredAt || "";
      return rightDate.localeCompare(leftDate) || left.appName.localeCompare(right.appName);
    });

  timelinesNode.innerHTML = ordered.map(timelineRow).join("");
}

function timelineRow(group) {
  const first = group.events[0]?.occurredAt;
  const last = group.events.at(-1)?.occurredAt;
  const blocks = group.events.map((event) => {
    const accepted = event.status === "success";
    const outcome = accepted ? "Accepted" : "Failed";
    const version = event.appVersion ? ` · Version ${event.appVersion}` : "";
    const label = `${outcome}${version} · ${dateTime(event.occurredAt)}`;
    return `<span class="timeline-block ${accepted ? "success" : "issue"}" role="listitem" title="${escapeHtml(label)}"><span class="sr-only">${escapeHtml(label)}</span></span>`;
  }).join("");

  return `<article class="timeline-row">
    <header>
      <div><h3>${escapeHtml(group.appName)}</h3><span>${escapeHtml(group.platform)}</span></div>
      <strong>${number(group.events.length)} ${group.events.length === 1 ? "review" : "reviews"}</strong>
    </header>
    <div class="timeline-track" role="list" aria-label="${escapeHtml(`${group.appName} ${group.platform} review timeline`)}">${blocks}</div>
    <div class="timeline-dates"><span>${shortDate(first)}</span><span>${shortDate(last)}</span></div>
  </article>`;
}

function updateStats(stats) {
  document.querySelector("#stat-total").textContent = number(stats.total);
  document.querySelector("#stat-success").textContent = number(stats.successful);
  document.querySelector("#stat-issues").textContent = number(stats.issues);
  document.querySelector("#stat-time").textContent = duration(stats.averageReviewSeconds);
}

function renderReviews(reviews) {
  if (!reviews.length) {
    resultsNode.innerHTML = `<div class="empty-state"><strong>No reviews in this view yet</strong><p>Forward an App Store Connect review email to report@review.vg to add the first signal.</p></div>`;
    return;
  }
  resultsNode.innerHTML = reviews.map(reviewCard).join("");
}

function reviewCard(review) {
  const success = review.status === "success";
  const eventAt = success ? review.successfulAt : review.issueAt;
  const elapsed = review.submittedAt && eventAt
    ? duration((new Date(eventAt) - new Date(review.submittedAt)) / 1000)
    : "Not available";
  const detail = success
    ? `<div class="detail-block"><h4>Timeline</h4><p>Submitted ${dateTime(review.submittedAt)} and approved ${dateTime(review.successfulAt)}.</p></div>
       <div class="detail-block"><h4>Outcome</h4><p>Review completed successfully and the submission became eligible for distribution.</p>${verification(review)}</div>`
    : `<div class="detail-block"><h4>Issue description</h4><p>${escapeHtml(review.issueDescription || "Apple reported an issue with this submission.")}</p></div>
       <div class="detail-block"><h4>Next steps</h4><p>${escapeHtml(review.nextSteps || "See App Store Connect for the requested changes.")}</p>${verification(review)}</div>`;

  return `<article class="review-card ${review.status}">
    <div class="review-main">
      <div class="app-block">
        <div class="app-icon" aria-hidden="true">${escapeHtml(review.appName.slice(0, 1).toUpperCase())}</div>
        <div class="app-meta">
          <h3>${escapeHtml(review.appName)}</h3>
          <div class="meta-line"><span>${escapeHtml(review.platform)}</span>${review.appVersion ? `<span>Version ${escapeHtml(review.appVersion)}</span>` : ""}</div>
        </div>
      </div>
      <div>
        <div class="status-pill ${review.status}">${success ? "✓ Approved" : `! ${escapeHtml(review.guidelineCode || "Issue")}`}</div>
      </div>
      <div class="time-block"><span>Review time</span><strong>${elapsed}</strong></div>
    </div>
    <div class="review-detail">${detail}</div>
  </article>`;
}

function verification(review) {
  const authenticated = review.verification === "apple-authenticated";
  return `<span class="verification ${authenticated ? "" : "forwarded"}">${authenticated ? "Apple-authenticated email" : "Community-forwarded email"}</span>`;
}

function dateTime(value) {
  if (!value) return "at an unknown time";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function shortDate(value) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function duration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return "—";
  const totalMinutes = Math.max(0, Math.round(Number(seconds) / 60));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function number(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

loadReviews();
