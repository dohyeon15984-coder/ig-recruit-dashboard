const MEDIA_TYPE_LABEL = { IMAGE: '이미지', VIDEO: '릴스/영상', CAROUSEL_ALBUM: '카드뉴스' };
const MEDIA_TYPE_ICON = { IMAGE: '🖼️', VIDEO: '🎬', CAROUSEL_ALBUM: '🗂️' };

// Tableau의 기본 카테고리 팔레트("Tableau 10")를 그대로 사용해 태블로 느낌을 낸다.
const TABLEAU10 = ['#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC'];

if (window.Chart) {
  Chart.defaults.font.family = "'Pretendard', -apple-system, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = '#6b7280';
  Chart.defaults.borderColor = '#eef0f5';
  Chart.defaults.plugins.tooltip.backgroundColor = '#1a2130';
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.titleFont = { weight: '600' };
}

function engagementRate(post) {
  const base = post.reach || post.views || 0;
  if (!base) return 0;
  const interactions = (post.like_count || 0) + (post.comments_count || 0) + (post.saved || 0) + (post.shares || 0);
  return interactions / base;
}

function groupAvgEngagement(posts, keyFn, labelFn) {
  const groups = new Map();
  for (const post of posts) {
    const key = keyFn(post);
    if (key == null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(post);
  }
  return [...groups.entries()]
    .map(([key, items]) => ({
      key,
      label: labelFn ? labelFn(key) : key,
      value: items.reduce((sum, p) => sum + engagementRate(p), 0) / items.length
    }))
    .sort((a, b) => b.value - a.value);
}

let followerChartInstance, mediaTypeChartInstance, categoryChartInstance, ageChartInstance, reachSparklineInstance, categoryDonutChartInstance;

// 막대 위에 값을 직접 표시해주는 미니 플러그인 (이 차트에만 적용, 전역 등록 아님)
function makeBarValueLabelPlugin(textColor) {
  return {
    id: 'barValueLabel',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      meta.data.forEach((bar, index) => {
        const value = chart.data.datasets[0].data[index];
        if (value == null) return;
        ctx.save();
        ctx.fillStyle = textColor;
        ctx.font = "700 12px 'Pretendard', sans-serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(value.toLocaleString(), bar.x, bar.y - 12);
        ctx.restore();
      });
    }
  };
}

// 어두운 히어로 카드(짙은 틸 배경) 위에 쓰는 흰색 라벨.
const barValueLabelPlugin = makeBarValueLabelPlugin('rgba(255,255,255,0.9)');
// 밝은 흰 배경 패널 위에 쓰는 어두운 라벨.
const barValueLabelPluginDark = makeBarValueLabelPlugin('#33403a');

// 보조 라인 데이터셋(예: 게시물 수) 위에 값을 표시하는 플러그인. 여러 데이터셋이 있는
// 콤보 차트에서 특정 datasetIndex 하나에만 적용하기 위해 인덱스를 받는다.
function makeLineValueLabelPlugin(datasetIndex, textColor) {
  return {
    id: `lineValueLabel${datasetIndex}`,
    afterDatasetsDraw(chart) {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (!meta) return;
      const { ctx } = chart;
      const data = chart.data.datasets[datasetIndex].data;
      meta.data.forEach((point, index) => {
        const value = data[index];
        if (value == null) return;
        ctx.save();
        ctx.fillStyle = textColor;
        ctx.font = "700 11px 'Pretendard', sans-serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(value.toLocaleString(), point.x, point.y - 8);
        ctx.restore();
      });
    }
  };
}

// 히어로 카드용 미니 스파크라인 (축/그리드 없이 추이만 보여줌)
function renderReachSparkline(entries) {
  const ctx = document.getElementById('reachHeroChart');
  if (!ctx) return;
  if (reachSparklineInstance) reachSparklineInstance.destroy();

  reachSparklineInstance = new Chart(ctx, {
    type: 'bar',
    plugins: [barValueLabelPlugin],
    data: {
      labels: entries.map((e) => e.date.slice(5).replace('-', '/')),
      datasets: [
        {
          type: 'bar',
          data: entries.map((e) => e.reach),
          backgroundColor: 'rgba(255,255,255,0.32)',
          hoverBackgroundColor: 'rgba(255,255,255,0.5)',
          borderRadius: 3,
          maxBarThickness: 28,
          order: 2
        },
        {
          type: 'line',
          data: entries.map((e) => e.reach),
          borderColor: '#ffffff',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: '#ffffff',
          pointBorderColor: '#ffffff',
          tension: 0.3,
          order: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 24 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          displayColors: false,
          filter: (item) => item.datasetIndex === 0,
          callbacks: { label: (ctx) => `도달 ${ctx.parsed.y.toLocaleString()}` }
        }
      },
      scales: {
        x: { display: true, grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.6)', font: { size: 11 }, maxRotation: 0 } },
        y: { display: false }
      }
    }
  });
}

const AGE_ORDER = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
const BRAND_TEAL = '#22a488';

// 가로 막대 끝에 값을 직접 표시해주는 미니 플러그인 (이 차트에만 적용).
const horizontalBarValueLabelPlugin = {
  id: 'horizontalBarValueLabel',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    meta.data.forEach((bar, index) => {
      const value = chart.data.datasets[0].data[index];
      if (value == null) return;
      ctx.save();
      ctx.fillStyle = '#4b5a54';
      ctx.font = "700 11px 'Pretendard', sans-serif";
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${value}%`, bar.x + 6, bar.y);
      ctx.restore();
    });
  }
};

function renderAgeChart(ageMap) {
  const ctx = document.getElementById('ageChart');
  if (ageChartInstance) ageChartInstance.destroy();
  if (!ageMap) return;

  const total = Object.values(ageMap).reduce((a, b) => a + b, 0) || 1;
  const keys = AGE_ORDER.filter((k) => ageMap[k] != null);

  ageChartInstance = new Chart(ctx, {
    type: 'bar',
    plugins: [horizontalBarValueLabelPlugin],
    data: {
      labels: keys,
      datasets: [
        {
          label: '비율',
          data: keys.map((k) => +((ageMap[k] / total) * 100).toFixed(1)),
          backgroundColor: BRAND_TEAL,
          borderRadius: 6,
          maxBarThickness: 18
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      layout: { padding: { right: 30 } },
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { callback: (v) => v + '%' }, grid: { color: '#eef0f5' } },
        y: { grid: { display: false } }
      }
    }
  });
}

// 날짜(YYYY-MM-DD 또는 YYYY-MM)를 "26.09"처럼 짧게 줄여 표시한다.
function shortMonthLabel(dateStr) {
  return dateStr.slice(2, 7).replace('-', '.');
}

// 라인 차트의 각 점 위에 값을 직접 표시해주는 미니 플러그인 (이 차트에만 적용).
const lineValueLabelPlugin = {
  id: 'lineValueLabel',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    meta.data.forEach((point, index) => {
      const value = chart.data.datasets[0].data[index];
      if (value == null) return;
      ctx.save();
      ctx.fillStyle = '#33403a';
      ctx.font = "700 11px 'Pretendard', sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(value.toLocaleString(), point.x, point.y - 8);
      ctx.restore();
    });
  }
};

function renderFollowerChart(history) {
  const ctx = document.getElementById('followerChart');
  if (followerChartInstance) followerChartInstance.destroy();
  followerChartInstance = new Chart(ctx, {
    type: 'line',
    plugins: [lineValueLabelPlugin],
    data: {
      labels: history.map((h) => shortMonthLabel(h.date)),
      datasets: [
        {
          label: '팔로워 수',
          data: history.map((h) => h.follower_count ?? null),
          borderColor: BRAND_TEAL,
          backgroundColor: 'rgba(34,164,136,0.12)',
          pointRadius: 3,
          pointHoverRadius: 6,
          borderWidth: 2,
          fill: true,
          tension: 0.25
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 20 } },
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: false, grid: { color: '#eef0f5' } },
        x: { grid: { display: false } }
      }
    }
  });
}

// 일별 이력을 월 단위로 "합산"한 시계열로 만든다 (도달처럼 매일 새로 발생하는 지표용).
function monthlySeriesSum(history, field) {
  const byMonth = new Map();
  for (const h of history) {
    if (h[field] == null) continue;
    const month = h.date.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) || 0) + h[field]);
  }
  return [...byMonth.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

// 일별 이력을 월 단위로 묶어 "그 달의 마지막 값"을 취하는 시계열로 만든다 (프로필 조회수처럼 스냅샷 성격인 지표용).
function monthlySeriesLatest(history, field) {
  const byMonth = new Map();
  for (const h of history) {
    if (h[field] == null) continue;
    const month = h.date.slice(0, 7);
    const existing = byMonth.get(month);
    if (!existing || h.date > existing.date) byMonth.set(month, h);
  }
  return [...byMonth.values()]
    .map((h) => ({ date: h.date.slice(0, 7), value: h[field] }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildTrendSeries(history, field, mode, aggType) {
  if (mode === 'daily') {
    return history
      .filter((h) => h[field] != null)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30)
      .map((h) => ({ date: h.date, value: h[field] }));
  }
  return aggType === 'sum' ? monthlySeriesSum(history, field) : monthlySeriesLatest(history, field);
}

const trendChartInstances = {};
const trendChartSeries = {};

// 메모가 달린 지점 위에 작은 점을 하나 더 찍어 "여기 기록 있음"을 표시해주는 플러그인.
function makeNoteMarkerPlugin(getNotedIndexes) {
  return {
    id: 'noteMarker',
    afterDatasetsDraw(chart) {
      const notedIndexes = getNotedIndexes();
      if (!notedIndexes || !notedIndexes.size) return;
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      meta.data.forEach((point, index) => {
        if (!notedIndexes.has(index)) return;
        ctx.save();
        ctx.beginPath();
        ctx.arc(point.x + 7, point.y - 7, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#c8961e';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = "700 8px 'Pretendard', sans-serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', point.x + 7, point.y - 6.5);
        ctx.restore();
      });
    }
  };
}

function renderTrendChart(canvasId, instanceKey, series, mode, label, color, notesByPeriod, onPointClick, secondary) {
  const ctx = document.getElementById(canvasId);
  if (trendChartInstances[instanceKey]) trendChartInstances[instanceKey].destroy();
  trendChartSeries[instanceKey] = series;

  const notedIndexes = new Set();
  series.forEach((s, i) => {
    if (notesByPeriod && notesByPeriod[s.date]) notedIndexes.add(i);
  });

  const plugins = [makeNoteMarkerPlugin(() => notedIndexes)];
  if (mode === 'monthly') plugins.push(barValueLabelPluginDark);
  if (secondary) plugins.push(makeLineValueLabelPlugin(1, secondary.color));

  // 가장 높은 막대가 그래프 맨 위 끝까지 닿으면 그 위에 그리는 값 라벨이 카드 밖으로 잘려서,
  // y축 최댓값을 실제 데이터보다 넉넉하게 잡아 라벨 자리를 남겨둔다.
  const maxValue = Math.max(0, ...series.map((s) => s.value).filter((v) => v != null));

  const datasets = [
    {
      label,
      data: series.map((s) => s.value),
      backgroundColor: color + 'b3',
      hoverBackgroundColor: color,
      borderRadius: 5,
      maxBarThickness: mode === 'daily' ? 16 : 46
    }
  ];

  if (secondary) {
    datasets.push({
      type: 'line',
      label: secondary.label,
      data: secondary.series.map((s) => s.value),
      borderColor: secondary.color,
      backgroundColor: secondary.color,
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.25,
      yAxisID: 'y1'
    });
  }

  trendChartInstances[instanceKey] = new Chart(ctx, {
    type: 'bar',
    plugins,
    data: {
      labels: series.map((s) => (mode === 'daily' ? s.date.slice(5).replace('-', '/') : shortMonthLabel(s.date))),
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 20, right: 14 } },
      // 보조 라인의 점이 막대 위에 겹치면 정확히 그 점(반지름 몇 px)을 클릭해야만 반응하는
      // 문제가 생긴다. 'index'+intersect:false로 두면 그 달/날짜 열 어디를 클릭해도
      // (막대든 겹친 라인이든) 항상 막대(datasetIndex 0) 기준으로 반응한다.
      interaction: { mode: 'index', intersect: false },
      onClick: (evt, elements) => {
        if (!elements.length || !onPointClick) return;
        const barElement = elements.find((el) => el.datasetIndex === 0) || elements[0];
        onPointClick(barElement.index);
      },
      onHover: (evt, elements) => {
        if (evt.native && evt.native.target) evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      },
      plugins: {
        legend: secondary ? { display: true, position: 'top', align: 'end', labels: { boxWidth: 10, font: { size: 11 } } } : { display: false },
        tooltip: { mode: 'index', intersect: false, callbacks: { label: (ctx) => `${ctx.dataset.label} ${ctx.parsed.y.toLocaleString()}` } }
      },
      scales: {
        y: { beginAtZero: false, suggestedMax: maxValue * 1.18, grid: { color: '#eef0f5' } },
        x: { grid: { display: false }, ticks: { maxRotation: mode === 'daily' ? 45 : 0 } },
        ...(secondary
          ? {
              y1: {
                position: 'right',
                beginAtZero: true,
                grid: { display: false },
                ticks: { precision: 0 },
                suggestedMax: Math.max(0, ...secondary.series.map((s) => s.value).filter((v) => v != null)) * 1.3 || 1
              }
            }
          : {})
      }
    }
  });
}

function renderReachOnlyChart(history, mode, notesByPeriod, onPointClick) {
  const series = buildTrendSeries(history, 'reach', mode, 'sum');
  renderTrendChart('reachOnlyChart', 'reach', series, mode, '도달', BRAND_TEAL, notesByPeriod, onPointClick);
}

// 계정 단위 일별 조회수 API가 없어서, 게시물별 조회수를 게시 시점(timestamp) 기준으로 합산해 대신 쓴다.
function monthlySeriesSumFromPosts(posts, field) {
  const byMonth = new Map();
  for (const p of posts) {
    if (p[field] == null) continue;
    const month = p.timestamp.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) || 0) + p[field]);
  }
  return [...byMonth.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

// 최근 N일을 하루도 빠짐없이 나열하고, 게시물이 없는 날은 0으로 채운다.
function dailySeriesSumFromPosts(posts, field, days = 30) {
  const byDate = new Map();
  for (const p of posts) {
    if (p[field] == null) continue;
    const date = p.timestamp.slice(0, 10);
    byDate.set(date, (byDate.get(date) || 0) + p[field]);
  }
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    series.push({ date: dateStr, value: byDate.get(dateStr) || 0 });
  }
  return series;
}

// 조회수 막대와 정확히 같은 x축(달/날짜) 구간에 맞춰 그 구간에 올라온 게시물 개수를 센다.
// 별도로 집계하면 구간이 어긋날 수 있어, 기준(조회수) 시리즈의 date 목록을 그대로 재사용한다.
function postCountSeriesAligned(baseSeries, posts, mode) {
  const counts = new Map();
  for (const p of posts) {
    const key = mode === 'daily' ? p.timestamp.slice(0, 10) : p.timestamp.slice(0, 7);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return baseSeries.map((s) => ({ date: s.date, value: counts.get(s.date) || 0 }));
}

function renderViewsOnlyChart(posts, mode, notesByPeriod, onPointClick) {
  const series = mode === 'daily' ? dailySeriesSumFromPosts(posts, 'views') : monthlySeriesSumFromPosts(posts, 'views');
  const postCountSeries = postCountSeriesAligned(series, posts, mode);
  renderTrendChart('viewsOnlyChart', 'views', series, mode, '조회수', BRAND_TEAL, notesByPeriod, onPointClick, {
    series: postCountSeries,
    label: '게시물 수',
    color: '#c8961e'
  });
}

function renderMediaTypeChart(posts) {
  const data = groupAvgEngagement(posts, (p) => p.media_type, (k) => MEDIA_TYPE_LABEL[k] || k);
  const ctx = document.getElementById('mediaTypeChart');
  if (mediaTypeChartInstance) mediaTypeChartInstance.destroy();
  mediaTypeChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map((d) => d.label),
      datasets: [
        {
          label: '평균 참여율',
          data: data.map((d) => +(d.value * 100).toFixed(1)),
          backgroundColor: data.map((_, i) => TABLEAU10[i % TABLEAU10.length]),
          borderRadius: 6,
          maxBarThickness: 56
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { ticks: { callback: (v) => v + '%' }, grid: { color: '#eef0f5' } },
        x: { grid: { display: false } }
      }
    }
  });
}

function renderCategoryChart(posts) {
  const tagged = posts.filter((p) => p.category);
  const data = groupAvgEngagement(tagged, (p) => p.category);
  const ctx = document.getElementById('categoryChart');
  if (categoryChartInstance) categoryChartInstance.destroy();
  categoryChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map((d) => d.label),
      datasets: [
        {
          label: '평균 참여율',
          data: data.map((d) => +(d.value * 100).toFixed(1)),
          backgroundColor: data.map((_, i) => TABLEAU10[i % TABLEAU10.length]),
          borderRadius: 6,
          maxBarThickness: 22
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { callback: (v) => v + '%' }, grid: { color: '#eef0f5' } },
        y: { grid: { display: false } }
      }
    }
  });
}

// 도넛 조각 한가운데에 값(개수)을 직접 그려주는 미니 플러그인.
const donutValueLabelPlugin = {
  id: 'donutValueLabel',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const data = chart.data.datasets[0].data;
    meta.data.forEach((arc, i) => {
      const value = data[i];
      if (!value) return;
      const midAngle = (arc.startAngle + arc.endAngle) / 2;
      const radius = (arc.innerRadius + arc.outerRadius) / 2;
      const x = arc.x + Math.cos(midAngle) * radius;
      const y = arc.y + Math.sin(midAngle) * radius;
      ctx.save();
      ctx.fillStyle = '#fff';
      ctx.font = "700 11px 'Pretendard', sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(value.toLocaleString(), x, y);
      ctx.restore();
    });
  }
};

function renderCategoryDonutChart(posts, selectedCategory, onSliceClick) {
  const counts = new Map();
  posts.forEach((p) => {
    const key = p.category || CATEGORY_PLACEHOLDER;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const labels = entries.map(([k]) => k);

  const ctx = document.getElementById('categoryDonutChart');
  if (categoryDonutChartInstance) categoryDonutChartInstance.destroy();
  categoryDonutChartInstance = new Chart(ctx, {
    type: 'doughnut',
    plugins: [donutValueLabelPlugin],
    data: {
      labels,
      datasets: [
        {
          data: entries.map(([, v]) => v),
          backgroundColor: entries.map((_, i) => TABLEAU10[i % TABLEAU10.length]),
          borderWidth: labels.map((l) => (l === selectedCategory ? 3 : 2)),
          borderColor: labels.map((l) => (l === selectedCategory ? '#1a2130' : '#fff')),
          offset: labels.map((l) => (l === selectedCategory ? 16 : 0))
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (evt, elements) => {
        if (!elements.length || !onSliceClick) return;
        onSliceClick(labels[elements[0].index]);
      },
      onHover: (evt, elements) => {
        if (evt.native && evt.native.target) evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      },
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 10, padding: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${ctx.parsed}개` } }
      }
    }
  });
}
