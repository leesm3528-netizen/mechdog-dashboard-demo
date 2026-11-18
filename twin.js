"use strict";
// 디지털 트윈: "현재 지도" 위에 로봇 실시간 위치·방향·배터리·정지 상태를 겹쳐 그린다.
// 로봇 위치는 RobotPose(Part B). 위치가 아직 없으면 지도의 출발 위치에 점선으로 표시한다.
(() => {
  const $ = (id) => document.getElementById(id);
  const MC = window.MapCore;
  let cfg = { robots: [], stale_s: 10, battery_v: { ok: 7.4, low: 7.0 } };
  let map = null;
  const robots = {}, poses = {};
  let queued = false;

  window.addEventListener("dash", (e) => {
    const m = e.detail;
    if (m.type === "hello") {
      cfg = m.config; map = m.map;
      Object.assign(robots, m.robots || {}); Object.assign(poses, m.poses || {});
    } else if (m.type === "robot") robots[m.robot_id] = m.data;
    else if (m.type === "pose") poses[m.robot_id] = { ...m.data, _rx: Date.now() };
    else if (m.type === "map") map = m.map;
    else return;
    schedule();
  });
  function schedule() { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; render(); }); } }

  // ---------------------------------------------------------------- 트윈 / 카메라 전환
  document.querySelectorAll(".view-card .seg button").forEach((b) => b.onclick = () => {
    document.querySelectorAll(".view-card .seg button").forEach((x) => x.classList.toggle("on", x === b));
    const cam = b.dataset.view === "cam";
    $("twinView").classList.toggle("hidden", cam); $("camView").classList.toggle("hidden", !cam);
    $("camActions").classList.toggle("hidden", !cam); $("twinInfo").classList.toggle("hidden", cam);
    if (!cam) render();
  });

  const online = (d) => d && (d.status || {}).connection !== "offline" && d.age_s !== null && d.age_s < cfg.stale_s;
  const volt = (d) => { const mv = ((d || {}).telemetry || {}).battery_mv; return typeof mv === "number" ? mv / 1000 : null; };

  function render() {
    const svg = $("twinSvg");
    if (!map) {
      svg.innerHTML = "";
      $("twinMsg").innerHTML = "<div>적용된 현재 지도가 없습니다<small>위의 <b>지도 편집</b>에서 지도를 그리고 <b>현재 지도로 적용</b>을 누르세요</small></div>";
      $("twinMsg").classList.remove("hidden"); $("twinInfo").textContent = ""; return;
    }
    $("twinMsg").classList.add("hidden");
    const doc = map.doc;
    const bgURL = doc.background ? DEMO_BG(map.map_id, doc.background) : null;
    const f = MC.draw(svg, { ...doc, items: doc.items.filter((i) => i.kind !== "robot_start") }, { bgURL, bgOpacity: 0.3 });
    const starts = Object.fromEntries(doc.items.filter((i) => i.kind === "robot_start").map((i) => [i.robot_id, i]));
    let live = 0;
    cfg.robots.forEach((r, n) => {
      const p = poses[r.robot_id], d = robots[r.robot_id];
      const hasPose = p && typeof p.x_m === "number" && typeof p.y_m === "number";
      const s = starts[r.robot_id];
      if (!hasPose && !s) return;
      if (hasPose) live++;
      const x = hasPose ? p.x_m : s.x, y = hasPose ? p.y_m : s.y;
      const hd = hasPose ? (typeof p.heading_rad === "number" ? p.heading_rad * 180 / Math.PI : 0) : s.heading_deg;
      const v = volt(d), on = online(d), est = on && ((d || {}).telemetry || {}).estop;
      const lvl = !on || v === null ? "off" : v >= cfg.battery_v.ok ? "ok" : v >= cfg.battery_v.low ? "low" : "bad";
      const g = MC.el("g", { class: `tw-robot ${hasPose ? "live" : "ghost"} ${est ? "estop" : ""}`,
        transform: `translate(${f.X(x)} ${f.Y(y)})`, style: `--c:${MC.ROBOT_COLOR[n % 4]}` }, f.layer);
      MC.el("circle", { r: 130, class: "tw-halo" }, g);
      const t = MC.el("g", { transform: `rotate(${-hd})` }, g);
      MC.el("rect", { x: -95, y: -55, width: 190, height: 110, rx: 30, class: "tw-body" }, t);
      MC.el("path", { d: "M 150 0 L 95 -38 L 95 38 Z", class: "tw-head" }, t);
      if (est) MC.el("circle", { r: 165, class: "tw-estop" }, g);
      const label = MC.el("text", { y: -230, "font-size": f.fs * 1.5, class: "tw-name", "text-anchor": "middle" }, g);
      label.textContent = r.name || r.robot_id;
      const sub = MC.el("text", { y: -230 + f.fs * 1.5, "font-size": f.fs * 1.15, class: `tw-sub ${lvl}`, "text-anchor": "middle" }, g);
      sub.textContent = !hasPose ? "출발 위치 · 실시간 위치 없음" : `${v === null ? "— V" : v.toFixed(2) + " V"}${est ? " · 정지됨" : ""}${on ? "" : " · 연결 끊김"}`;
    });
    $("twinInfo").textContent = `${doc.name} · v${map.v} · ${doc.width_m}×${doc.height_m} m · 실시간 위치 ${live}/${cfg.robots.length}대`;
  }
  addEventListener("resize", schedule);
})();
