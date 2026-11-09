(() => {
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

  function spring(t, t0 = 0, omega = 18, zeta = 0.85) {
    const x = Math.max(0, t - t0);
    if (t < t0) return 0;
    if (x === 0) return 0;
    const damping = clamp(zeta, 0.82, 0.88);
    const wd = omega * Math.sqrt(1 - damping * damping);
    const decay = Math.exp(-damping * omega * x);
    return 1 - decay * (
      Math.cos(wd * x) + (damping * omega / wd) * Math.sin(wd * x)
    );
  }

  const beat = (b) => b * 0.5;
  const bar = (m) => (m - 1) * 2;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function centerOf(id) {
    const element = document.getElementById(id);
    const stage = document.getElementById('stage');
    if (!element || !stage) throw new Error(`Missing geometry target: ${id}`);
    const rect = element.getBoundingClientRect();
    const frame = stage.getBoundingClientRect();
    const scale = frame.width / 1920 || 1;
    return {
      x: (rect.left + rect.width / 2 - frame.left) / scale,
      y: (rect.top + rect.height / 2 - frame.top) / scale,
    };
  }

  window.Engine = Object.freeze({
    beat,
    bar,
    centerOf,
    clamp,
    mulberry32,
    spring,
  });
})();
