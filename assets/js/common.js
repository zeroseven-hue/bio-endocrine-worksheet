/* ==========================================================================
   國中生物 數位互動學習單平台 (Bio Learning Sheets Hub)
   全站共用設定與工具函式庫
   ========================================================================== */

const COURSE_CONFIG = {
  // 班級陣列：701 至 710
  classes: ['701', '702', '703', '704', '705', '706', '707', '708', '709', '710'],

  // 座號上限：國中現場標準 1 ~ 35 號
  maxSeatNumber: 35,

  // 小組選項：第 1 組 ~ 第 8 組
  groups: ['第 1 組', '第 2 組', '第 3 組', '第 4 組', '第 5 組', '第 6 組', '第 7 組', '第 8 組'],

  // 收錄生物章節學習單清單（未來新增單元只需在此擴充）
  units: [
    {
      id: "3-2",
      file: "3-2-circulation.html",
      title: "【單元 3-2】人體的循環 數位互動學習單",
      badge: "上學期 · 循環系統",
      desc: "工作細胞第08話、紅血球雙凹盤、血管矩陣、心臟雙循環口訣（靜房心動出室）、淋巴三部曲",
      status: "active"
    },
    {
      id: "4-2",
      file: "4-2-endocrine.html",
      title: "【單元 4-2】內分泌系統 數位互動學習單",
      badge: "上學期 · 協調作用",
      desc: "巨人的眼淚、呆小症與甲亢多選、糖尿病拮抗配對、小組人體腺體圖互動模型",
      status: "active"
    },
    {
      id: "4-1",
      file: "4-1-nervous.html",
      title: "【單元 4-1】神經系統 數位互動學習單",
      badge: "規劃中",
      desc: "大腦、小腦、腦幹與脊髓反射中樞，實測紅綠燈反應時間與瞳孔對光反射",
      status: "upcoming"
    },
    {
      id: "4-3",
      file: "4-3-homeostasis.html",
      title: "【單元 4-3】體溫與水分恆定 數位互動學習單",
      badge: "規劃中",
      desc: "內溫 vs 外溫動物體溫調節策略、皮膚微血管收縮舒張、呼吸水分散失",
      status: "upcoming"
    },
    {
      id: "5-1",
      file: "5-1-reproduction.html",
      title: "【單元 5-1】生物的生殖與遺傳 數位互動學習單",
      badge: "規劃中",
      desc: "無性生殖 vs 有性生殖、細胞分裂與減數分裂受精過程",
      status: "upcoming"
    }
  ],

  // Google Apps Script 部署 URL (老師專屬試算表 API)
  gasEndpoint: "https://script.google.com/macros/s/AKfycby2-Pj2Nz1NFonB11rtsHXMMGU2qxLxvbjV0KCu4pi4oNXv2QLp0tK8m1XNYWvlCRJoEA/exec"
};

/**
 * 取得當前網頁之真實完整 URL（自動適應 GitHub Pages 與本機測試）
 */
function getAbsoluteSheetUrl(sheetFile) {
  const loc = window.location;
  if (loc.protocol === 'file:') {
    const dir = loc.pathname.substring(0, loc.pathname.lastIndexOf('/') + 1);
    return loc.origin + dir + sheetFile;
  }
  const pathParts = loc.pathname.split('/');
  pathParts.pop();
  const basePath = pathParts.join('/') + '/';
  return loc.origin + basePath + sheetFile;
}

/**
 * 複製文字至剪貼簿並提供動態反饋
 */
function copyToClipboard(text, btnElement) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      showCopiedFeedback(btnElement);
    }).catch(() => {
      fallbackCopy(text, btnElement);
    });
  } else {
    fallbackCopy(text, btnElement);
  }
}

function fallbackCopy(text, btnElement) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
    showCopiedFeedback(btnElement);
  } catch (err) {
    alert("複製失敗，請手動複製：" + text);
  }
  document.body.removeChild(textArea);
}

function showCopiedFeedback(btnElement) {
  if (!btnElement) return;
  const originalText = btnElement.innerHTML;
  btnElement.innerHTML = "✅ 已複製！";
  btnElement.style.background = "#10b981";
  btnElement.style.borderColor = "#10b981";
  btnElement.style.color = "#ffffff";
  setTimeout(() => {
    btnElement.innerHTML = originalText;
    btnElement.style.background = "";
    btnElement.style.borderColor = "";
    btnElement.style.color = "";
  }, 2000);
}

/**
 * 彈出教師大螢幕派卷 QR Code Modal (支援白板投影與手機掃碼)
 */
function showQrModal(targetUrl, titleText) {
  let modal = document.getElementById('qrModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'qrModal';
    modal.className = 'wb-modal-overlay';
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeQrModal();
    });
  }

  modal.innerHTML = `
    <div class="wb-modal-card">
      <button type="button" class="wb-close-btn" onclick="closeQrModal()">&times;</button>
      <div class="wb-modal-header">
        <span class="wb-badge">📡 智慧教室 ‧ 電子白板全螢幕投影</span>
        <h2 class="wb-title">${titleText}</h2>
      </div>
      <div class="wb-instruction">
        <div class="wb-tip-main">請全班同學開啟平板/手機相機，對準 QR Code 即可直接進入作答：</div>
      </div>
      <div class="wb-qr-frame">
        <div id="modalQrCode"></div>
      </div>
      <div class="wb-url-box">${targetUrl}</div>
      <div class="wb-modal-footer" style="margin-top: 20px;">
        <button type="button" class="btn-dispatch" onclick="copyToClipboard('${targetUrl}', this)">📋 複製派發連結</button>
        <a href="${targetUrl}" target="_blank" class="btn-dispatch btn-dispatch-secondary" style="text-decoration:none; display:inline-flex; align-items:center;">🚀 在新分頁開啟</a>
        <button type="button" class="btn-wb-close" onclick="closeQrModal()">關閉投影</button>
      </div>
    </div>
  `;

  modal.classList.add('active');

  setTimeout(() => {
    const container = document.getElementById('modalQrCode');
    if (!container) return;
    container.innerHTML = '';

    if (typeof QRCode !== 'undefined') {
      new QRCode(container, {
        text: targetUrl,
        width: 260,
        height: 260,
        colorDark: "#6d28d9",
        colorLight: "#FFFFFF",
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      const img = document.createElement('img');
      img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=260x260&color=6d28d9&data=' + encodeURIComponent(targetUrl);
      img.alt = 'QR Code';
      container.appendChild(img);
    }
  }, 60);
}

function closeQrModal() {
  const modal = document.getElementById('qrModal');
  if (modal) modal.classList.remove('active');
}
