const WS_URL = `ws://${location.host}/fe`;
const MAX_POINTS = 20;

let ws = null;
let reconnectTimer = null;

function send(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  } else {
    console.warn('[WS] Chưa kết nối server, không thể gửi lệnh!');
  }
}

function connect() {
  clearTimeout(reconnectTimer);
  console.log('[WS] Đang kết nối tới server...');
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('[WS] Kết nối server thành công!');
  };

  ws.onclose = () => {
    console.warn('[WS] Mất kết nối. Thử lại sau 5 giây...');
    reconnectTimer = setTimeout(connect, 5000);
  };

  ws.onerror = (e) => {
    console.error('[WS] Lỗi:', e.message || 'unknown');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === 'sensor_update') {
        updateSensors(msg.temp, msg.humidity);
        pushChartData(msg.temp, msg.humidity);
        console.log(`[WS] Sensor: ${msg.temp}°C | ${msg.humidity}%`);

      } else if (msg.type === 'motor_state') {
        fanSwitch.checked = msg.state === 'ON';
        updateDevices();
        console.log(`[WS] Motor: ${msg.state} | ESP: ${msg.esp_connected ? 'online' : 'offline'}`);

      } else if (msg.type === 'esp_status') {
        console.log(`[WS] ESP ${msg.connected ? 'đã kết nối' : 'đã ngắt kết nối'}`);
      }
    } catch (e) {
      console.error('[WS] Lỗi parse JSON:', e.message);
    }
  };
}

// UI, Chart.js, điều khiển thiết bị
const tempValueEl = document.getElementById('tempValue');
const humidityValueEl = document.getElementById('humidityValue');
const fanSwitch = document.getElementById('fanSwitch');
const alarmSwitch = document.getElementById('alarmSwitch');

function updateSensors(temp, humidity) {
  tempValueEl.textContent = parseFloat(temp).toFixed(1) + '°C';
  humidityValueEl.textContent = Math.round(humidity) + '%';
}

function updateDeviceBadge(switchEl, badgeId) {
  const on = switchEl.checked;
  const badge = document.getElementById(badgeId);
  badge.textContent = on ? 'On' : 'Off';
  badge.className = 'status-badge ' + (on ? 'on' : 'off');
}

function updateDevices() {
  updateDeviceBadge(fanSwitch, 'fanBadge');
  updateDeviceBadge(alarmSwitch, 'alarmBadge');
}

fanSwitch.addEventListener('change', () => {
  const state = fanSwitch.checked ? 'ON' : 'OFF';
  send({ type: 'motor_cmd', state });
  updateDevices();
  console.log(`[WS] Gửi lệnh quạt: ${state}`);
});

alarmSwitch.addEventListener('change', () => {
  updateDevices();
});

document.getElementById('allOnBtn').addEventListener('click', () => {
  fanSwitch.checked = true;
  alarmSwitch.checked = true;
  send({ type: 'motor_cmd', state: 'ON' });
  updateDevices();
});

document.getElementById('allOffBtn').addEventListener('click', () => {
  fanSwitch.checked = false;
  alarmSwitch.checked = false;
  send({ type: 'motor_cmd', state: 'OFF' });
  updateDevices();
});

const tempCtx = document.getElementById('tempChart').getContext('2d');
const humidityCtx = document.getElementById('humidityChart').getContext('2d');

const tempGradient = tempCtx.createLinearGradient(0, 0, 0, 210);
tempGradient.addColorStop(0, 'rgba(245, 158, 11, 0.22)');
tempGradient.addColorStop(1, 'rgba(245, 158, 11, 0)');

const humidityGradient = humidityCtx.createLinearGradient(0, 0, 0, 210);
humidityGradient.addColorStop(0, 'rgba(37, 99, 235, 0.18)');
humidityGradient.addColorStop(1, 'rgba(37, 99, 235, 0)');

const commonOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      titleColor: '#ffffff',
      bodyColor: '#e2e8f0',
      borderColor: 'rgba(148, 163, 184, 0.25)',
      borderWidth: 1,
      padding: 12,
      displayColors: false
    }
  },
  scales: {
    x: {
      grid: { color: 'rgba(226, 232, 240, 0.6)', drawBorder: false },
      ticks: { color: '#94a3b8', font: { family: 'Roboto', size: 12 } },
      border: { display: false }
    },
    y: {
      grid: { color: 'rgba(226, 232, 240, 0.8)', drawBorder: false },
      ticks: { color: '#94a3b8', font: { family: 'Roboto', size: 12 } },
      border: { display: false }
    }
  }
};

const tempChart = new Chart(tempCtx, {
  type: 'line',
  data: {
    labels: ['0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0'],
    datasets: [{
      label: 'Nhiệt độ',
      data: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      borderColor: '#f59e0b',
      backgroundColor: tempGradient,
      fill: true,
      tension: 0.38,
      borderWidth: 3,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointBackgroundColor: '#f59e0b',
      pointBorderColor: '#ffffff',
      pointBorderWidth: 2
    }]
  },
  options: {
    ...commonOptions,
    scales: {
      ...commonOptions.scales,
      y: { ...commonOptions.scales.y, min: 0, max: 50, ticks: { ...commonOptions.scales.y.ticks, stepSize: 10 } }
    }
  }
});

const humidityChart = new Chart(humidityCtx, {
  type: 'line',
  data: {
    labels: ['0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0'],
    datasets: [{
      label: 'Độ ẩm không khí',
      data: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      borderColor: '#2563eb',
      backgroundColor: humidityGradient,
      fill: true,
      tension: 0.38,
      borderWidth: 3,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointBackgroundColor: '#2563eb',
      pointBorderColor: '#ffffff',
      pointBorderWidth: 2
    }]
  },
  options: {
    ...commonOptions,
    scales: {
      ...commonOptions.scales,
      y: { ...commonOptions.scales.y, min: 0, max: 100, ticks: { ...commonOptions.scales.y.ticks, stepSize: 20 } }
    }
  }
});

function pushChartData(temp, humidity) {
  const now = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  if (tempChart.data.labels.length >= MAX_POINTS) {
    tempChart.data.labels.shift();
    tempChart.data.datasets[0].data.shift();
    humidityChart.data.labels.shift();
    humidityChart.data.datasets[0].data.shift();
  }

  tempChart.data.labels.push(now);
  tempChart.data.datasets[0].data.push(parseFloat(temp));
  tempChart.update('none');

  humidityChart.data.labels.push(now);
  humidityChart.data.datasets[0].data.push(parseFloat(humidity));
  humidityChart.update('none');
}

updateDevices();
connect();
