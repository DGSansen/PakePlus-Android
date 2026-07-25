(function () {
  // 存储键名
  const STORAGE_KEY = 'animal_timer_data_v2';
  const SETTINGS_KEY = 'animal_timer_settings_v1';
  let rows = [];
  let settings = {};

  // 固定编号范围 1 ~ N
  const DEFAULT_ID_COUNT = 20;

  // 喵提醒追加通知：30分钟内无操作则触发第二个喵提醒
  let lastInteractionTime = Date.now();
  let followUpPending = false;
  let followUpDeadline = 0;

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
    console.log('=== loadSettings 开始 ===');
    console.log('localStorage SETTINGS_KEY 内容:', localStorage.getItem(SETTINGS_KEY));

    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      try {
        settings = JSON.parse(saved);
      } catch (e) {
        console.error('解析设置JSON失败:', e);
        settings = {};
      }
    }
    if (settings.铃声开关 == null) settings.铃声开关 = true;
    if (settings.铃声音量 == null) settings.铃声音量 = 100;
    if (settings.铃声时长 == null) settings.铃声时长 = 10;
    if (settings.喵提醒开关 == null) settings.喵提醒开关 = true;
    if (settings.系统通知开关 == null) settings.系统通知开关 = true;
    if (settings.喵提醒URL列表 == null || !Array.isArray(settings.喵提醒URL列表)) {
      settings.喵提醒URL列表 = ANIMAL_DATA.喵提醒URL ? [ANIMAL_DATA.喵提醒URL] : [];
    }
    if (settings.编号数量 == null) settings.编号数量 = DEFAULT_ID_COUNT;
    if (settings.ID名称映射 == null || typeof settings.ID名称映射 !== 'object') {
      settings.ID名称映射 = {};
    }

    // 生成编号列表
    settings.编号列表 = buildIdList();

    // 动物配置：用默认配置为基础，合并用户修改
    const defaultAnimalConfig = JSON.parse(JSON.stringify(ANIMAL_DATA.动物配置));
    if (settings.动物配置 && typeof settings.动物配置 === 'object') {
      Object.keys(settings.动物配置).forEach(name => {
        if (defaultAnimalConfig[name]) {
          const savedCfg = settings.动物配置[name];
          const target = defaultAnimalConfig[name];
          if (savedCfg && typeof savedCfg === 'object') {
            Object.keys(savedCfg).forEach(key => {
              if (key === '阶段时长' && typeof savedCfg[key] === 'object') {
                if (!target.阶段时长) target.阶段时长 = {};
                Object.assign(target.阶段时长, savedCfg[key]);
              } else if (key !== '阶段列表') {
                target[key] = savedCfg[key];
              }
            });
          }
        }
      });
    }
    ANIMAL_DATA.动物配置 = defaultAnimalConfig;

    if (settings.喵提醒URL列表.length > 0) {
      ANIMAL_DATA.喵提醒URL = settings.喵提醒URL列表[0];
    }
    ANIMAL_DATA.编号列表 = [...settings.编号列表];
    ANIMAL_DATA.ID名称映射 = settings.ID名称映射 || {};

    console.log('=== loadSettings 结束 ===');
    console.log('编号数量:', settings.编号数量, '编号列表:', settings.编号列表);
    console.log('ID名称映射:', JSON.stringify(settings.ID名称映射));
  }

  function saveSettingsToStorage() {
    try {
      const jsonStr = JSON.stringify(settings);
      localStorage.setItem(SETTINGS_KEY, jsonStr);
      console.log('=== saveSettingsToStorage ===');
      console.log('保存的编号数量:', settings.编号数量);
      console.log('保存的ID名称映射:', JSON.stringify(settings.ID名称映射));
      console.log('保存成功, JSON长度:', jsonStr.length);
      return true;
    } catch (e) {
      console.error('保存设置到本地存储失败:', e);
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

    document.getElementById('addBtn').addEventListener('click', addRow);
    document.getElementById('settingsBtn').addEventListener('click', openSettings);
    document.getElementById('backBtn').addEventListener('click', closeSettings);
    document.getElementById('saveSettings').addEventListener('click', saveSettings);
    document.getElementById('addMiaoUrl').addEventListener('click', addMiaoUrlItem);

    // 跟踪用户交互（用于追加喵提醒判断）
    const interactionEvents = ['mousedown', 'keydown', 'touchstart', 'input', 'change', 'scroll'];
    interactionEvents.forEach(evt => {
      document.addEventListener(evt, () => { lastInteractionTime = Date.now(); }, { passive: true });
    });

    renderRows();
    
    // 静音音频保活：防止浏览器后台休眠冻结页面JS
    let audioCtx = null;
    const audioStart = () => {
      if (audioCtx) return;
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
    document.addEventListener('click', audioStart, { once: true });
    
    // Wake Lock API：防止设备休眠
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
      if (type) {
        // 种花类型
        if (type.阶段时长) {
          if (row.已通知 == null) row.已通知 = false;
          const dur = type.阶段时长[row.阶段];
          if (dur) {
            const end = row.阶段开始 + dur * 3600000;
            if (now >= end && !row.已通知) {
              row.已通知 = true;
            }
          }
          return;
        }

        // 动物类型
        if (row.阶段 === '繁殖期' && !row.繁殖开始) row.繁殖开始 = row.阶段开始;
        if (row.阶段 === '老年期' && !row.售出开始) row.售出开始 = row.阶段开始;

        if (row.阶段 === '繁殖期' && row.繁殖开始) {
          if (row.繁殖已通知 === true) {
            row.繁殖已通知次数 = 1;
            delete row.繁殖已通知;
          } else if (row.繁殖已通知 === false) {
            row.繁殖已通知次数 = 0;
            delete row.繁殖已通知;
          }
          if (row.繁殖已通知次数 == null) {
            row.繁殖已通知次数 = 0;
          }
          
          const totalBreeds = type.繁殖次数 || 1;
          const breedInterval = type.繁殖冷却 * 3600000;
          let expectedCount = 0;
          
          for (let i = 0; i < totalBreeds; i++) {
            const breedTime = row.繁殖开始 + i * breedInterval;
            if (now >= breedTime) {
              expectedCount++;
            } else {
              break;
            }
          }
          
          if (expectedCount > row.繁殖已通知次数) {
            row.繁殖已通知次数 = expectedCount;
          }
        }
        if (row.阶段 === '老年期' && row.售出开始) {
          const end = row.售出开始 + (type.售出时长 || 0) * 3600000;
          if (now >= end && !row.售出已通知) {
            row.售出已通知 = true;
          }
        }
      }

      // 饲料和清洁度衰减（仅动物类，种花没有）
      if (type && !type.阶段时长) {
        if (!row.上次衰减时间) row.上次衰减时间 = now;
        const hoursPassed = (now - row.上次衰减时间) / 3600000;
        if (hoursPassed > 0) {
          const feedDecay = (type.饲料衰减 || 0) * hoursPassed;
          const cleanDecay = (type.清洁度衰减 || 0) * hoursPassed;
          row.饲料 = Math.max(0, (row.饲料 || 100) - feedDecay);
          row.清洁度 = Math.max(0, (row.清洁度 || 100) - cleanDecay);
          row.上次衰减时间 = now;
        }

        // 低于50%提醒
        const feedLimit = type.饲料上限 || 100;
        const cleanLimit = type.清洁度上限 || 100;
        if (row.饲料 <= feedLimit * 0.5 && !row.饲料低已提醒) {
          row.饲料低已提醒 = true;
          triggerNotification('饲料不足提醒', row.动物 + ' 饲料低于50%了');
        }
        if (row.清洁度 <= cleanLimit * 0.5 && !row.清洁度低已提醒) {
          row.清洁度低已提醒 = true;
          triggerNotification('清洁度低提醒', row.动物 + ' 清洁度低于50%了');
        }
        // 恢复到50%以上时重置提醒标志
        if (row.饲料 > feedLimit * 0.5 && row.饲料低已提醒) {
          row.饲料低已提醒 = false;
        }
        if (row.清洁度 > cleanLimit * 0.5 && row.清洁度低已提醒) {
          row.清洁度低已提醒 = false;
        }
      }
    });
  }

  function openSettings() {
    document.getElementById('mainPage').classList.add('hidden');
    document.getElementById('settingsPage').classList.remove('hidden');
    document.getElementById('ringtoneEnabled').checked = settings.铃声开关;
    document.getElementById('ringtoneVolume').value = settings.铃声音量;
    document.getElementById('ringtoneDuration').value = settings.铃声时长;
    document.getElementById('miaoEnabled').checked = settings.喵提醒开关;
    document.getElementById('notificationEnabled').checked = settings.系统通知开关;
    document.getElementById('idCount').value = settings.编号数量 || DEFAULT_ID_COUNT;
    renderMiaoUrlList();
    renderIdList();
    renderAnimalSettings();
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
      item.innerHTML = `
        <input type="text" value="${url}" data-idx="${idx}" class="miao-url-input">
        <button type="button" data-idx="${idx}" class="del-miao-url">删除</button>
      `;
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
    settings.喵提醒URL列表.push('http://miaotixing.com/trigger?id=');
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

    // 编号数量变更时重新渲染
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

  function renderAnimalSettings() {
    const container = document.getElementById('animalSettingsContainer');
    container.innerHTML = '';
    Object.keys(ANIMAL_DATA.动物配置).forEach(name => {
      const cfg = ANIMAL_DATA.动物配置[name];
      const card = document.createElement('div');
      card.className = 'animal-config-card';

      const header = document.createElement('div');
      header.className = 'animal-config-header';
      header.innerHTML = name + ' <span>▼</span>';
      header.addEventListener('click', () => {
        const body = card.querySelector('.animal-config-body');
        body.classList.toggle('show');
      });
      card.appendChild(header);

      const body = document.createElement('div');
      body.className = 'animal-config-body';

      if (cfg.阶段时长) {
        Object.keys(cfg.阶段时长).forEach(stage => {
          const row = document.createElement('div');
          row.className = 'animal-config-row';
          row.innerHTML = `
            <label>${stage}</label>
            <input type="number" min="0.1" step="0.1" data-animal="${name}" data-field="阶段时长" data-stage="${stage}" value="${cfg.阶段时长[stage]}">
          `;
          body.appendChild(row);
        });
      } else {
        const fields = [
          { label: '成长期（小时）', key: '成长时长' },
          { label: '繁殖期（小时）', key: '繁殖期时长' },
          { label: '繁殖次数', key: '繁殖次数' },
          { label: '繁殖冷却（小时）', key: '繁殖冷却' },
          { label: '售出时长（小时）', key: '售出时长' },
          { label: '饲料上限', key: '饲料上限' },
          { label: '清洁度上限', key: '清洁度上限' },
          { label: '饲料衰减（每小时）', key: '饲料衰减' },
          { label: '清洁度衰减（每小时）', key: '清洁度衰减' },
        ];
        fields.forEach(f => {
          const row = document.createElement('div');
          row.className = 'animal-config-row';
          row.innerHTML = `
            <label>${f.label}</label>
            <input type="number" min="0.1" step="0.1" data-animal="${name}" data-field="${f.key}" value="${cfg[f.key]}">
          `;
          body.appendChild(row);
        });
      }

      card.appendChild(body);
      container.appendChild(card);
    });
  }

  function saveSettings() {
    // 保存基础设置
    settings.铃声开关 = document.getElementById('ringtoneEnabled').checked;
    settings.铃声音量 = parseInt(document.getElementById('ringtoneVolume').value, 10) || 100;
    settings.铃声时长 = parseInt(document.getElementById('ringtoneDuration').value, 10) || 10;
    settings.喵提醒开关 = document.getElementById('miaoEnabled').checked;
    settings.系统通知开关 = document.getElementById('notificationEnabled').checked;

    // 保存喵提醒URL
    const miaoUrls = [];
    document.querySelectorAll('.miao-url-input').forEach(input => {
      const val = input.value.trim();
      if (val) miaoUrls.push(val);
    });
    settings.喵提醒URL列表 = miaoUrls;
    if (miaoUrls.length > 0) {
      ANIMAL_DATA.喵提醒URL = miaoUrls[0];
    }

    // 保存编号数量和别名映射
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

    // 生成编号列表
    settings.编号列表 = buildIdList();
    ANIMAL_DATA.编号列表 = [...settings.编号列表];
    ANIMAL_DATA.ID名称映射 = idMap;

    console.log('=== saveSettings 编号部分 ===');
    console.log('编号数量:', settings.编号数量);
    console.log('ID名称映射:', JSON.stringify(idMap));
    console.log('编号列表:', settings.编号列表);

    // 保存动物配置：以默认配置为基础，合并用户修改，确保完整性
    try {
      // 从输入框读取用户修改
      const userChanges = {};
      document.querySelectorAll('#animalSettingsContainer input').forEach(input => {
        const name = input.dataset.animal;
        const field = input.dataset.field;
        const stage = input.dataset.stage;
        const val = parseFloat(input.value) || 0;

        if (!userChanges[name]) userChanges[name] = {};
        if (stage) {
          if (!userChanges[name].阶段时长) userChanges[name].阶段时长 = {};
          userChanges[name].阶段时长[stage] = val;
        } else {
          userChanges[name][field] = val;
        }
      });

      // 以当前ANIMAL_DATA为基础，合并用户修改，确保所有动物都存在
      const fullAnimalConfig = {};
      Object.keys(ANIMAL_DATA.动物配置).forEach(name => {
        const src = ANIMAL_DATA.动物配置[name];
        fullAnimalConfig[name] = {};

        if (src.阶段时长) {
          // 种花等有阶段时长的类型
          fullAnimalConfig[name].阶段时长 = {};
          if (src.阶段时长) {
            Object.assign(fullAnimalConfig[name].阶段时长, src.阶段时长);
          }
          // 合并用户修改
          if (userChanges[name] && userChanges[name].阶段时长) {
            Object.assign(fullAnimalConfig[name].阶段时长, userChanges[name].阶段时长);
          }
        } else {
          // 普通动物：复制所有数值属性（排除阶段列表）
          Object.keys(src).forEach(key => {
            if (key !== '阶段列表') {
              fullAnimalConfig[name][key] = src[key];
            }
          });
          // 合并用户修改
          if (userChanges[name]) {
            Object.keys(userChanges[name]).forEach(key => {
              if (key !== '阶段列表') {
                fullAnimalConfig[name][key] = userChanges[name][key];
              }
            });
          }
        }
      });

      // 保存完整配置到settings
      settings.动物配置 = fullAnimalConfig;

      // 同步更新ANIMAL_DATA（确保动物配置完整）
      Object.keys(fullAnimalConfig).forEach(name => {
        if (ANIMAL_DATA.动物配置[name]) {
          if (fullAnimalConfig[name].阶段时长) {
            if (!ANIMAL_DATA.动物配置[name].阶段时长) {
              ANIMAL_DATA.动物配置[name].阶段时长 = {};
            }
            Object.assign(ANIMAL_DATA.动物配置[name].阶段时长, fullAnimalConfig[name].阶段时长);
          } else {
            Object.keys(fullAnimalConfig[name]).forEach(key => {
              if (key !== '阶段列表') {
                ANIMAL_DATA.动物配置[name][key] = fullAnimalConfig[name][key];
              }
            });
          }
        }
      });
    } catch (e) {
      console.error('保存动物配置出错:', e);
      // 动物配置保存失败不影响编号列表
    }

    // 保存设置到本地存储（即使动物配置失败，编号列表已经单独保存了）
    saveSettingsToStorage();
    closeSettings();
    renderRows();
  }

  function saveRows() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    } catch (e) {
      console.error('保存数据失败:', e);
    }
  }

  function addRow() {
    const firstId = ANIMAL_DATA.编号列表[0];
    const firstAnimal = Object.keys(ANIMAL_DATA.动物配置)[0];
    const type = ANIMAL_DATA.动物配置[firstAnimal];
    const defaultStage = type && type.阶段列表 ? type.阶段列表[0] : ANIMAL_DATA.阶段列表[0];
    const 初始饲料 = (type && type.饲料上限) ? type.饲料上限 : 100;
    const 初始清洁度 = (type && type.清洁度上限) ? type.清洁度上限 : 100;
    rows.push({
      编号: firstId,
      动物: firstAnimal,
      阶段: defaultStage,
      饲料: 初始饲料,
      清洁度: 初始清洁度,
      阶段开始: Date.now(),
      上次衰减时间: Date.now(),
      已通知: false
    });
    renderRows();
    saveRows();
  }

  function updateRowField(index, field, value) {
    const row = rows[index];

    if (field === '饲料' || field === '清洁度') {
      const type = ANIMAL_DATA.动物配置[row.动物];
      let val = parseInt(value, 10) || 0;
      if (type && !type.阶段时长) {
        const 上限 = field === '饲料' ? (type.饲料上限 || 100) : (type.清洁度上限 || 100);
        if (val > 上限) val = 上限;
      }
      if (val < 0) val = 0;
      row[field] = val;
      row.上次衰减时间 = Date.now();
      // 如果恢复到50%以上，重置提醒标志
      if (type && !type.阶段时长) {
        const 上限 = field === '饲料' ? (type.饲料上限 || 100) : (type.清洁度上限 || 100);
        if (field === '饲料' && val > 上限 * 0.5) row.饲料低已提醒 = false;
        if (field === '清洁度' && val > 上限 * 0.5) row.清洁度低已提醒 = false;
      }
    } else if (field === '编号') {
      row.编号 = value;
    } else {
      row[field] = value;
    }

    if (field === '动物') {
      const type = ANIMAL_DATA.动物配置[value];
      const defaultStage = type && type.阶段列表 ? type.阶段列表[0] : ANIMAL_DATA.阶段列表[0];
      row.阶段 = defaultStage;
      row.阶段开始 = Date.now();
      row.繁殖开始 = null;
      row.繁殖已通知次数 = 0;
      row.售出开始 = null;
      row.售出已通知 = false;
      row.已通知 = false;
      row.饲料低已提醒 = false;
      row.清洁度低已提醒 = false;
      if (type && !type.阶段时长) {
        row.饲料 = type.饲料上限 || 100;
        row.清洁度 = type.清洁度上限 || 100;
      } else {
        row.饲料 = 100;
        row.清洁度 = 100;
      }
      row.上次衰减时间 = Date.now();
    } else if (field === '阶段') {
      const now = Date.now();
      row.阶段开始 = now;
      const type = ANIMAL_DATA.动物配置[row.动物];
      if (type && type.阶段时长) {
        row.已通知 = false;
        row.繁殖开始 = null;
        row.售出开始 = null;
      } else if (value === '繁殖期') {
        row.繁殖开始 = now;
        row.繁殖已通知次数 = 0;
        row.售出开始 = null;
      } else if (value === '老年期') {
        row.售出开始 = now;
        row.售出已通知 = false;
        row.繁殖开始 = null;
      } else {
        row.繁殖开始 = null;
        row.售出开始 = null;
      }
      // 切换阶段时重置饲料和清洁度
      if (type && !type.阶段时长) {
        row.饲料 = type.饲料上限 || 100;
        row.清洁度 = type.清洁度上限 || 100;
        row.上次衰减时间 = now;
        row.饲料低已提醒 = false;
        row.清洁度低已提醒 = false;
      }
    }

    saveRows();
    renderRows();
  }

  function deleteRow(index) {
    if (confirm('确定要删除这条记录吗？')) {
      rows.splice(index, 1);
      saveRows();
      renderRows();
    }
  }

  function updateNextStage(index, value) {
    const row = rows[index];
    const type = ANIMAL_DATA.动物配置[row.动物];
    if (!type) return;

    const now = Date.now();
    const hms = value.split(':');
    if (hms.length !== 3) return;

    const h = parseInt(hms[0], 10) || 0;
    const m = parseInt(hms[1], 10) || 0;
    const s = parseInt(hms[2], 10) || 0;
    const totalSeconds = h * 3600 + m * 60 + s;
    const totalMs = totalSeconds * 1000;

    const nextDur = getNextStageDuration(type, row.阶段);
    if (nextDur != null) {
      const oldStageStart = row.阶段开始;
      row.阶段开始 = now + totalMs - nextDur * 3600000;
      const offset = row.阶段开始 - oldStageStart;

      if (row.繁殖开始) {
        row.繁殖开始 += offset;
        
        const totalBreeds = type.繁殖次数 || 1;
        const breedInterval = type.繁殖冷却 * 3600000;
        let expectedCount = 0;
        
        for (let i = 0; i < totalBreeds; i++) {
          const breedTime = row.繁殖开始 + i * breedInterval;
          if (now >= breedTime) {
            expectedCount++;
          } else {
            break;
          }
        }
        
        row.繁殖已通知次数 = expectedCount;
      }
      if (row.售出开始) {
        row.售出开始 += offset;
      }
    }
    saveRows();
    renderRows();
  }

  function renderRows() {
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '';

    rows.forEach((row, idx) => {
      const tr = document.createElement('tr');

      const idOptions = [...ANIMAL_DATA.编号列表, '删除'];
      // ID下拉列表：显示别名
      const idTd = document.createElement('td');
      idTd.setAttribute('data-label', '所属ID');
      const idSelect = document.createElement('select');
      const displayOptions = [...idOptions];
      // 如果当前值不在列表中，加到前面
      if (row.编号 && displayOptions.indexOf(row.编号) === -1) {
        displayOptions.unshift(row.编号);
      }
      displayOptions.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt;
        // 显示别名（删除选项除外）
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
      const type = ANIMAL_DATA.动物配置[row.动物];
      const stageOptions = type && type.阶段列表 ? type.阶段列表 : ANIMAL_DATA.阶段列表;
      tr.appendChild(createSelectCell(Object.keys(ANIMAL_DATA.动物配置), row.动物, v => updateRowField(idx, '动物', v), '动物名称'));
      tr.appendChild(createSelectCell(stageOptions, row.阶段, v => updateRowField(idx, '阶段', v), '成长阶段'));
      const feedMax = (type && type.饲料上限) ? type.饲料上限 : 99999;
      const cleanMax = (type && type.清洁度上限) ? type.清洁度上限 : 99999;
      tr.appendChild(createNumberCell(Math.round(row.饲料), v => updateRowField(idx, '饲料', v), '剩余饲料', feedMax));
      tr.appendChild(createNumberCell(Math.round(row.清洁度), v => updateRowField(idx, '清洁度', v), '剩余清洁度', cleanMax));

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

      const breedCell = document.createElement('td');
      breedCell.className = 'countdown breed-remind';
      breedCell.setAttribute('data-label', '繁殖倒计时');
      tr.appendChild(breedCell);

      const sellCell = document.createElement('td');
      sellCell.className = 'countdown sell-remind';
      sellCell.setAttribute('data-label', '售出倒计时');
      tr.appendChild(sellCell);

      tbody.appendChild(tr);
    });

    updateTimers();
  }

  function createSelectCell(options, value, onChange, label) {
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
    select.addEventListener('change', e => onChange(e.target.value));
    td.appendChild(select);
    return td;
  }

  function createNumberCell(value, onChange, label, max) {
    const td = document.createElement('td');
    if (label) td.setAttribute('data-label', label);
    const input = document.createElement('input');
    input.type = 'number';
    input.min = 0;
    input.max = max || 99999;
    input.value = value;
    input.addEventListener('change', e => onChange(e.target.value));
    td.appendChild(input);
    return td;
  }

  function getNextStageDuration(type, stage) {
    if (type.阶段时长) {
      return type.阶段时长[stage] || null;
    }
    if (stage === '成长期') return type.成长时长;
    if (stage === '繁殖期') return type.繁殖期时长;
    return null;
  }

  function getNextBreedTime(row, type) {
    if (!row.繁殖开始 || !type.繁殖次数) return null;
    
    const totalBreeds = type.繁殖次数;
    const breedCount = row.繁殖已通知次数 || 0;
    
    if (breedCount >= totalBreeds) return null;
    
    const breedInterval = type.繁殖冷却 * 3600000;
    return row.繁殖开始 + breedCount * breedInterval;
  }

  function sendMiaoTiXing() {
    if (!settings.喵提醒开关) return;
    const urls = settings.喵提醒URL列表 || [];
    if (urls.length === 0) return;
    urls.forEach(url => {
      let sent = false;
      // 优先：fetch keepalive，GET请求，页面后台也能发
      if (window.fetch) {
        try {
          fetch(url, { keepalive: true, mode: 'no-cors', cache: 'no-store' });
          sent = true;
        } catch (e) {}
      }
      // 备选：Image
      if (!sent) {
        const img = new Image();
        img.src = url + (url.indexOf('?') > -1 ? '&' : '?') + 't=' + Date.now();
      }
    });
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
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const gain = ctx.createGain();
      const volume = (settings.铃声音量 || 100) / 100;
      gain.gain.value = volume;
      gain.connect(ctx.destination);

      const startTime = ctx.currentTime;
      const duration = settings.铃声时长 || 10;
      const beat = 0.25;
      const pattern = [
        [523.25, 659.25],
        [587.33, 740.00],
        [659.25, 783.99],
        [783.99, 987.77],
      ];

      let t = startTime;
      let idx = 0;
      while (t < startTime + duration) {
        const chord = pattern[idx % pattern.length];
        for (let i = 0; i < 2; i++) {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.value = chord[i];
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.5, t + 0.02);
          g.gain.setValueAtTime(0.5, t + beat * 0.9);
          g.gain.linearRampToValueAtTime(0, t + beat);
          osc.connect(g);
          g.connect(gain);
          osc.start(t);
          osc.stop(t + beat + 0.05);
        }
        t += beat;
        idx++;
        if (idx % 8 === 0) t += beat * 2;
      }

      setTimeout(() => {
        ctx.close();
      }, duration * 1000 + 500);
    } catch (e) {}
  }

  function triggerNotification(title, content) {
    sendMiaoTiXing();
    showBrowserNotification(title, content);
    playRingtone();

    // 如果有2个以上喵提醒URL，启动30分钟追加提醒计时器
    const urls = settings.喵提醒URL列表 || [];
    if (urls.length >= 2) {
      followUpPending = true;
      followUpDeadline = Date.now() + 30 * 60 * 1000;
    }
  }

  function tick() {
    // 每次取当前计算机真实时间，所以关掉 APP 再打开，时间也会继续走
    const now = Date.now();
    let changed = false;

    rows.forEach(row => {
      const type = ANIMAL_DATA.动物配置[row.动物];
      if (!type) return;

      let stage = row.阶段;
      let stageStart = row.阶段开始 || now;
      let reproduceStart = row.繁殖开始;
      let sellStart = row.售出开始;

      // 自动推进到下一阶段
      while (true) {
        const dur = getNextStageDuration(type, stage);
        if (dur == null) break;

        const end = stageStart + dur * 3600000;
        if (now >= end) {
          const idx = ANIMAL_DATA.阶段列表.indexOf(stage);
          if (idx >= 0 && idx < ANIMAL_DATA.阶段列表.length - 1) {
            stage = ANIMAL_DATA.阶段列表[idx + 1];
            stageStart = end;
            if (stage === '繁殖期') reproduceStart = stageStart;
            if (stage === '老年期') sellStart = stageStart;
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
        row.繁殖开始 = reproduceStart;
        row.售出开始 = sellStart;
        row.繁殖已通知次数 = stage === '繁殖期' ? 0 : row.繁殖已通知次数;
        row.售出已通知 = false;
        // 自动推进阶段时重置饲料和清洁度
        if (!type.阶段时长) {
          row.饲料 = type.饲料上限 || 100;
          row.清洁度 = type.清洁度上限 || 100;
          row.上次衰减时间 = now;
          row.饲料低已提醒 = false;
          row.清洁度低已提醒 = false;
        }
        changed = true;
      } else if (stage === '繁殖期' && row.繁殖开始) {
        const totalBreeds = type.繁殖次数 || 1;
        const breedInterval = type.繁殖冷却 * 3600000;
        const currentCount = row.繁殖已通知次数 || 0;
        
        let newCount = currentCount;
        for (let i = currentCount; i < totalBreeds; i++) {
          const breedTime = row.繁殖开始 + i * breedInterval;
          if (now >= breedTime) {
            newCount++;
            triggerNotification('繁殖倒计时', `编号${row.编号}的${row.动物}已到第${i + 1}次繁殖时间！`);
          } else {
            break;
          }
        }
        
        if (newCount > currentCount) {
          row.繁殖已通知次数 = newCount;
          changed = true;
        }
      }
    });

    if (changed) {
      saveRows();
      renderRows();
    } else {
      updateTimers();
    }

    // 追加喵提醒检查：30分钟内无操作则触发第二个喵提醒URL
    if (followUpPending && now >= followUpDeadline) {
      followUpPending = false;
      const urls = settings.喵提醒URL列表 || [];
      if (urls.length >= 2 && lastInteractionTime < followUpDeadline - 30 * 60 * 1000) {
        // 30分钟内无交互，发送第二个喵提醒（只发喵，不响铃）
        if (window.fetch) {
          try { fetch(urls[1], { keepalive: true, mode: 'no-cors', cache: 'no-store' }); } catch (e) {}
        }
        if (!window.fetch) {
          const img = new Image();
          img.src = urls[1] + (urls[1].indexOf('?') > -1 ? '&' : '?') + 't=' + Date.now();
        }
      }
    }
  }

  function updateTimers() {
    const now = Date.now();
    const trs = document.querySelectorAll('#tableBody tr');

    trs.forEach((tr, idx) => {
      const row = rows[idx];
      const type = ANIMAL_DATA.动物配置[row.动物];
      if (!type) return;

      // 种花类型特殊处理
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
          triggerNotification('种花提醒', `编号${row.编号}的${row.动物}${row.阶段}时间到！`);
        }
      }

      // 繁殖倒计时
      const breedCell = tr.querySelector('.breed-remind');
      if (isFlower) {
        breedCell.textContent = '-';
      } else if (row.阶段 !== '繁殖期' || !row.繁殖开始) {
        breedCell.textContent = '-';
      } else {
        const totalBreeds = type.繁殖次数 || 1;
        const breedCount = row.繁殖已通知次数 || 0;
        
        if (breedCount >= totalBreeds) {
          breedCell.textContent = '已全部可繁殖';
        } else {
          const nextBreedTime = getNextBreedTime(row, type);
          if (nextBreedTime) {
            const left = nextBreedTime - now;
            if (left <= 0) {
              breedCell.textContent = `可繁殖 第${breedCount + 1}/${totalBreeds}次`;
            } else {
              breedCell.textContent = `${formatCountdown(left)} (${breedCount}/${totalBreeds})`;
            }
          } else {
            breedCell.textContent = '已全部可繁殖';
          }
        }
      }

      // 售出倒计时（显示从成长期开始到进入老年期的总时间倒计时）
      const sellCell = tr.querySelector('.sell-remind');
      if (isFlower) {
        sellCell.textContent = '-';
      } else if (row.阶段 === '老年期' && row.售出开始) {
        const end = row.售出开始 + (type.售出时长 || 0) * 3600000;
        const left = end - now;
        sellCell.textContent = left <= 0 ? '可售出' : formatCountdown(left);

        if (left <= 0 && !row.售出已通知) {
          row.售出已通知 = true;
          triggerNotification('售出倒计时', `编号${row.编号}的${row.动物}已到售出时间！`);
        }
      } else if (row.阶段 === '繁殖期' && row.繁殖开始) {
        const totalHours = type.成长时长 + type.繁殖期时长;
        const startOfGrowth = row.繁殖开始 - type.成长时长 * 3600000;
        const end = startOfGrowth + totalHours * 3600000;
        const left = end - now;
        sellCell.textContent = left <= 0 ? '即将进入老年期' : formatCountdown(left);
      } else if (row.阶段 === '成长期' && row.阶段开始) {
        const totalHours = type.成长时长 + type.繁殖期时长;
        const end = row.阶段开始 + totalHours * 3600000;
        const left = end - now;
        sellCell.textContent = left <= 0 ? '即将进入繁殖期' : formatCountdown(left);
      } else {
        sellCell.textContent = '-';
      }
    });
  }

  function formatCountdown(ms) {
    let total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    total %= 3600;
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  window.addEventListener('DOMContentLoaded', init);
})();


