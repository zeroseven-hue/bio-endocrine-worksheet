/**
 * 國中生物 4-1 神經系統 ✕ 交通安全 數位互動學習單
 * 主邏輯核心：雙模式、防呆驗證、中樞解剖互動、localStorage 暫存與 GAS 雙軌上傳
 */

// 後端 GAS Web App 接收 URL（已設定為老師專屬試算表 API）
const GAS_URL = "https://script.google.com/macros/s/AKfycby2-Pj2Nz1NFonB11rtsHXMMGU2qxLxvbjV0KCu4pi4oNXv2QLp0tK8m1XNYWvlCRJoEA/exec";

// 本地存儲鍵名
const STORAGE_KEY_INDIV = "BIO_4_1_INDIVIDUAL_DATA";
const STORAGE_KEY_GROUP = "BIO_4_1_GROUP_DATA";
const STORAGE_KEY_SUBMIT_INDIV = "BIO_4_1_SUBMITTED_INDIV";
const STORAGE_KEY_SUBMIT_GROUP = "BIO_4_1_SUBMITTED_GROUP";

// 當前狀態管理
let currentMode = "individual"; // "individual" | "group"
let currentStep = 1;
let currentCenter = "A";
let autoSaveTimer = null;

// ==================== 1. 初始化班級座號與事件掛載 ====================
document.addEventListener("DOMContentLoaded", () => {
  // 4.5 檢查 URL 是否帶有重置指令 (?reset=1 或 ?fresh=1)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('reset') === '1' || urlParams.get('fresh') === '1') {
    localStorage.removeItem(STORAGE_KEY_INDIV);
    localStorage.removeItem(STORAGE_KEY_GROUP);
    localStorage.removeItem(STORAGE_KEY_SUBMIT_INDIV);
    localStorage.removeItem(STORAGE_KEY_SUBMIT_GROUP);
    localStorage.removeItem('BIO_4_1_LAST_TIMESTAMP');
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  // 4.8 課堂超時 40 分鐘自動清空判定 (專為 10 分鐘推車換班設計)
  checkBioSessionTimeout();

  initDropdowns();
  bindModeSwitching();
  bindStepperEvents();
  bindHumanViewerEvents();
  bindInputListeners();
  initReactionChart();
  loadSavedData();
  updateStepperCheckmarks();
  updateCenterNodeStatus();
  initExitGuard();
  checkBioStudentIdentityAndStatus();

  // 若記憶為小組模式，自動恢復上次開啟的任務子分頁
  const savedGroupTab = localStorage.getItem("BIO_ACTIVE_GROUP_TAB_4_1");
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

  renderGroupMemberSlots(4);
}

/** 動態渲染組員座號下拉格數（純數字 01~35） */
function renderGroupMemberSlots(count) {
  const grid = document.getElementById("membersGrid");
  if (!grid) return;
  const oldSelections = Array.from(document.querySelectorAll(".member-seat-select")).map(s => s.value);
  grid.innerHTML = "";

  for (let i = 1; i <= count; i++) {
    const slot = document.createElement("div");
    slot.className = "member-slot";

    const tag = document.createElement("span");
    tag.className = "member-tag";
    tag.textContent = `組員 ${i}:`;

    const sel = document.createElement("select");
    sel.className = "cyber-select member-seat-select";
    sel.dataset.index = i;

    const defOpt = document.createElement("option");
    defOpt.value = "";
    defOpt.disabled = true;
    defOpt.selected = true;
    defOpt.textContent = "選座號";
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
  const assigneeSelects = document.querySelectorAll(".center-assignee");

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
  const groupMembersSlot = document.getElementById("groupMembersSlot");

  tabIndiv.addEventListener("click", () => {
    currentMode = "individual";
    localStorage.setItem("BIO_ACTIVE_MODE_4_1", "individual");
    tabIndiv.classList.add("active");
    tabGroup.classList.remove("active");
    indivIdRow.classList.remove("hidden");
    groupIdRow.classList.add("hidden");
    groupMembersSlot.classList.add("hidden");
    indivContainer.classList.remove("hidden");
    groupContainer.classList.add("hidden");
    identityTitle.textContent = "個人學習單 ｜ 基本資料設定";
    showToast("已切換至【個人學習單】模式");
  });

  tabGroup.addEventListener("click", () => {
    currentMode = "group";
    localStorage.setItem("BIO_ACTIVE_MODE_4_1", "group");
    tabGroup.classList.add("active");
    tabIndiv.classList.remove("active");
    groupIdRow.classList.remove("hidden");
    groupMembersSlot.classList.remove("hidden");
    indivIdRow.classList.add("hidden");
    groupContainer.classList.remove("hidden");
    indivContainer.classList.add("hidden");
    identityTitle.textContent = "小組學習單 ｜ 彈性分組與組員設定";
    showToast("已切換至【小組學習單】模式");
  });

  // 記憶 F5 重新載入前的模式狀態
  const savedMode = localStorage.getItem("BIO_ACTIVE_MODE_4_1");
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

      if (!val) {
        nameFeedback.textContent = "";
        nameFeedback.className = "input-feedback";
        return;
      }
      if (validChineseRegex.test(val)) {
        nameFeedback.textContent = "✓ 姓名格式正確";
        nameFeedback.className = "input-feedback valid";
      } else {
        nameFeedback.textContent = "⚠️ 請填寫 2~5 字中文真實姓名，嚴禁英數或暱稱";
        nameFeedback.className = "input-feedback error";
      }
    });
  }
}

// ==================== 3. 個人學習單 Stepper 關卡切換 ====================
function bindStepperEvents() {
  const stepBtns = document.querySelectorAll(".step-btn");
  const cards = document.querySelectorAll(".question-card");

  stepBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const step = parseInt(btn.dataset.step, 10);
      goToStep(step);
    });
  });

  // 下一步按鈕
  document.querySelectorAll(".next-step-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const next = parseInt(btn.dataset.next, 10);
      goToStep(next);
    });
  });

  // 上一步按鈕
  document.querySelectorAll(".prev-step-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const prev = parseInt(btn.dataset.prev, 10);
      goToStep(prev);
    });
  });

  // 句型提示抽屜開關
  const essayHintBtn = document.getElementById("essayHintBtn");
  const essayScaffold = document.getElementById("essayScaffold");
  if (essayHintBtn && essayScaffold) {
    essayHintBtn.addEventListener("click", () => {
      essayScaffold.classList.toggle("hidden");
    });
  }

  // 素養簡答字數即時計算
  const essayInput = document.getElementById("q5_pedestrian_essay");
  const essayCharCount = document.getElementById("essayCharCount");
  if (essayInput && essayCharCount) {
    essayInput.addEventListener("input", () => {
      const len = essayInput.value.trim().length;
      essayCharCount.textContent = `已輸入 ${len} 字`;
    });
  }

  // 個人提交按鈕
  const btnSubmitIndividual = document.getElementById("btnSubmitIndividual");
  if (btnSubmitIndividual) {
    btnSubmitIndividual.addEventListener("click", handleSubmitIndividual);
  }
}

function goToStep(step) {
  currentStep = step;
  document.querySelectorAll(".step-btn").forEach(btn => {
    btn.classList.toggle("active", parseInt(btn.dataset.step, 10) === step);
  });
  document.querySelectorAll(".question-card").forEach(card => {
    card.classList.toggle("hidden", card.id !== `stepCard${step}`);
  });

  // 平滑滾動到卡片頂部
  const targetCard = document.getElementById(`stepCard${step}`);
  if (targetCard) {
    targetCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  updateStepperCheckmarks();
}

/** 檢查各關卡是否已完成作答，即時打綠勾 */
function updateStepperCheckmarks() {
  const checks = {
    1: () => !!document.getElementById("q1_receptor").value && !!document.getElementById("q1_center").value && !!document.getElementById("q1_effector").value,
    2: () => !!document.getElementById("q2_brain_class").value && !!document.getElementById("q2_brain_func").value && !!document.getElementById("q2_nerve_class").value && !!document.getElementById("q2_nerve_func").value && document.querySelectorAll('input[name="q2_neu"]:checked').length > 0,
    3: () => !!document.getElementById("p_receptor").value && !!document.getElementById("p_sensory").value && !!document.getElementById("p_brain").value && !!document.getElementById("p_spine").value && !!document.getElementById("p_motor").value && !!document.getElementById("q3_not_answer").value,
    4: () => !!document.getElementById("q4_reaction_def").value && !!document.getElementById("q4_diff_variation").value && !!document.getElementById("q4_time_compare").value && document.querySelectorAll('input[name="q4_rs"]:checked').length > 0,
    5: () => !!document.getElementById("q5_bio_factor").value && !!document.getElementById("q5_phy_factor").value && !!document.getElementById("q5_distracted_result").value && document.getElementById("q5_pedestrian_essay").value.trim().length >= 5
  };

  for (let s = 1; s <= 5; s++) {
    const btn = document.querySelector(`.step-btn[data-step="${s}"]`);
    if (btn) {
      const isDone = checks[s] ? checks[s]() : false;
      btn.classList.toggle("completed", isDone);
    }
  }
}

// ==================== 4. 小組模式：神經中樞解剖圖與任務卡 ====================
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

      localStorage.setItem("BIO_ACTIVE_GROUP_TAB_4_1", targetTab);
      if (targetTab === "tabBrain") {
        document.getElementById("paneBrain").classList.remove("hidden");
      } else if (targetTab === "tabPathways") {
        document.getElementById("panePathways").classList.remove("hidden");
      } else if (targetTab === "tabTraffic") {
        document.getElementById("paneTraffic").classList.remove("hidden");
      }
    });
  });

  // 神經中樞解剖圖科技熱點點擊
  const hotspots = document.querySelectorAll(".img-hotspot");
  hotspots.forEach(spot => {
    spot.addEventListener("click", () => {
      const center = spot.dataset.center;
      switchCenterTask(center);
    });
  });

  const btnSubmitGroup = document.getElementById("btnSubmitGroup");
  if (btnSubmitGroup) {
    btnSubmitGroup.addEventListener("click", handleSubmitGroup);
  }
}

function switchCenterTask(center) {
  currentCenter = center;
  // 熱點高亮切換
  document.querySelectorAll(".img-hotspot").forEach(s => {
    s.classList.toggle("active-target", s.dataset.center === center);
  });

  // 卡片抽換切換
  ["A", "B", "C", "D"].forEach(c => {
    const card = document.getElementById(`cardCenter${c}`);
    if (card) {
      card.classList.toggle("hidden", c !== center);
    }
  });

  // 平板觸控貼心提示
  showToast(`已切換至【座標點 ${center} 中樞任務卡】`);
}

/** 檢查中樞 A~D 是否填寫完整，更新熱點綠色完成狀態 */
function updateCenterNodeStatus() {
  ["A", "B", "C", "D"].forEach(c => {
    const spot = document.getElementById(`hotspot${c}`);
    const assignee = document.getElementById(`assigneeCenter${c}`);
    const name = document.getElementById(`nameCenter${c}`);
    const func = document.getElementById(`funcCenter${c}`);
    const cs = document.getElementById(`caseCenter${c}`);

    const isComplete = assignee && assignee.value && name && name.value && func && func.value && cs && cs.value;
    if (spot) {
      spot.classList.toggle("completed", !!isComplete);
    }
  });
}

// ==================== 5. 輸入監聽與 localStorage 本地自動暫存 ====================
function bindInputListeners() {
  // 所有 input / select / textarea 變更皆觸發微緩衝暫存
  document.addEventListener("input", (e) => {
    if (e.target.matches("input, select, textarea")) {
      updateStepperCheckmarks();
      updateCenterNodeStatus();
      triggerAutoSave();
    }
  });

  document.addEventListener("change", (e) => {
    if (e.target.matches("input, select, textarea")) {
      updateStepperCheckmarks();
      updateCenterNodeStatus();
      triggerAutoSave();
    }
  });

  // Modal 關閉重置
  const btnModalClose = document.getElementById("btnModalClose");
  if (btnModalClose) {
    btnModalClose.addEventListener("click", () => {
      document.getElementById("resultModal").classList.add("hidden");
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
    q1_receptor: document.getElementById("q1_receptor").value,
    q1_center: document.getElementById("q1_center").value,
    q1_effector: document.getElementById("q1_effector").value,
    q2_brain_class: document.getElementById("q2_brain_class").value,
    q2_brain_func: document.getElementById("q2_brain_func").value,
    q2_nerve_class: document.getElementById("q2_nerve_class").value,
    q2_nerve_func: document.getElementById("q2_nerve_func").value,
    q2_neu: Array.from(document.querySelectorAll('input[name="q2_neu"]:checked')).map(cb => cb.value),
    p_receptor: document.getElementById("p_receptor").value,
    p_sensory: document.getElementById("p_sensory").value,
    p_brain: document.getElementById("p_brain").value,
    p_spine: document.getElementById("p_spine").value,
    p_motor: document.getElementById("p_motor").value,
    q3_not_answer: document.getElementById("q3_not_answer").value,
    q4_reaction_def: document.getElementById("q4_reaction_def").value,
    q4_diff_variation: document.getElementById("q4_diff_variation").value,
    q4_time_compare: document.getElementById("q4_time_compare").value,
    q4_rs: Array.from(document.querySelectorAll('input[name="q4_rs"]:checked')).map(cb => cb.value),
    q5_bio_factor: document.getElementById("q5_bio_factor").value,
    q5_phy_factor: document.getElementById("q5_phy_factor").value,
    q5_distracted_result: document.getElementById("q5_distracted_result").value,
    q5_pedestrian_essay: document.getElementById("q5_pedestrian_essay").value
  };
  localStorage.setItem(STORAGE_KEY_INDIV, JSON.stringify(indivPayload));
  localStorage.setItem('BIO_4_1_LAST_TIMESTAMP', String(Date.now()));

  // 2. 小組資料
  const groupPayload = {
    class: document.getElementById("groupClass").value,
    groupNum: document.getElementById("groupNum").value,
    groupSize: document.getElementById("groupSize").value,
    members: getSelectedGroupMembers(),
    centers: {
      A: {
        assignee: document.getElementById("assigneeCenterA").value,
        name: document.getElementById("nameCenterA").value,
        func: document.getElementById("funcCenterA").value,
        case: document.getElementById("caseCenterA").value
      },
      B: {
        assignee: document.getElementById("assigneeCenterB").value,
        name: document.getElementById("nameCenterB").value,
        func: document.getElementById("funcCenterB").value,
        case: document.getElementById("caseCenterB").value
      },
      C: {
        assignee: document.getElementById("assigneeCenterC").value,
        name: document.getElementById("nameCenterC").value,
        func: document.getElementById("funcCenterC").value,
        case: document.getElementById("caseCenterC").value
      },
      D: {
        assignee: document.getElementById("assigneeCenterD").value,
        name: document.getElementById("nameCenterD").value,
        func: document.getElementById("funcCenterD").value,
        case: document.getElementById("caseCenterD").value
      }
    },
    compare1: {
      assignee: document.getElementById("assigneeCompare1").value,
      con_center: document.getElementById("comp_con_center").value,
      ref_center: document.getElementById("comp_ref_center").value,
      con_path: document.getElementById("comp_con_path").value,
      ref_path: document.getElementById("comp_ref_path").value,
      con_time: document.getElementById("comp_con_time").value,
      ref_time: document.getElementById("comp_ref_time").value,
      con_sign: document.getElementById("comp_con_sign").value,
      ref_sign: document.getElementById("comp_ref_sign").value
    },
    compare2: {
      assignee: document.getElementById("assigneeCompare2").value,
      pull_center: document.getElementById("seq_pull_center").value,
      pull_order: document.getElementById("seq_pull_order").value,
      pain_center: document.getElementById("seq_pain_center").value,
      pain_order: document.getElementById("seq_pain_order").value
    },
    traffic: {
      t1_assignee: document.getElementById("assigneeTraffic1") ? document.getElementById("assigneeTraffic1").value : "",
      t1_dist_calc: document.getElementById("t1_dist_calc") ? document.getElementById("t1_dist_calc").value : "",
      t1_dist_reason: document.getElementById("t1_dist_reason") ? document.getElementById("t1_dist_reason").value : "",
      t2_assignee: document.getElementById("assigneeTraffic2") ? document.getElementById("assigneeTraffic2").value : "",
      t2_alcohol: Array.from(document.querySelectorAll('input[name="t2_alc"]:checked')).map(cb => cb.value),
      group_traffic_essay: document.getElementById("group_traffic_essay") ? document.getElementById("group_traffic_essay").value : ""
    }
  };
  localStorage.setItem(STORAGE_KEY_GROUP, JSON.stringify(groupPayload));
  localStorage.setItem('BIO_4_1_LAST_TIMESTAMP', String(Date.now()));
}

function loadSavedData() {
  // 載入個人
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
      [
        "q1_receptor", "q1_center", "q1_effector",
        "q2_brain_class", "q2_brain_func", "q2_nerve_class", "q2_nerve_func",
        "p_receptor", "p_sensory", "p_brain", "p_spine", "p_motor", "q3_not_answer",
        "q4_reaction_def", "q4_diff_variation", "q4_time_compare",
        "q5_bio_factor", "q5_phy_factor", "q5_distracted_result"
      ].forEach(id => {
        if (data[id] && document.getElementById(id)) {
          document.getElementById(id).value = data[id];
        }
      });
      if (data.q2_neu) {
        document.querySelectorAll('input[name="q2_neu"]').forEach(cb => {
          cb.checked = data.q2_neu.includes(cb.value);
        });
      }
      if (data.q4_rs) {
        document.querySelectorAll('input[name="q4_rs"]').forEach(cb => {
          cb.checked = data.q4_rs.includes(cb.value);
        });
      }
      if (data.q5_pedestrian_essay) {
        document.getElementById("q5_pedestrian_essay").value = data.q5_pedestrian_essay;
        document.getElementById("essayCharCount").textContent = `已輸入 ${data.q5_pedestrian_essay.length} 字`;
      }
    } catch (e) {
      console.warn("載入個人暫存失敗:", e);
    }
  }

  // 載入小組
  const groupRaw = localStorage.getItem(STORAGE_KEY_GROUP);
  if (groupRaw) {
    try {
      const gdata = JSON.parse(groupRaw);
      if (gdata.class) document.getElementById("groupClass").value = gdata.class;
      if (gdata.groupNum) document.getElementById("groupNum").value = gdata.groupNum;
      if (gdata.groupSize) {
        document.getElementById("groupSize").value = gdata.groupSize;
        renderGroupMemberSlots(parseInt(gdata.groupSize, 10));
      }
      if (gdata.members && Array.isArray(gdata.members)) {
        const selects = document.querySelectorAll(".member-seat-select");
        gdata.members.forEach((m, idx) => {
          if (selects[idx]) selects[idx].value = m;
        });
        syncAssigneeDropdowns();
      }
      if (gdata.centers) {
        ["A", "B", "C", "D"].forEach(c => {
          const item = gdata.centers[c];
          if (item) {
            if (item.assignee && document.getElementById(`assigneeCenter${c}`)) document.getElementById(`assigneeCenter${c}`).value = item.assignee;
            if (item.name && document.getElementById(`nameCenter${c}`)) document.getElementById(`nameCenter${c}`).value = item.name;
            if (item.func && document.getElementById(`funcCenter${c}`)) document.getElementById(`funcCenter${c}`).value = item.func;
            if (item.case && document.getElementById(`caseCenter${c}`)) document.getElementById(`caseCenter${c}`).value = item.case;
          }
        });
      }
      if (gdata.compare1) {
        const c1 = gdata.compare1;
        if (c1.assignee && document.getElementById("assigneeCompare1")) document.getElementById("assigneeCompare1").value = c1.assignee;
        if (c1.con_center) document.getElementById("comp_con_center").value = c1.con_center;
        if (c1.ref_center) document.getElementById("comp_ref_center").value = c1.ref_center;
        if (c1.con_path) document.getElementById("comp_con_path").value = c1.con_path;
        if (c1.ref_path) document.getElementById("comp_ref_path").value = c1.ref_path;
        if (c1.con_time) document.getElementById("comp_con_time").value = c1.con_time;
        if (c1.ref_time) document.getElementById("comp_ref_time").value = c1.ref_time;
        if (c1.con_sign) document.getElementById("comp_con_sign").value = c1.con_sign;
        if (c1.ref_sign) document.getElementById("comp_ref_sign").value = c1.ref_sign;
      }
      if (gdata.compare2) {
        const c2 = gdata.compare2;
        if (c2.assignee && document.getElementById("assigneeCompare2")) document.getElementById("assigneeCompare2").value = c2.assignee;
        if (c2.pull_center) document.getElementById("seq_pull_center").value = c2.pull_center;
        if (c2.pull_order) document.getElementById("seq_pull_order").value = c2.pull_order;
        if (c2.pain_center) document.getElementById("seq_pain_center").value = c2.pain_center;
        if (c2.pain_order) document.getElementById("seq_pain_order").value = c2.pain_order;
      }
      if (gdata.traffic) {
        const t = gdata.traffic;
        if (t.t1_assignee && document.getElementById("assigneeTraffic1")) document.getElementById("assigneeTraffic1").value = t.t1_assignee;
        if (t.t1_dist_calc && document.getElementById("t1_dist_calc")) document.getElementById("t1_dist_calc").value = t.t1_dist_calc;
        if (t.t1_dist_reason && document.getElementById("t1_dist_reason")) document.getElementById("t1_dist_reason").value = t.t1_dist_reason;
        if (t.t2_assignee && document.getElementById("assigneeTraffic2")) document.getElementById("assigneeTraffic2").value = t.t2_assignee;
        if (t.t2_alcohol && Array.isArray(t.t2_alcohol)) {
          document.querySelectorAll('input[name="t2_alc"]').forEach(cb => {
            cb.checked = t.t2_alcohol.includes(cb.value);
          });
        }
        if (t.group_traffic_essay && document.getElementById("group_traffic_essay")) {
          document.getElementById("group_traffic_essay").value = t.group_traffic_essay;
        }
      }
    } catch (e) {
      console.warn("載入小組暫存失敗:", e);
    }
  }
}

// ==================== 6. 客觀評分引擎與作答提交驗證 ====================
function handleSubmitIndividual() {
  const cls = document.getElementById("studentClass").value;
  const seat = document.getElementById("studentSeat").value;
  const name = document.getElementById("studentName").value.trim();

  if (!cls || !seat) {
    alert("⚠️ 請先在上方基本資料卡中選擇【班級】與【座號】！");
    document.getElementById("identityCard").scrollIntoView({ behavior: "smooth" });
    return;
  }

  const validChineseRegex = /^[\u4e00-\u9fa5]{2,5}$/;
  if (!validChineseRegex.test(name)) {
    alert("⚠️ 請輸入 2~5 字真實中文姓名！\n\n依課堂規定，非真實姓名（如暱稱、純英文數字等）本學習單將扣 10 分。");
    document.getElementById("studentName").focus();
    return;
  }

  // 檢查是否重複提交
  const existingSubmission = localStorage.getItem(STORAGE_KEY_SUBMIT_INDIV);
  if (existingSubmission) {
    const confirmOverwrite = confirm("⚠️ 系統偵測到您先前已提交過成績！\n\n再次送出將會更新雲端最高分紀錄，確定要重新繳交嗎？");
    if (!confirmOverwrite) return;
  }

  // 自動計分計算 (滿分 100 分)
  let score = 0;
  const breakdownList = [];

  // 【關卡 1：安全車距的秘密】(20分)
  if (document.getElementById("q1_receptor").value === "眼睛") {
    score += 6; breakdownList.push("Q1受器辨識正確 (+6)");
  }
  if (document.getElementById("q1_center").value === "大腦") {
    score += 7; breakdownList.push("Q1大腦中樞判斷正確 (+7)");
  }
  if (document.getElementById("q1_effector").value === "腳部肌肉") {
    score += 7; breakdownList.push("Q1動器踩煞車正確 (+7)");
  }

  // 【關卡 2：神經系統的組成】(20分)
  if (document.getElementById("q2_brain_class").value === "中樞神經系統" && document.getElementById("q2_brain_func").value === "指揮中心整合發布命令") {
    score += 6; breakdownList.push("Q2腦脊髓中樞正確 (+6)");
  }
  if (document.getElementById("q2_nerve_class").value === "周圍神經系統" && document.getElementById("q2_nerve_func").value === "傳遞訊息往返中樞與身體各部") {
    score += 6; breakdownList.push("Q2腦脊神經周圍正確 (+6)");
  }
  const q2Neu = Array.from(document.querySelectorAll('input[name="q2_neu"]:checked')).map(cb => cb.value);
  const q2Traps = ["骨質晶體", "無核紅血球"];
  const hasNeuTraps = q2Neu.some(item => q2Traps.includes(item));
  if (q2Neu.includes("神經細胞") && q2Neu.includes("細胞體與突起") && q2Neu.includes("傳遞電訊號") && !hasNeuTraps) {
    score += 8; breakdownList.push("Q2神經元特徵全對 (+8)");
  } else if (!hasNeuTraps && q2Neu.length >= 2) {
    score += 4; breakdownList.push("Q2神經元部分正確 (+4)");
  }

  // 【關卡 3：意識行為傳導路徑】(20分)
  if (
    document.getElementById("p_receptor").value === "耳內聽覺受器" &&
    document.getElementById("p_sensory").value === "感覺神經元" &&
    document.getElementById("p_brain").value === "大腦" &&
    document.getElementById("p_spine").value === "脊髓" &&
    document.getElementById("p_motor").value === "運動神經元"
  ) {
    score += 12; breakdownList.push("Q3接電話完整路徑全對 (+12)");
  } else {
    // 部分正確給分
    let hit = 0;
    if (document.getElementById("p_receptor").value === "耳內聽覺受器") hit++;
    if (document.getElementById("p_sensory").value === "感覺神經元") hit++;
    if (document.getElementById("p_brain").value === "大腦") hit++;
    if (document.getElementById("p_spine").value === "脊髓") hit++;
    if (document.getElementById("p_motor").value === "運動神經元") hit++;
    if (hit >= 3) { score += hit * 2; breakdownList.push(`Q3接電話路徑部分正確 (+${hit*2})`); }
  }
  if (document.getElementById("q3_not_answer").value === "訊號止於大腦無下傳手部與脊髓") {
    score += 8; breakdownList.push("Q3不接電話路徑分析精準 (+8)");
  }

  // 【關卡 4：反應時間的測定】(20分)
  if (document.getElementById("q4_reaction_def").value === "刺激經神經傳遞至動器表現反應時間") {
    score += 5; breakdownList.push("Q4反應時間定義正確 (+5)");
  }
  if (document.getElementById("q4_diff_variation").value === "接尺反應" && document.getElementById("q4_time_compare").value === "大於") {
    score += 7; breakdownList.push("Q4接尺波動大且時間大於反射 (+7)");
  }
  const q4Rs = Array.from(document.querySelectorAll('input[name="q4_rs"]:checked')).map(cb => cb.value);
  if (q4Rs.includes("接尺屬意識大腦具學習經驗記憶") && q4Rs.includes("瞳孔反射中樞為腦幹不具意志學習") && q4Rs.includes("反射路徑極短穩定爭取生機") && !q4Rs.includes("接尺神經傳導速度慢百倍")) {
    score += 8; breakdownList.push("Q4圖表學習推理全對 (+8)");
  } else if (!q4Rs.includes("接尺神經傳導速度慢百倍") && q4Rs.length >= 2) {
    score += 4; breakdownList.push("Q4圖表推理部分正確 (+4)");
  }

  // 【關卡 5：交通安全跨領域素養】(20分)
  if (document.getElementById("q5_bio_factor").value === "預留神經傳導與反應時間距離" && document.getElementById("q5_phy_factor").value === "高速動能與煞車滑行距離") {
    score += 8; breakdownList.push("Q5車距物理與生物雙因素全對 (+8)");
  }
  if (document.getElementById("q5_distracted_result").value === "反應距離大幅拉長延誤煞車釀嚴重追撞") {
    score += 6; breakdownList.push("Q5分心反應距離倍增判斷正確 (+6)");
  }
  const pedestrianEssay = document.getElementById("q5_pedestrian_essay").value.trim();
  const pedestrianKeywords = ["受器", "專注", "眼睛", "耳朵", "大腦", "判斷", "手機", "意識", "轉頭", "觀察", "安全", "反應時間"];
  const hasKeywords = pedestrianKeywords.some(kw => pedestrianEssay.includes(kw));
  if (pedestrianEssay.length >= 25 && hasKeywords) {
    score += 6; breakdownList.push("Q5行人防禦神經機制簡答深刻 (+6)");
  } else if (pedestrianEssay.length >= 10) {
    score += 4; breakdownList.push("Q5行人簡答基本填寫 (+4)");
  }

  score = Math.min(100, score);

  // 打包 Payload 送出
  const payload = {
    sheetId: "4-1",
    mode: "individual",
    class: cls,
    studentClass: cls,
    seatOrGroup: seat,
    studentSeat: seat,
    nameOrMembers: name,
    studentName: name,
    score: score,
    scoreBreakdown: breakdownList,
    essay: pedestrianEssay,
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
  ["A", "B", "C", "D"].forEach(c => {
    const el = document.getElementById(`assigneeCenter${c}`);
    if (el && el.value && !claimedAssignees.includes(el.value)) claimedAssignees.push(el.value);
  });
  ["assigneeCompare1", "assigneeCompare2", "assigneeTraffic1", "assigneeTraffic2"].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.value && !claimedAssignees.includes(el.value)) claimedAssignees.push(el.value);
  });

  const missingMembers = members.filter(m => !claimedAssignees.includes(m));
  if (missingMembers.length > 0) {
    alert(`⚠️ 小組責任分工防呆：\n座號【 ${missingMembers.join("、 ")} 】同學尚未認領任何題目！\n\n請讓每位組員都認領至少 1 個中樞任務、路徑比較表或交通探討題，共同參與作答。`);
    return;
  }

  const existingGroupSubmission = localStorage.getItem(STORAGE_KEY_SUBMIT_GROUP);
  if (existingGroupSubmission) {
    const confirmOverwrite = confirm("⚠️ 系統偵測到本組先前已繳交過報告！\n\n再次送出將會更新雲端最高分紀錄，確定要重新繳交嗎？");
    if (!confirmOverwrite) return;
  }

  // 小組計分 (滿分 100 分)
  let score = 0;
  const breakdownList = [];

  // 【任務一：中樞解剖座標認領 (共 32 分)】
  const correctCenters = {
    A: { name: "大腦", func: "意識與感覺思考運動", case: "中風半身不遂或失語" },
    B: { name: "小腦", func: "協調骨骼肌維持平衡", case: "酒醉走路搖晃步伐不穩" },
    C: { name: "腦幹", func: "心跳呼吸生命中樞", case: "昏迷呼吸停止腦死判定" },
    D: { name: "脊髓", func: "軀幹四肢反射中樞", case: "小兒麻痺或下半身癱瘓" }
  };

  ["A", "B", "C", "D"].forEach(c => {
    const n = document.getElementById(`nameCenter${c}`).value;
    const f = document.getElementById(`funcCenter${c}`).value;
    const cs = document.getElementById(`caseCenter${c}`).value;
    const cor = correctCenters[c];

    if (n === cor.name && f === cor.func && cs === cor.case) {
      score += 8;
      breakdownList.push(`任務一中樞${c}(${cor.name})全對 (+8)`);
    } else if (n === cor.name && (f === cor.func || cs === cor.case)) {
      score += 5;
      breakdownList.push(`任務一中樞${c}(${cor.name})部分正確 (+5)`);
    }
  });

  // 【任務二：意識行為 vs 反射雙軌模型 (共 32 分)】
  // 表一 (16分)
  let t1Hits = 0;
  if (document.getElementById("comp_con_center").value === "大腦") t1Hits++;
  if (document.getElementById("comp_ref_center").value === "脊髓或腦幹") t1Hits++;
  if (document.getElementById("comp_con_path").value === "較長需經大腦分析") t1Hits++;
  if (document.getElementById("comp_ref_path").value === "極短不經大腦思考") t1Hits++;
  if (document.getElementById("comp_con_time").value === "時間長易受分心干擾") t1Hits++;
  if (document.getElementById("comp_ref_time").value === "極迅速且固定不變") t1Hits++;
  if (document.getElementById("comp_con_sign").value === "彈性學習因應複雜環境") t1Hits++;
  if (document.getElementById("comp_ref_sign").value === "緊急防禦爭取生機") t1Hits++;

  score += t1Hits * 2;
  if (t1Hits >= 6) breakdownList.push(`任務二比較表一機制大對決精準 (+${t1Hits*2})`);

  // 表二 (16分)
  if (document.getElementById("seq_pull_center").value === "脊髓" && document.getElementById("seq_pull_order").value === "先發生") {
    score += 8; breakdownList.push("縮手反射先發生正確 (+8)");
  }
  if (document.getElementById("seq_pain_center").value === "大腦" && document.getElementById("seq_pain_order").value === "後發生") {
    score += 8; breakdownList.push("大腦感到劇痛後發生正確 (+8)");
  }

  // 【任務三：交通安全實況危機模擬與宣言 (共 36 分)】
  if (document.getElementById("t1_dist_calc").value === "約33公尺") {
    score += 8; breakdownList.push("情境一安全車距計算精準 (+8)");
  }
  const t1Reason = document.getElementById("t1_dist_reason") ? document.getElementById("t1_dist_reason").value.trim() : "";
  if (t1Reason.length >= 8) {
    score += 6; breakdownList.push("情境一車距意涵分析完整 (+6)");
  }

  const t2Alc = Array.from(document.querySelectorAll('input[name="t2_alc"]:checked')).map(cb => cb.value);
  const t2Traps = ["增強視力夜視功能", "骨骼鈣質快速結晶硬化"];
  const hasAlcTraps = t2Alc.some(item => t2Traps.includes(item));
  if (t2Alc.includes("麻痺大腦判斷遲鈍") && t2Alc.includes("麻痺小腦步伐不穩") && t2Alc.includes("神經傳導延緩反應時間拉長") && !hasAlcTraps) {
    score += 10; breakdownList.push("情境二酒駕神經毒性機制全對 (+10)");
  } else if (!hasAlcTraps && t2Alc.length >= 2) {
    score += 6; breakdownList.push("情境二酒駕分析部分正確 (+6)");
  }

  // 宣言 (12分)
  const groupTrafficEssay = document.getElementById("group_traffic_essay") ? document.getElementById("group_traffic_essay").value.trim() : "";
  const essayWords = ["安全", "車距", "專注", "手機", "觀察", "防禦", "行人", "轉頭", "遵守", "提醒", "減速"];
  const hasTrafficKeywords = essayWords.some(w => groupTrafficEssay.includes(w));
  if (groupTrafficEssay.length >= 25 && hasTrafficKeywords) {
    score += 12; breakdownList.push("情境三防禦性駕駛行動承諾深刻 (+12)");
  } else if (groupTrafficEssay.length >= 8) {
    score += 6; breakdownList.push("情境三行動承諾基本填寫 (+6)");
  }

  score = Math.min(100, score);

  const payload = {
    sheetId: "4-1",
    mode: "group",
    class: cls,
    studentClass: cls,
    seatOrGroup: groupNum,
    studentGroup: groupNum,
    nameOrMembers: members.join(", "),
    groupMembers: members.join(", "),
    score: score,
    scoreBreakdown: breakdownList,
    essay: groupTrafficEssay || "小組交通安全模型完成",
    detailData: JSON.parse(localStorage.getItem(STORAGE_KEY_GROUP) || "{}"),
    timestamp: new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })
  };

  sendToGAS(payload, score);
}

// ==================== 7. 後端 GAS 傳送 ＋ 8 秒降級機制 ====================
function sendToGAS(payload, score) {
  const modal = document.getElementById("resultModal");
  const scoreVal = document.getElementById("scoreVal");
  const scoreStatus = document.getElementById("scoreStatus");
  const detailsBox = document.getElementById("resultDetailsBox");

  scoreVal.textContent = score;
  modal.classList.remove("hidden");

  scoreStatus.textContent = "📡 正在向課堂伺服器同步成績，請稍候...";
  detailsBox.innerHTML = `
    <div><strong>單元：</strong>【單元 4-1】神經系統 ✕ 交通安全</div>
    <div><strong>作答模式：</strong>${payload.mode === "individual" ? "個人學習單" : "小組學習單"}</div>
    <div><strong>身分：</strong>${payload.class} 班 ${payload.seatOrGroup} ｜ ${payload.nameOrMembers}</div>
    <div style="margin-top:6px; color:#7c3aed;">正在建立加密通道送出作答數據...</div>
  `;

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

  if (!GAS_URL || GAS_URL === "YOUR_GAS_EXEC_URL") {
    clearTimeout(timeoutId);
    isHandled = true;
    setTimeout(() => {
      scoreStatus.textContent = "✅ 本地批改完成（尚未配置 GAS_URL）";
      detailsBox.innerHTML += `
        <div style="margin-top:6px; color:#16a34a;"><strong>客觀評分診斷清單：</strong><br>${payload.scoreBreakdown.join("<br>")}</div>
      `;
    }, 600);
    return;
  }

  fetch(GAS_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  })
    .then(() => {
      clearTimeout(timeoutId);
      if (!isHandled) {
        isHandled = true;
        scoreStatus.textContent = "🎉 成績與作答紀錄已成功同步上傳！";
        detailsBox.innerHTML += `
          <div style="margin-top:6px; color:#16a34a;"><strong>雲端診斷清單：</strong><br>${payload.scoreBreakdown.join("<br>")}</div>
        `;
        const key = payload.mode === "individual" ? STORAGE_KEY_SUBMIT_INDIV : STORAGE_KEY_SUBMIT_GROUP;
        localStorage.setItem(key, JSON.stringify({
          timestamp: payload.timestamp,
          score: score,
          target: `${payload.class}班 ${payload.seatOrGroup}`
        }));
        localStorage.setItem('BIO_4_1_LAST_TIMESTAMP', String(Date.now()));
      }
    })
    .catch(err => {
      clearTimeout(timeoutId);
      if (!isHandled) {
        isHandled = true;
        scoreStatus.textContent = "⚠️ 雲端傳送遇到微小干擾，但本地已安全存檔！";
        detailsBox.innerHTML += `
          <div style="margin-top:6px; color:#ea580c;">請保持此畫面，向任課老師回報成績 (${score}分)。</div>
        `;
      }
    });
}

// ==================== 8. 防呆與離頁守護機制 ====================
function initExitGuard() {
  window.addEventListener("beforeunload", (e) => {
    const indSubmit = localStorage.getItem(STORAGE_KEY_SUBMIT_INDIV);
    const grpSubmit = localStorage.getItem(STORAGE_KEY_SUBMIT_GROUP);
    if (!indSubmit && !grpSubmit) {
      e.preventDefault();
      e.returnValue = "您尚有未提交的學習單內容，確定要離開嗎？";
    }
  });
}

function showToast(msg) {
  const toast = document.getElementById("cyberToast");
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
}


// ==================== 9. 接尺 vs 瞳孔反應時間圖表動態渲染 ====================
function initReactionChart() {
  const inputs = [
    document.getElementById("rulerVal1"),
    document.getElementById("rulerVal2"),
    document.getElementById("rulerVal3"),
    document.getElementById("rulerVal4"),
    document.getElementById("rulerVal5")
  ];

  inputs.forEach((input) => {
    if (input) {
      input.addEventListener("input", renderReactionChart);
      input.addEventListener("change", renderReactionChart);
    }
  });

  renderReactionChart();
}

function renderReactionChart() {
  const r1 = parseFloat(document.getElementById("rulerVal1")?.value) || 0.32;
  const r2 = parseFloat(document.getElementById("rulerVal2")?.value) || 0.27;
  const r3 = parseFloat(document.getElementById("rulerVal3")?.value) || 0.23;
  const r4 = parseFloat(document.getElementById("rulerVal4")?.value) || 0.20;
  const r5 = parseFloat(document.getElementById("rulerVal5")?.value) || 0.18;

  const rulerData = [r1, r2, r3, r4, r5];
  // 瞳孔反射天生固定且短暫，5 次皆約為 0.08 秒
  const pupilData = [0.08, 0.08, 0.08, 0.08, 0.08];

  const xCoords = [100, 195, 290, 385, 480];
  // Y 軸 0.00s 處在 y=195, 0.40s 處在 y=35 (高度 160px，即每 0.1s 佔 40px)
  const getY = (val) => {
    const clamped = Math.max(0, Math.min(0.42, val));
    return 195 - (clamped / 0.40) * 160;
  };

  // 1. 構建接尺折線與漸層區域
  let lineD = "";
  let areaD = `M ${xCoords[0]} 195 `;
  rulerData.forEach((val, idx) => {
    const x = xCoords[idx];
    const y = getY(val);
    if (idx === 0) {
      lineD += `M ${x} ${y} `;
    } else {
      lineD += `L ${x} ${y} `;
    }
    areaD += `L ${x} ${y} `;
  });
  areaD += `L ${xCoords[xCoords.length - 1]} 195 Z`;

  const rulerLine = document.getElementById("chartRulerLine");
  const rulerArea = document.getElementById("chartRulerArea");
  if (rulerLine) rulerLine.setAttribute("d", lineD);
  if (rulerArea) rulerArea.setAttribute("d", areaD);

  // 2. 構建瞳孔反射水平線 (恆定 0.08s)
  let pupilD = "";
  pupilData.forEach((val, idx) => {
    const x = xCoords[idx];
    const y = getY(val);
    if (idx === 0) {
      pupilD += `M ${x} ${y} `;
    } else {
      pupilD += `L ${x} ${y} `;
    }
  });
  const pupilLine = document.getElementById("chartPupilLine");
  if (pupilLine) pupilLine.setAttribute("d", pupilD);

  // 3. 渲染圓點與數值標籤
  const rulerDotsG = document.getElementById("chartRulerDots");
  const pupilDotsG = document.getElementById("chartPupilDots");

  if (rulerDotsG) {
    let dotsHtml = "";
    rulerData.forEach((val, idx) => {
      const x = xCoords[idx];
      const y = getY(val);
      dotsHtml += `
        <circle cx="${x}" cy="${y}" r="5" fill="#7c3aed" stroke="#ffffff" stroke-width="2"/>
        <text x="${x}" y="${y - 9}" font-size="10" font-weight="700" fill="#6d28d9" text-anchor="middle">${val.toFixed(2)}s</text>
      `;
    });
    rulerDotsG.innerHTML = dotsHtml;
  }

  if (pupilDotsG) {
    let dotsHtml = "";
    pupilData.forEach((val, idx) => {
      const x = xCoords[idx];
      const y = getY(val);
      dotsHtml += `
        <circle cx="${x}" cy="${y}" r="4" fill="#ea580c" stroke="#ffffff" stroke-width="1.5"/>
        <text x="${x}" y="${y + 16}" font-size="9" font-weight="700" fill="#c2410c" text-anchor="middle">${val.toFixed(2)}s</text>
      `;
    });
    pupilDotsG.innerHTML = dotsHtml;
  }
}

// ==================== 10. 跑班推車防呆核心函式 (超時/門禁/換人清空) ====================
function checkBioSessionTimeout() {
  const lastTimeRaw = localStorage.getItem('BIO_4_1_LAST_TIMESTAMP');
  if (!lastTimeRaw) return;
  const lastTime = parseInt(lastTimeRaw, 10);
  const diffMinutes = (Date.now() - lastTime) / (1000 * 60);
  if (diffMinutes > 40) {
    console.log('[Bio Session Guard] 距離上次填寫超過 40 分鐘，自動清空上一班暫存');
    localStorage.removeItem(STORAGE_KEY_INDIV);
    localStorage.removeItem(STORAGE_KEY_GROUP);
    localStorage.removeItem(STORAGE_KEY_SUBMIT_INDIV);
    localStorage.removeItem(STORAGE_KEY_SUBMIT_GROUP);
    localStorage.removeItem('BIO_4_1_LAST_TIMESTAMP');
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
    <div style="background:#fff;border-radius:24px;max-width:500px;width:100%;padding:2rem;text-align:center;box-shadow:0 25px 50px -12px rgba(0,0,0,0.3);border-top:6px solid #7c3aed;">
      <div style="font-size:3rem;margin-bottom:0.4rem;">👋</div>
      <h2 style="font-size:1.4rem;font-weight:900;color:#0f172a;margin-bottom:0.3rem;">請確認作答身分</h2>
      <p style="color:#64748b;font-size:0.95rem;margin-bottom:1.2rem;">本平板留存上一位同學的作答紀錄：</p>
      
      <div style="background:#f5f3ff;border:2px dashed #c4b5fd;border-radius:14px;padding:1.1rem;margin-bottom:1.5rem;">
        <span style="font-size:1.3rem;font-weight:900;color:#6d28d9;">${studentDesc}</span>
        <div style="font-size:0.85rem;color:#7c3aed;margin-top:0.3rem;">
          ${isSubmitted ? '✅ 該生已成功完成交卷' : '📝 該生尚有填寫中之草稿'}
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:0.75rem;">
        <button type="button" onclick="document.getElementById('bioIdentityModal').remove()" style="padding:0.85rem;background:#7c3aed;color:#fff;font-weight:800;border:none;border-radius:12px;font-size:1rem;cursor:pointer;">
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
    localStorage.removeItem('BIO_4_1_LAST_TIMESTAMP');
    location.reload();
  }
}
