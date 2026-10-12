/* Mecánica orbital de dos cuerpos alrededor de Plutón. Lógica pura, sin DOM:
   también carga en Node para comprobarla (ver README).
   Unidades: km, s y km/s. Plano orbital 2D con el planeta en el origen, y hacia
   arriba y sentido antihorario como progrado. */
(function (root) {
  "use strict";

  var App = (root.OrbitSandbox = root.OrbitSandbox || {});

  var MU = 869.6; // GM de Plutón, km³/s²
  var RADIUS = 1188.3; // km
  var STEP = 5; // paso fijo del integrador, s
  var TAU = Math.PI * 2;

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function accelerate(s) {
    var r2 = s.x * s.x + s.y * s.y;
    var k = -MU / (r2 * Math.sqrt(r2));
    s.ax = k * s.x;
    s.ay = k * s.y;
  }

  function makeState(x, y, vx, vy) {
    var s = { x: x, y: y, vx: vx, vy: vy, ax: 0, ay: 0 };
    accelerate(s);
    return s;
  }

  function copyState(s) {
    return { x: s.x, y: s.y, vx: s.vx, vy: s.vy, ax: s.ax, ay: s.ay };
  }

  /* Leapfrog en su forma velocity Verlet (medio impulso, deriva, medio impulso).
     Es simpléctico: la energía oscila acotada en vez de derivar, que es lo que
     hace Euler explícito hasta sacar el satélite de su órbita. También es
     reversible: con dt negativo desanda exactamente el camino. Muta `s`. */
  function step(s, dt) {
    var half = dt * 0.5;
    s.vx += s.ax * half;
    s.vy += s.ay * half;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    accelerate(s);
    s.vx += s.ax * half;
    s.vy += s.ay * half;
  }

  function advance(s, steps, dt) {
    for (var i = 0; i < steps; i++) step(s, dt);
  }

  function circularSpeed(r) {
    return Math.sqrt(MU / r);
  }

  function escapeSpeed(r) {
    return Math.sqrt((2 * MU) / r);
  }

  function period(a) {
    return TAU * Math.sqrt((a * a * a) / MU);
  }

  /* Elementos orbitales a partir del vector de estado. La clasificación es
     analítica: no hace falta simular para saber cómo acaba el lanzamiento. */
  function elements(s) {
    var r = Math.sqrt(s.x * s.x + s.y * s.y);
    var v2 = s.vx * s.vx + s.vy * s.vy;
    var rv = s.x * s.vx + s.y * s.vy; // > 0 alejándose, < 0 acercándose
    var energy = v2 / 2 - MU / r;
    var h = s.x * s.vy - s.y * s.vx;
    var k = v2 - MU / r;
    var ex = (k * s.x - rv * s.vx) / MU; // vector de excentricidad: apunta al periapsis
    var ey = (k * s.y - rv * s.vy) / MU;
    var e = Math.sqrt(ex * ex + ey * ey);
    var p = (h * h) / MU;
    var bound = energy < 0;
    var a = energy === 0 ? Infinity : -MU / (2 * energy);
    var rp = bound ? a * (1 - e) : p / (1 + e);
    var ra = bound ? a * (1 + e) : Infinity;

    var kind;
    if (bound) kind = rp < RADIUS - 1e-6 ? "impact" : "orbit";
    // Una hipérbola también puede chocar si llega de fuera apuntando al planeta.
    else kind = rp < RADIUS && rv < 0 ? "impact" : "escape";

    return {
      kind: kind,
      r: r,
      speed: Math.sqrt(v2),
      rv: rv,
      energy: energy,
      h: h,
      e: e,
      p: p,
      a: a,
      rp: rp,
      ra: ra,
      periAlt: rp - RADIUS,
      apoAlt: ra - RADIUS,
      period: bound ? period(a) : Infinity,
      // En una órbita circular el periapsis no está definido: se toma la posición actual.
      argp: e > 1e-8 ? Math.atan2(ey, ex) : Math.atan2(s.y, s.x),
    };
  }

  /* Estado inicial desde los datos del formulario: altitud sobre la superficie,
     rapidez y ángulo de la velocidad sobre el horizonte local (0° = horizontal
     y progrado, 90° = hacia arriba). `bearing` es la posición alrededor del planeta. */
  function fromLaunch(altitude, speed, angleDeg, bearing) {
    var r = RADIUS + altitude;
    var ux = Math.cos(bearing);
    var uy = Math.sin(bearing);
    var g = (angleDeg * Math.PI) / 180;
    var horizontal = speed * Math.cos(g);
    var vertical = speed * Math.sin(g);
    return makeState(r * ux, r * uy, vertical * ux - horizontal * uy, vertical * uy + horizontal * ux);
  }

  // Elipse de una órbita ligada: centro, semiejes, giro y los dos ápsides.
  function ellipse(el) {
    var cos = Math.cos(el.argp);
    var sin = Math.sin(el.argp);
    return {
      cx: -el.a * el.e * cos,
      cy: -el.a * el.e * sin,
      a: el.a,
      b: el.a * Math.sqrt(Math.max(0, 1 - el.e * el.e)),
      rotation: el.argp,
      peri: { x: el.rp * cos, y: el.rp * sin },
      apo: { x: -el.ra * cos, y: -el.ra * sin },
    };
  }

  function sampleConic(el, nu0, nu1, out) {
    var dir = el.h >= 0 ? 1 : -1;
    var n = Math.max(2, Math.ceil(Math.abs(nu1 - nu0) / (TAU / 240)));
    for (var i = 1; i <= n; i++) {
      var nu = nu0 + ((nu1 - nu0) * i) / n;
      var rr = el.p / (1 + el.e * Math.cos(nu));
      var theta = el.argp + dir * nu;
      out.push(rr * Math.cos(theta), rr * Math.sin(theta));
    }
    return out;
  }

  /* Camino que le queda por delante a un satélite, muestreando la cónica por
     anomalía verdadera: hasta la superficie (impacto), hasta `maxR` (escape) o
     una vuelta entera (órbita). Devuelve [x0, y0, x1, y1, …] en km. */
  function trace(s, maxR) {
    var el = elements(s);
    var out = [s.x, s.y];
    var ux = s.x / el.r;
    var uy = s.y / el.r;

    // Caída o subida radial: la cónica degenera en una recta.
    if (el.p < 1e-6 * RADIUS) {
      if (el.rv < 0) {
        out.push(ux * RADIUS, uy * RADIUS);
      } else if (el.energy < 0 && -MU / el.energy < maxR) {
        var top = -MU / el.energy;
        out.push(ux * top, uy * top, ux * RADIUS, uy * RADIUS);
      } else {
        out.push(ux * maxR, uy * maxR);
      }
      return out;
    }

    if (el.e < 1e-8) return sampleConic(el, 0, TAU, out);

    var nu0 = Math.acos(clamp((el.p / el.r - 1) / el.e, -1, 1));
    if (el.rv < 0) nu0 = -nu0;
    var nu1;
    if (el.kind === "orbit") {
      nu1 = nu0 + TAU;
    } else if (el.kind === "impact") {
      var hit = Math.acos(clamp((el.p / RADIUS - 1) / el.e, -1, 1));
      nu1 = nu0 < 0 ? -hit : TAU - hit;
    } else {
      nu1 = Math.max(nu0, Math.acos(clamp((el.p / maxR - 1) / el.e, -1, 1)));
    }
    return sampleConic(el, nu0, nu1, out);
  }

  // Tramo de la cónica que cae dentro de `maxR`, centrado en el periapsis. Sirve
  // para dibujar órbitas tan grandes que casi toda la elipse queda fuera de cuadro.
  function nearArc(el, maxR) {
    if (el.rp >= maxR || el.e < 1e-8) return [];
    var edge = Math.acos(clamp((el.p / maxR - 1) / el.e, -1, 1));
    var dir = el.h >= 0 ? 1 : -1;
    var r0 = el.p / (1 + el.e * Math.cos(-edge));
    var theta0 = el.argp - dir * edge;
    return sampleConic(el, -edge, edge, [r0 * Math.cos(theta0), r0 * Math.sin(theta0)]);
  }

  App.physics = {
    MU: MU,
    RADIUS: RADIUS,
    STEP: STEP,
    makeState: makeState,
    copyState: copyState,
    step: step,
    advance: advance,
    circularSpeed: circularSpeed,
    escapeSpeed: escapeSpeed,
    period: period,
    elements: elements,
    fromLaunch: fromLaunch,
    ellipse: ellipse,
    trace: trace,
    nearArc: nearArc,
  };
})(typeof window !== "undefined" ? window : globalThis);
