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

let followerChartInstance, reachChartInstance, mediaTypeChartInstance, categoryChartInstance, ageChartInstance, reachSparklineInstance;

// 막대 위에 값을 직접 표시해주는 미니 플러그인 (이 차트에만 적용, 전역 등록 아님)
const barValueLabelPlugin = {
  id: 'barValueLabel',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    meta.data.forEach((bar, index) => {
      const value = chart.data.datasets[0].data[index];
      if (value == null) return;
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = "600 9px 'Pretendard', sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(value.toLocaleString(), bar.x, bar.y - 4);
      ctx.restore();
    });
  }
};

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
          data: entries.map((e) => e.reach),
          backgroundColor: 'rgba(255,255,255,0.55)',
          hoverBackgroundColor: '#ffffff',
          borderRadius: 3,
          maxBarThickness: 16
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 16 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          displayColors: false,
          callbacks: { label: (ctx) => `도달 ${ctx.parsed.y.toLocaleString()}` }
        }
      },
      scales: {
        x: { display: true, grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 9 }, maxRotation: 0 } },
        y: { display: false }
      }
    }
  });
}

const AGE_ORDER = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];

function renderAgeChart(ageMap) {
  const ctx = document.getElementById('ageChart');
  if (ageChartInstance) ageChartInstance.destroy();
  if (!ageMap) return;

  const total = Object.values(ageMap).reduce((a, b) => a + b, 0) || 1;
  const keys = AGE_ORDER.filter((k) => ageMap[k] != null);

  ageChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: keys,
      datasets: [
        {
          label: '비율',
          data: keys.map((k) => +((ageMap[k] / total) * 100).toFixed(1)),
          backgroundColor: '#4E79A7',
          borderRadius: 6,
          maxBarThickness: 18
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

function renderFollowerChart(history) {
  const ctx = document.getElementById('followerChart');
  if (followerChartInstance) followerChartInstance.destroy();
  followerChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: history.map((h) => h.date.slice(0, 7)),
      datasets: [
        {
          label: '팔로워 수',
          data: history.map((h) => h.follower_count ?? null),
          borderColor: '#4E79A7',
          backgroundColor: 'rgba(78,121,167,0.10)',
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
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: false, grid: { color: '#eef0f5' } },
        x: { grid: { display: false } }
      }
    }
  });
}

function renderReachChart(history) {
  const ctx = document.getElementById('reachChart');
  if (reachChartInstance) reachChartInstance.destroy();
  reachChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: history.map((h) => h.date),
      datasets: [
        {
          label: '도달',
          data: history.map((h) => h.reach ?? null),
          borderColor: '#4E79A7',
          backgroundColor: 'transparent',
          pointRadius: 2,
          pointHoverRadius: 5,
          borderWidth: 2,
          tension: 0.25,
          yAxisID: 'y'
        },
        {
          label: '프로필 조회수',
          data: history.map((h) => h.profile_views ?? null),
          borderColor: '#F28E2B',
          backgroundColor: 'transparent',
          pointRadius: 2,
          pointHoverRadius: 5,
          borderWidth: 2,
          tension: 0.25,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 7, padding: 14 }
        }
      },
      scales: {
        y: { position: 'left', beginAtZero: false, grid: { color: '#eef0f5' }, title: { display: true, text: '도달' } },
        y1: { position: 'right', beginAtZero: false, grid: { drawOnChartArea: false }, title: { display: true, text: '프로필 조회수' } },
        x: { grid: { display: false } }
      }
    }
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
