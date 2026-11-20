"use strict";
// 지도 그리기 공통 (도면 편집기·디지털 트윈). 지도 좌표 m (원점 왼쪽 아래, y 위쪽) → SVG mm (y 아래쪽).
window.MapCore = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const KINDS = { work: "작업구역", material: "자재", obstacle: "장애물", target: "목표 시공 구역",
    wall: "벽·경계선", bucket: "버켓", robot_start: "로봇 출발", hopper: "호퍼", storage: "보관함" };
  // 종류 색 (dataviz 기본 팔레트, 어두운 바탕에서 검증된 단계)
  const COLOR = { work: "#3987e5", material: "#c98500", obstacle: "#e66767", target: "#199e70",
    wall: "#c3c2b7", bucket: "#d95926", robot_start: "#9085e9", hopper: "#e8b923", storage: "#d55ca5" };
  const ROBOT_COLOR = ["#3987e5", "#d95926", "#199e70", "#c98500"];

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const mm = (v) => Math.round(v * 1000);

  /** svg 를 지도 크기에 맞춰 viewBox 설정, 배경·격자·눈금을 그리고 좌표 변환 함수들을 돌려준다. */
  function frame(svg, doc, opts = {}) {
    const W = mm(doc.width_m), H = mm(doc.height_m), pad = Math.max(W, H) * 0.045;
    svg.setAttribute("viewBox", `${-pad * 1.2} ${-pad * 0.5} ${W + pad * 1.7} ${H + pad * 1.8}`);
    svg.innerHTML = "";
    const fs = Math.max(W, H) / 62;
    const X = (x) => mm(x), Y = (y) => H - mm(y);
    el("rect", { x: 0, y: 0, width: W, height: H, class: "mc-field" }, svg);
    if (opts.bgURL) el("image", { href: opts.bgURL, x: 0, y: 0, width: W, height: H, preserveAspectRatio: "none", opacity: opts.bgOpacity ?? 0.55 }, svg);
    for (let x = 100; x < W; x += 100) el("line", { x1: x, x2: x, y1: 0, y2: H, class: x % 500 ? "mc-g1" : "mc-g5" }, svg);
    for (let y = 100; y < H; y += 100) el("line", { y1: H - y, y2: H - y, x1: 0, x2: W, class: y % 500 ? "mc-g1" : "mc-g5" }, svg);
    for (let x = 0; x <= W + 1; x += 500) el("text", { x, y: H + fs * 1.6, class: "mc-axis", "font-size": fs, "text-anchor": "middle" }, svg).textContent = `${x / 1000}`;
    for (let y = 0; y <= H + 1; y += 500) el("text", { x: -fs * 0.6, y: H - y + fs * 0.35, class: "mc-axis", "font-size": fs, "text-anchor": "end" }, svg).textContent = `${y / 1000}`;
    el("text", { x: W, y: H + fs * 2.9, class: "mc-axis", "font-size": fs * 0.9, "text-anchor": "end" }, svg).textContent = "m";
    const layer = el("g", {}, svg);
    return { W, H, fs, X, Y, layer,
      toMap(ev) {   // 화면 좌표 → 지도 m
        const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
        const p = pt.matrixTransform(svg.getScreenCTM().inverse());
        return { x: p.x / 1000, y: (H - p.y) / 1000 };
      } };
  }

  const pts = (list, f) => list.map(([x, y]) => `${f.X(x)},${f.Y(y)}`).join(" ");

  /** 항목 하나를 그린다. 돌려주는 <g> 에 data-id 가 붙는다. */
  function drawItem(f, i, opts = {}) {
    const c = COLOR[i.kind] || "#999";
    const g = el("g", { class: `mc-it mc-${i.kind}${opts.selected ? " mc-sel" : ""}`, "data-id": i.id, style: `--c:${c}` }, f.layer);
    let lx, ly;
    if (i.shape === "rect") {
      el("rect", { x: f.X(i.x), y: f.Y(i.y + i.h), width: mm(i.w), height: mm(i.h), rx: 6, class: "mc-area" }, g);
      lx = i.x + i.w / 2; ly = i.y + i.h / 2;
    } else if (i.shape === "circle") {
      el("circle", { cx: f.X(i.cx), cy: f.Y(i.cy), r: mm(i.r), class: "mc-area" }, g);
      lx = i.cx; ly = i.cy;
    } else if (i.shape === "polygon") {
      el("polygon", { points: pts(i.points, f), class: "mc-area" }, g);
      lx = i.points.reduce((s, p) => s + p[0], 0) / i.points.length; ly = i.points.reduce((s, p) => s + p[1], 0) / i.points.length;
    } else if (i.shape === "polyline") {
      el("polyline", { points: pts(i.points, f), class: "mc-hit" }, g);
      el("polyline", { points: pts(i.points, f), class: "mc-wall", "stroke-width": Math.max(12, mm(i.thickness || 0.02)) }, g);
      [lx, ly] = i.points[Math.floor(i.points.length / 2) - (i.points.length % 2 ? 0 : 1)];
      if (i.points.length % 2 === 0) { const a = i.points[i.points.length / 2 - 1], b = i.points[i.points.length / 2]; lx = (a[0] + b[0]) / 2; ly = (a[1] + b[1]) / 2; }
    } else if (i.kind === "bucket") {   // 위에서 본 버켓: 뒤·양옆이 막힌 U 자, 입구는 heading 방향
      const W = mm(i.width_m || 0.3), D = W * 0.6;
      const t = el("g", { transform: `translate(${f.X(i.x)} ${f.Y(i.y)}) rotate(${-i.heading_deg})` }, g);
      el("rect", { x: -D / 2, y: -W / 2, width: D, height: W, rx: 14, class: "mc-bucket-fill" }, t);
      el("path", { d: `M ${D / 2} ${-W / 2} L ${-D / 2} ${-W / 2} L ${-D / 2} ${W / 2} L ${D / 2} ${W / 2}`, class: "mc-bucket" }, t);
      lx = i.x; ly = i.y - (i.width_m || 0.3) / 2 - 0.07;
    } else if (i.kind === "storage") {   // 위에서 본 보관함: ㄷ 자 벽, 터진 쪽(입구)이 heading 방향 — 로봇이 이쪽에서 와서 붓는다
      const W = mm(i.width_m || 0.4), D = W * 0.75;
      const t = el("g", { transform: `translate(${f.X(i.x)} ${f.Y(i.y)}) rotate(${-i.heading_deg})` }, g);
      el("rect", { x: -D / 2, y: -W / 2, width: D, height: W, class: "mc-bucket-fill" }, t);
      el("path", { d: `M ${D / 2} ${-W / 2} L ${-D / 2} ${-W / 2} L ${-D / 2} ${W / 2} L ${D / 2} ${W / 2}`, class: "mc-ushape" }, t);
      el("path", { d: `M ${D / 2 + 110} 0 L ${D / 2 + 30} 0 M ${D / 2 + 60} -35 L ${D / 2 + 30} 0 L ${D / 2 + 60} 35`, class: "mc-dir" }, t);
      lx = i.x; ly = i.y;
    } else if (i.kind === "hopper") {    // 위에서 본 호퍼: 양옆 받침 상자 + 가운데 병, 화살표는 로봇이 지나가는 방향
      const G = mm(i.width_m || 0.24), BL = 200, BW = 100;
      const t = el("g", { transform: `translate(${f.X(i.x)} ${f.Y(i.y)}) rotate(${-i.heading_deg})` }, g);
      el("rect", { x: -BL / 2, y: -G / 2, width: BL, height: G, class: "mc-hopper-gap" }, t);
      [-1, 1].forEach((s) => el("rect", { x: -BL / 2, y: s < 0 ? -G / 2 - BW : G / 2, width: BL, height: BW, rx: 8, class: "mc-area" }, t));
      el("line", { x1: 0, y1: -G / 2 - BW, x2: 0, y2: G / 2 + BW, class: "mc-hopper-bar" }, t);
      el("circle", { r: 45, class: "mc-hopper-bottle" }, t);
      el("path", { d: `M ${-BL / 2 - 40} 0 L ${BL / 2 + 60} 0 M ${BL / 2 + 25} -35 L ${BL / 2 + 60} 0 L ${BL / 2 + 25} 35`, class: "mc-dir" }, t);
      lx = i.x; ly = i.y - (i.width_m || 0.24) / 2 - 0.17;
    } else if (i.kind === "robot_start") {
      const n = Math.max(0, parseInt(String(i.robot_id).slice(-2), 10) - 1 || 0);
      g.style.setProperty("--c", ROBOT_COLOR[n % 4]);
      const t = el("g", { transform: `translate(${f.X(i.x)} ${f.Y(i.y)}) rotate(${-i.heading_deg})` }, g);
      el("circle", { r: 90, class: "mc-start-ring" }, t);
      el("path", { d: "M 80 0 L -45 -50 L -20 0 L -45 50 Z", class: "mc-start" }, t);
      lx = i.x; ly = i.y + 0.15;
    }
    if (opts.labels !== false) el("text", { x: f.X(lx), y: f.Y(ly) + f.fs * 0.35, "font-size": f.fs, class: "mc-label", "text-anchor": "middle" }, g)
      .textContent = i.name || KINDS[i.kind];
    return g;
  }

  function draw(svg, doc, opts = {}) {
    const f = frame(svg, doc, opts);
    const order = ["work", "target", "material", "obstacle", "wall", "storage", "hopper", "bucket", "robot_start"];
    [...doc.items].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
      .forEach((i) => drawItem(f, i, { selected: opts.selected === i.id, labels: opts.labels }));
    return f;
  }

  /** 방향이 있는 항목(버켓·호퍼·보관함)의 바닥 네 모서리 [m]. 그 외 자세 항목은 null. 서버 maps.pose_corners 와 같은 식. */
  function poseCorners(i) {
    const sz = { bucket: [0.3, 0.6, 0], storage: [0.4, 0.75, 0], hopper: [0.24, 0, 0] }[i.kind];
    if (!sz) return null;
    const W = i.width_m || sz[0];
    const d = i.kind === "hopper" ? 0.1 : W * sz[1] / 2, w = i.kind === "hopper" ? W / 2 + 0.1 : W / 2;
    const a = i.heading_deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => [i.x + su * d * c - sv * w * s, i.y + su * d * s + sv * w * c]);
  }

  return { NS, KINDS, COLOR, ROBOT_COLOR, el, mm, frame, draw, drawItem, poseCorners };
})();
