const state = { vacancies: [], loading: false };
const elements = {
  list: document.querySelector("#vacancy-list"),
  status: document.querySelector("#status"),
  search: document.querySelector("#search"),
  layout: document.querySelector("#layout-filter"),
  sort: document.querySelector("#sort-order"),
  refresh: document.querySelector("#refresh"),
  total: document.querySelector("#total-count"),
  cities: document.querySelector("#city-count"),
  lowest: document.querySelector("#lowest-rent"),
  label: document.querySelector("#result-label"),
  sync: document.querySelector("#sync-time"),
};

const yen = new Intl.NumberFormat("ja-JP");

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
  identity.append(
    text("span", "city", item.city),
    text("h3", "", item.building),
    text("p", "room", item.room),
  );
  const rent = document.createElement("div");
  rent.className = "rent";
  rent.append(
    text("strong", "", `${yen.format(item.rent_yen)}円`),
    text("span", "", item.common_fee || "共益费请查看详情"),
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
  const layout = elements.layout.value;
  const rows = state.vacancies.filter((item) => {
    const haystack = [item.city, item.building, item.room, item.commute_station]
      .join(" ")
      .toLocaleLowerCase();
    return (!query || haystack.includes(query)) && (!layout || item.layout === layout);
  });

  const sorters = {
    rent: (a, b) => a.rent_yen - b.rent_yen,
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
  } else if (!state.loading) {
    elements.status.hidden = true;
  }
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

function updateSummary() {
  const rents = state.vacancies.map((item) => item.rent_yen).filter(Number.isFinite);
  elements.total.textContent = state.vacancies.length;
  elements.cities.textContent = new Set(state.vacancies.map((item) => item.city)).size;
  elements.lowest.textContent = rents.length ? `${yen.format(Math.min(...rents))}円` : "—";

  const layouts = [...new Set(state.vacancies.map((item) => item.layout).filter(Boolean))].sort();
  const selected = elements.layout.value;
  elements.layout.replaceChildren(new Option("全部户型", ""), ...layouts.map((item) => new Option(item, item)));
  elements.layout.value = layouts.includes(selected) ? selected : "";
}

async function loadVacancies() {
  if (state.loading) return;
  state.loading = true;
  elements.refresh.disabled = true;
  showStatus("正在同步 UR 空房数据…", true);
  try {
    const response = await fetch("/api/vacancies", { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload.vacancies)) {
      throw new Error(payload.error || "无法读取空房数据");
    }
    state.vacancies = payload.vacancies;
    elements.sync.textContent = `网页同步：${new Date(payload.synchronized_at).toLocaleString("zh-CN", { timeZone: "Asia/Tokyo", hour12: false })} JST`;
    updateSummary();
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

[elements.search, elements.layout, elements.sort].forEach((control) => {
  control.addEventListener("input", render);
});
elements.refresh.addEventListener("click", loadVacancies);

loadVacancies();
setInterval(loadVacancies, 5 * 60 * 1000);
