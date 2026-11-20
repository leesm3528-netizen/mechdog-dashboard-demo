// 작은 재생기: 장면 코드(kit.scene)를 시간 t 로 그린다. 소리는 없음.
(function () {
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const seg = (t, a, b) => clamp01((t - a) / (b - a));
  const lerp = (a, b, p) => a + (b - a) * p;
  const eo = (x) => 1 - Math.pow(1 - x, 3);
  const ei = (x) => x * x * x;
  const eio = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  function rng(seed) {
    let s = (Math.imul(seed + 1, 2654435761) >>> 0) || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  const TextFx = {
    fadeFromRight(el, t, t0, o) {
      o = o || {};
      if (!el._w) {
        const words = el.textContent.split(' ');
        el.textContent = '';
        el._w = words.map((w, i) => {
          const s = document.createElement('span');
          s.textContent = w; s.style.display = 'inline-block';
          el.appendChild(s);
          if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
          return s;
        });
      }
      const st = o.stagger || 0.11, d = o.dur || 0.5, dx = o.dx || 30;
      el._w.forEach((s, i) => {
        const p = eo(seg(t, t0 + i * st, t0 + i * st + d));
        s.style.opacity = p;
        s.style.transform = 'translateX(' + ((1 - p) * dx).toFixed(1) + 'px)';
      });
    },
  };
  const defs = {};
  const kit = {
    seg, lerp, clamp01, eo, ei, eio, rng, TextFx,
    scene(id, def) { defs[id] = def; },
    h(html) {
      const tp = document.createElement('template');
      tp.innerHTML = html.trim();
      return tp.content.children.length === 1 ? tp.content.firstElementChild : tp.content;
    },
  };
  window.kit = kit;

  window.FilmPlayer = async function (cfg) {
    const stage = document.getElementById('stage'), wrap = document.getElementById('wrap');
    let start = 0;
    const list = [];
    for (const sc of cfg.scenes) {
      const layer = document.createElement('div');
      layer.className = 'layer';
      stage.appendChild(layer);
      const sk = Object.assign(Object.create(kit), {
        stage: layer, dur: sc.dur, start,
        css(text) { const s = document.createElement('style'); s.textContent = text; layer.appendChild(s); },
      });
      const def = defs[sc.id];
      if (def && def.init) await def.init(sk);
      list.push({ sc, def, sk, layer, start });
      start += sc.dur;
    }
    const total = start;

    const fit = () => { const k = wrap.clientWidth / 1920; stage.style.transform = 'scale(' + k + ')'; wrap.style.height = 1080 * k + 'px'; };
    fit(); new ResizeObserver(fit).observe(wrap);

    const range = document.getElementById('seek'), clock = document.getElementById('clock'), btn = document.getElementById('play'), chips = document.getElementById('chips');
    range.max = total; range.step = 0.01;
    const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    list.forEach((it) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = it.sc.name;
      b.onclick = () => { t = it.start + 0.01; draw(); };
      chips.appendChild(b); it.chip = b;
    });

    let t = 0, playing = true, last = null;
    function draw() {
      let cur = list.length - 1;
      for (let i = 0; i < list.length; i++) if (t < list[i].start + list[i].sc.dur) { cur = i; break; }
      list.forEach((it, i) => { it.layer.hidden = i !== cur; it.chip.classList.toggle('on', i === cur); });
      const it = list[cur];
      if (it.def) { try { it.def.render(t - it.start, it.sk); } catch (e) { console.error(it.sc.id, e); } }
      range.value = t; clock.textContent = fmt(t) + ' / ' + fmt(total);
      btn.textContent = playing ? '일시정지' : '재생';
    }
    function frame(now) {
      if (playing) {
        if (last !== null) t += (now - last) / 1000;
        if (t >= total) { t = total - 0.001; playing = false; }
      }
      last = now;
      draw();
      requestAnimationFrame(frame);
    }
    btn.onclick = () => { if (!playing && t >= total - 0.01) t = 0; playing = !playing; };
    range.oninput = () => { t = +range.value; playing = false; };
    document.addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); btn.click(); } });
    requestAnimationFrame(frame);
  };
})();
