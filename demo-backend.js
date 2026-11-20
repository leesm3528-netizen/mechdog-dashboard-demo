"use strict";
// 공유용 데모: 실제 서버(dashboard.server) 대신 브라우저 안에서 가짜 로봇 4대·공정·지도 저장소를 돌린다.
// 화면 코드(app.js, twin.js, editor.js, map-core.js)는 실제 대시보드와 같다. WebSocket 과 /api 만 이 파일이 대신 답한다.
(() => {
  const now = () => new Date().toISOString();
  const CFG = {
    robots: [
      { robot_id: "mechdog-01", name: "1호기", camera_url: "" },
      { robot_id: "mechdog-02", name: "2호기", camera_url: "" },
      { robot_id: "mechdog-03", name: "3호기", camera_url: "" },
      { robot_id: "mechdog-04", name: "4호기", camera_url: "" },
    ],
    battery_v: { ok: 7.4, low: 7.0 }, stale_s: 10, warmup_enabled: false,
  };
  const IDS = CFG.robots.map((r) => r.robot_id);
  const LABELS = { start: "작업 시작", approve: "승인", pause: "일시정지", resume: "재개", stop: "정지", status: "로봇 상태", warmup: "준비운동" };
  const IMMEDIATE = new Set(["stop", "pause", "status"]);
  const RULES = [
    ["pause", ["일시정지", "일시중지", "잠깐대기", "잠시대기", "대기해"]],
    ["stop", ["비상정지", "정지", "멈", "스톱", "스탑", "stop", "그만"]],
    ["resume", ["재개", "다시시작", "다시해", "계속해", "계속진행", "이어서"]],
    ["start", ["작업시작", "현장시작", "시작해", "시작"]],
    ["approve", ["승인", "진행해", "좋아진행", "허가"]],
    ["status", ["상태", "배터리", "어때"]],
  ];
  // 로봇 지정 (실제 대시보드 voice.py 와 같은 규칙): "2호기", "이호기", "1번", "일번", "로봇 1번", STT 오인식 "1억이"
  const PER_ROBOT = new Set(["stop", "pause", "resume", "status"]);
  const NUM = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9, 하나: 1, 한: 1, 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4, 네: 4 };
  const TARGET = /(\d{1,2}|하나|한|둘|두|셋|세|넷|네|[일이삼사오육칠팔구])(?:호기|호이|억이|억기|역이|역기|어기)|(\d{1,2})번(?!째)|([일삼사오육칠팔구])번(?![에엔째주달])|(이)번(?=로봇)|로봇(\d{1,2})|mechdog-?(\d{1,2})/g;
  const NAME = (id) => (CFG.robots.find((r) => r.robot_id === id) || {}).name || id;
  function findRobots(t) {
    const out = [];
    for (const m of t.matchAll(TARGET)) {
      const tok = m.slice(1).find((g) => g), n = /^\d+$/.test(tok) ? +tok : NUM[tok];
      const id = IDS.find((r) => r.endsWith(String(n).padStart(2, "0")));
      if (id && !out.includes(id)) out.push(id);
    }
    return out;
  }
  const STAGES = ["P0-01", "P0-06", "P1-04", "P1-05b", "P2-03", "P2-04b", "P3-02", "P4-03", "P5-05a", "P6-02b"];

  // ------------------------------------------------------------ 예시 지도 (3 m × 2 m)
  const SAMPLE = {
    name: "시연장 예시 지도", width_m: 3, height_m: 2, background: null,
    items: [
      { id: "wall-1", kind: "wall", name: "벽", shape: "polyline", thickness: 0.02, points: [[0.05, 0.05], [2.95, 0.05], [2.95, 1.95], [0.05, 1.95], [0.05, 0.05]] },
      { id: "work-1", kind: "work", name: "작업구역 A", shape: "rect", x: 0.9, y: 0.45, w: 1.2, h: 1.1 },
      { id: "hopper-1", kind: "hopper", name: "호퍼 (쌀)", shape: "pose", x: 0.45, y: 1.65, heading_deg: 0, width_m: 0.24 },
      { id: "storage-1", kind: "storage", name: "보관함", shape: "pose", x: 1.8, y: 0.25, heading_deg: 90, width_m: 0.4 },
      { id: "obstacle-1", kind: "obstacle", name: "기둥", shape: "circle", cx: 2.45, cy: 1.45, r: 0.15 },
      { id: "target-1", kind: "target", name: "목표 시공 구역", shape: "polygon", points: [[2.3, 0.25], [2.8, 0.25], [2.8, 0.85], [2.3, 0.95]] },
      { id: "bucket-1", kind: "bucket", name: "버켓", shape: "pose", x: 0.45, y: 1.15, heading_deg: 0, width_m: 0.3 },
      { id: "rs-1", kind: "robot_start", name: "1호기 출발", shape: "pose", x: 0.3, y: 0.3, heading_deg: 0, robot_id: "mechdog-01" },
      { id: "rs-2", kind: "robot_start", name: "2호기 출발", shape: "pose", x: 0.3, y: 0.7, heading_deg: 0, robot_id: "mechdog-02" },
      { id: "rs-3", kind: "robot_start", name: "3호기 출발", shape: "pose", x: 0.3, y: 1.0, heading_deg: 0, robot_id: "mechdog-03" },
      { id: "rs-4", kind: "robot_start", name: "4호기 출발", shape: "pose", x: 1.3, y: 0.25, heading_deg: 90, robot_id: "mechdog-04" },
    ],
  };

  // ------------------------------------------------------------ 지도 저장소 (메모리)
  const store = { maps: {}, active: null, bg: {} };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let mapSeq = 0;
  function mapCreate(name, w, h, items) {
    const map_id = `map-demo-${++mapSeq}`;
    store.maps[map_id] = { meta: { map_id, name, created: now(), updated: now(), versions: [] }, docs: {} };
    mapSave(map_id, { name, width_m: w, height_m: h, background: null, items: items || [] }, null, "새로 만듦");
    return map_id;
  }
  function mapSave(map_id, doc, image, note) {
    const m = store.maps[map_id];
    let bg = doc.background;
    if (image) { bg = "bg-" + Math.random().toString(16).slice(2, 10) + ".png"; store.bg[map_id + "/" + bg] = image; }
    const clean = { name: String(doc.name || m.meta.name).slice(0, 40), width_m: +doc.width_m, height_m: +doc.height_m, background: bg || null, items: clone(doc.items || []) };
    const v = (m.meta.versions.length ? m.meta.versions[m.meta.versions.length - 1].v : 0) + 1;
    m.docs[v] = clean;
    m.meta.versions.push({ v, saved_at: now(), note: String(note || "").slice(0, 80), items: clean.items.length });
    m.meta.name = clean.name; m.meta.updated = now();
    return { map_id, v, doc: clone(clean) };
  }
  const mapGet = (map_id, v) => {
    const m = store.maps[map_id]; if (!m) return null;
    v = v || m.meta.versions[m.meta.versions.length - 1].v;
    return m.docs[v] ? { map_id, v, doc: clone(m.docs[v]), meta: clone(m.meta) } : null;
  };
  const mapList = () => Object.values(store.maps).map(({ meta }) => ({
    map_id: meta.map_id, name: meta.name, updated: meta.updated, latest: meta.versions[meta.versions.length - 1].v,
    versions: clone(meta.versions), active_v: store.active && store.active.map_id === meta.map_id ? store.active.v : null,
  })).sort((a, b) => (a.updated < b.updated ? 1 : -1));
  const activeMap = () => (store.active ? (({ map_id, v, doc }) => ({ map_id, v, doc }))(mapGet(store.active.map_id, store.active.v)) : null);
  window.DEMO_BG = (map_id, name) => store.bg[map_id + "/" + name] || null;

  const sid = mapCreate("시연장 예시 지도", 3, 2, []);
  mapSave(sid, SAMPLE, null, "벽·구역·버켓·호퍼·보관함·로봇 출발 4대");
  store.active = { map_id: sid, v: 2 };

  // ------------------------------------------------------------ 가짜 로봇
  const R = {}, poses = {};
  const loops = {   // 로봇마다 도는 길 (지도 m 좌표)
    "mechdog-01": { cx: 1.5, cy: 1.0, rx: 0.45, ry: 0.35, w: 0.25, ph: 0 },
    "mechdog-02": { cx: 1.5, cy: 1.0, rx: 0.45, ry: 0.35, w: 0.25, ph: Math.PI },
    "mechdog-03": { cx: 0.6, cy: 1.2, rx: 0.2, ry: 0.15, w: 0.35, ph: 1 },
    "mechdog-04": { cx: 2.55, cy: 0.6, rx: 0.15, ry: 0.22, w: 0.3, ph: 2 },
  };
  IDS.forEach((id, i) => {
    R[id] = { estop: 0, reason: null, fallen: false, bat: 8.05 - i * 0.28, boot: "fb" + (4096 + i * 777).toString(16), t: loops[id].ph, last: Date.now() };
  });
  let process = { schema_version: "process-state.v1", process_id: "demo", state_id: STAGES[0], status: "running", reason: "데모 공정" };
  let stageIdx = 0, paused = false;
  const history = [];

  const view = (id) => {
    const r = R[id], moving = !r.estop && !paused;
    return {
      telemetry: { robot_id: id, battery_mv: Math.round(r.bat * 1000), state: moving ? "walking" : "idle", action: moving ? "forward" : null,
        sonar_cm: 20 + Math.round(30 + 25 * Math.sin(r.t * 3)), estop: r.estop, estop_reason: r.reason, boot_id: r.boot, ready: 1,
        roll_deg: r.fallen ? 84 : +(Math.sin(r.t * 5) * 2).toFixed(1), pitch_deg: r.fallen ? 3 : +(Math.cos(r.t * 4) * 1.5).toFixed(1) },
      fallen: r.fallen, tilt_deg: r.fallen ? 84 : 2,
      status: { connection: "online", session_id: "demo-session", boot_id: r.boot },
      last_seen: r.last / 1000, last_result: null, age_s: Math.round((Date.now() - r.last) / 100) / 10,
    };
  };

  // ------------------------------------------------------------ WebSocket 대신
  const clients = new Set();
  const emit = (msg) => clients.forEach((c) => c._recv(msg));
  function note(level, text) {
    const item = { t: now(), level, text };
    history.push(item); if (history.length > 200) history.shift();
    emit({ type: "log", ...item });
  }
  function summary(only) {
    return (only || IDS).map((id) => `${id} 연결 ${R[id].bat.toFixed(2)} V${R[id].estop ? " 정지중" : ""}`).join(", ");
  }
  function ack(uid, ids) {   // 가짜 로봇의 command_result (지연 표시용, 40~120 ms)
    if (!uid) return;
    ids.forEach((id) => {
      const ms = 40 + Math.round(Math.random() * 80);
      setTimeout(() => emit({ type: "ack", uid, robot_id: id, status: "accepted", ms }), ms);
    });
  }
  function execute(cmd, source, text, robots, uid) {
    const who = source === "voice" ? "음성" : "버튼";
    robots = (robots || []).filter((id) => IDS.includes(id));
    const names = robots.map(NAME).join("·");
    if (robots.length && (cmd === "stop" || cmd === "pause")) {
      robots.forEach((id) => { R[id].estop = 1; R[id].reason = "estop"; });
      note("alarm", `[${who}] ${names} 일시정지 → EMERGENCY_STOP 전송 (${robots.length}/${robots.length}대 연결됨) (나머지 로봇은 계속)`);
      ack(uid, robots);
    } else if (robots.length && cmd === "resume") {
      robots.forEach((id) => { R[id].estop = 0; R[id].reason = null; });
      note("info", `[${who}] ${names} 재개 → 지시 전송, 정지 해제 ${robots.length}/${robots.length}대`);
      ack(uid, robots);
    } else if (robots.length && cmd === "status") {
      note("info", `[${who}] 로봇 상태: ` + summary(robots));
    } else if (cmd === "stop") {
      IDS.forEach((id) => { R[id].estop = 1; R[id].reason = "estop"; });
      paused = true; process = { ...process, status: "paused", reason: "정지 버튼" }; emit({ type: "process", data: process });
      note("alarm", `[${who}] 정지 → EMERGENCY_STOP 전송 (${IDS.length}/${IDS.length}대 연결됨)`);
      ack(uid, IDS);
    } else if (cmd === "resume") {
      IDS.forEach((id) => { R[id].estop = 0; R[id].reason = null; });
      paused = false; process = { ...process, status: "running", reason: "재개" }; emit({ type: "process", data: process });
      note("info", `[${who}] 재개 → 지시 전송, 정지 해제 ${IDS.length}/${IDS.length}대`);
      ack(uid, IDS);
    } else if (cmd === "pause") {
      paused = true; process = { ...process, status: "paused", reason: "일시정지" }; emit({ type: "process", data: process });
      note("info", `[${who}] 일시정지 → 전송`);
    } else if (cmd === "start") {
      stageIdx = 0; paused = false; process = { ...process, state_id: STAGES[0], status: "running", reason: "작업 시작" };
      emit({ type: "process", data: process }); note("info", `[${who}] 작업 시작 → 전송`);
    } else if (cmd === "approve") {
      note("info", `[${who}] 승인 → 전송`);
    } else if (cmd === "status") {
      note("info", `[${who}] 로봇 상태: ` + summary());
    } else if (cmd === "warmup") {
      note("warn", `[${who}] 준비운동: 아직 로봇 브리지가 내장 동작 명령을 받지 않습니다 (run_preset_action 추가 협의 중)`);
    }
    IDS.forEach((id) => emit({ type: "robot", robot_id: id, data: view(id) }));
  }
  function interpret(text) {
    const t = text.replace(/[\s.,!?~]/g, "").toLowerCase();
    let cmd = null;
    for (const [c, words] of RULES) if (words.some((w) => t.includes(w))) { cmd = c; break; }
    if (!cmd && t.endsWith("다시")) cmd = "resume";   // "1호기 다시"
    if (!cmd) return { cmd: null, via: "none", note: "데모는 규칙만 사용 (실제 대시보드는 Gemini LLM 으로 해석)", robots: [] };
    return { cmd, via: "rule", note: "", robots: PER_ROBOT.has(cmd) ? findRobots(t) : [] };
  }

  class DemoSocket {
    constructor() {
      this.readyState = 0; clients.add(this);
      setTimeout(() => {
        this.readyState = 1; this.onopen && this.onopen();
        this._recv({ type: "hello", config: clone(CFG), llm: false, mqtt: true,
          robots: Object.fromEntries(IDS.map((id) => [id, view(id)])), process, poses: clone(poses), map: activeMap(), log: history.slice(-50) });
      }, 150);
    }
    _recv(msg) { if (this.readyState === 1 && this.onmessage) this.onmessage({ data: JSON.stringify(msg) }); }
    send(raw) {
      const req = JSON.parse(raw);
      if (req.type === "command") execute(String(req.command), req.source || "button", req.text, req.robots, req.uid);
      else if (req.type === "voice") {
        const t0 = performance.now(), text = String(req.text || "").slice(0, 200), it = interpret(text);
        const label = it.cmd ? (it.robots.length ? it.robots.map(NAME).join("·") + " " : "") + LABELS[it.cmd] : "";
        note("voice", `음성 "${text}" → ${label || "명령 아님"} (${it.via}${it.note ? ", " + it.note : ""})`);
        this._recv({ type: "interpretation", uid: req.uid, ms: +(performance.now() - t0).toFixed(1), text, command: it.cmd, via: it.via,
          note: it.note, label, immediate: IMMEDIATE.has(it.cmd), robots: it.robots });
        if (it.cmd && IMMEDIATE.has(it.cmd)) execute(it.cmd, "voice", text, it.robots, req.uid);
      }
    }
    close() { this.readyState = 3; clients.delete(this); }
  }
  window.WebSocket = DemoSocket;

  // ------------------------------------------------------------ /api 대신
  const realFetch = window.fetch.bind(window);
  const json = (o, status = 200) => Promise.resolve(new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } }));
  window.fetch = (url, opt = {}) => {
    const u = new URL(url, "http://demo.local");
    if (!u.pathname.startsWith("/api/")) return realFetch(url, opt);
    const body = opt.body ? JSON.parse(opt.body) : null;
    const p = u.pathname.split("/").filter(Boolean);   // ["api","maps",id,action]
    if (p[1] === "maps" && p.length === 2) {
      if (!body) return json({ maps: mapList(), active: store.active });
      const id = mapCreate(String(body.name || "새 지도").slice(0, 40), +body.width_m || 3, +body.height_m || 2);
      note("info", `지도 만듦: ${body.name}`);
      return json({ ok: true, ...mapGet(id) });
    }
    if (p[1] === "maps" && p.length >= 3) {
      const id = decodeURIComponent(p[2]);
      if (!store.maps[id]) return json({ error: "not found" }, 404);
      if (p.length === 3) { const g = mapGet(id, +u.searchParams.get("v") || null); return g ? json({ ok: true, ...g }) : json({}, 404); }
      if (p[3] === "versions") {
        const r = mapSave(id, body.doc, body.image, body.note);
        note("info", `지도 저장: ${r.doc.name} v${r.v} (${r.doc.items.length}개 항목)`);
        return json({ ok: true, ...r });
      }
      if (p[3] === "rename") { store.maps[id].meta.name = String(body.name || "").slice(0, 40) || store.maps[id].meta.name; return json({ ok: true }); }
      if (p[3] === "apply") {
        const g = mapGet(id, +body.v); if (!g) return json({}, 404);
        store.active = { map_id: id, v: g.v };
        note("info", `현재 지도 적용: ${g.doc.name} v${g.v} — 팀 전송 완료 (데모)`);
        emit({ type: "map", map: activeMap() });
        return json({ ok: true, published: true, check: { ok: true, errors: [], warnings: [] } });
      }
    }
    if (p[1] === "active") return json({ map: activeMap() });
    return json({ error: "not found" }, 404);
  };

  // ------------------------------------------------------------ 시간 흐름
  setInterval(() => {   // 위치 5 Hz
    IDS.forEach((id) => {
      const r = R[id], L = loops[id];
      if (!r.estop && !paused) { r.t += L.w * 0.2; r.bat = Math.max(6.6, r.bat - 0.00035); }
      r.last = Date.now();
      const x = L.cx + L.rx * Math.cos(r.t), y = L.cy + L.ry * Math.sin(r.t);
      const hd = Math.atan2(L.ry * Math.cos(r.t), -L.rx * Math.sin(r.t));
      poses[id] = { schema_version: "robot-pose.v1", robot_id: id, x_m: +x.toFixed(3), y_m: +y.toFixed(3), heading_rad: +hd.toFixed(3), source: "demo" };
      emit({ type: "pose", robot_id: id, data: poses[id] });
    });
  }, 200);
  setInterval(() => IDS.forEach((id) => emit({ type: "robot", robot_id: id, data: view(id) })), 1000);
  setInterval(() => {   // 공정 단계 10 s 마다 진행
    if (paused) return;
    stageIdx = (stageIdx + 1) % STAGES.length;
    process = { ...process, state_id: STAGES[stageIdx], status: "running", reason: "데모 공정" };
    emit({ type: "process", data: process });
  }, 10000);

  note("info", "데모 시작 — 가짜 로봇 4대, 예시 지도 적용됨. 실제 로봇·카메라와는 연결되지 않습니다");

  // 음성: 데모 페이지에서는 마이크 대신 글자로 넣어 볼 수 있다
  window.addEventListener("DOMContentLoaded", () => {
    const f = document.getElementById("demoVoice");
    if (!f) return;
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const i = document.getElementById("demoVoiceText"), t = i.value.trim();
      if (!t) return;
      document.getElementById("heard").textContent = t;
      // 지연 측정: 실제 화면은 마이크(말 끝)부터 재지만, 데모는 '말하기'를 누른 순간부터 잰다 (STT 없음)
      const n = performance.now();
      lat = { uid: "d" + Date.now().toString(36), press: n, speechEnd: n, final: n };
      latSent(false);
      send({ type: "voice", text: t, uid: lat.uid });
      i.value = "";
    });
    const fb = document.getElementById("demoFall");
    if (fb) fb.onclick = () => {   // 3호기를 6초 동안 넘어진 상태로 (실제는 roll/pitch 45° 이상 약 1초)
      const id = "mechdog-03", r = R[id];
      if (r.fallen) return;
      r.fallen = true;
      note("alarm", `⚠ ${NAME(id)} 넘어짐 — 기울기 84°. 주변 확인 후 로봇을 세워 주세요`);
      emit({ type: "robot", robot_id: id, data: view(id) });
      setTimeout(() => {
        r.fallen = false;
        note("info", `${NAME(id)} 다시 섰음 (기울기 2°)`);
        emit({ type: "robot", robot_id: id, data: view(id) });
      }, 6000);
    };
  });
})();
