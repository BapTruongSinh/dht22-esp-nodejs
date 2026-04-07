const WS_URL = `ws://${location.host}/fe`;
const MAX_POINTS = 20;

let currentAlarmState = false;
const ws = new WebSocket(WS_URL);

const send = (payload) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  } else {
    console.log('Chưa kết nối server, không gửi được lệnh!');
  }
}

const updateWSStatus = (connected) => {
  const badge = document.getElementById('wsStatusBadge');
  if (!badge) return;
  if (connected) {
    badge.innerHTML = 'Đã kết nối Server';
    badge.style.background = 'white';
    badge.style.color = 'green';
  } else {
    badge.innerHTML = 'Mất kết nối Server';
    badge.style.background = 'white';
    badge.style.color = 'red';
  }
}

ws.onopen = () => {
  updateWSStatus(true);
  modeSwitch.disabled = false;
  fanSwitch.disabled = modeSwitch.checked;
  alarmOffBtn.disabled = modeSwitch.checked;
};

ws.onclose = () => {
  updateWSStatus(false);
  modeSwitch.disabled = true;
  fanSwitch.disabled = true;
  alarmOffBtn.disabled = true;
};

ws.onmessage = (event) => {
  try {
    const msg = JSON.parse(event.data);

    console.log('msg:', msg);

    switch (msg.type) {
      case 'sensor_update':
        console.log('sensor_update:', msg);
        if (msg.app_state == "ERROR") {
          tempValueEl.textContent = '--';
          humidityValueEl.textContent = '--';
        } else {
          updateSensors(msg.temp, msg.humi);
          pushChartData(msg.temp, msg.humi);
          
          // Đồng bộ toàn bộ trạng thái thiết bị từ gói sensor_update
          syncDeviceUI(msg);
        }
        if (msg.app_state) document.getElementById('appStateValue').textContent = `Trạng thái: ${msg.app_state}`;
        break;

      case 'fan_state':
        // Gói lẻ: {state: "ON"|"OFF"} -> Đồng bộ quạt
        syncDeviceUI({ fan: msg.state === 'ON' });
        break;

      case 'mode_state':
        // Gói lẻ: {mode: "AUTO"|"MANUAL"} -> Đồng bộ mode
        syncDeviceUI({ mode: msg.mode });
        break;

      case 'buzzer_state':
        // Gói lẻ: {state: "ON"|"OFF"} -> Đồng bộ còi
        syncDeviceUI({ buzzer: msg.state === 'ON' });
        break;

      case 'esp_status': {
        const espStatusValue = document.getElementById('espStatusValue');
        const appStateValue = document.getElementById('appStateValue');

        espStatusValue.textContent = msg.connected ? 'Online' : 'Offline';
        espStatusValue.style.color = msg.connected ? 'green' : 'red';

        if (!msg.connected) {
          appStateValue.textContent = 'Trạng thái: ngắt kết nối';
          tempValueEl.textContent = '--';
          humidityValueEl.textContent = '--';
        }

        break;
      }

      default:
        console.log(`Lệnh không xác định: ${msg.type}`);
        break;
    }
  } catch (e) {
    console.log('Lỗi:', e.message);
  }
};

// UI, Chart.js, điều khiển thiết bị
const tempValueEl = document.getElementById('tempValue');
const humidityValueEl = document.getElementById('humidityValue');
const fanSwitch = document.getElementById('fanSwitch');
const alarmOffBtn = document.getElementById('alarmOffBtn');
const modeSwitch = document.getElementById('modeSwitch');
const modeLabel = document.getElementById('modeLabel');

const updateModeUI = (mode) => {
  const isAuto = mode === 'AUTO';
  modeSwitch.checked = isAuto;
  modeLabel.textContent = mode;
  modeLabel.style.color = isAuto ? 'blue' : 'orange';

  fanSwitch.disabled = isAuto;
  alarmOffBtn.disabled = isAuto;
}

const updateSensors = (temp, humidity) => {
  tempValueEl.textContent = parseFloat(temp).toFixed(1) + '°C';
  humidityValueEl.textContent = Math.round(humidity) + '%';
}

const updateBadge = (badgeId, isOn) => {
  const badge = document.getElementById(badgeId);
  if (!badge) return;
  badge.textContent = isOn ? 'On' : 'Off';
  badge.className = 'status-badge ' + (isOn ? 'on' : 'off');
}

const updateDevices = () => {
  updateBadge('fanBadge', fanSwitch.checked);
  updateBadge('alarmBadge', currentAlarmState);
}

// Hàm đồng bộ toàn diện giao diện thiết bị
const syncDeviceUI = (data) => {
  // Đồng bộ Mode
  if (data.mode !== undefined) {
    updateModeUI(data.mode);
  }
  
  // Đồng bộ FAN
  if (data.fan !== undefined) {
    fanSwitch.checked = (data.fan === true || data.fan === 'ON');
  }
  
  // Đồng bộ BUZZER
  if (data.buzzer !== undefined) {
    currentAlarmState = (data.buzzer === true || data.buzzer === 'ON');
  }
  
  // Cập nhật lại các Badge trên màn hình
  updateDevices();
}

// Điều khiển thiết bị
fanSwitch.addEventListener('change', () => {
  if (fanSwitch.disabled) return;
  const state = fanSwitch.checked ? 'ON' : 'OFF';
  send({ type: 'fan', state });
  updateDevices();
});

alarmOffBtn.addEventListener('click', () => {
  if (alarmOffBtn.disabled) return;
  send({ type: 'buzzer_off' });
});


modeSwitch.addEventListener('change', () => {
  const mode = modeSwitch.checked ? 'AUTO' : 'MANUAL';
  updateModeUI(mode);
  send({ type: 'mode', value: mode });
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

const pushChartData = (temp, humidity) => {
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
updateModeUI('AUTO');
