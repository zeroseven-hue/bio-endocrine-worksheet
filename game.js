/**
 * 國中生物 4-2 內分泌系統 數位互動學習單
 * 主邏輯核心：雙模式、防呆驗證、人體圖互動、localStorage 暫存與 GAS 雙軌上傳
 */

// 後端 GAS Web App 接收 URL（已設定為老師專屬試算表 API）
const GAS_URL = "https://script.google.com/macros/s/AKfycby2-Pj2Nz1NFonB11rtsHXMMGU2qxLxvbjV0KCu4pi4oNXv2QLp0tK8m1XNYWvlCRJoEA/exec";

// 本地存儲鍵名
const STORAGE_KEY_INDIV = "BIO_4_2_INDIVIDUAL_DATA";
const STORAGE_KEY_GROUP = "BIO_4_2_GROUP_DATA";
const STORAGE_KEY_SUBMIT_INDIV = "BIO_4_2_SUBMITTED_INDIV";
const STORAGE_KEY_SUBMIT_GROUP = "BIO_4_2_SUBMITTED_GROUP";

// 當前狀態管理
let currentMode = "individual"; // "individual" | "group"
let currentStep = 1;
let currentGland = "A";
let autoSaveTimer = null;

// ==================== 1. 初始化班級座號與事件掛載 ====================
document.addEventListener("DOMContentLoaded", () => {
  // 4.5 檢查 URL 是否帶有重置指令 (?reset=1)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('reset') === '1' || urlParams.get('fresh') === '1') {
    localStorage.removeItem(STORAGE_KEY_INDIV);
    localStorage.removeItem(STORAGE_KEY_GROUP);
    localStorage.removeItem(STORAGE_KEY_SUBMIT_INDIV);
    localStorage.removeItem(STORAGE_KEY_SUBMIT_GROUP);
    localStorage.removeItem('BIO_4_2_LAST_TIMESTAMP');
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  // 4.8 課堂超時 40 分鐘自動清空判定 (專為 10 分鐘推車換班設計)
  checkBioSessionTimeout();

  initDropdowns();
  bindModeSwitching();
  bindStepperEvents();
  bindHumanViewerEvents();
  bindInputListeners();
  loadSavedData();
  updateStepperCheckmarks();
  updateGlandNodeStatus();
  initExitGuard();
  checkBioStudentIdentityAndStatus();

  // 若記憶為小組模式，自動恢復上次開啟的任務子分頁
  const savedGroupTab = localStorage.getItem("BIO_ACTIVE_GROUP_TAB");
  if (savedGroupTab) {
    const targetBtn = document.querySelector(`.group-tab-btn[data-gtab="${savedGroupTab}"]`);
    if (targetBtn) targetBtn.click();
  }
});

/** 初始化 701~710 與 01~35 純數字下拉選項 (嚴禁出現「班」與「號」字樣) */
function initDropdowns() {
  const classSelects = [document.getElementById("studentClass"), document.getElementById("groupClass")];
  classSelects.forEach(sel => {
    if (!sel) return;
    for (let c = 701; c <= 710; c++) {
      const opt = document.createElement("option");
      opt.value = String(c);
      opt.textContent = String(c); // 純數字，無「班」字
      sel.appendChild(opt);
    }
  });

  const studentSeat = document.getElementById("studentSeat");
  if (studentSeat) {
    for (let s = 1; s <= 35; s++) {
      const val = s < 10 ? `0${s}` : String(s);
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = val; // 純兩位數字，無「號」字
      studentSeat.appendChild(opt);
    }
  }

  // 小組組別 1~8（純數字，嚴禁「第」與「組」字樣）
  const groupNum = document.getElementById("groupNum");
  if (groupNum) {
    for (let g = 1; g <= 8; g++) {
      const opt = document.createElement("option");
      opt.value = String(g);
      opt.textContent = String(g);
      groupNum.appendChild(opt);
    }
  }

  // 初始生成小組成員座號下拉選單
  renderGroupMemberSlots(4);
}

/** 動態生成小組出席組員座號下拉 */
function renderGroupMemberSlots(count) {
  const grid = document.getElementById("memberSeatsGrid");
  if (!grid) return;
  
  // 保存舊選擇
  const oldSelections = [];
  grid.querySelectorAll("select").forEach(sel => oldSelections.push(sel.value));

  grid.innerHTML = "";
  for (let i = 1; i <= count; i++) {
    const slot = document.createElement("div");
    slot.className = "member-seat-slot";

    const tag = document.createElement("span");
    tag.className = "slot-tag";
    tag.textContent = `組員 ${i}:`;

    const sel = document.createElement("select");
    sel.className = "cyber-select member-seat-select";
    sel.id = `memberSeat_${i}`;

    const defOpt = document.createElement("option");
    defOpt.value = "";
    defOpt.textContent = "選擇座號";
    sel.appendChild(defOpt);

    for (let s = 1; s <= 35; s++) {
      const val = s < 10 ? `0${s}` : String(s);
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = val; // 純數字，無「號」字
      sel.appendChild(opt);
    }

    if (oldSelections[i - 1]) {
      sel.value = oldSelections[i - 1];
    }

    sel.addEventListener("change", () => {
      syncAssigneeDropdowns();
      triggerAutoSave();
    });

    slot.appendChild(tag);
    slot.appendChild(sel);
    grid.appendChild(slot);
  }

  syncAssigneeDropdowns();
}

/** 同步小組出席組員座號至所有任務卡與比較表的負責人選單 */
function syncAssigneeDropdowns() {
  const members = getSelectedGroupMembers();
  const assigneeSelects = document.querySelectorAll(".gland-assignee");

  assigneeSelects.forEach(sel => {
    const curVal = sel.value;
    sel.innerHTML = '<option value="" disabled selected>請認領</option>';

    members.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = `${m} 認領`; // 無「號同學」字樣
      sel.appendChild(opt);
    });

    if (members.includes(curVal)) {
      sel.value = curVal;
    }
  });
}

/** 取得當前到齊組員座號清單 */
function getSelectedGroupMembers() {
  const selects = document.querySelectorAll(".member-seat-select");
  const list = [];
  selects.forEach(s => {
    if (s.value && !list.includes(s.value)) {
      list.push(s.value);
    }
  });
  return list;
}

// ==================== 2. 雙模式切換與身分欄位連動 ====================
function bindModeSwitching() {
  const tabIndiv = document.getElementById("tabIndividual");
  const tabGroup = document.getElementById("tabGroup");
  const indivIdRow = document.getElementById("individualIdRow");
  const groupIdRow = document.getElementById("groupIdRow");
  const indivContainer = document.getElementById("individualModeContainer");
  const groupContainer = document.getElementById("groupModeContainer");
  const identityTitle = document.getElementById("identityTitle");

  tabIndiv.addEventListener("click", () => {
    currentMode = "individual";
    localStorage.setItem("BIO_ACTIVE_MODE", "individual");
    tabIndiv.classList.add("active");
    tabGroup.classList.remove("active");
    indivIdRow.classList.remove("hidden");
    groupIdRow.classList.add("hidden");
    indivContainer.classList.remove("hidden");
    groupContainer.classList.add("hidden");
    identityTitle.textContent = "個人學習單 ｜ 基本資料設定";
    showToast("已切換至【個人學習單】模式");
  });

  tabGroup.addEventListener("click", () => {
    currentMode = "group";
    localStorage.setItem("BIO_ACTIVE_MODE", "group");
    tabGroup.classList.add("active");
    tabIndiv.classList.remove("active");
    groupIdRow.classList.remove("hidden");
    indivIdRow.classList.add("hidden");
    groupContainer.classList.remove("hidden");
    indivContainer.classList.add("hidden");
    identityTitle.textContent = "小組學習單 ｜ 彈性分組與組員設定";
    showToast("已切換至【小組學習單】模式");
  });

  // 記憶 F5 重新載入前的模式狀態
  const savedMode = localStorage.getItem("BIO_ACTIVE_MODE");
  if (savedMode === "group") {
    tabGroup.click();
  }

  // 小組人數下拉選單切換
  const groupSize = document.getElementById("groupSize");
  if (groupSize) {
    groupSize.addEventListener("change", (e) => {
      renderGroupMemberSlots(parseInt(e.target.value, 10));
      triggerAutoSave();
    });
  }

  // 學生姓名 2~5 字即時校驗（相容雙字單名，封殺純英數）
  const studentNameInput = document.getElementById("studentName");
  const nameFeedback = document.getElementById("nameFeedback");
  if (studentNameInput) {
    studentNameInput.addEventListener("input", (e) => {
      const val = e.target.value.trim();
      const validChineseRegex = /^[\u4e00-\u9fa5]{2,5}$/;
      const isRepeated = /(.)\1{2,}/.test(val); // 封殺 哈哈哈 等玩笑

      if (!val) {
        nameFeedback.textContent = "";
        nameFeedback.className = "valid-feedback";
      } else if (validChineseRegex.test(val) && !isRepeated) {
        nameFeedback.textContent = "✅ 姓名格式正確";
        nameFeedback.className = "valid-feedback success";
      } else {
        nameFeedback.textContent = "⚠️ 請輸入 2~5 個繁體中文字（不含符號或純英數）";
        nameFeedback.className = "valid-feedback error";
      }
      triggerAutoSave();
    });
  }
}

// ==================== 3. 個人速記 Stepper 關卡切換 ====================
function bindStepperEvents() {
  const stepButtons = document.querySelectorAll(".step-btn");
  stepButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const step = parseInt(btn.dataset.step, 10);
      goToStep(step);
    });
  });

  // 下一步 / 上一步
  document.querySelectorAll(".next-step-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const next = parseInt(btn.dataset.next, 10);
      goToStep(next);
    });
  });

  document.querySelectorAll(".prev-step-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const prev = parseInt(btn.dataset.prev, 10);
      goToStep(prev);
    });
  });

  // 素養寫作句型抽屜與字數統計
  const essayHintBtn = document.getElementById("essayHintBtn");
  const essayScaffold = document.getElementById("essayScaffold");
  const essayInput = document.getElementById("q7_literacy_essay");
  const charCount = document.getElementById("essayCharCount");

  if (essayHintBtn && essayScaffold) {
    essayHintBtn.addEventListener("click", () => {
      essayScaffold.classList.toggle("hidden");
    });
  }

  if (essayInput && charCount) {
    essayInput.addEventListener("input", (e) => {
      const len = e.target.value.trim().length;
      charCount.textContent = `已輸入 ${len} 字`;
      triggerAutoSave();
    });
  }

  // 提交按鈕監聽
  const btnSubmitIndividual = document.getElementById("btnSubmitIndividual");
  if (btnSubmitIndividual) {
    btnSubmitIndividual.addEventListener("click", handleSubmitIndividual);
  }
}

function goToStep(step) {
  currentStep = step;
  // 切換 Stepper 按鈕樣式
  document.querySelectorAll(".step-btn").forEach(btn => {
    btn.classList.toggle("active", parseInt(btn.dataset.step, 10) === step);
  });

  // 切換卡片顯示
  for (let s = 1; s <= 7; s++) {
    const card = document.getElementById(`stepCard${s}`);
    if (card) {
      card.classList.toggle("hidden", s !== step);
    }
  }

  // 平順滾動至卡片頂部
  const stepper = document.querySelector(".stepper-nav");
  if (stepper) {
    stepper.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  updateStepperCheckmarks();
}

/** 檢查各關卡是否已完成作答，即時打綠勾 */
function updateStepperCheckmarks() {
  const checks = {
    1: () => !!document.getElementById("q1_height").value && !!document.getElementById("q1_hormone").value && !!document.getElementById("q1_gland").value,
    2: () => document.querySelectorAll('input[name="q2_symptom"]:checked').length > 0,
    3: () => !!document.getElementById("q3_age").value && !!document.getElementById("q3_hormone").value && document.querySelectorAll('input[name="q3_symptom"]:checked').length > 0,
    4: () => !!document.getElementById("q4_location").value && !!document.getElementById("q4_function").value,
    5: () => !!document.getElementById("q5_hormone").value && !!document.getElementById("q5_location").value && document.querySelectorAll('input[name="q5_func"]:checked').length > 0,
    6: () => !!document.getElementById("q6_abnormal_hormone").value && !!document.getElementById("q6_lower_hormone").value && !!document.getElementById("q6_lower_convert").value && !!document.getElementById("q6_raise_hormone").value && !!document.getElementById("q6_raise_convert").value && document.querySelectorAll('input[name="q6_care"]:checked').length > 0,
    7: () => !!document.getElementById("q7_hormone_change").value && document.getElementById("q7_literacy_essay").value.trim().length >= 5
  };

  for (let s = 1; s <= 7; s++) {
    const btn = document.querySelector(`.step-btn[data-step="${s}"]`);
    if (btn) {
      const isDone = checks[s] ? checks[s]() : false;
      btn.classList.toggle("completed", isDone);
    }
  }
}

// ==================== 4. 小組統整模式：人體圖與連動任務卡 ====================
function bindHumanViewerEvents() {
  // 小組模式三大核心 Tab 頁籤切換
  const tabBtns = document.querySelectorAll(".group-tab-btn");
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetTab = btn.dataset.gtab;
      tabBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      document.querySelectorAll(".group-tab-pane").forEach(pane => {
        pane.classList.add("hidden");
      });

      localStorage.setItem("BIO_ACTIVE_GROUP_TAB", targetTab);
      if (targetTab === "tabGlands") {
        document.getElementById("paneGlands").classList.remove("hidden");
      } else if (targetTab === "tabCompare") {
        document.getElementById("paneCompare").classList.remove("hidden");
      } else if (targetTab === "tabMovies") {
        document.getElementById("paneMovies").classList.remove("hidden");
      }
    });
  });

  // 課本標準解剖圖科技熱點按鈕點擊
  const hotspots = document.querySelectorAll(".img-hotspot");
  hotspots.forEach(spot => {
    spot.addEventListener("click", () => {
      const gland = spot.dataset.gland;
      switchGlandTask(gland);
    });
  });

  // 兼容舊版 SVG 節點點擊
  const nodes = document.querySelectorAll(".gland-target-node");
  nodes.forEach(node => {
    node.addEventListener("click", () => {
      const gland = node.dataset.gland;
      switchGlandTask(gland);
    });
  });

  const btnSubmitGroup = document.getElementById("btnSubmitGroup");
  if (btnSubmitGroup) {
    btnSubmitGroup.addEventListener("click", handleSubmitGroup);
  }

  // 監聽小組題目欄位變動更新節點狀態
  document.querySelectorAll(".gland-answer, .gland-assignee, .table-select").forEach(el => {
    el.addEventListener("change", () => {
      updateGlandNodeStatus();
      triggerAutoSave();
    });
  });
}

function switchGlandTask(gland) {
  currentGland = gland;
  // 熱點高亮切換
  document.querySelectorAll(".img-hotspot").forEach(s => {
    s.classList.toggle("active-target", s.dataset.gland === gland);
  });
  // SVG 節點高亮切換 (如存在)
  document.querySelectorAll(".gland-target-node").forEach(n => {
    n.classList.toggle("active-target", n.dataset.gland === gland);
  });

  // 卡片抽換切換
  ["A", "B", "C", "D", "E", "F"].forEach(g => {
    const card = document.getElementById(`cardGland${g}`);
    if (card) {
      card.classList.toggle("hidden", g !== gland);
    }
  });

  // 平板觸控貼心提示
  showToast(`已切換至【座標點 ${gland} 任務卡】`);
}

/** 檢查腺體 A~F 是否填寫完整，更新熱點與 SVG 光點綠色完成狀態 */
function updateGlandNodeStatus() {
  ["A", "B", "C", "D", "E", "F"].forEach(g => {
    const spot = document.getElementById(`hotspot${g}`);
    const node = document.getElementById(`node${g}`);
    const assignee = document.getElementById(`assignee${g}`);
    const name = document.getElementById(`glandName${g}`);
    const hormone = document.getElementById(`hormone${g}`);
    const disease = document.getElementById(`disease${g}`);

    const isComplete = assignee && assignee.value && name && name.value && hormone && hormone.value && disease && disease.value;
    if (spot) {
      spot.classList.toggle("completed", !!isComplete);
    }
    if (node) {
      node.classList.toggle("completed", !!isComplete);
    }
  });
}

// ==================== 5. 輸入監聽與 localStorage 本地自動暫存 ====================
function bindInputListeners() {
  const stdClsEl = document.getElementById("studentClass");
  if (stdClsEl) {
    stdClsEl.addEventListener("change", () => {
      const savedIndiv = localStorage.getItem(STORAGE_KEY_INDIV);
      if (savedIndiv) {
        try {
          const d = JSON.parse(savedIndiv);
          if (d.class && d.class !== stdClsEl.value) {
            if (confirm("⚠️ 系統偵測到班級已切換為【" + stdClsEl.value + " 班】！\n\n是否清空上一班（" + d.class + " 班）的座號姓名與作答紀錄，開始全新作答？")) {
              startFreshBioQuiz(true);
            }
          }
        } catch(e) {}
      }
    });
  }
  // 所有 input / select / textarea 變更皆觸發微緩衝暫存
  document.addEventListener("input", (e) => {
    if (e.target.matches("input, select, textarea")) {
      updateStepperCheckmarks();
      updateGlandNodeStatus();
      triggerAutoSave();
    }
  });

  document.addEventListener("change", (e) => {
    if (e.target.matches("input, select, textarea")) {
      updateStepperCheckmarks();
      updateGlandNodeStatus();
      triggerAutoSave();
    }
  });

  // Modal 關閉重置
  const btnModalClose = document.getElementById("btnModalClose");
  if (btnModalClose) {
    btnModalClose.addEventListener("click", () => {
      document.getElementById("resultModal").classList.add("hidden");
      // 重置頁面回到頂端
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  const btnModalFresh = document.getElementById("btnModalFreshStudent");
  if (btnModalFresh) {
    btnModalFresh.addEventListener("click", () => {
      startFreshBioQuiz();
    });
  }
}

function triggerAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    saveCurrentData();
    const pill = document.getElementById("autoSaveBadge");
    if (pill) {
      pill.style.background = "#bbf7d0";
      setTimeout(() => { pill.style.background = "#d1fae5"; }, 800);
    }
  }, 400);
}

function saveCurrentData() {
  // 1. 個人資料
  const indivPayload = {
    class: document.getElementById("studentClass").value,
    seat: document.getElementById("studentSeat").value,
    name: document.getElementById("studentName").value,
    q1_height: document.getElementById("q1_height").value,
    q1_hormone: document.getElementById("q1_hormone").value,
    q1_gland: document.getElementById("q1_gland").value,
    q2_symptoms: Array.from(document.querySelectorAll('input[name="q2_symptom"]:checked')).map(cb => cb.value),
    q3_age: document.getElementById("q3_age").value,
    q3_hormone: document.getElementById("q3_hormone").value,
    q3_symptoms: Array.from(document.querySelectorAll('input[name="q3_symptom"]:checked')).map(cb => cb.value),
    q4_location: document.getElementById("q4_location").value,
    q4_function: document.getElementById("q4_function").value,
    q5_hormone: document.getElementById("q5_hormone").value,
    q5_location: document.getElementById("q5_location").value,
    q5_functions: Array.from(document.querySelectorAll('input[name="q5_func"]:checked')).map(cb => cb.value),
    q6_abnormal_hormone: document.getElementById("q6_abnormal_hormone").value,
    q6_lower_hormone: document.getElementById("q6_lower_hormone").value,
    q6_lower_convert: document.getElementById("q6_lower_convert").value,
    q6_raise_hormone: document.getElementById("q6_raise_hormone").value,
    q6_raise_convert: document.getElementById("q6_raise_convert").value,
    q6_cares: Array.from(document.querySelectorAll('input[name="q6_care"]:checked')).map(cb => cb.value),
    q7_hormone_change: document.getElementById("q7_hormone_change").value,
    q7_literacy_essay: document.getElementById("q7_literacy_essay").value
  };
  localStorage.setItem(STORAGE_KEY_INDIV, JSON.stringify(indivPayload));
  localStorage.setItem('BIO_4_2_LAST_TIMESTAMP', String(Date.now()));

  // 2. 小組資料
  const groupPayload = {
    class: document.getElementById("groupClass").value,
    groupNum: document.getElementById("groupNum").value,
    groupSize: document.getElementById("groupSize").value,
    members: getSelectedGroupMembers(),
    glands: {
      A: {
        assignee: document.getElementById("assigneeA").value,
        name: document.getElementById("glandNameA").value,
        hormone: document.getElementById("hormoneA").value,
        disease: document.getElementById("diseaseA").value
      },
      B: {
        assignee: document.getElementById("assigneeB").value,
        name: document.getElementById("glandNameB").value,
        hormone: document.getElementById("hormoneB").value,
        disease: document.getElementById("diseaseB").value
      },
      C: {
        assignee: document.getElementById("assigneeC").value,
        name: document.getElementById("glandNameC").value,
        hormone: document.getElementById("hormoneC").value,
        disease: document.getElementById("diseaseC").value
      },
      D: {
        assignee: document.getElementById("assigneeD").value,
        name: document.getElementById("glandNameD").value,
        hormone: document.getElementById("hormoneD").value,
        disease: document.getElementById("diseaseD").value
      },
      E: {
        assignee: document.getElementById("assigneeE").value,
        name: document.getElementById("glandNameE").value,
        hormone: document.getElementById("hormoneE").value,
        disease: document.getElementById("diseaseE").value
      },
      F: {
        assignee: document.getElementById("assigneeF").value,
        name: document.getElementById("glandNameF").value,
        hormone: document.getElementById("hormoneF").value,
        disease: document.getElementById("diseaseF").value
      }
    },
    compareEnzyme: {
      assignee: document.getElementById("assigneeEnzymeCompare") ? document.getElementById("assigneeEnzymeCompare").value : "",
      same: document.getElementById("comp_enz_same") ? document.getElementById("comp_enz_same").value : "",
      enz_duct: document.getElementById("comp_enz_duct") ? document.getElementById("comp_enz_duct").value : "",
      hor_duct: document.getElementById("comp_hor_duct") ? document.getElementById("comp_hor_duct").value : "",
      enz_transport: document.getElementById("comp_enz_transport") ? document.getElementById("comp_enz_transport").value : "",
      hor_transport: document.getElementById("comp_hor_transport") ? document.getElementById("comp_hor_transport").value : "",
      enz_func: document.getElementById("comp_enz_func") ? document.getElementById("comp_enz_func").value : "",
      hor_func: document.getElementById("comp_hor_func") ? document.getElementById("comp_hor_func").value : ""
    },
    compareNervous: {
      assignee: document.getElementById("assigneeCompare").value,
      trans_endo: document.getElementById("comp_trans_endo").value,
      trans_nerv: document.getElementById("comp_trans_nerv").value,
      speed_endo: document.getElementById("comp_speed_endo").value,
      speed_nerv: document.getElementById("comp_speed_nerv").value,
      scope_endo: document.getElementById("comp_scope_endo").value,
      scope_nerv: document.getElementById("comp_scope_nerv").value,
      time_endo: document.getElementById("comp_time_endo").value,
      time_nerv: document.getElementById("comp_time_nerv").value
    },
    movies: {
      m1_assignee: document.getElementById("assigneeMovie1") ? document.getElementById("assigneeMovie1").value : "",
      m1_disease: document.getElementById("m1_disease") ? document.getElementById("m1_disease").value : "",
      m1_cause: document.getElementById("m1_cause") ? document.getElementById("m1_cause").value : "",
      m1_reason: document.getElementById("m1_reason") ? document.getElementById("m1_reason").value : "",
      m2_assignee: document.getElementById("assigneeMovie2") ? document.getElementById("assigneeMovie2").value : "",
      m2_symptoms: Array.from(document.querySelectorAll('input[name="m2_sym"]:checked')).map(cb => cb.value),
      m2_diff: document.getElementById("m2_diff") ? document.getElementById("m2_diff").value : "",
      m3_assignee: document.getElementById("assigneeMovie3") ? document.getElementById("assigneeMovie3").value : "",
      m3_symptom: document.getElementById("m3_symptom") ? document.getElementById("m3_symptom").value : "",
      m3_calcium_reason: document.getElementById("m3_calcium_reason") ? document.getElementById("m3_calcium_reason").value : "",
      m4_assignee: document.getElementById("assigneeMovie4") ? document.getElementById("assigneeMovie4").value : "",
      m4_hormone: document.getElementById("m4_hormone") ? document.getElementById("m4_hormone").value : "",
      m4_location: document.getElementById("m4_location") ? document.getElementById("m4_location").value : "",
      m4_responses: Array.from(document.querySelectorAll('input[name="m4_resp"]:checked')).map(cb => cb.value),
      m5_assignee: document.getElementById("assigneeMovie5") ? document.getElementById("assigneeMovie5").value : "",
      m5_disease: document.getElementById("m5_disease") ? document.getElementById("m5_disease").value : "",
      m5_reason: document.getElementById("m5_reason") ? document.getElementById("m5_reason").value : "",
      m6_assignee: document.getElementById("assigneeMovie6") ? document.getElementById("assigneeMovie6").value : "",
      m6_reason_select: document.getElementById("m6_reason_select") ? document.getElementById("m6_reason_select").value : "",
      m6_drug: document.getElementById("m6_drug") ? document.getElementById("m6_drug").value : "",
      group_empathy_essay: document.getElementById("group_empathy_essay") ? document.getElementById("group_empathy_essay").value : ""
    }
  };
  localStorage.setItem(STORAGE_KEY_GROUP, JSON.stringify(groupPayload));
}

function loadSavedData() {
  // 還原個人資料
  const indivRaw = localStorage.getItem(STORAGE_KEY_INDIV);
  if (indivRaw) {
    try {
      const data = JSON.parse(indivRaw);
      if (data.class) document.getElementById("studentClass").value = data.class;
      if (data.seat) document.getElementById("studentSeat").value = data.seat;
      if (data.name) {
        document.getElementById("studentName").value = data.name;
        document.getElementById("studentName").dispatchEvent(new Event("input"));
      }
      if (data.q1_height) document.getElementById("q1_height").value = data.q1_height;
      if (data.q1_hormone) document.getElementById("q1_hormone").value = data.q1_hormone;
      if (data.q1_gland) document.getElementById("q1_gland").value = data.q1_gland;

      if (data.q2_symptoms) {
        document.querySelectorAll('input[name="q2_symptom"]').forEach(cb => {
          cb.checked = data.q2_symptoms.includes(cb.value);
        });
      }
      if (data.q3_age) document.getElementById("q3_age").value = data.q3_age;
      if (data.q3_hormone) document.getElementById("q3_hormone").value = data.q3_hormone;
      if (data.q3_symptoms) {
        document.querySelectorAll('input[name="q3_symptom"]').forEach(cb => {
          cb.checked = data.q3_symptoms.includes(cb.value);
        });
      }
      if (data.q4_location) document.getElementById("q4_location").value = data.q4_location;
      if (data.q4_function) document.getElementById("q4_function").value = data.q4_function;

      if (data.q5_hormone) document.getElementById("q5_hormone").value = data.q5_hormone;
      if (data.q5_location) document.getElementById("q5_location").value = data.q5_location;
      if (data.q5_functions) {
        document.querySelectorAll('input[name="q5_func"]').forEach(cb => {
          cb.checked = data.q5_functions.includes(cb.value);
        });
      }

      if (data.q6_abnormal_hormone) document.getElementById("q6_abnormal_hormone").value = data.q6_abnormal_hormone;
      if (data.q6_lower_hormone) document.getElementById("q6_lower_hormone").value = data.q6_lower_hormone;
      if (data.q6_lower_convert) document.getElementById("q6_lower_convert").value = data.q6_lower_convert;
      if (data.q6_raise_hormone) document.getElementById("q6_raise_hormone").value = data.q6_raise_hormone;
      if (data.q6_raise_convert) document.getElementById("q6_raise_convert").value = data.q6_raise_convert;
      if (data.q6_cares) {
        document.querySelectorAll('input[name="q6_care"]').forEach(cb => {
          cb.checked = data.q6_cares.includes(cb.value);
        });
      }

      if (data.q7_hormone_change) document.getElementById("q7_hormone_change").value = data.q7_hormone_change;
      if (data.q7_literacy_essay) {
        document.getElementById("q7_literacy_essay").value = data.q7_literacy_essay;
        document.getElementById("essayCharCount").textContent = `已輸入 ${data.q7_literacy_essay.length} 字`;
      }
    } catch (e) {
      console.warn("還原個人暫存失敗", e);
    }
  }

  // 還原小組資料
  const groupRaw = localStorage.getItem(STORAGE_KEY_GROUP);
  if (groupRaw) {
    try {
      const gData = JSON.parse(groupRaw);
      if (gData.class) document.getElementById("groupClass").value = gData.class;
      if (gData.groupNum) document.getElementById("groupNum").value = gData.groupNum;
      if (gData.groupSize) {
        document.getElementById("groupSize").value = gData.groupSize;
        renderGroupMemberSlots(parseInt(gData.groupSize, 10));
      }
      if (gData.members && Array.isArray(gData.members)) {
        const selects = document.querySelectorAll(".member-seat-select");
        gData.members.forEach((m, idx) => {
          if (selects[idx]) selects[idx].value = m;
        });
        syncAssigneeDropdowns();
      }

      if (gData.glands) {
        ["A", "B", "C", "D", "E", "F"].forEach(g => {
          const item = gData.glands[g];
          if (!item) return;
          if (item.assignee) document.getElementById(`assignee${g}`).value = item.assignee;
          if (item.name) document.getElementById(`glandName${g}`).value = item.name;
          if (item.hormone) document.getElementById(`hormone${g}`).value = item.hormone;
          if (item.disease) document.getElementById(`disease${g}`).value = item.disease;
        });
      }

      if (gData.compare) {
        const c = gData.compare;
        if (c.assignee && document.getElementById("assigneeCompare")) document.getElementById("assigneeCompare").value = c.assignee;
        if (c.trans_endo && document.getElementById("comp_trans_endo")) document.getElementById("comp_trans_endo").value = c.trans_endo;
        if (c.trans_nerv && document.getElementById("comp_trans_nerv")) document.getElementById("comp_trans_nerv").value = c.trans_nerv;
        if (c.speed_endo && document.getElementById("comp_speed_endo")) document.getElementById("comp_speed_endo").value = c.speed_endo;
        if (c.speed_nerv && document.getElementById("comp_speed_nerv")) document.getElementById("comp_speed_nerv").value = c.speed_nerv;
        if (c.scope_endo && document.getElementById("comp_scope_endo")) document.getElementById("comp_scope_endo").value = c.scope_endo;
        if (c.scope_nerv && document.getElementById("comp_scope_nerv")) document.getElementById("comp_scope_nerv").value = c.scope_nerv;
        if (c.time_endo && document.getElementById("comp_time_endo")) document.getElementById("comp_time_endo").value = c.time_endo;
        if (c.time_nerv && document.getElementById("comp_time_nerv")) document.getElementById("comp_time_nerv").value = c.time_nerv;
      }

      if (gData.compareEnzyme) {
        const ce = gData.compareEnzyme;
        if (ce.assignee && document.getElementById("assigneeEnzymeCompare")) document.getElementById("assigneeEnzymeCompare").value = ce.assignee;
        if (ce.same && document.getElementById("comp_enz_same")) document.getElementById("comp_enz_same").value = ce.same;
        if (ce.enz_duct && document.getElementById("comp_enz_duct")) document.getElementById("comp_enz_duct").value = ce.enz_duct;
        if (ce.hor_duct && document.getElementById("comp_hor_duct")) document.getElementById("comp_hor_duct").value = ce.hor_duct;
        if (ce.enz_transport && document.getElementById("comp_enz_transport")) document.getElementById("comp_enz_transport").value = ce.enz_transport;
        if (ce.hor_transport && document.getElementById("comp_hor_transport")) document.getElementById("comp_hor_transport").value = ce.hor_transport;
        if (ce.enz_func && document.getElementById("comp_enz_func")) document.getElementById("comp_enz_func").value = ce.enz_func;
        if (ce.hor_func && document.getElementById("comp_hor_func")) document.getElementById("comp_hor_func").value = ce.hor_func;
      }

      if (gData.movies) {
        const m = gData.movies;
        if (m.m1_assignee && document.getElementById("assigneeMovie1")) document.getElementById("assigneeMovie1").value = m.m1_assignee;
        if (m.m1_disease && document.getElementById("m1_disease")) document.getElementById("m1_disease").value = m.m1_disease;
        if (m.m1_cause && document.getElementById("m1_cause")) document.getElementById("m1_cause").value = m.m1_cause;
        if (m.m1_reason && document.getElementById("m1_reason")) document.getElementById("m1_reason").value = m.m1_reason;

        if (m.m2_assignee && document.getElementById("assigneeMovie2")) document.getElementById("assigneeMovie2").value = m.m2_assignee;
        if (m.m2_symptoms && Array.isArray(m.m2_symptoms)) {
          document.querySelectorAll('input[name="m2_sym"]').forEach(cb => {
            cb.checked = m.m2_symptoms.includes(cb.value);
          });
        }
        if (m.m2_diff && document.getElementById("m2_diff")) document.getElementById("m2_diff").value = m.m2_diff;

        if (m.m3_assignee && document.getElementById("assigneeMovie3")) document.getElementById("assigneeMovie3").value = m.m3_assignee;
        if (m.m3_symptom && document.getElementById("m3_symptom")) document.getElementById("m3_symptom").value = m.m3_symptom;
        if (m.m3_calcium_reason && document.getElementById("m3_calcium_reason")) document.getElementById("m3_calcium_reason").value = m.m3_calcium_reason;

        if (m.m4_assignee && document.getElementById("assigneeMovie4")) document.getElementById("assigneeMovie4").value = m.m4_assignee;
        if (m.m4_hormone && document.getElementById("m4_hormone")) document.getElementById("m4_hormone").value = m.m4_hormone;
        if (m.m4_location && document.getElementById("m4_location")) document.getElementById("m4_location").value = m.m4_location;
        if (m.m4_responses && Array.isArray(m.m4_responses)) {
          document.querySelectorAll('input[name="m4_resp"]').forEach(cb => {
            cb.checked = m.m4_responses.includes(cb.value);
          });
        }

        if (m.m5_assignee && document.getElementById("assigneeMovie5")) document.getElementById("assigneeMovie5").value = m.m5_assignee;
        if (m.m5_disease && document.getElementById("m5_disease")) document.getElementById("m5_disease").value = m.m5_disease;
        if (m.m5_reason && document.getElementById("m5_reason")) document.getElementById("m5_reason").value = m.m5_reason;

        if (m.m6_assignee && document.getElementById("assigneeMovie6")) document.getElementById("assigneeMovie6").value = m.m6_assignee;
        if (m.m6_reason_select && document.getElementById("m6_reason_select")) document.getElementById("m6_reason_select").value = m.m6_reason_select;
        if (m.m6_drug && document.getElementById("m6_drug")) document.getElementById("m6_drug").value = m.m6_drug;

        if (m.group_empathy_essay && document.getElementById("group_empathy_essay")) {
          document.getElementById("group_empathy_essay").value = m.group_empathy_essay;
        }
      }
    } catch (e) {
      console.warn("還原小組暫存失敗", e);
    }
  }
}

// ==================== 6. 防手滑攔截與送出驗證 ====================
function initExitGuard() {
  window.addEventListener("beforeunload", (e) => {
    // 若填寫有進度，防止手滑滑出上一頁
    const name = document.getElementById("studentName").value;
    if (name) {
      e.preventDefault();
      e.returnValue = "學習單作答中，確定要離開嗎？進度已為您自動暫存於本機。";
    }
  });
}

/** 個人模式提交與計分 */
function handleSubmitIndividual() {
  const cls = document.getElementById("studentClass").value;
  const seat = document.getElementById("studentSeat").value;
  const name = document.getElementById("studentName").value.trim();

  // 1. 身分防呆
  if (!cls || !seat || !name) {
    alert("⚠️ 請先完整填寫頂部的【班級、座號與學生姓名】！");
    document.getElementById("identityCard").scrollIntoView({ behavior: "smooth" });
    return;
  }

  const validChineseRegex = /^[\u4e00-\u9fa5]{2,5}$/;
  if (!validChineseRegex.test(name)) {
    alert("⚠️ 姓名請輸入 2~5 字繁體中文真實姓名，以利成績登錄！");
    return;
  }

  // 1.5 🔍 重複繳交防呆確認 (純前端本地檢查，0 延遲、0 網路伺服器負擔)
  const existingSubmission = localStorage.getItem(STORAGE_KEY_SUBMIT_INDIV);
  if (existingSubmission) {
    try {
      const prev = JSON.parse(existingSubmission);
      const prevScore = (prev.score !== undefined) ? `${prev.score} 分` : "已計分";
      const confirmResubmit = confirm(
        `⚠️ 系統提示：\n\n你先前已經繳交過學習單囉！（成績：${prevScore}）\n\n確定要重新送出，並以「最新的作答與分數」覆蓋原本的成績嗎？`
      );
      if (!confirmResubmit) {
        return; // 學生點選取消，立即終止，原成績毫髮無傷
      }
    } catch (e) {}
  }

  // 2. 未完成題目防呆檢查
  const uncompleted = [];
  for (let s = 1; s <= 7; s++) {
    const btn = document.querySelector(`.step-btn[data-step="${s}"]`);
    if (btn && !btn.classList.contains("completed")) {
      uncompleted.push(`影片 ${s}`);
    }
  }

  if (uncompleted.length > 0) {
    const confirmSubmit = confirm(`⚠️ 提示：你還有以下關卡尚未完整填寫：\n【 ${uncompleted.join("、 ")} 】\n\n確定現在就要提早交卷嗎？（未完成題目將不計分）`);
    if (!confirmSubmit) return;
  }

  // 3. 前端客觀題與情意素養計分（總分 100 分，對齊 Rubric 評分規準）
  let score = 0;
  const breakdownList = [];

  // 【影片一：巨人的眼淚】(15分)
  const q1Height = parseInt(document.getElementById("q1_height").value, 10);
  if (q1Height >= 230 && q1Height <= 236) {
    score += 5;
    breakdownList.push("Q1巨人身高正確 (+5)");
  }
  if (document.getElementById("q1_hormone").value === "生長激素") {
    score += 5;
    breakdownList.push("Q1生長激素正確 (+5)");
  }
  if (document.getElementById("q1_gland").value === "腦垂腺") {
    score += 5;
    breakdownList.push("Q1腦垂腺正確 (+5)");
  }

  // 【影片二：甲狀腺機能亢進】(15分)
  // 正確項 (共8項)：新陳代謝過高/消瘦, 眼凸, 手抖, 肌肉萎縮, 皮膚粗糙, 緊張頭痛, 血壓飆高/心臟負擔大, 骨質疏鬆
  // 誘答項 (共3項)：身材矮小智力受限(呆小症), 血糖過高尿液排出(糖尿病), 血鈣過低抽搐(副甲狀腺)
  const q2Checked = Array.from(document.querySelectorAll('input[name="q2_symptom"]:checked')).map(cb => cb.value);
  const q2Traps = ["身材矮小智力受限", "血糖過高尿液排出", "血鈣過低抽搐"];
  const hasTraps = q2Checked.some(item => q2Traps.includes(item));
  const correctCount = q2Checked.filter(item => !q2Traps.includes(item)).length;

  if (!hasTraps && correctCount >= 6) {
    score += 15;
    breakdownList.push(`Q2甲亢特徵精準全對 (+15)`);
  } else if (!hasTraps && correctCount >= 4) {
    score += 10;
    breakdownList.push(`Q2甲亢特徵辨識良好 (+10)`);
  } else if (!hasTraps && correctCount >= 2) {
    score += 6;
    breakdownList.push(`Q2甲亢特徵部分正確 (+6)`);
  } else if (hasTraps) {
    score += Math.max(3, correctCount * 2 - 4);
    breakdownList.push(`Q2勾選含誘答項，部分得分`);
  }

  // 【影片三：不老女嬰】(15分)
  // 年齡標準答案 30 歲
  const q3Age = parseInt(document.getElementById("q3_age").value, 10);
  if (q3Age === 30) {
    score += 5;
    breakdownList.push("Q3當時年齡30歲正確 (+5)");
  } else if (q3Age >= 28 && q3Age <= 32) {
    score += 3;
    breakdownList.push("Q3年齡相近採計 (+3)");
  }
  if (document.getElementById("q3_hormone").value === "甲狀腺素") {
    score += 5;
    breakdownList.push("Q3缺乏甲狀腺素正確 (+5)");
  }
  const q3Checked = Array.from(document.querySelectorAll('input[name="q3_symptom"]:checked')).map(cb => cb.value);
  const q3HasTraps = q3Checked.includes("骨質疏鬆") || q3Checked.includes("血糖過高");
  const q3CorrectCount = q3Checked.filter(item => ["影響生長發育", "智力發展受限", "心智年齡與行為能力受限"].includes(item)).length;
  if (!q3HasTraps && q3CorrectCount >= 2) {
    score += 5;
    breakdownList.push("Q3呆小症特徵精準 (+5)");
  }

  // 【影片四：骨折與副甲狀腺】(15分)
  if (document.getElementById("q4_location").value === "包埋於甲狀腺背側") {
    score += 7;
    breakdownList.push("Q4副甲位置正確 (+7)");
  }
  if (document.getElementById("q4_function").value === "調節血鈣與磷的濃度") {
    score += 8;
    breakdownList.push("Q4副甲功能正確 (+8)");
  }

  // 【影片五：超越極限？】(15分，雙重機制評分)
  if (document.getElementById("q5_hormone").value === "腎上腺素") {
    score += 4;
    breakdownList.push("Q5腎上腺素正確 (+4)");
  }
  if (document.getElementById("q5_location").value === "腎臟上方") {
    score += 3;
    breakdownList.push("Q5腎臟上方位置正確 (+3)");
  }
  const q5Checked = Array.from(document.querySelectorAll('input[name="q5_func"]:checked')).map(cb => cb.value);
  const q5HasTrap = q5Checked.includes("腸胃消化吸收加速");
  const q5CorrectList = ["心搏加快呼吸急促", "血壓上升", "腸胃蠕動減慢", "血糖升高", "提供更多氧氣與養分"];
  const q5HitCount = q5Checked.filter(k => q5CorrectList.includes(k)).length;
  if (!q5HasTrap && q5HitCount >= 4) {
    score += 8;
    breakdownList.push("Q5雙重應急機制精準全對 (+8)");
  } else if (!q5HasTrap && q5HitCount >= 2) {
    score += 5;
    breakdownList.push("Q5應急機制部分正確 (+5)");
  }

  // 【影片六：糖尿病原理】(15分)
  if (document.getElementById("q6_abnormal_hormone").value === "胰島素") {
    score += 3;
  }
  if (document.getElementById("q6_lower_hormone").value === "胰島素" && document.getElementById("q6_lower_convert").value === "血糖→肝糖") {
    score += 4;
    breakdownList.push("Q6降血糖機制正確 (+4)");
  }
  if (document.getElementById("q6_raise_hormone").value === "升糖素" && document.getElementById("q6_raise_convert").value === "肝糖→血糖") {
    score += 4;
    breakdownList.push("Q6升血糖機制正確 (+4)");
  }
  const q6Care = Array.from(document.querySelectorAll('input[name="q6_care"]:checked')).map(cb => cb.value);
  if (q6Care.includes("定時服藥/注射") && q6Care.includes("控制飲食") && q6Care.includes("規律運動") && !q6Care.includes("多吃高糖食物")) {
    score += 4;
    breakdownList.push("Q6照護原則全對 (+4)");
  }

  // 【影片七：蜜蜂變性人與素養探討】(10分)
  if (document.getElementById("q7_hormone_change").value === "雄性激素減少、雌性激素增加") {
    score += 5;
    breakdownList.push("Q7性激素消長正確 (+5)");
  }
  // 情意素養簡答（依據 Rubric：展現尊重、包容、友善、平常心等正面態度給分）
  const essayText = document.getElementById("q7_literacy_essay").value.trim();
  const empathyKeywords = ["尊重", "包容", "友善", "平常心", "同理", "支持", "傾聽", "陪伴", "正常", "平等"];
  const hasEmpathy = empathyKeywords.some(kw => essayText.includes(kw));
  if (essayText.length >= 10 && hasEmpathy) {
    score += 5;
    breakdownList.push("Q7情意素養充分展現 (+5)");
  } else if (essayText.length >= 5) {
    score += 3;
    breakdownList.push("Q7素養簡答基本填寫 (+3)");
  }

  score = Math.min(100, score);

  // 雙重確認身分彈窗防呆
  if (!confirm("📋【學習單送出身分核對】\n\n請確認您的身分：\n" + cls + " 班 " + seat + " 號 " + name + "\n初評得分：" + score + " 分\n\n⚠️ 送出後成績將直接登錄至老師試算表！確定要現在送出嗎？")) {
    return;
  }

  // 打包 Payload 送出
  const payload = {
    sheetId: "4-2",
    mode: "individual",
    class: cls,
    studentClass: cls,
    seatOrGroup: seat,
    studentSeat: seat,
    nameOrMembers: name,
    studentName: name,
    score: score,
    scoreBreakdown: breakdownList,
    essay: document.getElementById("q7_literacy_essay").value.trim(),
    detailData: JSON.parse(localStorage.getItem(STORAGE_KEY_INDIV) || "{}"),
    timestamp: new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })
  };

  sendToGAS(payload, score);
}

/** 小組模式提交與防呆驗證 */
function handleSubmitGroup() {
  const cls = document.getElementById("groupClass").value;
  const groupNum = document.getElementById("groupNum").value;
  const members = getSelectedGroupMembers();

  if (!cls || !groupNum) {
    alert("⚠️ 請先選擇【班級與組別】！");
    document.getElementById("identityCard").scrollIntoView({ behavior: "smooth" });
    return;
  }

  if (members.length < 3) {
    alert("⚠️ 請至少設定 3 位出席組員的座號！");
    return;
  }

  // 關鍵防呆：驗證每位到齊組員皆至少認領並作答了 1 題
  const claimedAssignees = [];
  ["A", "B", "C", "D", "E", "F"].forEach(g => {
    const el = document.getElementById(`assignee${g}`);
    if (el && el.value && !claimedAssignees.includes(el.value)) claimedAssignees.push(el.value);
  });
  ["assigneeEnzymeCompare", "assigneeCompare", "assigneeMovie1", "assigneeMovie2", "assigneeMovie3", "assigneeMovie4", "assigneeMovie5", "assigneeMovie6"].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.value && !claimedAssignees.includes(el.value)) claimedAssignees.push(el.value);
  });

  const missingMembers = members.filter(m => !claimedAssignees.includes(m));
  if (missingMembers.length > 0) {
    alert(`⚠️ 小組責任分工防呆：\n座號【 ${missingMembers.join("、 ")} 】同學尚未認領任何題目！\n\n請讓每位組員都認領至少 1 個腺體任務、比較表或電影探討題，共同參與作答。`);
    return;
  }

  // 1.5 🔍 小組重複繳交防呆確認 (純前端本地檢查，0 延遲、0 伺服器負擔)
  const existingGroupSubmission = localStorage.getItem(STORAGE_KEY_SUBMIT_GROUP);
  if (existingGroupSubmission) {
    try {
      const prev = JSON.parse(existingGroupSubmission);
      const prevScore = (prev.score !== undefined) ? `${prev.score} 分` : "已計分";
      const confirmResubmit = confirm(
        `⚠️ 系統提示：\n\n本組先前已經繳交過囉！（成績：${prevScore}）\n\n全組確定要重新送出，並以「最新的統整結果與分數」覆蓋原本的紀錄嗎？`
      );
      if (!confirmResubmit) {
        return; // 小組取消送出，終止後續動作
      }
    } catch (e) {}
  }

  // 小組客觀題計分（任務一 30分 + 任務二 30分 + 任務三 40分 = 100分滿分）
  let score = 0;
  const breakdownList = [];

  // 【任務一：腺體座標地圖 (共 30 分，6 題各 5 分)】
  if (document.getElementById("glandNameA").value === "腦垂腺" && document.getElementById("hormoneA").value === "生長激素") {
    score += 5; breakdownList.push("腺體A腦垂腺正確 (+5)");
  }
  if (document.getElementById("glandNameB").value === "甲狀腺" && document.getElementById("hormoneB").value === "甲狀腺素") {
    score += 5; breakdownList.push("腺體B甲狀腺正確 (+5)");
  }
  if (document.getElementById("glandNameC").value === "副甲狀腺" && document.getElementById("hormoneC").value === "副甲狀腺素") {
    score += 5; breakdownList.push("腺體C副甲狀腺正確 (+5)");
  }
  if (document.getElementById("glandNameD").value === "腎上腺" && document.getElementById("hormoneD").value === "腎上腺素") {
    score += 5; breakdownList.push("腺體D腎上腺正確 (+5)");
  }
  if (document.getElementById("glandNameE").value === "胰島" && document.getElementById("hormoneE").value === "胰島素與升糖素") {
    score += 5; breakdownList.push("腺體E胰島正確 (+5)");
  }
  if (document.getElementById("glandNameF").value === "性腺" && document.getElementById("hormoneF").value === "雄性/雌性激素") {
    score += 5; breakdownList.push("腺體F性腺正確 (+5)");
  }

  // 【任務二：雙重生理機制比較模型 (共 30 分)】
  // 1. 酵素 vs 激素 (15分)
  if (document.getElementById("comp_enz_same") && document.getElementById("comp_enz_same").value === "生物體製造") score += 3;
  if (document.getElementById("comp_enz_duct") && document.getElementById("comp_enz_duct").value === "有導管" && document.getElementById("comp_hor_duct").value === "無導管") score += 4;
  if (document.getElementById("comp_enz_transport") && document.getElementById("comp_enz_transport").value === "導管排至體腔或體外" && document.getElementById("comp_hor_transport").value === "血液循環") score += 4;
  if (document.getElementById("comp_enz_func") && document.getElementById("comp_enz_func").value === "生物催化劑" && document.getElementById("comp_hor_func").value === "化學調節") score += 4;
  breakdownList.push("任務二酵素激素比較模型完成");

  // 2. 內分泌 vs 神經系統 (15分)
  if (document.getElementById("comp_trans_endo").value === "血液" && document.getElementById("comp_trans_nerv").value === "神經元") score += 4;
  if (document.getElementById("comp_speed_endo").value === "較慢" && document.getElementById("comp_speed_nerv").value === "迅速") score += 4;
  if (document.getElementById("comp_scope_endo").value === "廣泛" && document.getElementById("comp_scope_nerv").value === "局部") score += 4;
  if (document.getElementById("comp_time_endo").value === "持久" && document.getElementById("comp_time_nerv").value === "短暫") score += 3;
  breakdownList.push("任務二神經內分泌比較模型完成");

  // 【任務三：電影深度實測與社會同理素養 (共 40 分)】
  // M1: 侏儒症與生長激素不足 (5分)
  if (document.getElementById("m1_disease") && document.getElementById("m1_disease").value === "侏儒症" && document.getElementById("m1_cause").value === "腦垂腺生長激素不足") {
    score += 5; breakdownList.push("M1侏儒症辨析正確 (+5)");
  }
  // M1 依據簡答評分
  const m1Reason = document.getElementById("m1_reason") ? document.getElementById("m1_reason").value.trim() : "";
  if (m1Reason.includes("智力") || m1Reason.includes("心智") || m1Reason.includes("腦") || m1Reason.includes("聰明") || m1Reason.includes("正常")) {
    score += 3; breakdownList.push("M1侏儒呆小依據精準 (+3)");
  }

  // M2: 甲狀腺低下與亢進區分 (5分)
  const m2Syms = Array.from(document.querySelectorAll('input[name="m2_sym"]:checked')).map(cb => cb.value);
  const m2Traps = ["眼球凸出吃不胖", "血鈣過低抽搐"];
  const hasM2Traps = m2Syms.some(s => m2Traps.includes(s));
  if (m2Syms.includes("嗜睡疲倦") && m2Syms.includes("體重難下降") && !hasM2Traps) {
    score += 3;
  }
  if (document.getElementById("m2_diff") && document.getElementById("m2_diff").value === "亢進消瘦低下肥胖") {
    score += 2; breakdownList.push("M2甲狀腺低下亢進區分正確 (+5)");
  }

  // M3: 誤割副甲狀腺與血鈣平衡 (5分)
  if (document.getElementById("m3_symptom") && document.getElementById("m3_symptom").value === "血鈣過低抽搐痙攣") score += 2;
  const m3Reason = document.getElementById("m3_calcium_reason") ? document.getElementById("m3_calcium_reason").value.trim() : "";
  if (m3Reason.includes("鈣") || m3Reason.includes("抽搐") || m3Reason.includes("平衡") || m3Reason.includes("副甲狀腺") || m3Reason.includes("補充")) {
    score += 3; breakdownList.push("M3血鈣失衡與補鈣依據精準 (+5)");
  }

  // M4: 腎上腺應急 (5分)
  if (document.getElementById("m4_hormone") && document.getElementById("m4_hormone").value === "腎上腺素" && document.getElementById("m4_location").value === "腎臟上方") {
    score += 3;
  }
  const m4Resps = Array.from(document.querySelectorAll('input[name="m4_resp"]:checked')).map(cb => cb.value);
  if (m4Resps.includes("心搏加快呼吸急促") && m4Resps.includes("腸胃蠕動減慢") && !m4Resps.includes("胃液大量分泌幫助消化")) {
    score += 2; breakdownList.push("M4腎上腺緊急反應全對 (+5)");
  }

  // M5: 循利寧與糖尿病末梢循環 (5分)
  if (document.getElementById("m5_disease") && document.getElementById("m5_disease").value === "糖尿病") score += 2;
  const m5Reason = document.getElementById("m5_reason") ? document.getElementById("m5_reason").value.trim() : "";
  if (m5Reason.includes("感覺") || m5Reason.includes("麻") || m5Reason.includes("燙") || m5Reason.includes("知覺") || m5Reason.includes("循環") || m5Reason.includes("神經")) {
    score += 3; breakdownList.push("M5糖尿病末梢病變判斷正確 (+5)");
  }

  // M6: 帶針筒上學與胰島素 (4分)
  if (document.getElementById("m6_reason_select") && document.getElementById("m6_reason_select").value === "第一型糖尿病需補充胰島素" && document.getElementById("m6_drug").value === "胰島素") {
    score += 4; breakdownList.push("M6胰島素治療正確 (+4)");
  }

  // M7: 情意素養宣言 (8分)
  const groupEmpathy = document.getElementById("group_empathy_essay") ? document.getElementById("group_empathy_essay").value.trim() : "";
  const empathyWords = ["陪伴", "尊重", "包容", "勇敢", "支持", "幫助", "同理", "不要嘲笑", "不排斥", "愛心", "關懷"];
  const hasGroupEmpathy = empathyWords.some(w => groupEmpathy.includes(w));
  if (groupEmpathy.length >= 20 && hasGroupEmpathy) {
    score += 8; breakdownList.push("M7小組情意素養宣言深刻真誠 (+8)");
  } else if (groupEmpathy.length >= 8) {
    score += 5; breakdownList.push("M7情意素養基本填寫 (+5)");
  }

  score = Math.min(100, score);

  if (!confirm("📋【小組學習單送出核對】\n\n請確認：\n" + cls + " 班 第 " + groupNum + " 組\n出席組員：" + members.join("、") + "\n初評得分：" + score + " 分\n\n確定正式提交小組學習單嗎？")) {
    return;
  }

  const payload = {
    sheetId: "4-2",
    mode: "group",
    class: cls,
    studentClass: cls,
    seatOrGroup: groupNum,
    studentSeat: groupNum,
    nameOrMembers: members.join(", "),
    studentName: members.join("、"),
    score: score,
    scoreBreakdown: breakdownList,
    essay: groupEmpathy || "小組統整模型完成",
    detailData: JSON.parse(localStorage.getItem(STORAGE_KEY_GROUP) || "{}"),
    timestamp: new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })
  };

  sendToGAS(payload, score);
}

// ==================== 7. 後端 GAS 傳送 ＋ 8 秒降級機制 ====================
function sendToGAS(payload, score) {
  // 顯示彈窗
  const modal = document.getElementById("resultModal");
  const scoreVal = document.getElementById("scoreVal");
  const scoreStatus = document.getElementById("scoreStatus");
  const detailsBox = document.getElementById("resultDetailsBox");

  scoreVal.textContent = score;
  modal.classList.remove("hidden");

  scoreStatus.textContent = "📡 正在向課堂伺服器同步成績，請稍候...";
  detailsBox.innerHTML = `
    <div><strong>作答模式：</strong>${payload.mode === "individual" ? "個人學習單" : "小組學習單"}</div>
    <div><strong>身分：</strong>${payload.class} 班 ${payload.seatOrGroup} ｜ ${payload.nameOrMembers}</div>
    <div style="margin-top:6px; color:#7c3aed;">正在建立加密通道送出作答數據...</div>
  `;

  // 8 秒逾時防塞車降級機制
  let isHandled = false;
  const timeoutId = setTimeout(() => {
    if (!isHandled) {
      isHandled = true;
      scoreStatus.textContent = "⚠️ 學校 Wi-Fi 塞車延遲，成績已為您快照備份！";
      detailsBox.innerHTML += `
        <div style="margin-top:8px; padding:8px; background:#fef3c7; border-radius:6px; color:#92400e;">
          <strong>備援通報：</strong>校園網路稍有雍塞，您的成績 (${score}分) 已安全快照留存於此平板中。<br>
          請直接向任課生物老師出示本畫面進行手動核對登記即可！
        </div>
      `;
    }
  }, 8000);

  // 若尚未設定真實 GAS URL 則提供優雅展示
  if (!GAS_URL || GAS_URL === "YOUR_GAS_EXEC_URL") {
    setTimeout(() => {
      clearTimeout(timeoutId);
      isHandled = true;
      scoreStatus.textContent = "✅ 本地批改完成（尚未配置 GAS_URL）";
      detailsBox.innerHTML += `
        <div style="margin-top:8px; color:#059669;">
          🎉 成績批改完成！若要上傳 Google 試算表，請在 <code>game.js</code> 第 7 行填入您的 GAS Web App 部署網址。
        </div>
      `;
    }, 1000);
    return;
  }

  fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  })
    .then(res => res.json())
    .then(data => {
      clearTimeout(timeoutId);
      if (isHandled) return;
      isHandled = true;

      // 紀錄送出快照以防重複點擊覆蓋（個人與小組雙模式）
      try {
        const key = payload.mode === "individual" ? STORAGE_KEY_SUBMIT_INDIV : STORAGE_KEY_SUBMIT_GROUP;
        localStorage.setItem(key, JSON.stringify({
          timestamp: payload.timestamp,
          score: score,
          target: `${payload.class}班 ${payload.seatOrGroup}`
        }));
      } catch (e) {}

      scoreStatus.textContent = "🎉 成績已成功登錄至任課教師雲端試算表！";
      detailsBox.innerHTML += `
        <div style="margin-top:8px; color:#059669;">
          <strong>雲端回執：</strong>${data.message || "成績上傳成功"} (更新時間: ${new Date().toLocaleTimeString()})
        </div>
      `;
    })
    .catch(err => {
      clearTimeout(timeoutId);
      if (isHandled) return;
      isHandled = true;
      console.warn("GAS 送出略過或離線", err);
      scoreStatus.textContent = "⚠️ 已快照存於本機離線緩存";
      detailsBox.innerHTML += `
        <div style="margin-top:8px; color:#b45309;">
          數據已完整妥善存於瀏覽器 LocalStorage，請向老師出示本畫面。
        </div>
      `;
    });
}

/** 提示小泡泡 */
function showToast(msg) {
  const toast = document.getElementById("cyberToast");
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
}

// ==================== 8. 跑班推車防呆核心函式 (超時/門禁/換人清空) ====================
function checkBioSessionTimeout() {
  const lastTimeRaw = localStorage.getItem('BIO_4_2_LAST_TIMESTAMP');
  if (!lastTimeRaw) return;
  const lastTime = parseInt(lastTimeRaw, 10);
  const diffMinutes = (Date.now() - lastTime) / (1000 * 60);
  if (diffMinutes > 40) {
    console.log('[Bio Session Guard] 距離上次填寫超過 40 分鐘，自動清空上一班暫存');
    localStorage.removeItem(STORAGE_KEY_INDIV);
    localStorage.removeItem(STORAGE_KEY_GROUP);
    localStorage.removeItem(STORAGE_KEY_SUBMIT_INDIV);
    localStorage.removeItem(STORAGE_KEY_SUBMIT_GROUP);
    localStorage.removeItem('BIO_4_2_LAST_TIMESTAMP');
  }
}

function checkBioStudentIdentityAndStatus() {
  const indivRaw = localStorage.getItem(STORAGE_KEY_INDIV);
  const submittedRaw = localStorage.getItem(STORAGE_KEY_SUBMIT_INDIV);
  
  if (submittedRaw) {
    try {
      const sub = JSON.parse(submittedRaw);
      showBioIdentityModal(sub.target || '先前同學', true);
      return;
    } catch(e) {}
  }

  if (indivRaw) {
    try {
      const d = JSON.parse(indivRaw);
      if (d.class && d.seat && d.name) {
        showBioIdentityModal(d.class + ' 班 ' + d.seat + ' 號 ' + d.name, false);
      }
    } catch(e) {}
  }
}

function showBioIdentityModal(studentDesc, isSubmitted) {
  let modal = document.getElementById('bioIdentityModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'bioIdentityModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.85);backdrop-filter:blur(6px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1.2rem;';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div style="background:#fff;border-radius:24px;max-width:500px;width:100%;padding:2rem;text-align:center;box-shadow:0 25px 50px -12px rgba(0,0,0,0.3);border-top:6px solid #0284c7;">
      <div style="font-size:3rem;margin-bottom:0.4rem;">👋</div>
      <h2 style="font-size:1.4rem;font-weight:900;color:#0f172a;margin-bottom:0.3rem;">請確認作答身分</h2>
      <p style="color:#64748b;font-size:0.95rem;margin-bottom:1.2rem;">本平板留存上一位同學的作答紀錄：</p>
      
      <div style="background:#f0f9ff;border:2px dashed #38bdf8;border-radius:14px;padding:1.1rem;margin-bottom:1.5rem;">
        <span style="font-size:1.3rem;font-weight:900;color:#0369a1;">${studentDesc}</span>
        <div style="font-size:0.85rem;color:#0284c7;margin-top:0.3rem;">
          ${isSubmitted ? '✅ 該生已成功完成交卷' : '📝 該生尚有填寫中之草稿'}
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:0.75rem;">
        <button type="button" onclick="document.getElementById('bioIdentityModal').remove()" style="padding:0.85rem;background:#0284c7;color:#fff;font-weight:800;border:none;border-radius:12px;font-size:1rem;cursor:pointer;">
          🙋‍♂️ 我就是該位同學（繼續作答/檢視）
        </button>
        <button type="button" onclick="startFreshBioQuiz(true)" style="padding:0.85rem;background:#fee2e2;color:#dc2626;font-weight:800;border:1.5px solid #fca5a5;border-radius:12px;font-size:0.95rem;cursor:pointer;">
          🔄 不是我，我是新同學（清空上一位，開始全新作答）
        </button>
      </div>
    </div>
  `;
}

function startFreshBioQuiz(skipConfirm) {
  if (skipConfirm || confirm("確定要開始全新作答嗎？\n\n（這將清空此平板畫面上留存的上一位座號與答案，前一位同學已送出的成績不受影響）")) {
    localStorage.removeItem(STORAGE_KEY_INDIV);
    localStorage.removeItem(STORAGE_KEY_GROUP);
    localStorage.removeItem(STORAGE_KEY_SUBMIT_INDIV);
    localStorage.removeItem(STORAGE_KEY_SUBMIT_GROUP);
    localStorage.removeItem('BIO_4_2_LAST_TIMESTAMP');
    location.reload();
  }
}
