/**
 * 國中生物 3-2 人體的循環 核心邏輯
 * 嚴格遵循 bio-curriculum-regular-workflow 規範：
 * 1. 40 分鐘超時自動清理 checkBioSessionTimeout
 * 2. 701~710, 01~35 前導零鎖定
 * 3. 身分覆核門禁 checkBioStudentIdentityAndStatus
 * 4. 8 秒 Wi-Fi 降級提交與 GAS 原地覆蓋更新
 * 5. YouTube 播放器時間軸跳轉
 */

// 1. 本地存儲鍵名 (單元隔離)
const STORAGE_KEY_DATA = "BIO_3_2_CIRCULATION_DATA";
const STORAGE_KEY_SUBMITTED = "BIO_3_2_SUBMITTED_RECORD";
const STORAGE_KEY_TIMESTAMP = "BIO_3_2_LAST_TIMESTAMP";

// 2. 素養選擇題標準答案與解析 (符合南一七年級課綱)
const MCQ_ANSWERS = {
  mcq_1: { ans: "B", explain: "成熟紅血球無細胞核，外形呈雙凹圓盤狀，富含血紅素負責攜氧。" },
  mcq_2: { ans: "C", explain: "白血球具細胞核，能產生變形運動穿出微血管管壁進行吞噬防禦。" },
  mcq_3: { ans: "D", explain: "血小板不具血紅素，主要負責促進血液凝固與止血。" },
  mcq_4: { ans: "B", explain: "白血球體積最大、有細胞核、可變形運動防禦疾病。" },
  mcq_5: { ans: "B", explain: "微血管僅單層細胞厚、血流最慢，最有利於進行物質交換。" },
  mcq_6: { ans: "A", explain: "心房與心室之間有瓣膜，可防止心室血液逆流回心房。微血管無瓣膜。" },
  mcq_7: { ans: "A", explain: "血管承受血壓大小順序為：動脈 ＞ 微血管 ＞ 靜脈。" },
  mcq_8: { ans: "B", explain: "口訣「靜房，心動出室」！全身缺氧血回右心房 ➔ 右心室 ➔ 肺動脈前往肺部。" },
  mcq_9: { ans: "C", explain: "體循環中，組織微血管送出氧氣給細胞，鮮紅充氧血轉變成暗紅缺氧血。" },
  mcq_10: { ans: "B", explain: "血漿滲出微血管成組織液，組織液滲入淋巴管成為淋巴，經淋巴結過濾後匯入靜脈。" }
};

// 3. YouTube 播放器秒速跳轉
function seekVideoTo(seconds) {
  const iframe = document.getElementById('ytPlayer');
  if (iframe) {
    // 透過 postMessage 或更新 src 讓 YouTube 跳轉
    iframe.contentWindow.postMessage(JSON.stringify({
      event: 'command',
      func: 'seekTo',
      args: [seconds, true]
    }), '*');
  }
}

// 4. 生命週期啟動
document.addEventListener("DOMContentLoaded", () => {
  // ① 檢查 URL 重置指令 (?reset=1 或 ?fresh=1)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('reset') === '1' || urlParams.get('fresh') === '1') {
    startFreshQuiz(true);
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  // ② 40 分鐘超時自動清理
  checkBioSessionTimeout();

  // ③ 初始化純數字班級 (701~710) 與 前導零座號 (01~35)
  initClassSeatDropdowns();

  // ④ 綁定事件與載入暫存
  bindEventListeners();
  loadSavedData();

  // ⑤ 身分覆核門禁檢查
  checkStudentIdentityAndStatus();
});

// 初始化班級座號
function initClassSeatDropdowns() {
  const classSelect = document.getElementById("studentClass");
  const seatSelect = document.getElementById("studentSeat");

  if (classSelect && classSelect.options.length <= 1) {
    for (let c = 701; c <= 710; c++) {
      const opt = document.createElement("option");
      opt.value = c.toString();
      opt.textContent = `${c} 班`;
      classSelect.appendChild(opt);
    }
  }

  if (seatSelect && seatSelect.options.length <= 1) {
    for (let s = 1; s <= 35; s++) {
      const seatStr = s < 10 ? `0${s}` : `${s}`;
      const opt = document.createElement("option");
      opt.value = seatStr;
      opt.textContent = `${seatStr} 號`;
      seatSelect.appendChild(opt);
    }
  }
}

// 40 分鐘超時檢測
function checkBioSessionTimeout() {
  const lastTime = localStorage.getItem(STORAGE_KEY_TIMESTAMP);
  if (lastTime) {
    const elapsed = Date.now() - parseInt(lastTime, 10);
    // 超過 40 分鐘 (2,400,000 毫秒)
    if (elapsed > 40 * 60 * 1000) {
      console.warn("偵測到上一班填寫已超過 40 分鐘，啟動平板車防呆自動清空！");
      startFreshQuiz(false);
    }
  }
}

// 綁定輸入與導航事件
function bindEventListeners() {
  // 導覽按鈕切換卡片
  const stepBtns = document.querySelectorAll(".step-btn");
  stepBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const step = btn.getAttribute("data-step");
      switchToStep(step);
    });
  });

  // 下一步 / 上一步
  document.querySelectorAll(".next-step-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const next = btn.getAttribute("data-next");
      switchToStep(next);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  document.querySelectorAll(".prev-step-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const prev = btn.getAttribute("data-prev");
      switchToStep(prev);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // 表單輸入自動暫存 (防丟失)
  const formInputs = document.querySelectorAll("input, select");
  formInputs.forEach(input => {
    input.addEventListener("change", () => {
      saveFormData();
      updateStepCheckmarks();
    });
    input.addEventListener("input", () => {
      saveFormData();
    });
  });

  // 交卷按鈕
  const submitBtn = document.getElementById("btnSubmitAll");
  if (submitBtn) {
    submitBtn.addEventListener("click", handleSubmit);
  }

  // 成果卡按鈕
  const btnCloseResult = document.getElementById("btnCloseResult");
  if (btnCloseResult) {
    btnCloseResult.addEventListener("click", () => {
      document.getElementById("resultModal").classList.add("hidden");
    });
  }

  const btnNextStudentReset = document.getElementById("btnNextStudentReset");
  if (btnNextStudentReset) {
    btnNextStudentReset.addEventListener("click", () => {
      if (confirm("確認換下一位同學？這將會清空本平板的當前作答內容！")) {
        startFreshQuiz(true);
        location.reload();
      }
    });
  }

  // 身分門禁 Modal 按鈕
  const btnContinueDraft = document.getElementById("btnContinueDraft");
  if (btnContinueDraft) {
    btnContinueDraft.addEventListener("click", () => {
      document.getElementById("identityVerifyModal").classList.add("hidden");
    });
  }

  const btnResetForNewStudent = document.getElementById("btnResetForNewStudent");
  if (btnResetForNewStudent) {
    btnResetForNewStudent.addEventListener("click", () => {
      startFreshQuiz(true);
      document.getElementById("identityVerifyModal").classList.add("hidden");
    });
  }
}

// 切換關卡
function switchToStep(step) {
  document.querySelectorAll(".step-btn").forEach(b => {
    if (b.getAttribute("data-step") === step) {
      b.classList.add("active");
    } else {
      b.classList.remove("active");
    }
  });

  document.querySelectorAll(".question-card").forEach(c => {
    c.classList.add("hidden");
  });

  const targetCard = document.getElementById(`stepCard${step}`);
  if (targetCard) {
    targetCard.classList.remove("hidden");
  }
}

// 收集所有表單數據
function getFormData() {
  const data = {
    sClass: document.getElementById("studentClass")?.value || "",
    sSeat: document.getElementById("studentSeat")?.value || "",
    sName: document.getElementById("studentName")?.value.trim() || "",
    
    // 任務一
    t1_rbc_nucleus: document.getElementById("t1_rbc_nucleus")?.value || "",
    t1_wbc_nucleus: document.getElementById("t1_wbc_nucleus")?.value || "",
    t1_plt_nucleus: document.getElementById("t1_plt_nucleus")?.value || "",
    t1_wbc_size: document.getElementById("t1_wbc_size")?.value || "",
    t1_plt_size: document.getElementById("t1_plt_size")?.value || "",
    t1_rbc_num: document.getElementById("t1_rbc_num")?.value || "",
    t1_wbc_num: document.getElementById("t1_wbc_num")?.value || "",
    t1_rbc_func: document.getElementById("t1_rbc_func")?.value || "",
    t1_wbc_func: document.getElementById("t1_wbc_func")?.value || "",
    t1_plt_func: document.getElementById("t1_plt_func")?.value || "",

    // 任務二
    t2_rbc_advantage: document.getElementById("t2_rbc_advantage")?.value || "",
    t2_wbc_motion: document.getElementById("t2_wbc_motion")?.value || "",

    // 任務三
    t3_art_dir: document.getElementById("t3_art_dir")?.value || "",
    t3_vein_dir: document.getElementById("t3_vein_dir")?.value || "",
    t3_cap_wall: document.getElementById("t3_cap_wall")?.value || "",
    t3_vein_lumen: document.getElementById("t3_vein_lumen")?.value || "",
    t3_cap_speed: document.getElementById("t3_cap_speed")?.value || "",
    t3_vein_bp: document.getElementById("t3_vein_bp")?.value || "",
    t3_vein_valve: document.getElementById("t3_vein_valve")?.value || "",

    // 任務四
    t4_valve_name: document.getElementById("t4_valve_name")?.value || "",
    t4_valve_func: document.getElementById("t4_valve_func")?.value || "",
    t4_cap_exchange: document.getElementById("t4_cap_exchange")?.value || "",

    // 任務五
    t5_pul_start_chamber: document.getElementById("t5_pul_start_chamber")?.value || "",
    t5_pul_vessel: document.getElementById("t5_pul_vessel")?.value || "",
    t5_pul_blood_type: document.getElementById("t5_pul_blood_type")?.value || "",
    t5_pul_vein: document.getElementById("t5_pul_vein")?.value || "",
    t5_pul_end_chamber: document.getElementById("t5_pul_end_chamber")?.value || "",
    t5_sys_start_chamber: document.getElementById("t5_sys_start_chamber")?.value || "",
    t5_sys_vessel: document.getElementById("t5_sys_vessel")?.value || "",
    t5_sys_blood_type: document.getElementById("t5_sys_blood_type")?.value || "",
    t5_sys_vein: document.getElementById("t5_sys_vein")?.value || "",
    t5_sys_end_chamber: document.getElementById("t5_sys_end_chamber")?.value || "",

    // 任務六
    t6_fluid_tissue: document.getElementById("t6_fluid_tissue")?.value || "",
    t6_fluid_lymph: document.getElementById("t6_fluid_lymph")?.value || "",
    t6_fluid_node: document.getElementById("t6_fluid_node")?.value || "",
    t6_fluid_return: document.getElementById("t6_fluid_return")?.value || "",
    t6_node_swollen: document.getElementById("t6_node_swollen")?.value || "",

    // 任務七 (選擇題)
    mcq: {}
  };

  for (let i = 1; i <= 10; i++) {
    const checked = document.querySelector(`input[name="mcq_${i}"]:checked`);
    data.mcq[`mcq_${i}`] = checked ? checked.value : "";
  }

  return data;
}

// 自動儲存至 localStorage
function saveFormData() {
  const data = getFormData();
  localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(data));
  localStorage.setItem(STORAGE_KEY_TIMESTAMP, Date.now().toString());

  const badge = document.getElementById("autoSaveBadge");
  if (badge) {
    badge.innerHTML = `<span class="save-icon">💾</span> ${new Date().toLocaleTimeString('zh-TW', {hour12:false})} 已自動暫存`;
  }
}

// 載入已存資料
function loadSavedData() {
  const raw = localStorage.getItem(STORAGE_KEY_DATA);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    
    // 身分欄位
    if (data.sClass) document.getElementById("studentClass").value = data.sClass;
    if (data.sSeat) document.getElementById("studentSeat").value = data.sSeat;
    if (data.sName) document.getElementById("studentName").value = data.sName;

    // 所有 select
    Object.keys(data).forEach(k => {
      if (k !== 'mcq' && k !== 'sClass' && k !== 'sSeat' && k !== 'sName') {
        const el = document.getElementById(k);
        if (el && data[k]) {
          el.value = data[k];
        }
      }
    });

    // 選擇題 radio
    if (data.mcq) {
      Object.keys(data.mcq).forEach(qKey => {
        const val = data.mcq[qKey];
        if (val) {
          const radio = document.querySelector(`input[name="${qKey}"][value="${val}"]`);
          if (radio) radio.checked = true;
        }
      });
    }

    updateStepCheckmarks();
  } catch (e) {
    console.error("載入暫存失敗", e);
  }
}

// 更新導覽勾選標記
function updateStepCheckmarks() {
  const data = getFormData();
  // 檢查各關卡是否有填寫
  // 任務一
  const t1Filled = data.t1_rbc_nucleus && data.t1_wbc_nucleus && data.t1_plt_nucleus;
  toggleCheckMark(1, t1Filled);

  // 任務二
  const t2Filled = data.t2_rbc_advantage && data.t2_wbc_motion;
  toggleCheckMark(2, t2Filled);

  // 任務三
  const t3Filled = data.t3_art_dir && data.t3_cap_wall && data.t3_vein_valve;
  toggleCheckMark(3, t3Filled);

  // 任務四
  const t4Filled = data.t4_valve_name && data.t4_cap_exchange;
  toggleCheckMark(4, t4Filled);

  // 任務五
  const t5Filled = data.t5_pul_start_chamber && data.t5_sys_start_chamber;
  toggleCheckMark(5, t5Filled);

  // 任務六
  const t6Filled = data.t6_fluid_tissue && data.t6_fluid_lymph;
  toggleCheckMark(6, t6Filled);

  // 任務七
  let mcqCount = 0;
  for (let i = 1; i <= 10; i++) {
    if (data.mcq[`mcq_${i}`]) mcqCount++;
  }
  toggleCheckMark(7, mcqCount === 10);
}

function toggleCheckMark(step, completed) {
  const btn = document.querySelector(`.step-btn[data-step="${step}"]`);
  if (btn) {
    if (completed) {
      btn.classList.add("completed");
    } else {
      btn.classList.remove("completed");
    }
  }
}

// 身分覆核門禁 Modal
function checkStudentIdentityAndStatus() {
  const savedDataRaw = localStorage.getItem(STORAGE_KEY_DATA);
  const submittedRaw = localStorage.getItem(STORAGE_KEY_SUBMITTED);

  if (savedDataRaw) {
    try {
      const data = JSON.parse(savedDataRaw);
      if (data.sClass && data.sSeat && data.sName) {
        const modal = document.getElementById("identityVerifyModal");
        const nameSpan = document.getElementById("savedClassSeatName");
        nameSpan.textContent = `${data.sClass} 班 ${data.sSeat} 號 ${data.sName}`;
        modal.classList.remove("hidden");
      }
    } catch (e) {}
  }
}

// 一鍵乾淨重置 (換下一位同學作答)
function startFreshQuiz(isNewStudent) {
  localStorage.removeItem(STORAGE_KEY_DATA);
  localStorage.removeItem(STORAGE_KEY_TIMESTAMP);
  localStorage.removeItem(STORAGE_KEY_SUBMITTED);

  const inputs = document.querySelectorAll("input");
  inputs.forEach(i => {
    if (i.type === 'radio' || i.type === 'checkbox') i.checked = false;
    else i.value = "";
  });

  const selects = document.querySelectorAll("select");
  selects.forEach(s => s.selectedIndex = 0);

  document.querySelectorAll(".step-btn").forEach(b => b.classList.remove("completed"));
  switchToStep("1");

  if (isNewStudent) {
    console.log("已乾淨重置學習單，歡迎新同學！");
  }
}

// 交卷計算分數
function handleSubmit() {
  const data = getFormData();

  // 身分驗證防呆
  if (!data.sClass) {
    alert("⚠️ 請先選擇【班級】！");
    switchToStep("1");
    document.getElementById("studentClass").focus();
    return;
  }
  if (!data.sSeat) {
    alert("⚠️ 請先選擇【座號】！");
    switchToStep("1");
    document.getElementById("studentSeat").focus();
    return;
  }
  if (!data.sName || data.sName.length < 2) {
    alert("⚠️ 請填寫學生【真實中文姓名】（2~5 字，嚴禁暱稱）！");
    switchToStep("1");
    document.getElementById("studentName").focus();
    return;
  }

  // 計算第 7 關 10 題素養客觀題分數 (每題 10 分)
  let score = 0;
  let correctCount = 0;
  for (let i = 1; i <= 10; i++) {
    const userAns = data.mcq[`mcq_${i}`];
    const target = MCQ_ANSWERS[`mcq_${i}`].ans;
    if (userAns === target) {
      score += 10;
      correctCount++;
    }
  }

  // 成果卡顯示
  document.getElementById("resStudentInfo").textContent = `${data.sClass} 班 ${data.sSeat} 號 ${data.sName} 同學`;
  document.getElementById("resScore").textContent = score;
  document.getElementById("resDetail").textContent = `客觀素養選擇題 10 題答對 ${correctCount} 題，全卷任務已妥善紀錄！`;
  document.getElementById("resultModal").classList.remove("hidden");

  // 標記已交卷
  localStorage.setItem(STORAGE_KEY_SUBMITTED, JSON.stringify({
    score: score,
    timestamp: Date.now()
  }));

  // 背景自動提交後端 GAS (8 秒 Wi-Fi 降級防禦)
  submitToGasBackend(data, score);
}

// 雲端 GAS 提交 (支援原地覆蓋與斷網保護)
function submitToGasBackend(data, score) {
  // 正課通用 GAS 網址 (與 4-1, 4-2 共用後端 API)
  const GAS_URL = "https://script.google.com/macros/s/AKfycbwPz2t5Z3f6T6Ew5L7S9eYg_EXAMPLE/exec"; // 由教師儀表板設定

  const payload = {
    unit: "3-2 人體的循環",
    studentClass: data.sClass,
    studentSeat: data.sSeat, // 後端會強制補單引號 "'" + seat，鎖定前導零
    studentName: data.sName,
    score: score,
    details: JSON.stringify(data),
    submitTime: new Date().toISOString()
  };

  // 8 秒逾時防護
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  fetch(GAS_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: controller.signal
  }).then(() => {
    clearTimeout(timeoutId);
    console.log("成績已順利提交至教師雲端儀表板！");
  }).catch(err => {
    clearTimeout(timeoutId);
    console.warn("因校園 Wi-Fi 斷網或後端尚未部署，已安全留存於本機暫存中（不卡死交卷）", err);
  });
}
