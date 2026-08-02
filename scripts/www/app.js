(function () {
  // 存储键名
  const STORAGE_KEY = 'animal_timer_data_v2';
  const SETTINGS_KEY = 'animal_timer_settings_v1';
  const LOG_KEY = 'animal_timer_log_v1';
  const MIAO_PREFIX = 'https://miaotixing.com/trigger?id=';
  let rows = [];
  let settings = {};
  let notificationLogs = [];

  // 固定编号范围 1 ~ N
  const DEFAULT_ID_COUNT = 20;

  // 内置铃声列表
  const BUILTIN_RINGTONES = [
    { name: '小艺', file: 'Xiaoyi.ogg' },
    { name: '爱琴海', file: 'Aegean_Sea.ogg' },
    { name: '觉醒', file: 'Awakening.ogg' },
    { name: '小溪', file: 'Creek.ogg' },
    { name: '布谷鸟', file: 'Cuckoo.ogg' },
    { name: '黎明', file: 'Dawn.ogg' },
    { name: '繁茂', file: 'Flourish.ogg' },
    { name: '森林旋律', file: 'Forest_Melody.ogg' },
    { name: '夏威夷', file: 'Hawaii.ogg' },
    { name: '时刻', file: 'Moment.ogg' },
    { name: '晨光', file: 'Morning_Light.ogg' },
    { name: '新的一天', file: 'New_Day.ogg' },
    { name: '海洋低语', file: 'Ocean_Whisper.ogg' },
    { name: '序曲', file: 'Overture.ogg' },
    { name: '光芒', file: 'Rays.ogg' },
    { name: '涟漪', file: 'Ripple.ogg' },
    { name: '海之声', file: 'Sound_of_the_Sea.ogg' },
    { name: '星星', file: 'Star.ogg' },
    { name: '敲击', file: 'Tap.ogg' },
    { name: '计时器', file: 'Timer_Beep.ogg' },
    { name: '美好的开始', file: 'Wonderful_Beginning.ogg' },
  ];
  const DEFAULT_RINGTONE = 'Xiaoyi.ogg';

  // 喵提醒追加通知：30分钟内无操作则触发第二个喵提醒
  let lastInteractionTime = Date.now();
  let followUpPending = false;
  let followUpDeadline = 0;
  let followUpLogIds = [];
  // 喵提醒发送队列：同个喵码35秒内只能发一次，多条通知排队发送
  let miaoQueue = [];
  let miaoProcessing = false;
  // 已通知的繁殖/可出售状态跟踪（避免重复通知）
  let notifiedBreed = {};
  let notifiedSell = {};
  // 休养期提醒时间追踪（独立对象，不依赖row）
  let sellReminderTimes = {};
  // 首次tick标记（防止加载时误触发通知）
  let isFirstTick = true;

  // 根据编号数量和别名映射生成编号列表
  function buildIdList() {
    const count = settings.编号数量 || DEFAULT_ID_COUNT;
    const list = [];
    for (let i = 1; i <= count; i++) {
      list.push(String(i));
    }
    return list;
  }

  // 获取编号的显示名称（别名优先，否则显示编号本身）
  function getIdDisplayName(id) {
    const map = settings.ID名称映射 || {};
    return (map[id] && map[id].trim()) ? map[id].trim() : String(id);
  }

  function loadSettings() {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      try {
        settings = JSON.parse(saved);
      } catch (e) {
        settings = {};
      }
    }
    if (settings.铃声开关 == null) settings.铃声开关 = true;
    if (settings.铃声音量 == null) settings.铃声音量 = 100;
    if (settings.铃声时长 == null) settings.铃声时长 = 10;
    if (settings.喵提醒开关 == null) settings.喵提醒开关 = true;
    if (settings.系统通知开关 == null) settings.系统通知开关 = true;
    if (settings.音频保活 == null) settings.音频保活 = true;
    if (settings.选中铃声 == null) settings.选中铃声 = DEFAULT_RINGTONE;
    if (settings.提醒间隔 == null) settings.提醒间隔 = 120;
    if (settings.免打扰开始 == null) settings.免打扰开始 = 0;
    if (settings.免打扰结束 == null) settings.免打扰结束 = 8;
    if (settings.喵提醒URL列表 == null || !Array.isArray(settings.喵提醒URL列表)) {
      settings.喵提醒URL列表 = ANIMAL_DATA.喵提醒URL ? [ANIMAL_DATA.喵提醒URL] : [];
    }
    // 兼容旧版完整URL，自动提取喵码
    settings.喵提醒URL列表 = settings.喵提醒URL列表.map(url => {
      if (url && url.indexOf('miaotixing.com') > -1) {
        const parts = url.split('id=');
        return parts.length > 1 ? parts[1] : url;
      }
      return url;
    }).filter(Boolean);
    if (settings.编号数量 == null) settings.编号数量 = DEFAULT_ID_COUNT;
    if (settings.ID名称映射 == null || typeof settings.ID名称映射 !== 'object') {
      settings.ID名称映射 = {};
    }

    // 生成编号列表
    settings.编号列表 = buildIdList();

    if (settings.喵提醒URL列表.length > 0) {
      ANIMAL_DATA.喵提醒URL = settings.喵提醒URL列表[0];
    }
    ANIMAL_DATA.编号列表 = [...settings.编号列表];
    ANIMAL_DATA.ID名称映射 = settings.ID名称映射 || {};
  }

  function saveSettingsToStorage() {
    try {
      const jsonStr = JSON.stringify(settings);
      localStorage.setItem(SETTINGS_KEY, jsonStr);
      return true;
    } catch (e) {
      alert('保存设置失败：' + e.message);
      return false;
    }
  }

  function init() {
    loadSettings();

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        rows = JSON.parse(saved);
      } catch (e) {
        rows = [];
      }
    }

    if (!rows || rows.length === 0) {
      rows = JSON.parse(JSON.stringify(ANIMAL_DATA.默认数据));
      normalizeRows();
      saveRows();
    }

    // 加载日志
    const savedLogs = localStorage.getItem(LOG_KEY);
    if (savedLogs) {
      try { notificationLogs = JSON.parse(savedLogs); } catch (e) { notificationLogs = []; }
    }

    document.getElementById('addBtn').addEventListener('click', addRow);
    document.getElementById('settingsBtn').addEventListener('click', openSettings);
    document.getElementById('backBtn').addEventListener('click', closeSettings);
    document.getElementById('saveSettings').addEventListener('click', saveSettings);
    document.getElementById('addMiaoUrl').addEventListener('click', addMiaoUrlItem);
    document.getElementById('logBtn').addEventListener('click', openLog);
    document.getElementById('logBackBtn').addEventListener('click', closeLog);
    document.getElementById('clearLogBtn').addEventListener('click', clearLog);

    // 跟踪用户交互（用于追加喵提醒判断）
    const interactionEvents = ['mousedown', 'keydown', 'touchstart', 'input', 'change', 'scroll'];
    interactionEvents.forEach(evt => {
      document.addEventListener(evt, () => { lastInteractionTime = Date.now(); }, { passive: true });
    });

    renderRows();
    
    // 静音音频保活
    let audioCtx = null;
    const audioStart = () => {
      if (!settings.音频保活 || audioCtx) return;
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const gain = audioCtx.createGain();
        gain.gain.value = 0.001;
        gain.connect(audioCtx.destination);
        const oscillator = audioCtx.createOscillator();
        oscillator.frequency.value = 200;
        oscillator.connect(gain);
        oscillator.start();
      } catch (e) {}
    };
    if (settings.音频保活) {
      document.addEventListener('click', audioStart, { once: true });
    }
    
    // Wake Lock API
    try {
      if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
        document.addEventListener('click', function() {
          navigator.wakeLock.request('screen').catch(function() {});
        }, { once: true });
      }
    } catch (e) {}
    
    // 主定时器
    setInterval(tick, 1000);
    
    // 页面切回时补发检查
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') {
        tick();
      }
    });
  }

  function normalizeRows() {
    const now = Date.now();
    rows.forEach(row => {
      if (!row.阶段开始) row.阶段开始 = now;

      const type = ANIMAL_DATA.动物配置[row.动物];
      if (!type) return;

      // 种花类型
      if (type.阶段时长) {
        if (row.已通知 == null) row.已通知 = false;
        return;
      }

      // 迁移旧阶段名称
      const oldToNew = { '成长期': '幼年', '繁殖期': '成年', '老年期': '成年', '成长': '成年', '休养': '成年' };
      if (oldToNew[row.阶段]) {
        row.阶段 = oldToNew[row.阶段];
      }
      // 如果阶段不在新列表中，默认幼年
      if (ANIMAL_DATA.阶段列表.indexOf(row.阶段) === -1) {
        row.阶段 = '幼年';
        row.阶段开始 = now;
      }

      // 初始化繁殖状态（成年阶段）
      if (row.阶段 === '成年') {
        if (row.已繁殖次数 == null) row.已繁殖次数 = 0;
        if (row.繁殖已通知次数 != null) {
          row.已繁殖次数 = row.繁殖已通知次数;
          delete row.繁殖已通知次数;
        }
        if (row.繁殖已通知 != null) {
          if (row.繁殖已通知 === true && row.已繁殖次数 === 0) row.已繁殖次数 = 1;
          delete row.繁殖已通知;
        }
        if (row.售出开始 != null) delete row.售出开始;
        if (row.售出已通知 != null) delete row.售出已通知;
      }
    });
  }

  // ==================== 设置页面 ====================

  function openSettings() {
    document.getElementById('mainPage').classList.add('hidden');
    document.getElementById('settingsPage').classList.remove('hidden');
    document.getElementById('ringtoneEnabled').checked = settings.铃声开关;
    document.getElementById('ringtoneVolume').value = settings.铃声音量;
    document.getElementById('ringtoneDuration').value = settings.铃声时长;
    document.getElementById('miaoEnabled').checked = settings.喵提醒开关;
    document.getElementById('notificationEnabled').checked = settings.系统通知开关;
    document.getElementById('audioKeepAlive').checked = settings.音频保活;
    document.getElementById('idCount').value = settings.编号数量 || DEFAULT_ID_COUNT;
    // 内置铃声下拉
    const ringtoneSelect = document.getElementById('ringtoneSelect');
    ringtoneSelect.innerHTML = '';
    BUILTIN_RINGTONES.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.file;
      opt.textContent = r.name;
      if (settings.选中铃声 === r.file) opt.selected = true;
      ringtoneSelect.appendChild(opt);
    });
    ringtoneSelect.onchange = function() {
      settings.选中铃声 = this.value;
    };
    document.getElementById('remindInterval').value = settings.提醒间隔;
    document.getElementById('quietStart').value = settings.免打扰开始;
    document.getElementById('quietEnd').value = settings.免打扰结束;
    renderMiaoUrlList();
    renderIdList();
    window.scrollTo(0, 0);
  }

  function closeSettings() {
    document.getElementById('settingsPage').classList.add('hidden');
    document.getElementById('mainPage').classList.remove('hidden');
  }

  function renderMiaoUrlList() {
    const container = document.getElementById('miaoUrlList');
    container.innerHTML = '';
    settings.喵提醒URL列表.forEach((url, idx) => {
      const item = document.createElement('div');
      item.className = 'miao-url-item';
      item.innerHTML = '<span class="miao-prefix">https://miaotixing.com/trigger?id=</span><input type="text" value="' + url + '" data-idx="' + idx + '" class="miao-url-input" placeholder="喵码"><button type="button" data-idx="' + idx + '" class="del-miao-url">删除</button>';
      container.appendChild(item);
    });
    container.querySelectorAll('.del-miao-url').forEach(btn => {
      btn.addEventListener('click', function() {
        const idx = parseInt(this.dataset.idx, 10);
        settings.喵提醒URL列表.splice(idx, 1);
        renderMiaoUrlList();
      });
    });
  }

  function addMiaoUrlItem() {
    settings.喵提醒URL列表.push('');
    renderMiaoUrlList();
  }

  function renderIdList() {
    const container = document.getElementById('idListContainer');
    container.innerHTML = '';
    const count = settings.编号数量 || DEFAULT_ID_COUNT;
    const map = settings.ID名称映射 || {};

    for (let i = 1; i <= count; i++) {
      const id = String(i);
      const item = document.createElement('div');
      item.className = 'id-item';

      const label = document.createElement('span');
      label.className = 'id-number-label';
      label.textContent = 'ID ' + id;
      item.appendChild(label);

      const input = document.createElement('input');
      input.type = 'text';
      input.value = map[id] || '';
      input.dataset.id = id;
      input.className = 'id-input';
      input.placeholder = '留空则显示 ' + id;
      item.appendChild(input);

      container.appendChild(item);
    }

    const idCountInput = document.getElementById('idCount');
    if (idCountInput) {
      idCountInput.onchange = function() {
        const val = parseInt(this.value, 10);
        if (val > 0 && val <= 99) {
          settings.编号数量 = val;
          renderIdList();
        }
      };
    }
  }

  function saveSettings() {
    settings.铃声开关 = document.getElementById('ringtoneEnabled').checked;
    settings.铃声音量 = parseInt(document.getElementById('ringtoneVolume').value, 10) || 100;
    settings.铃声时长 = parseInt(document.getElementById('ringtoneDuration').value, 10) || 10;
    settings.喵提醒开关 = document.getElementById('miaoEnabled').checked;
    settings.系统通知开关 = document.getElementById('notificationEnabled').checked;
    settings.音频保活 = document.getElementById('audioKeepAlive').checked;
    settings.提醒间隔 = parseInt(document.getElementById('remindInterval').value, 10) || 120;
    settings.免打扰开始 = parseInt(document.getElementById('quietStart').value, 10) || 0;
    settings.免打扰结束 = parseInt(document.getElementById('quietEnd').value, 10) || 8;

    const miaoUrls = [];
    document.querySelectorAll('.miao-url-input').forEach(input => {
      const val = input.value.trim();
      if (val) miaoUrls.push(val);
    });
    settings.喵提醒URL列表 = miaoUrls;
    if (miaoUrls.length > 0) {
      ANIMAL_DATA.喵提醒URL = miaoUrls[0];
    }

    const idCount = parseInt(document.getElementById('idCount').value, 10) || DEFAULT_ID_COUNT;
    settings.编号数量 = Math.min(99, Math.max(1, idCount));

    const idMap = {};
    document.querySelectorAll('.id-input').forEach(input => {
      const id = input.dataset.id;
      const val = input.value.trim();
      if (val && id) {
        idMap[id] = val;
      }
    });
    settings.ID名称映射 = idMap;
    settings.编号列表 = buildIdList();
    ANIMAL_DATA.编号列表 = [...settings.编号列表];
    ANIMAL_DATA.ID名称映射 = idMap;

    saveSettingsToStorage();
    closeSettings();
    renderRows();
    showToast('设置已保存');
  }

  function showToast(msg) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 2000);
  }

  // ==================== 数据持久化 ====================

  function saveRows() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    } catch (e) {
      console.error('保存数据失败:', e);
    }
  }

  function saveLogs() {
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(notificationLogs));
    } catch (e) {
      console.error('保存日志失败:', e);
    }
  }

  // ==================== 日志系统 ====================

  function addLog(row, title, content, miao1Result, miao2Result) {
    const now = new Date();
    const timeStr = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0') + ' ' +
      String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0') + ':' +
      String(now.getSeconds()).padStart(2, '0');
    const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    notificationLogs.unshift({
      _id: logId,
      时间: timeStr,
      编号: row ? row.编号 : '',
      编号别名: row ? getIdDisplayName(row.编号) : '',
      动物: row ? row.动物 : '',
      标题: title,
      内容: content,
      喵1结果: miao1Result || '',
      喵2结果: miao2Result || ''
    });
    if (notificationLogs.length > 200) {
      notificationLogs.length = 200;
    }
    saveLogs();
    return logId;
  }

  function updateLogById(logId, updates) {
    const log = notificationLogs.find(l => l._id === logId);
    if (log) {
      Object.assign(log, updates);
      saveLogs();
    }
  }

  function openLog() {
    document.getElementById('mainPage').classList.add('hidden');
    document.getElementById('logPage').classList.remove('hidden');
    renderLog();
    window.scrollTo(0, 0);
  }

  function closeLog() {
    document.getElementById('logPage').classList.add('hidden');
    document.getElementById('mainPage').classList.remove('hidden');
  }

  function renderLog() {
    const container = document.getElementById('logContainer');
    if (notificationLogs.length === 0) {
      container.innerHTML = '<div class="log-empty">暂无通知记录</div>';
      return;
    }
    container.innerHTML = notificationLogs.map(log => {
      const miao1Class = log.喵1结果.indexOf('失败') > -1 ? 'log-miao-fail' : 'log-miao1';
      const miao2Class = log.喵2结果.indexOf('失败') > -1 ? 'log-miao-fail' : (log.喵2结果 ? 'log-miao2' : '');
      const idDisplay = getIdDisplayName(log.编号) || log.编号;
      return '<div class="log-item"><div class="log-time">' + log.时间 + '</div><div class="log-title">' + log.标题 + '</div><div><span class="log-id">' + idDisplay + '</span> <span class="log-animal">' + log.动物 + '</span></div><div class="log-content">' + log.内容 + '</div>' + (log.喵1结果 ? '<div class="' + miao1Class + '">喵提醒1：' + log.喵1结果 + '</div>' : '') + (log.喵2结果 ? '<div class="' + miao2Class + '">喵提醒2：' + log.喵2结果 + '</div>' : '') + '</div>';
    }).join('');
  }

  function clearLog() {
    notificationLogs = [];
    saveLogs();
    renderLog();
  }

  // ==================== 行操作 ====================

  function addRow() {
    const firstId = ANIMAL_DATA.编号列表[0];
    const firstAnimal = Object.keys(ANIMAL_DATA.动物配置)[0];
    const type = ANIMAL_DATA.动物配置[firstAnimal];
    const defaultStage = type && type.阶段列表 ? type.阶段列表[0] : ANIMAL_DATA.阶段列表[0];
    const now = Date.now();
    rows.push({
      编号: firstId,
      动物: firstAnimal,
      阶段: defaultStage,
      "阶段开始": now,
      已通知: false,
      已繁殖次数: 0,
      繁殖冷却开始: null,
      休养上次通知: 0
    });
    renderRows();
    saveRows();
  }

  function updateRowField(index, field, value) {
    const row = rows[index];
    const type = ANIMAL_DATA.动物配置[row.动物];

    if (field === '编号') {
      row.编号 = value;
    } else {
      row[field] = value;
    }

    if (field === '动物') {
      const newType = ANIMAL_DATA.动物配置[value];
      const defaultStage = newType && newType.阶段列表 ? newType.阶段列表[0] : ANIMAL_DATA.阶段列表[0];
      row.阶段 = defaultStage;
      row.阶段开始 = Date.now();
      row.已繁殖次数 = 0;
      row.繁殖冷却开始 = null;
      row.已通知 = false;
      notifiedBreed = {};
      notifiedSell = {};
    } else if (field === '阶段') {
      const now = Date.now();
      row.阶段开始 = now;
      if (type && type.阶段时长) {
        // 种花
        row.已通知 = false;
        row.已繁殖次数 = 0;
        row.繁殖冷却开始 = null;
      } else if (value === '成年') {
        // 进入成年：立即可繁殖
        row.繁殖冷却开始 = null;
        row.已繁殖次数 = 0;
        row.休养上次通知 = 0;
      } else {
        // 幼年/未成年
        row.繁殖冷却开始 = null;
        row.已繁殖次数 = 0;
        row.休养上次通知 = 0;
      }
      notifiedBreed = {};
      notifiedSell = {};
    }

    saveRows();
    renderRows();
  }

  function deleteRow(index) {
    rows.splice(index, 1);
    saveRows();
    renderRows();
  }

  function updateNextStage(index, value) {
    const row = rows[index];
    const type = ANIMAL_DATA.动物配置[row.动物];
    if (!type) return;

    const now = Date.now();
    let totalSeconds;

    if (value.indexOf(':') > -1) {
      const hms = value.split(':');
      if (hms.length !== 3) return;
      const h = parseInt(hms[0], 10) || 0;
      const m = parseInt(hms[1], 10) || 0;
      const s = parseInt(hms[2], 10) || 0;
      totalSeconds = h * 3600 + m * 60 + s;
    } else {
      const minutes = parseFloat(value) || 0;
      totalSeconds = Math.round(minutes * 60);
    }

    const totalMs = totalSeconds * 1000;
    const nextDur = getNextStageDuration(type, row.阶段);
    if (nextDur != null) {
      const oldStageStart = row.阶段开始;
      row.阶段开始 = now + totalMs - nextDur * 3600000;
      row.已通知 = false;
      const offset = row.阶段开始 - oldStageStart;

      if (row.繁殖冷却开始) {
        row.繁殖冷却开始 += offset;
      }
    }
    saveRows();
    renderRows();
  }

  // 繁殖状态点击
  function handleBreedClick(index) {
    const row = rows[index];
    const type = ANIMAL_DATA.动物配置[row.动物];
    if (!type || type.阶段时长 || row.阶段 !== '成年') return;

    const now = Date.now();
    const breedCooldown = type.繁殖冷却 * 3600000;
    const totalBreeds = type.繁殖次数;
    const bredCount = row.已繁殖次数 || 0;

    // 检查是否处于可繁殖状态
    const cooldownEnd = (row.繁殖冷却开始 || 0) + breedCooldown;
    const isBreedable = now >= cooldownEnd && bredCount < totalBreeds;

    if (!isBreedable) return;

    // 执行繁殖
    row.已繁殖次数 = (bredCount || 0) + 1;
    row.繁殖冷却开始 = now;
    saveRows();
    renderRows();
  }

  // ==================== 渲染 ====================

  function renderRows() {
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '';

    rows.forEach((row, idx) => {
      const tr = document.createElement('tr');
      const type = ANIMAL_DATA.动物配置[row.动物];
      const isFlower = type && type.阶段时长;

      // 所属ID
      const idOptions = [...ANIMAL_DATA.编号列表, '删除'];
      const idTd = document.createElement('td');
      idTd.setAttribute('data-label', '所属ID');
      const idSelect = document.createElement('select');
      const displayOptions = [...idOptions];
      if (row.编号 && displayOptions.indexOf(row.编号) === -1) {
        displayOptions.unshift(row.编号);
      }
      displayOptions.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt;
        if (opt === '删除') {
          option.textContent = '删除';
        } else {
          option.textContent = getIdDisplayName(opt);
        }
        if (opt === row.编号) option.selected = true;
        idSelect.appendChild(option);
      });
      idSelect.addEventListener('change', e => {
        if (e.target.value === '删除') {
          deleteRow(idx);
        } else {
          updateRowField(idx, '编号', e.target.value);
        }
      });
      idTd.appendChild(idSelect);
      tr.appendChild(idTd);

      // 种类
      tr.appendChild(createSelectCell(Object.keys(ANIMAL_DATA.动物配置), row.动物, v => updateRowField(idx, '动物', v), '种类'));

      // 年龄（阶段）
      const stageOptions = type && type.阶段列表 ? type.阶段列表 : ANIMAL_DATA.阶段列表;
      tr.appendChild(createSelectCell(stageOptions, row.阶段, v => updateRowField(idx, '阶段', v), '年龄', true));

      // 下一阶段
      const nextCell = document.createElement('td');
      nextCell.className = 'countdown-cell';
      nextCell.setAttribute('data-label', '下一阶段');
      const nextInput = document.createElement('input');
      nextInput.type = 'text';
      nextInput.className = 'countdown-input';
      nextInput.dataset.rowIndex = idx;
      nextInput.addEventListener('focus', () => {
        nextInput.dataset.editing = 'true';
      });
      nextInput.addEventListener('blur', () => {
        nextInput.dataset.editing = 'false';
        if (nextInput.value.trim()) {
          updateNextStage(idx, nextInput.value.trim());
        }
      });
      nextCell.appendChild(nextInput);
      tr.appendChild(nextCell);

      // 繁殖阶段
      const breedCell = document.createElement('td');
      breedCell.setAttribute('data-label', '繁殖阶段');
      const breedPhase = document.createElement('div');
      breedPhase.className = 'breed-phase';
      breedPhase.addEventListener('click', () => handleBreedClick(idx));
      breedCell.appendChild(breedPhase);
      tr.appendChild(breedCell);

      tbody.appendChild(tr);
    });

    updateTimers();
  }

  function createSelectCell(options, value, onChange, label, allowReSelect) {
    const td = document.createElement('td');
    if (label) td.setAttribute('data-label', label);
    const select = document.createElement('select');
    const allOptions = [...options];
    if (value && allOptions.indexOf(value) === -1) {
      allOptions.unshift(value);
    }
    allOptions.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = opt;
      if (opt === value) option.selected = true;
      select.appendChild(option);
    });
    if (allowReSelect) {
      select.addEventListener('focus', function() { this._prev = this.value; });
      select.addEventListener('blur', function() {
        if (this.value === this._prev && this.value) onChange(this.value);
      });
    }
    select.addEventListener('change', e => onChange(e.target.value));
    td.appendChild(select);
    return td;
  }

  // ==================== 阶段/繁殖计算 ====================

  function getNextStageDuration(type, stage) {
    if (!type) return null;
    if (type.阶段时长) {
      return type.阶段时长[stage] || null;
    }
    if (stage === '幼年') return type.幼年时长;
    if (stage === '未成年') return type.未成年时长;
    if (stage === '成年') return type.成年时长;
    return null;
  }

  function getBreedStatus(row, type, now) {
    // 种花：无繁殖
    if (type && type.阶段时长) {
      return { state: 'none', display: '-' };
    }
    if (!type) return { state: 'none', display: '-' };

    const stage = row.阶段;

    // 幼年：不可繁殖
    if (stage === '幼年') {
      return { state: 'none', display: '不可繁殖' };
    }

    // 未成年：显示到成年的倒计时（不加冷却，进入成年立即可繁殖）
    if (stage === '未成年') {
      const stageStart = row.阶段开始 || now;
      const teenDuration = type.未成年时长 * 3600000;
      const teenEnd = stageStart + teenDuration;
      const left = teenEnd - now;
      return { state: 'countdown', display: formatCountdown(left) };
    }

    // 成年
    if (stage === '成年') {
      const breedCooldown = type.繁殖冷却 * 3600000;
      const totalBreeds = type.繁殖次数;
      const bredCount = row.已繁殖次数 || 0;
      const stageStart = row.阶段开始 || now;
      const adultEnd = stageStart + type.成年时长 * 3600000;

      // 繁殖冷却进行中
      if (row.繁殖冷却开始 != null) {
        const cooldownEnd = row.繁殖冷却开始 + breedCooldown;
        if (now < cooldownEnd) {
          // 次数已用完 → 直接显示可出售（休养期）
          if (bredCount >= totalBreeds) {
            const left = adultEnd - now;
            return { state: 'sellable', display: formatCountdown(left) + ' 可出售' };
          }
          // 冷却结束时间 >= 成年结束时间：没机会再繁殖了
          if (cooldownEnd >= adultEnd) {
            return { state: 'none', display: '不可繁殖' };
          }
          const left = cooldownEnd - now;
          return { state: 'cooldown', display: formatCountdown(left) + ' 剩余次数:' + (totalBreeds - bredCount) };
        }
      }

      // 不在冷却中，检查剩余次数
      if (bredCount >= totalBreeds) {
        // 次数用完：显示成年剩余时间 + 可出售
        const left = adultEnd - now;
        return { state: 'sellable', display: formatCountdown(left) + ' 可出售' };
      }

      // 可繁殖
      const remaining = totalBreeds - bredCount;
      const left = adultEnd - now;
      return { state: 'breedable', display: formatCountdown(left) + ' 可繁殖' };
    }

    return { state: 'none', display: '-' };
  }

  // ==================== 计时更新 ====================

  function tick() {
    const now = Date.now();
    let changed = false;

    rows.forEach(row => {
      const type = ANIMAL_DATA.动物配置[row.动物];
      if (!type) return;

      let stage = row.阶段;
      let stageStart = row.阶段开始 || now;

      // 自动推进到下一阶段（只对动物，种花不动）
      if (!type.阶段时长) {
        while (true) {
          const dur = getNextStageDuration(type, stage);
          if (dur == null) break;

          const end = stageStart + dur * 3600000;
          if (now >= end) {
            const idx = ANIMAL_DATA.阶段列表.indexOf(stage);
            if (idx >= 0 && idx < ANIMAL_DATA.阶段列表.length - 1) {
              stage = ANIMAL_DATA.阶段列表[idx + 1];
              stageStart = end;

              if (stage === '成年') {
                row.已繁殖次数 = 0;
              }
            } else {
              break;
            }
          } else {
            break;
          }
        }

        if (stage !== row.阶段) {
          row.阶段 = stage;
          row.阶段开始 = stageStart;
          changed = true;
        }
      }

      // 繁殖状态提醒（成年阶段）
      if (!type.阶段时长 && row.阶段 === '成年') {
        const breedStatus = getBreedStatus(row, type, now);
        const rowKey = row.编号 + '_' + row.动物;

        // 一次性提醒：首次可繁殖/可出售
        if (breedStatus.state === 'breedable' && !notifiedBreed[rowKey]) {
          notifiedBreed[rowKey] = true;
          if (!isFirstTick) {
            triggerNotification(row, '可繁殖提醒', getIdDisplayName(row.编号) + '的' + row.动物 + ' 可以繁殖了！');
          }
        }
        if (breedStatus.state !== 'breedable') {
          notifiedBreed[rowKey] = false;
        }

        if (breedStatus.state === 'sellable' && !notifiedSell[rowKey]) {
          notifiedSell[rowKey] = true;
          if (!isFirstTick) {
            triggerNotification(row, '可出售提醒', getIdDisplayName(row.编号) + '的' + row.动物 + ' 可出售了！');
          }
        }
        if (breedStatus.state !== 'sellable') {
          notifiedSell[rowKey] = false;
        }

        // 周期性提醒：可繁殖/可出售时按间隔提醒
        if (breedStatus.state === 'breedable' || breedStatus.state === 'sellable') {
          const nowHour = new Date(now).getHours();
          const quietStart = settings.免打扰开始 || 0;
          const quietEnd = settings.免打扰结束 || 8;
          // 免打扰判断：如果 start < end，在 [start, end) 区间不提醒
          const inQuiet = (quietStart < quietEnd)
            ? (nowHour >= quietStart && nowHour < quietEnd)
            : (nowHour >= quietStart || nowHour < quietEnd);
          if (!inQuiet) {
            const intervalMs = (settings.提醒间隔 || 120) * 60 * 1000;
            const lastReminded = sellReminderTimes[rowKey] || 0;
            if (now - lastReminded >= intervalMs && !isFirstTick) {
              sellReminderTimes[rowKey] = now;
              const prefix = breedStatus.state === 'breedable' ? '可繁殖' : '可出售';
              triggerNotification(row, prefix + '提醒', getIdDisplayName(row.编号) + '的' + row.动物 + ' ' + prefix + '，请及时处理！');
            }
          }
        }
      }
    });

    if (isFirstTick) isFirstTick = false;

    if (changed) {
      saveRows();
      renderRows();
    } else {
      updateTimers();
    }

    // 追加喵提醒检查
    if (followUpPending && now >= followUpDeadline) {
      followUpPending = false;
      const urls = settings.喵提醒URL列表 || [];
      if (urls.length >= 2 && lastInteractionTime < followUpDeadline - 30 * 60 * 1000) {
        sendMiaoTiXing(1).then(result => {
          followUpLogIds.forEach(id => updateLogById(id, { 喵2结果: result }));
        });
      } else if (urls.length >= 2) {
        followUpLogIds.forEach(id => updateLogById(id, { 喵2结果: '已取消' }));
      }
      followUpLogIds = [];
    }
  }

  function updateTimers() {
    const now = Date.now();
    const trs = document.querySelectorAll('#tableBody tr');

    trs.forEach((tr, idx) => {
      const row = rows[idx];
      const type = ANIMAL_DATA.动物配置[row.动物];
      if (!type) return;

      const isFlower = type.阶段时长;

      // 下一阶段倒计时
      const nextInput = tr.querySelector('.countdown-input');
      const nextDur = getNextStageDuration(type, row.阶段);
      if (nextDur == null) {
        nextInput.value = '-';
        nextInput.style.background = '#f5f5f5';
      } else if (nextInput.dataset.editing !== 'true') {
        const end = (row.阶段开始 || now) + nextDur * 3600000;
        const left = end - now;
        nextInput.value = formatCountdown(left);
        nextInput.style.background = '#fff';

        // 种花时间到提醒
        if (isFlower && left <= 0 && !row.已通知) {
          row.已通知 = true;
          triggerNotification(row, '种花提醒', getIdDisplayName(row.编号) + '的' + row.动物 + row.阶段 + '时间到！');
        }
      }

      // 繁殖阶段
      const breedPhase = tr.querySelector('.breed-phase');
      if (breedPhase) {
        const breedStatus = getBreedStatus(row, type, now);
        breedPhase.textContent = breedStatus.display;
        breedPhase.classList.remove('breed-available', 'breed-sellable');
        if (breedStatus.state === 'breedable') {
          breedPhase.classList.add('breed-available');
        } else if (breedStatus.state === 'sellable') {
          breedPhase.classList.add('breed-sellable');
        }
      }
    });
  }

  function formatCountdown(ms) {
    let total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    total %= 3600;
    const m = Math.floor(total / 60);
    const s = total % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  // ==================== 喵提醒 ====================

  async function sendMiaoTiXing(urlIndex) {
    if (!settings.喵提醒开关) return '喵提醒已关闭';
    const urls = settings.喵提醒URL列表 || [];
    if (urls.length === 0) return '无喵提醒URL';
    const targets = (urlIndex != null ? [urls[urlIndex]] : urls).filter(Boolean);
    if (targets.length === 0) return '无喵提醒URL';

    return new Promise(resolve => {
      miaoQueue.push({ targets, resolve });
      if (!miaoProcessing) {
        processMiaoQueue();
      }
    });
  }

  async function processMiaoQueue() {
    if (miaoQueue.length === 0) {
      miaoProcessing = false;
      return;
    }
    miaoProcessing = true;
    const { targets, resolve } = miaoQueue.shift();

    let lastResult = '';
    for (const code of targets) {
      const url = MIAO_PREFIX + code;
      try {
        const resp = await fetch(url, { cache: 'no-store' });
        if (resp.ok) {
          try {
            const data = await resp.json();
            if (data.code === 0 || data.success === true || (data.msg && data.msg.includes('success'))) {
              lastResult = '发送成功';
            } else {
              lastResult = '返回异常: ' + JSON.stringify(data).substring(0, 80);
            }
          } catch (e) {
            lastResult = '已发送(HTTP ' + resp.status + ')';
          }
        } else {
          lastResult = 'HTTP错误 ' + resp.status;
        }
      } catch (e) {
        try {
          const img = new Image();
          img.src = url + (url.indexOf('?') > -1 ? '&' : '?') + 't=' + Date.now();
          lastResult = '已发送(无法验证)';
        } catch (e2) {
          lastResult = '发送失败: ' + e2.message;
        }
      }
    }

    resolve(lastResult || '已发送');
    await new Promise(r => setTimeout(r, 35000));
    processMiaoQueue();
  }

  function showBrowserNotification(title, content) {
    if (!settings.系统通知开关) return;
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body: content });
    } else if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  function playRingtone() {
    if (!settings.铃声开关) return;
    const volume = (settings.铃声音量 || 100) / 100;
    const duration = (settings.铃声时长 || 10) * 1000;

    const ringtoneFile = settings.选中铃声 || DEFAULT_RINGTONE;
    try {
      const audio = new Audio('HUAWEI AUDIO/' + ringtoneFile);
      audio.volume = volume;
      audio.play().catch(() => {});
      setTimeout(() => { audio.pause(); audio.currentTime = 0; }, duration);
    } catch (e) {}
  }

  async function triggerNotification(row, title, content) {
    showBrowserNotification(title, content);
    playRingtone();

    const urls = settings.喵提醒URL列表 || [];
    let miao2Result = '';
    if (urls.length >= 2) {
      followUpPending = true;
      followUpDeadline = Date.now() + 30 * 60 * 1000;
      miao2Result = '30分钟后追加';
    }

    const logId = addLog(row, title, content, '排队中', miao2Result);
    if (miao2Result) followUpLogIds.push(logId);

    const miao1Result = await sendMiaoTiXing();
    updateLogById(logId, { 喵1结果: miao1Result });
  }

  // ==================== 启动 ====================

  window.addEventListener('DOMContentLoaded', init);
})();