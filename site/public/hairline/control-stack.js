/** Floodwall control-plane cartridge: admission, policy, and the receipt ledger. */
const {
  Cam, clamp, fit, facing, proj, rrect, rings, prism, ringAt, open,
  spring, stepS, tween, tset, tval, tdone, mk, solid, put, pointer,
  register, disposer,
} = HL;

const W = 108, D = 68, REST = [0, 13, 27], THICK = [6, 6, 7];
const LABELS = ["ledger", "policy", "admission"];
const OUTER = rings(-W / 2, -D / 2, W / 2, D / 2, 7, 1.6);

function mount({ stage, svg, onStageChange = () => {} }, value) {
  const bag = disposer();
  const C = Cam(45, 0.5, 2.1);
  fit(C, [[-56, -36, -2], [56, 36, -2], [-56, -36, 90], [56, 36, 90]], 200, 166);
  const P = proj(C), front = facing(C);
  const group = mk("g", {}, svg);
  const gap = spring(0);
  let reach = value, active = -2;
  const layers = REST.map((base, i) => {
    const g = mk("g", {}, group);
    const body = solid(g);
    const details = mk("g", {}, g);
    return { base, body, details, lift: tween(0), lastZ: NaN, i };
  });

  function line(parent, points, cls = "nf lo") {
    return mk("path", { d: open(points.map(([x, y, z]) => P(x, y, z))), class: cls }, parent);
  }
  function topRing(parent, x0, y0, x1, y1, radius, z, cls = "nf lo") {
    return mk("path", { d: open(ringAt(P, rrect(x0, y0, x1, y1, radius, 8), z)), class: cls }, parent);
  }
  function feature(parent, x0, y0, x1, y1, z, cls = "nf lo") {
    return topRing(parent, x0, y0, x1, y1, 2, z, cls);
  }
  function draw(i, z) {
    const layer = layers[i], top = z + THICK[i];
    if (layer.lastZ === z) return;
    layer.lastZ = z;
    layer.details.replaceChildren();
    put(layer.body, prism(P, front, OUTER[0], OUTER[1], z, top));
    if (i === 0) {
      // Three exposed receipt leaves and two binding punches identify the ledger.
      for (let j = 0; j < 3; j++) {
        const zz = z + 1.3 + j * 1.35;
        line(layer.details, [[-49, 34, zz], [46 - j * 3, 34, zz]], "nf lo");
      }
      for (const x of [-39, -31]) feature(layer.details, x, -25, x + 3.4, -21.6, top + .1);
      line(layer.details, [[-42, -14, top + .1], [24, -14, top + .1]]);
      line(layer.details, [[-42, -7, top + .1], [9, -7, top + .1]]);
    } else if (i === 1) {
      // A recessed policy slot, four contact lands, and parallel guide rails.
      topRing(layer.details, -36, -14, 27, 9, 4, top + .1);
      topRing(layer.details, -32, -10, 23, 5, 2.6, top + .1);
      for (let j = 0; j < 4; j++) feature(layer.details, -24 + j * 12, -3, -18 + j * 12, 1, top + .1);
      line(layer.details, [[-37, 17, top + .1], [34, 17, top + .1]]);
      line(layer.details, [[-37, 22, top + .1], [34, 22, top + .1]]);
    } else {
      // Admission card inset with its pull tab and punched validation row.
      topRing(layer.details, -39, -24, 36, 23, 4, top + .1);
      feature(layer.details, -12, -29, 14, -22, top + .12, "nf");
      line(layer.details, [[-29, -9, top + .1], [24, -9, top + .1]]);
      line(layer.details, [[-29, -3, top + .1], [12, -3, top + .1]]);
      for (let j = 0; j < 4; j++) feature(layer.details, -29 + j * 9, 11, -25 + j * 9, 15, top + .1);
    }
  }

  function choose(a) {
    if (a === active) return;
    active = a;
    const now = performance.now();
    layers.forEach((layer, i) => {
      const lift = a < 0 ? 0 : i === a ? 5 : Math.abs(i - a) === 1 ? 1.8 : 0;
      tset(layer.lift, lift, now, Math.abs(i - a) * 42);
      layer.body.sil.classList.toggle("hi", i === (a < 0 ? 2 : a));
    });
    onStageChange(a < 0 ? "admission" : a === 1 ? "gate" : LABELS[a]);
    loop.wake();
  }

  function hit([x, y]) {
    if (x < 52 || x > 350 || y < 48 || y > 276) return -1;
    // Fixed rest-pose bands: the moving layers cannot make the pick flicker.
    const cx = P(0, 0, 0)[0], ex = P(1, 0, 0), origin = P(0, 0, 0);
    const corrected = y - (x - cx) * (ex[1] - origin[1]) / (ex[0] - cx);
    let best = -1, distance = Infinity;
    layers.forEach((layer, i) => {
      const cy = P(0, 0, layer.base + i * gap.t + THICK[i])[1];
      const d = Math.abs(corrected - cy);
      if (d < distance) { distance = d; best = i; }
    });
    return distance < 38 ? best : -1;
  }

  const loop = register(stage, (dt, now) => {
    let moving = stepS(gap, dt);
    const g = gap.x;
    layers.forEach((layer, i) => {
      const lift = tval(layer.lift, now);
      const z = layer.base + i * g + lift;
      draw(i, z);
      if (!tdone(layer.lift, now)) moving = true;
    });
    return moving;
  });
  bag.add(loop.unregister);
  bag.add(pointer(stage, {
    move: ([x, y]) => {
      gap.t = clamp((x - 72) / 258, 0, 1) * reach;
      choose(hit([x, y]));
      loop.wake();
    },
    leave: () => { gap.t = 0; choose(-1); loop.wake(); },
  }));
  bag.add(() => svg.replaceChildren());
  layers.forEach((layer, i) => draw(i, layer.base));
  choose(-1);
  return {
    set: (v) => { reach = v; gap.t = clamp(gap.t, 0, reach); loop.wake(); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "control-stack",
  means: "A control cartridge separates to reveal the admission tray, policy contacts, and receipt ledger.",
  rules: [1, 3, 4, 5, 8, 9, 10],
  range: [5, 13, 21],
  tour: [[110, 190], [200, 200], [285, 188], null],
  mount,
});
