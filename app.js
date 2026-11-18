"use strict";
const $ = (id) => document.getElementById(id);
const LABEL = { start: "작업 시작", approve: "승인", pause: "일시정지", resume: "재개", stop: "정지",
  status: "로봇 상태", warmup: "준비운동" };
const NEED_CONFIRM = new Set(["start", "approve", "resume", "warmup"]);
const STAGES = ["P0", "P1", "P2", "P3", "P4", "P5", "P6"];

let ws = null, cfg = { robots: [], battery_v: { ok: 7.4, low: 7.0 }, stale_s: 10 };
const robots = {};
let pending = null;   // 확인 대기 중인 명령 {command, source, text}

// ---------------------------------------------------------------- 서버 연결
function connect() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => badge("wsBadge", "서버 연결", true);
  ws.onclose = () => { badge("wsBadge", "서버 끊김", false); setTimeout(connect, 1500); };
  ws.onmessage = (e) => onMsg(JSON.parse(e.data));
}
function send(obj) {
  if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; }
  addLog({ level: "alarm", text: "서버와 연결이 끊겨 명령을 못 보냈습니다", t: new Date().toISOString() });
  return false;
}
function badge(id, text, ok) {
  const b = $(id); b.textContent = text; b.className = "badge " + (ok === true ? "ok" : ok === false ? "bad" : "");
}

function onMsg(m) {
  window.dispatchEvent(new CustomEvent("dash", { detail: m }));   // 트윈·편집기도 같은 메시지를 받음
  if (m.type === "hello") {
    cfg = m.config;
    badge("mqttBadge", m.mqtt ? "MQTT 연결" : "MQTT 끊김", m.mqtt);
    badge("llmBadge", m.llm ? "LLM 켜짐" : "LLM 꺼짐 (규칙만)", m.llm ? true : null);
    buildRobots(); buildCams();
    Object.entries(m.robots).forEach(([id, d]) => updateRobot(id, d));
    showProcess(m.process);
    $("log").innerHTML = ""; m.log.forEach(addLog);
  } else if (m.type === "robot") updateRobot(m.robot_id, m.data);
  else if (m.type === "process") showProcess(m.data);
  else if (m.type === "mqtt") badge("mqttBadge", m.ok ? "MQTT 연결" : "MQTT 끊김", m.ok);
  else if (m.type === "log") addLog(m);
  else if (m.type === "interpretation") onInterpretation(m);
}

// ---------------------------------------------------------------- 로봇 카드
function buildRobots() {
  $("robots").innerHTML = "";
  cfg.robots.forEach((r) => {
    const el = document.createElement("div");
    el.className = "robot off"; el.id = "r-" + r.robot_id;
    el.innerHTML = `<div class="top"><span>${r.name || r.robot_id} <span class="muted small">${r.robot_id}</span></span>
      <span class="tags"></span></div><div class="volt">— V</div><div class="meta">연결 기다리는 중</div>`;
    $("robots").appendChild(el);
  });
}
function updateRobot(id, d) {
  robots[id] = d;
  const el = $("r-" + id); if (!el) return;
  const tel = d.telemetry || {}, st = d.status || {};
  const online = st.connection !== "offline" && d.age_s !== null && d.age_s < cfg.stale_s;
  const v = typeof tel.battery_mv === "number" ? tel.battery_mv / 1000 : null;
  let cls = "off", stateText;
  if (!online) stateText = d.age_s === null ? "연결 기다리는 중" : `연결 끊김 (${Math.round(d.age_s)} s 전 마지막 응답)`;
  else {
    cls = v === null ? "ok" : v >= cfg.battery_v.ok ? "ok" : v >= cfg.battery_v.low ? "low" : "bad";
    stateText = `${tel.state || "?"}${tel.action ? " · " + tel.action : ""} · ${d.age_s.toFixed(1)} s 전` +
      (typeof tel.sonar_cm === "number" ? ` · 초음파 ${tel.sonar_cm} cm` : "");
  }
  el.className = "robot " + cls;
  el.querySelector(".volt").textContent = v === null ? "— V" :
    `${v.toFixed(2)} V` + (cls === "bad" ? " 교체!" : cls === "low" ? " 주의" : "");
  el.querySelector(".meta").textContent = stateText;
  el.querySelector(".tags").innerHTML = tel.estop ? `<span class="tag estop">정지 ${tel.estop_reason || ""}</span>` : "";
}

// ---------------------------------------------------------------- 공정 단계
function showProcess(p) {
  const cur = p && p.state_id ? p.state_id.slice(0, 2) : null;
  const idx = STAGES.indexOf(cur);
  $("stages").innerHTML = STAGES.map((s, i) =>
    `<div class="stage ${i < idx ? "done" : i === idx ? "now" : ""}">${s}</div>`).join("");
  $("stageText").textContent = p ? `${p.state_id} · ${p.status || ""} ${p.reason ? "· " + p.reason : ""}` : "공정 상태 없음";
}

// ---------------------------------------------------------------- 카메라
// ---------------------------------------------------------------- 카메라 4분할 (로봇마다 MJPEG 를 브라우저가 직접 받음)
let camFocus = null;
function buildCams() {
  $("camGrid").innerHTML = "";
  cfg.robots.forEach((r) => {
    const t = document.createElement("div");
    t.className = "cam-tile"; t.id = "cam-" + r.robot_id;
    t.innerHTML = `<img alt=""><div class="cam-msg"></div><div class="cam-label"><span class="cam-dot"></span><b></b></div>
      <button class="cam-toggle secondary small-btn">켜기</button>`;
    t.querySelector("b").textContent = r.name || r.robot_id;
    t.querySelector(".cam-toggle").onclick = (e) => { e.stopPropagation(); camOn(r.robot_id, !t.classList.contains("live")); };
    t.onclick = () => { camFocus = camFocus === r.robot_id ? null : r.robot_id; layoutCams(); };
    $("camGrid").appendChild(t);
    camOn(r.robot_id, false);
  });
  layoutCams();
}
function layoutCams() {
  $("camGrid").classList.toggle("focus", !!camFocus);
  document.querySelectorAll(".cam-tile").forEach((t) => t.classList.toggle("big", t.id === "cam-" + camFocus));
}
function camOn(id, on) {
  const r = cfg.robots.find((x) => x.robot_id === id), t = $("cam-" + id);
  if (!r || !t) return;
  const img = t.querySelector("img"), msg = t.querySelector(".cam-msg"), btn = t.querySelector(".cam-toggle");
  const show = (text) => { msg.textContent = text; msg.classList.remove("hidden"); };
  t.classList.remove("live", "err");
  if (!on) { img.removeAttribute("src"); btn.textContent = "켜기"; return show(r.camera_url ? "꺼짐" : "카메라 주소 미설정"); }
  if (!r.camera_url) return show("카메라 주소 미설정 (robots.json)");
  msg.classList.add("hidden"); btn.textContent = "끄기"; t.classList.add("live");
  img.onerror = () => { t.classList.remove("live"); t.classList.add("err"); btn.textContent = "다시"; show("영상 없음 — 네트워크 확인"); };
  img.src = r.camera_url + (r.camera_url.includes("?") ? "&" : "?") + "t=" + Date.now();  // 다시 켤 때 새 연결
}
$("camAllOn").onclick = () => cfg.robots.forEach((r) => camOn(r.robot_id, true));
$("camAllOff").onclick = () => cfg.robots.forEach((r) => camOn(r.robot_id, false));

// ---------------------------------------------------------------- 명령
function request(command, source, text) {
  if (NEED_CONFIRM.has(command)) {
    pending = { command, source, text };
    $("confirmText").textContent = `"${LABEL[command]}" 을(를) 실행할까요?` + (text ? `  (들은 말: ${text})` : "");
    $("confirm").classList.remove("hidden");
  } else send({ type: "command", command, source, text });
}
function confirmYes() {
  if (!pending) return;
  send({ type: "command", ...pending }); pending = null; $("confirm").classList.add("hidden");
}
function confirmNo() { pending = null; $("confirm").classList.add("hidden"); }
$("yes").onclick = confirmYes; $("no").onclick = confirmNo;
document.querySelectorAll("[data-cmd]").forEach((b) => b.onclick = () => request(b.dataset.cmd, "button"));
$("btnStop").onclick = () => { confirmNo(); send({ type: "command", command: "stop", source: "button" }); };

// ---------------------------------------------------------------- 음성 (브라우저 STT)
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false, finalText = "";
if (!SR) { $("mic").disabled = true; $("heard").textContent = "이 브라우저는 음성 인식을 지원하지 않습니다 (Chrome 사용)"; }
else {
  rec = new SR(); rec.lang = "ko-KR"; rec.interimResults = true; rec.continuous = true;
  rec.onresult = (e) => {
    let interim = ""; finalText = "";
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
    }
    $("heard").textContent = (finalText + interim) || "…";
    // 정지는 손을 떼기 전이라도 바로 보낸다
    if (/정지|멈춰|멈추|스톱|스탑|그만/.test(finalText + interim) && !/일시/.test(finalText + interim)) {
      if (!rec._stopSent) { rec._stopSent = true; send({ type: "voice", text: finalText + interim }); }
    }
  };
  rec.onerror = (e) => { $("heard").textContent = "음성 인식 오류: " + e.error + (e.error === "not-allowed" ? " (마이크 권한 허용)" : ""); };
  rec.onend = () => {
    if (listening) { try { rec.start(); } catch (_) {} return; }  // 누르고 있는 동안 끊기면 다시 듣기
    $("mic").classList.remove("on");
    const t = finalText.trim() || $("heard").textContent.trim();
    if (!rec._stopSent && t && t !== "…" && t !== "—") send({ type: "voice", text: t });
  };
}
function micDown() {
  if (!rec || listening) return;
  listening = true; finalText = ""; rec._stopSent = false; confirmNo();
  $("heard").textContent = "듣는 중…"; $("mic").classList.add("on");
  try { rec.start(); } catch (_) {}
}
function micUp() { if (!rec || !listening) return; listening = false; rec.stop(); }
$("mic").addEventListener("pointerdown", micDown);
$("mic").addEventListener("pointerup", micUp);
$("mic").addEventListener("pointerleave", micUp);

function onInterpretation(m) {
  if (!m.command) { $("heard").textContent = `"${m.text}" → 명령 아님${m.note ? " (" + m.note + ")" : ""}`; return; }
  $("heard").textContent = `"${m.text}" → ${m.label} (${m.via === "llm" ? "LLM" : "규칙"})`;
  if (!m.immediate) request(m.command, "voice", m.text);   // 즉시 명령은 서버가 이미 실행
}

// ---------------------------------------------------------------- 키보드
document.addEventListener("keydown", (e) => {
  if (["SELECT", "INPUT", "TEXTAREA"].includes(e.target.tagName)) return;   // 글자 입력 중에는 단축키 끔
  if (document.body.dataset.mode === "editor" && e.code !== "Space") return;  // 도면 편집 중에는 정지(Space)만
  if (e.code === "Space") { e.preventDefault(); $("btnStop").click(); }
  else if (e.code === "KeyV" && !e.repeat) micDown();
  else if (e.code === "Enter" && pending) confirmYes();
  else if (e.code === "Escape") confirmNo();
});
document.addEventListener("keyup", (e) => { if (e.code === "KeyV") micUp(); });

// ---------------------------------------------------------------- 기록
function addLog(m) {
  const li = document.createElement("li");
  const d = new Date(m.t), t = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
  li.innerHTML = `<span class="t">${t}</span><span class="${m.level}"></span>`;
  li.lastChild.textContent = m.text;
  $("log").prepend(li);
  while ($("log").children.length > 200) $("log").lastChild.remove();
}

// 1280×880 기준 화면을 창에 꽉 맞춤 (스크롤 없음, 가운데 정렬)
function fit() {
  const W = 1280, H = 880, s = Math.min(innerWidth / W, innerHeight / H);
  const st = $("stage");
  st.style.transform = `translate(${(innerWidth - W * s) / 2}px, ${(innerHeight - H * s) / 2}px) scale(${s})`;
}
addEventListener("resize", fit); fit();

showProcess(null);
connect();
