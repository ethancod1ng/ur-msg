const state = { vacancies: [], loading: false, monitor: null };
const elements = {
  list: document.querySelector("#vacancy-list"), status: document.querySelector("#status"),
  search: document.querySelector("#search"), city: document.querySelector("#city-filter"),
  layout: document.querySelector("#layout-filter"), price: document.querySelector("#price-filter"),
  commute: document.querySelector("#commute-filter"), sort: document.querySelector("#sort-order"),
  refresh: document.querySelector("#refresh"), total: document.querySelector("#total-count"),
  newCount: document.querySelector("#new-count"), monitorLabel: document.querySelector("#monitor-label"),
  monitorMessage: document.querySelector("#monitor-message"), monitorSummary: document.querySelector(".monitor-summary"),
  lastSuccess: document.querySelector("#last-success"), label: document.querySelector("#result-label"),
  sync: document.querySelector("#sync-time"),
};
const yen = new Intl.NumberFormat("ja-JP");
const DAY_MS = 24 * 60 * 60 * 1000;

function text(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value ?? "—";
  return node;
}

function floorArea(value = "") {
  const match = String(value).match(/[\d.]+/);
  return match ? Number(match[0]) : 0;
}

function isNew(item) {
  const age = Date.now() - Date.parse(item.first_seen_at);
  return age >= 0 && age < DAY_MS;
}

function makeFact(label, value) {
  const fact = document.createElement("div");
  fact.className = "fact";
  fact.append(text("span", "", label), text("strong", "", value || "—"));
  return fact;
}

function vacancyCard(item) {
  const card = document.createElement("article");
  card.className = "vacancy-card";
  const top = document.createElement("div");
  top.className = "card-top";
  const identity = document.createElement("div");
  const badges = document.createElement("div");
  badges.className = "badges";
  badges.append(text("span", "city", item.city));
  if (isNew(item)) badges.append(text("span", "new-badge", "NEW"));
  identity.append(badges, text("h3", "", item.building), text("p", "room", item.room));
  const rent = document.createElement("div");
  rent.className = "rent";
  rent.append(
    text("strong", "", `${yen.format(item.monthly_total_yen)}円`),
    text("span", "", `房租 ${yen.format(item.rent_yen)}円 · 共益费 ${yen.format(item.common_fee_yen)}円`),
  );
  top.append(identity, rent);
  const facts = document.createElement("div");
  facts.className = "facts";
  facts.append(
    makeFact("户型 / 面积", [item.layout, item.floor_space].filter(Boolean).join(" · ")),
    makeFact("楼层", item.floor),
    makeFact("到茅场町", item.commute_minutes == null ? "—" : `${item.commute_minutes} 分钟`),
  );
  const link = document.createElement("a");
  link.className = "card-link";
  link.href = item.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.append(text("span", "", "查看 UR 官方详情"), text("span", "", "↗"));
  card.append(top, facts, text("p", "access", item.access), link);
  return card;
}

function filteredVacancies() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  const city = elements.city.value;
  const layout = elements.layout.value;
  const maxPrice = Number(elements.price.value || Infinity);
  const maxCommute = Number(elements.commute.value || Infinity);
  const rows = state.vacancies.filter((item) => {
    const haystack = [item.city, item.building, item.room, item.commute_station].join(" ").toLocaleLowerCase();
    return (!query || haystack.includes(query)) && (!city || item.city === city) &&
      (!layout || item.layout === layout) && item.monthly_total_yen <= maxPrice &&
      (item.commute_minutes == null || item.commute_minutes <= maxCommute);
  });
  const sorters = {
    recommended: (a, b) => Number(isNew(b)) - Number(isNew(a)) || a.monthly_total_yen - b.monthly_total_yen,
    rent: (a, b) => a.monthly_total_yen - b.monthly_total_yen,
    commute: (a, b) => (a.commute_minutes ?? Infinity) - (b.commute_minutes ?? Infinity),
    area: (a, b) => floorArea(b.floor_space) - floorArea(a.floor_space),
  };
  return rows.sort(sorters[elements.sort.value]);
}

function render() {
  const rows = filteredVacancies();
  elements.list.replaceChildren(...rows.map(vacancyCard));
  elements.label.textContent = `显示 ${rows.length} / ${state.vacancies.length} 间`;
  if (!state.loading && rows.length === 0) {
    showStatus(state.vacancies.length ? "没有符合当前筛选的房源。" : "当前暂无符合条件的空房。", false);
  } else if (!state.loading) elements.status.hidden = true;
}

function showStatus(message, spinning = false, retry = false) {
  elements.status.hidden = false;
  elements.status.replaceChildren();
  if (spinning) elements.status.append(text("div", "spinner", ""));
  elements.status.append(text("p", "", message));
  if (retry) {
    const button = text("button", "", "重新加载");
    button.type = "button";
    button.addEventListener("click", loadVacancies);
    elements.status.append(button);
  }
}

function replaceOptions(select, label, values) {
  const selected = select.value;
  select.replaceChildren(new Option(label, ""), ...values.map((value) => new Option(value, value)));
  select.value = values.includes(selected) ? selected : "";
}

function updateSummary(payload) {
  elements.total.textContent = payload.stats.vacancy_count;
  elements.newCount.textContent = payload.stats.new_count_24h;
  elements.monitorSummary.className = `monitor-summary ${payload.monitor.code}`;
  elements.monitorLabel.replaceChildren(text("i", "status-dot", ""), document.createTextNode(payload.monitor.label));
  elements.monitorMessage.textContent = payload.monitor.message;
  elements.lastSuccess.textContent = payload.monitor.last_success_at
    ? new Date(payload.monitor.last_success_at).toLocaleTimeString("zh-CN", {
        timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false,
      })
    : "—";
  replaceOptions(elements.city, "全部区域", payload.filters.cities);
  replaceOptions(elements.layout, "全部户型", payload.filters.layouts);
}

async function loadVacancies() {
  if (state.loading) return;
  state.loading = true;
  elements.refresh.disabled = true;
  showStatus("正在同步 UR 空房数据…", true);
  try {
    const response = await fetch("/api/dashboard", { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload.vacancies)) throw new Error(payload.error || "无法读取空房数据");
    state.vacancies = payload.vacancies;
    state.monitor = payload.monitor;
    elements.sync.textContent = `网页同步：${new Date(payload.synchronized_at).toLocaleString("zh-CN", {
      timeZone: "Asia/Tokyo", hour12: false,
    })} JST`;
    updateSummary(payload);
  } catch (error) {
    showStatus(`加载失败：${error.message}`, false, true);
    elements.label.textContent = "数据暂时不可用";
    return;
  } finally {
    state.loading = false;
    elements.refresh.disabled = false;
  }
  render();
}

[elements.search, elements.city, elements.layout, elements.price, elements.commute, elements.sort]
  .forEach((control) => control.addEventListener("input", render));
elements.refresh.addEventListener("click", loadVacancies);
loadVacancies();
setInterval(loadVacancies, 5 * 60 * 1000);
