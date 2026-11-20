"use strict";
// 지도 편집기 + 지도 관리. 지도 좌표 m (원점 왼쪽 아래, x 오른쪽, y 위쪽), 방향은 +x 기준 반시계 각도(°).
(() => {
  const $ = (id) => document.getElementById(id);
  const MC = window.MapCore, KINDS = MC.KINDS;
  const AREA = ["work", "material", "obstacle", "target"];
  const HINT = {
    select: "항목을 눌러 선택 · 끌어서 이동 · 꼭짓점(흰 점)을 끌어 모양 바꾸기 · 화살표 5 cm 이동 · R 회전 · Delete 삭제",
    rect: "끌어서 사각형을 그립니다", circle: "가운데를 누르고 끌어서 원을 그립니다",
    polygon: "점을 차례로 찍고 더블클릭(또는 Enter)으로 끝냅니다 · Backspace 마지막 점 지우기 · Esc 취소",
    wall: "점을 차례로 찍고 더블클릭(또는 Enter)으로 끝냅니다 · Esc 취소",
    bucket: "버켓 가운데를 누르면 놓입니다 · 입구가 화살표 방향 · 선택 후 R 로 15° 회전",
    hopper: "호퍼(병) 자리를 누릅니다 · 화살표가 로봇이 지나가는 방향 · 폭 = 양옆 상자 안쪽 간격 · R 로 회전",
    storage: "ㄷ 자 보관함 가운데를 누릅니다 · 터진 쪽(화살표)으로 로봇이 와서 붓습니다 · R 로 회전", robot_start: "로봇이 출발할 자리를 누릅니다 · 선택 후 R 로 방향 회전",
  };

  let maps = [], active = null, robotIds = ["mechdog-01", "mechdog-02", "mechdog-03", "mechdog-04"];
  let cur = null;             // {map_id, v, doc}
  let dirty = false, imgData = null, discardArmed = null;
  let tool = "select", shape = "rect", sel = null, drag = null, draft = null;
  let undo = [], redo = [];
  let F = null;               // MapCore.frame 결과 (좌표 변환)
  let lastDown = null;        // 다각형·벽 더블클릭 판정

  window.addEventListener("dash", (e) => {
    if (e.detail.type === "hello" && e.detail.config) robotIds = e.detail.config.robots.map((r) => r.robot_id);
    if (e.detail.type === "map") { active = e.detail.map ? { map_id: e.detail.map.map_id, v: e.detail.map.v } : null; if (isOpen()) renderLists(); }
  });
  const isOpen = () => document.body.dataset.mode === "editor";

  // ================================================================ 모드 전환
  document.querySelectorAll(".mode").forEach((b) => b.onclick = () => {
    document.querySelectorAll(".mode").forEach((x) => x.classList.toggle("on", x === b));
    const ed = b.dataset.mode === "editor";
    document.body.dataset.mode = b.dataset.mode;
    $("editor").classList.toggle("hidden", !ed);
    document.querySelector(".stages").classList.toggle("hidden", ed);
    document.querySelector("main.grid").classList.toggle("hidden", ed);
    if (ed) refresh(); else window.dispatchEvent(new Event("resize"));
  });

  // ================================================================ 서버
  const api = async (url, body) => {
    const r = await fetch(url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.status === 404) throw new Error("찾을 수 없음");
    return r.json();
  };
  async function refresh() {
    try {
      const r = await api("/api/maps");
      maps = r.maps; active = r.active;
      if (!maps.length) { const c = await api("/api/maps", { name: "현장 지도 1", width_m: 3, height_m: 2 }); maps = (await api("/api/maps")).maps; return open(c.map_id); }
      if (!cur || !maps.find((m) => m.map_id === cur.map_id)) return open(maps[0].map_id);
      renderLists(); draw();
    } catch (e) { status("지도 목록을 못 불러옴: " + e.message, "bad"); }
  }
  async function open(mapId, v) {
    const r = await api(`/api/maps/${mapId}` + (v ? `?v=${v}` : ""));
    cur = { map_id: r.map_id, v: r.v, doc: r.doc };
    dirty = false; imgData = null; sel = null; draft = null; undo = []; redo = []; discardArmed = null;
    maps = (await api("/api/maps")).maps;
    fillSettings(); renderLists(); draw();
    status(`${r.doc.name} v${r.v} 열림`);
  }
  async function save(note) {
    if (!cur) return null;
    status("저장 중…");
    const doc = { ...cur.doc, background: imgData ? null : cur.doc.background };
    const r = await api(`/api/maps/${cur.map_id}/versions`, { doc, image: imgData, note: note || autoNote() });
    if (!r.ok) { status("저장 실패: " + r.error, "bad"); return null; }
    cur = { map_id: r.map_id, v: r.v, doc: r.doc }; dirty = false; imgData = null;
    maps = (await api("/api/maps")).maps;
    renderLists(); draw(); status(`저장됨 — v${r.v}`, "ok");
    return r;
  }
  const autoNote = () => {
    const c = {}; cur.doc.items.forEach((i) => c[i.kind] = (c[i.kind] || 0) + 1);
    return Object.entries(c).map(([k, n]) => `${KINDS[k]} ${n}`).join(", ") || "빈 지도";
  };
  async function apply() {
    if (!cur) return;
    if (dirty && !(await save())) return;
    const chk = check();
    if (chk.errors.length) { status("오류가 있어 적용할 수 없습니다 — 오른쪽 검사 목록을 고치세요", "bad"); return; }
    const r = await api(`/api/maps/${cur.map_id}/apply`, { v: cur.v });
    if (!r.ok) { status("적용 거절: " + (r.check?.errors || []).join("; "), "bad"); return; }
    active = { map_id: cur.map_id, v: cur.v };
    maps = (await api("/api/maps")).maps; renderLists();
    status(r.published ? `v${cur.v} 을 현재 지도로 적용 — 팀(공정 엔진·경로)에 보냄` : `현재 지도로 적용했지만 팀 전송 실패 (MQTT 끊김) — 연결 후 다시 적용`, r.published ? "ok" : "bad");
  }
  /** 저장 안 한 변경이 있으면 한 번 경고하고, 같은 동작을 다시 누르면 진행 */
  function guard(key) {
    if (!dirty || discardArmed === key) { discardArmed = null; return true; }
    discardArmed = key; status("저장하지 않은 변경이 있습니다 — 버리려면 한 번 더 누르세요 (저장: Ctrl+S)", "bad");
    return false;
  }
  function status(t, cls) { const s = $("mapStatus"); s.textContent = t; s.className = "muted small status " + (cls || ""); }
  $("mapSave").onclick = () => save();
  $("mapApply").onclick = apply;
  $("mapNew").onclick = async () => {
    if (!guard("new")) return;
    const r = await api("/api/maps", { name: `현장 지도 ${maps.length + 1}`, width_m: 3, height_m: 2 });
    if (r.ok) open(r.map_id);
  };

  // ================================================================ 지도·버전 목록
  function renderLists() {
    const ml = $("mapList"); ml.innerHTML = "";
    maps.forEach((m) => {
      const li = document.createElement("li");
      li.className = cur && m.map_id === cur.map_id ? "on" : "";
      li.innerHTML = `<span class="mname"></span><span class="mmeta"></span>`;
      li.querySelector(".mname").textContent = m.name;
      li.querySelector(".mmeta").innerHTML = `v${m.latest}` + (m.active_v ? ` · <b class="live">현재 v${m.active_v}</b>` : "");
      li.onclick = () => { if (cur && m.map_id === cur.map_id) return; if (guard("map-" + m.map_id)) open(m.map_id); };
      ml.appendChild(li);
    });
    const m = cur && maps.find((x) => x.map_id === cur.map_id);
    $("verName").textContent = m ? m.name : "";
    const vl = $("verList"); vl.innerHTML = "";
    (m ? [...m.versions].reverse() : []).forEach((v) => {
      const li = document.createElement("li");
      li.className = (v.v === cur.v ? "on " : "") + (m.active_v === v.v ? "act" : "");
      const t = new Date(v.saved_at);
      li.innerHTML = `<b>v${v.v}</b><span class="vt">${t.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })} ${t.toTimeString().slice(0, 5)}</span>` +
        `<span class="vn"></span>${m.active_v === v.v ? '<span class="live">현재</span>' : ""}`;
      li.querySelector(".vn").textContent = v.note || "";
      li.onclick = () => { if (v.v === cur.v && !dirty) return; if (guard("v-" + v.v)) open(cur.map_id, v.v); };
      vl.appendChild(li);
    });
    $("mapSave").classList.toggle("dirty", dirty);
  }

  // ================================================================ 지도 설정 (이름·크기·배경)
  function fillSettings() {
    $("mName").value = cur.doc.name; $("mW").value = cur.doc.width_m; $("mH").value = cur.doc.height_m; bgNote();
  }
  $("mName").onchange = () => { mutate(() => { cur.doc.name = $("mName").value.trim() || cur.doc.name; }); };
  ["mW", "mH"].forEach((id) => $(id).onchange = () => {
    const w = parseFloat($("mW").value), h = parseFloat($("mH").value);
    if (!(w >= 0.2 && w <= 20 && h >= 0.2 && h <= 20)) { fillSettings(); return; }
    mutate(() => { cur.doc.width_m = w; cur.doc.height_m = h; }); bgNote();
  });
  $("bgFile").onchange = (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    if (f.type !== "image/png") { status("배경은 PNG 만 됩니다", "bad"); return; }
    const rd = new FileReader();
    rd.onload = () => { imgData = rd.result; dirty = true; renderLists(); bgNote(); draw(); status("배경을 올렸습니다 — 저장하면 남습니다"); };
    rd.readAsDataURL(f);
  };
  $("bgClear").onclick = () => { if (!cur.doc.background && !imgData) return; mutate(() => { cur.doc.background = null; }); imgData = null; bgNote(); };
  $("bgShow").onchange = () => draw();
  function bgURL() {
    if (!$("bgShow").checked) return null;
    return imgData || (cur.doc.background ? DEMO_BG(cur.map_id, cur.doc.background) : null);
  }
  function bgNote() {
    const u = imgData || (cur.doc.background ? DEMO_BG(cur.map_id, cur.doc.background) : null);
    if (!u) { $("bgNote").textContent = "배경 없음 (선택 사항 — 참고 그림을 깔 수 있습니다)"; return; }
    const im = new Image();
    im.onload = () => {
      const a = im.naturalWidth / im.naturalHeight, want = cur.doc.width_m / cur.doc.height_m;
      $("bgNote").textContent = `배경 비율 ${a.toFixed(2)}:1 · 지도 ${want.toFixed(2)}:1` + (Math.abs(a / want - 1) > 0.02 ? " — 비율이 달라 늘어나 보입니다" : " ✓");
    };
    im.src = u;
  }

  // ================================================================ 되돌리기
  const snapItems = () => JSON.stringify({ items: cur.doc.items, name: cur.doc.name, w: cur.doc.width_m, h: cur.doc.height_m, bg: cur.doc.background });
  function restore(s) { const o = JSON.parse(s); cur.doc.items = o.items; cur.doc.name = o.name; cur.doc.width_m = o.w; cur.doc.height_m = o.h; cur.doc.background = o.bg; }
  function mutate(fn) { undo.push(snapItems()); if (undo.length > 100) undo.shift(); redo = []; fn(); dirty = true; renderLists(); fillSettings(); draw(); }
  function doUndo() { if (!undo.length) return; redo.push(snapItems()); restore(undo.pop()); dirty = true; sel = null; renderLists(); fillSettings(); draw(); }
  function doRedo() { if (!redo.length) return; undo.push(snapItems()); restore(redo.pop()); dirty = true; sel = null; renderLists(); fillSettings(); draw(); }
  $("undo").onclick = doUndo; $("redo").onclick = doRedo;

  // ================================================================ 도구
  document.querySelectorAll(".tool").forEach((b) => b.onclick = () => setTool(b.dataset.tool));
  document.querySelectorAll(".shape").forEach((b) => b.onclick = () => {
    shape = b.dataset.shape; document.querySelectorAll(".shape").forEach((x) => x.classList.toggle("on", x === b));
    draft = null; hint(); draw();
  });
  function setTool(t) {
    tool = t; draft = null;
    document.querySelectorAll(".tool").forEach((x) => x.classList.toggle("on", x.dataset.tool === t));
    $("shapes").classList.toggle("disabled", !AREA.includes(t));
    $("edSvg").classList.toggle("drawing", t !== "select");
    hint(); draw();
  }
  function hint() { $("edHint").textContent = tool === "select" ? HINT.select : AREA.includes(tool) ? `${KINDS[tool]}: ${HINT[shape]}` : HINT[tool]; }
  const SN = () => $("snapOn").checked ? 0.05 : 0.001;
  const snap = (v) => Math.round(v / SN()) * SN();
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const clampP = (p) => ({ x: r3(Math.min(cur.doc.width_m, Math.max(0, snap(p.x)))), y: r3(Math.min(cur.doc.height_m, Math.max(0, snap(p.y)))) });
  function newId(kind) {
    let n = 1; const used = new Set(cur.doc.items.map((i) => i.id));
    while (used.has(`${kind}-${String(n).padStart(2, "0")}`)) n++;
    return `${kind}-${String(n).padStart(2, "0")}`;
  }
  const nameFor = (kind) => `${KINDS[kind]} ${cur.doc.items.filter((i) => i.kind === kind).length + 1}`;
  function add(item) { mutate(() => cur.doc.items.push(item)); sel = item.id; draw(); }

  // ================================================================ 그리기
  const svg = $("edSvg");
  function draw() {
    if (!cur) return;
    F = MC.draw(svg, cur.doc, { bgURL: bgURL(), selected: sel });
    const it = cur.doc.items.find((i) => i.id === sel);
    if (it && tool === "select") handles(it);
    if (draft) drawDraft();
    renderProps(); renderCheck();
  }
  function handles(i) {
    const hs = [];
    if (i.shape === "polygon" || i.shape === "polyline") i.points.forEach((p, k) => hs.push([p[0], p[1], "pt", k]));
    if (i.shape === "rect") hs.push([i.x + i.w, i.y + i.h, "corner"]);
    if (i.shape === "circle") hs.push([i.cx + i.r, i.cy, "radius"]);
    hs.forEach(([x, y, kind, k]) => MC.el("circle", { cx: F.X(x), cy: F.Y(y), r: F.fs * 0.45, class: "ed-handle", "data-h": kind, "data-k": k }, F.layer));
  }
  function drawDraft() {
    const d = draft, c = MC.COLOR[tool];
    const g = MC.el("g", { class: "ed-draft", style: `--c:${c}` }, F.layer);
    if (d.type === "rect") {
      const r = rectOf(d.a, d.b);
      MC.el("rect", { x: F.X(r.x), y: F.Y(r.y + r.h), width: MC.mm(r.w), height: MC.mm(r.h) }, g);
      size(`${r.w.toFixed(2)} × ${r.h.toFixed(2)} m`, r.x + r.w / 2, r.y + r.h);
    } else if (d.type === "circle") {
      const r = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);
      MC.el("circle", { cx: F.X(d.a.x), cy: F.Y(d.a.y), r: MC.mm(r) }, g);
      size(`r ${r.toFixed(2)} m`, d.a.x, d.a.y + r);
    } else {
      const ps = [...d.points, d.hover].filter(Boolean);
      MC.el(d.type === "polygon" && ps.length > 2 ? "polygon" : "polyline", { points: ps.map((p) => `${F.X(p.x)},${F.Y(p.y)}`).join(" ") }, g);
      d.points.forEach((p) => MC.el("circle", { cx: F.X(p.x), cy: F.Y(p.y), r: F.fs * 0.3, class: "ed-pt" }, g));
      if (d.hover && d.points.length) { const a = d.points[d.points.length - 1]; size(`${Math.hypot(d.hover.x - a.x, d.hover.y - a.y).toFixed(2)} m`, d.hover.x, d.hover.y); }
    }
    function size(t, x, y) { MC.el("text", { x: F.X(x), y: F.Y(y) - F.fs * 0.5, "font-size": F.fs * 0.9, class: "ed-size", "text-anchor": "middle" }, F.layer).textContent = t; }
  }
  const rectOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: r3(Math.abs(a.x - b.x)), h: r3(Math.abs(a.y - b.y)) });

  svg.addEventListener("pointerdown", (ev) => {
    if (!cur || ev.button !== 0) return;
    const raw = F.toMap(ev), p = clampP(raw);
    if (tool === "select") {
      const h = ev.target.closest(".ed-handle"), g = ev.target.closest(".mc-it");
      const it = cur.doc.items.find((i) => i.id === sel);
      if (h && it) { undo.push(snapItems()); redo = []; drag = { mode: "handle", it, h: h.dataset.h, k: +h.dataset.k }; }
      else if (g) {
        sel = g.dataset.id; const it2 = cur.doc.items.find((i) => i.id === sel);
        undo.push(snapItems()); redo = [];
        drag = { mode: "move", it: it2, start: p, orig: JSON.parse(JSON.stringify(it2)), moved: false };
      } else { sel = null; }
      svg.setPointerCapture(ev.pointerId); draw(); return;
    }
    if (AREA.includes(tool) && shape !== "polygon") { draft = { type: shape, a: p, b: p }; svg.setPointerCapture(ev.pointerId); draw(); return; }
    if ((AREA.includes(tool) && shape === "polygon") || tool === "wall") {
      // 더블클릭으로 끝내기 — 클릭마다 화면을 다시 그려 브라우저 dblclick 이 안 올 수 있어 직접 잰다
      const now = performance.now(), last0 = lastDown; lastDown = { t: now, x: ev.clientX, y: ev.clientY };
      if (draft && last0 && now - last0.t < 400 && Math.hypot(ev.clientX - last0.x, ev.clientY - last0.y) < 8) { finishDraft(); return; }
      if (!draft) draft = { type: tool === "wall" ? "polyline" : "polygon", points: [] };
      const last = draft.points[draft.points.length - 1];
      if (!last || last.x !== p.x || last.y !== p.y) draft.points.push(p);
      draw(); return;
    }
    if (tool === "bucket") add({ id: newId("bucket"), kind: "bucket", name: nameFor("bucket"), shape: "pose", x: p.x, y: p.y, heading_deg: 0, width_m: 0.3 });
    if (tool === "hopper") add({ id: newId("hopper"), kind: "hopper", name: nameFor("hopper"), shape: "pose", x: p.x, y: p.y, heading_deg: 0, width_m: 0.24 });
    if (tool === "storage") add({ id: newId("storage"), kind: "storage", name: nameFor("storage"), shape: "pose", x: p.x, y: p.y, heading_deg: 90, width_m: 0.4 });
    if (tool === "robot_start") {
      const used = new Set(cur.doc.items.filter((i) => i.kind === "robot_start").map((i) => i.robot_id));
      const rid = robotIds.find((r) => !used.has(r));
      if (!rid) { status("로봇 4대의 출발 위치를 이미 모두 놓았습니다 — 기존 것을 옮기세요", "bad"); return; }
      add({ id: newId("start"), kind: "robot_start", name: `${parseInt(rid.slice(-2), 10)}호기 출발`, shape: "pose", x: p.x, y: p.y, heading_deg: 90, robot_id: rid });
    }
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!cur || !F) return;
    const raw = F.toMap(ev), p = clampP(raw);
    $("edCursor").textContent = `x ${p.x.toFixed(2)} · y ${p.y.toFixed(2)} m`;
    if (draft && (draft.type === "rect" || draft.type === "circle")) { draft.b = p; draw(); return; }
    if (draft) { draft.hover = p; draw(); return; }
    if (!drag) return;
    const it = drag.it;
    if (drag.mode === "move") {
      const dx = r3(p.x - drag.start.x), dy = r3(p.y - drag.start.y), o = drag.orig;
      if (!dx && !dy) return;
      drag.moved = true;
      if (o.shape === "rect" || o.shape === "pose") { it.x = r3(o.x + dx); it.y = r3(o.y + dy); }
      else if (o.shape === "circle") { it.cx = r3(o.cx + dx); it.cy = r3(o.cy + dy); }
      else it.points = o.points.map(([x, y]) => [r3(x + dx), r3(y + dy)]);
    } else if (drag.h === "pt") it.points[drag.k] = [p.x, p.y];
    else if (drag.h === "corner") { it.w = Math.max(SN(), r3(p.x - it.x)); it.h = Math.max(SN(), r3(p.y - it.y)); }
    else if (drag.h === "radius") it.r = Math.max(SN(), r3(Math.hypot(p.x - it.cx, p.y - it.cy)));
    dirty = true; draw();
  });
  svg.addEventListener("pointerup", () => {
    if (drag) { if (drag.mode === "move" && !drag.moved) undo.pop(); drag = null; renderLists(); draw(); return; }
    if (draft && draft.type === "rect") {
      const r = rectOf(draft.a, draft.b); draft = null;
      if (r.w >= 0.02 && r.h >= 0.02) add({ id: newId(tool), kind: tool, name: nameFor(tool), shape: "rect", ...r });
      else draw();
    } else if (draft && draft.type === "circle") {
      const r = r3(Math.hypot(draft.b.x - draft.a.x, draft.b.y - draft.a.y)), c = draft.a; draft = null;
      if (r >= 0.02) add({ id: newId(tool), kind: tool, name: nameFor(tool), shape: "circle", cx: c.x, cy: c.y, r });
      else draw();
    }
  });
  function finishDraft() {
    if (!draft || !draft.points) return;
    const ps = draft.points.map((p) => [p.x, p.y]), type = draft.type; draft = null;
    if (type === "polygon" && ps.length >= 3) add({ id: newId(tool), kind: tool, name: nameFor(tool), shape: "polygon", points: ps });
    else if (type === "polyline" && ps.length >= 2) add({ id: newId("wall"), kind: "wall", name: nameFor("wall"), shape: "polyline", points: ps, thickness: 0.02 });
    else { status(type === "polygon" ? "다각형은 점이 3개 이상 필요합니다" : "벽은 점이 2개 이상 필요합니다", "bad"); draw(); }
  }

  // ================================================================ 키보드
  document.addEventListener("keydown", (ev) => {
    if (!isOpen() || ["INPUT", "SELECT", "TEXTAREA"].includes(ev.target.tagName)) return;
    const k = ev.key, it = cur && cur.doc.items.find((i) => i.id === sel);
    if ((ev.ctrlKey || ev.metaKey) && k.toLowerCase() === "s") { ev.preventDefault(); save(); return; }
    if ((ev.ctrlKey || ev.metaKey) && k.toLowerCase() === "z") { ev.preventDefault(); ev.shiftKey ? doRedo() : doUndo(); return; }
    if ((ev.ctrlKey || ev.metaKey) && k.toLowerCase() === "y") { ev.preventDefault(); doRedo(); return; }
    if (draft) {
      if (k === "Enter") finishDraft();
      else if (k === "Escape") { draft = null; draw(); }
      else if (k === "Backspace" && draft.points) { draft.points.pop(); draw(); ev.preventDefault(); }
      return;
    }
    if (k === "Escape") { sel = null; setTool("select"); return; }
    if (k.toLowerCase() === "s" && !ev.ctrlKey) { setTool("select"); return; }
    if (!it) return;
    if (k === "Delete" || k === "Backspace") { ev.preventDefault(); const id = sel; sel = null; mutate(() => cur.doc.items = cur.doc.items.filter((i) => i.id !== id)); return; }
    if (k.toLowerCase() === "r" && it.shape === "pose") { mutate(() => it.heading_deg = (it.heading_deg + (ev.shiftKey ? -15 : 15) + 360) % 360); return; }
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[k];
    if (d) {
      ev.preventDefault(); const s = 0.05 * (ev.shiftKey ? 4 : 1);
      mutate(() => {
        if (it.shape === "rect" || it.shape === "pose") { it.x = r3(it.x + d[0] * s); it.y = r3(it.y + d[1] * s); }
        else if (it.shape === "circle") { it.cx = r3(it.cx + d[0] * s); it.cy = r3(it.cy + d[1] * s); }
        else it.points = it.points.map(([x, y]) => [r3(x + d[0] * s), r3(y + d[1] * s)]);
      });
    }
  });

  // ================================================================ 선택 항목 속성
  const FIELDS = { rect: [["x", "x m"], ["y", "y m"], ["w", "가로 m"], ["h", "세로 m"]], circle: [["cx", "중심 x"], ["cy", "중심 y"], ["r", "반지름 m"]],
    pose: [["x", "x m"], ["y", "y m"], ["heading_deg", "방향 °"]] };
  function renderProps() {
    const box = $("propBox"), it = cur && cur.doc.items.find((i) => i.id === sel);
    if (!it) { box.innerHTML = `<div class="muted small">지도에서 항목을 누르세요 · 항목 ${cur ? cur.doc.items.length : 0}개</div>`; return; }
    if (box.dataset.id === it.id && box.contains(document.activeElement)) return;   // 입력 중에는 다시 그리지 않음
    box.dataset.id = it.id;
    box.innerHTML = `<div class="prop-kind"><i class="sw" style="--c:${MC.COLOR[it.kind]}"></i>${KINDS[it.kind]} <span class="muted">${it.id}</span></div>
      <label>이름 <input data-f="name" type="text" maxlength="40"></label><div class="two nums"></div><div class="extra"></div>
      <button class="danger small-btn" data-del>삭제 <small>Delete</small></button>`;
    box.querySelector("[data-f=name]").value = it.name;
    const nums = box.querySelector(".nums");
    (FIELDS[it.shape] || []).concat(it.kind === "bucket" || it.kind === "storage" ? [["width_m", "폭 m"]] : it.kind === "hopper" ? [["width_m", "상자 간격 m"]] : []).concat(it.shape === "polyline" ? [["thickness", "두께 m"]] : [])
      .forEach(([f, label]) => { const l = document.createElement("label"); l.innerHTML = `${label} <input data-f="${f}" type="number" step="0.05">`; l.querySelector("input").value = it[f]; nums.appendChild(l); });
    const ex = box.querySelector(".extra");
    if (it.shape === "polygon" || it.shape === "polyline") ex.innerHTML = `<div class="muted small">점 ${it.points.length}개 · 흰 점을 끌어 모양을 바꿉니다</div>`;
    if (it.kind === "robot_start") {
      ex.innerHTML = `<label>로봇 <select data-f="robot_id">${robotIds.map((r) => `<option value="${r}">${r}</option>`).join("")}</select></label>`;
      ex.querySelector("select").value = it.robot_id;
    }
    box.querySelectorAll("[data-f]").forEach((inp) => inp.onchange = () => {
      const f = inp.dataset.f; let v = inp.value;
      if (inp.type === "number") { v = parseFloat(v); if (!isFinite(v)) { renderProps(); return; } v = r3(v); }
      if (["w", "h", "r", "width_m", "thickness"].includes(f) && v <= 0) { renderProps(); return; }
      mutate(() => { it[f] = v; });
    });
    box.querySelector("[data-del]").onclick = () => { const id = it.id; sel = null; mutate(() => cur.doc.items = cur.doc.items.filter((i) => i.id !== id)); };
  }

  // ================================================================ 검사 (서버 maps.validate 와 같은 기준)
  function polyOf(i) {
    if (i.shape === "rect") return [[i.x, i.y], [i.x + i.w, i.y], [i.x + i.w, i.y + i.h], [i.x, i.y + i.h]];
    if (i.shape === "circle") return Array.from({ length: 24 }, (_, k) => [i.cx + i.r * Math.cos(2 * Math.PI * k / 24), i.cy + i.r * Math.sin(2 * Math.PI * k / 24)]);
    if (i.shape === "polygon") return i.points;
    return null;
  }
  function ptsOf(i) {
    if (i.shape === "pose") {
      return MC.poseCorners(i) || [[i.x, i.y]];
    }
    return i.shape === "polyline" ? i.points : polyOf(i);
  }
  const cen = (p) => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
  const orient = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const cross = (a, b, c, d) => orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
  function inside(pt, poly) {
    let r = false;
    for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) {
      const [x1, y1] = poly[k], [x2, y2] = poly[j];
      if ((y1 > pt[1]) !== (y2 > pt[1]) && pt[0] < (x2 - x1) * (pt[1] - y1) / (y2 - y1) + x1) r = !r;
    }
    return r;
  }
  function overlap(p, q) {
    for (let a = 0; a < p.length; a++) for (let b = 0; b < q.length; b++)
      if (cross(p[(a + p.length - 1) % p.length], p[a], q[(b + q.length - 1) % q.length], q[b])) return true;
    return inside(cen(p), q) || inside(cen(q), p);
  }
  function check() {
    const W = cur.doc.width_m, H = cur.doc.height_m, items = cur.doc.items, errors = [], warnings = [];
    const nm = (i) => `${i.name}`;
    items.forEach((i) => { if (ptsOf(i).some(([x, y]) => x < -1e-6 || y < -1e-6 || x > W + 1e-6 || y > H + 1e-6)) errors.push({ t: `${nm(i)} 이(가) 지도 밖으로 나감`, id: i.id }); });
    const zones = items.filter((i) => i.kind === "work" || i.kind === "target");
    for (let a = 0; a < zones.length; a++) for (let b = a + 1; b < zones.length; b++)
      if (overlap(polyOf(zones[a]), polyOf(zones[b]))) errors.push({ t: `${nm(zones[a])} 와 ${nm(zones[b])} 가 겹침`, id: zones[b].id });
    const obs = items.filter((i) => i.kind === "obstacle");
    items.filter((i) => i.kind === "robot_start" || i.kind === "material").forEach((i) => {
      const pt = i.shape === "pose" ? [i.x, i.y] : cen(polyOf(i));
      obs.forEach((o) => { if (inside(pt, polyOf(o))) errors.push({ t: `${nm(i)} 이(가) 장애물 ${nm(o)} 안에 있음`, id: i.id }); });
    });
    items.filter((i) => i.kind === "hopper" || i.kind === "storage").forEach((i) => {
      const fp = MC.poseCorners(i);
      obs.forEach((o) => { if (overlap(fp, polyOf(o))) errors.push({ t: `${nm(i)} 이(가) 장애물 ${nm(o)} 와 겹침`, id: i.id }); });
    });
    const starts = items.filter((i) => i.kind === "robot_start");
    if (new Set(starts.map((s) => s.robot_id)).size !== starts.length) errors.push({ t: "같은 로봇의 출발 위치가 두 개 이상" });
    if (!items.some((i) => i.kind === "target")) warnings.push({ t: "목표 시공 구역이 없음" });
    if (!items.some((i) => i.kind === "work")) warnings.push({ t: "작업구역이 없음" });
    if (!items.some((i) => i.kind === "bucket")) warnings.push({ t: "버켓 보관 위치가 없음 (P1 에서 씀)" });
    if (starts.length < 4) warnings.push({ t: `로봇 출발 위치 ${starts.length}/4 대` });
    return { errors, warnings };
  }
  function renderCheck() {
    const c = check(), ul = $("chkList"), b = $("chkBadge");
    b.textContent = c.errors.length ? `오류 ${c.errors.length}` : c.warnings.length ? `주의 ${c.warnings.length}` : "통과";
    b.className = "chk " + (c.errors.length ? "bad" : c.warnings.length ? "warn" : "ok");
    ul.innerHTML = "";
    if (!c.errors.length && !c.warnings.length) { ul.innerHTML = `<li class="ok">모든 검사 통과 — 현재 지도로 적용할 수 있습니다</li>`; }
    [...c.errors.map((e) => ["bad", e]), ...c.warnings.map((w) => ["warn", w])].forEach(([cls, e]) => {
      const li = document.createElement("li"); li.className = cls; li.textContent = e.t;
      if (e.id) { li.classList.add("link"); li.onclick = () => { sel = e.id; setTool("select"); }; }
      ul.appendChild(li);
    });
    $("mapApply").disabled = c.errors.length > 0;
  }

  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
  addEventListener("resize", () => { if (isOpen()) draw(); });
  hint();
})();
