/* Escena: Plutón a escala, los satélites, sus estelas y el lanzamiento con puntero.
   Un único bucle requestAnimationFrame integra la física a paso fijo (los fps no
   cambian el resultado) y por frame solo escribe `transform` en cada satélite;
   las estelas van a un canvas de fondo. Con prefers-reduced-motion no hay bucle:
   cada satélite queda quieto donde se lanzó, con su órbita entera dibujada. */
(function () {
  "use strict";

  var App = (window.OrbitSandbox = window.OrbitSandbox || {});
  var physics = App.physics;
  var fmt = App.fmt;
  var SVG_NS = "http://www.w3.org/2000/svg";

  var VIEW_KM = 5600; // el lado corto de la escena abarca ±5600 km desde el centro
  var BASE_RATE = 600; // a ×1, un segundo real son diez minutos de vuelo
  var MAX_SATS = 12;
  var MAX_STEPS = 400; // tope de subpasos por frame
  var V_PER_PX = 0.009; // puntería: km/s por píxel arrastrado
  var V_MAX = 2.5;
  var AIM_MIN_PX = 6; // por debajo es un toque, no un lanzamiento
  var TRAIL_PX = 3; // separación entre puntos guardados de la estela
  var TRAIL_BUCKETS = 12; // escalones de opacidad a lo largo de la estela
  var TRAIL_MAX = 30 * 3600; // s de vuelo que recuerda una estela, como mucho
  var TRAIL_LOOSE = 4 * 3600; // estela de lo que cae o escapa
  var ELLIPSE_MAX_PX = 6000; // más allá se dibuja solo el tramo que cabe en cuadro
  var EXIT_PX = 36; // margen fuera del encuadre antes de retirar un escape
  var RETIRE_MS = 1800; // movimiento reducido: lo que tarda en retirarse lo que no orbita
  var GOLDEN_ANGLE = 2.39996; // reparte los lanzamientos del formulario
  var TINTS = 3;
  var STEP = physics.STEP;
  var R = physics.RADIUS;

  function node(name, attrs, parent) {
    var el = document.createElementNS(SVG_NS, name);
    for (var key in attrs) el.setAttribute(key, attrs[key]);
    if (parent) parent.appendChild(el);
    return el;
  }

  function reduced() {
    return Boolean(window.Pluton && window.Pluton.reducedMotion());
  }

  App.createScene = function (options) {
    var stage = options.stage;
    var view = options.view;
    var svg = options.svg;
    var canvas = options.canvas;
    var ctx = canvas.getContext("2d");
    var plutoEl = svg.querySelector("#pluto");
    var orbitsLayer = svg.querySelector("#orbits");
    var fxLayer = svg.querySelector("#fx");
    var marksLayer = svg.querySelector("#marks");
    var satsLayer = svg.querySelector("#sats");
    var aimEl = svg.querySelector("#aim");
    var aimPath = svg.querySelector("#aim-path");
    var aimLine = svg.querySelector("#aim-line");
    var aimHead = svg.querySelector("#aim-head");
    var aimOrigin = svg.querySelector("#aim-origin");
    var aimLabel = svg.querySelector("#aim-label");
    var scaleEl = options.scale;
    var selPath = node("path", { class: "orbit-dashed sel-orbit", hidden: "" }, orbitsLayer);

    var sats = []; // en vuelo, del más antiguo al más reciente
    var ghosts = []; // estelas de satélites que ya cayeron o escaparon
    var selectedId = null;
    var counter = 0; // nº de lanzamientos: da nombre, tono y posición de salida
    var simTime = 0; // s de vuelo simulados
    var acc = 0; // tiempo simulado pendiente de integrar
    var speed = 1;
    var paused = false;
    var w = 0;
    var h = 0;
    var scale = 1; // px por km
    var maxR = VIEW_KM * 2; // km hasta la esquina del encuadre, con margen
    var dpr = 1;
    var probe = ""; // escala de la sonda en escenas pequeñas
    var colors = [];
    var raf = 0;
    var lastFrame = 0;
    var lastTick = 0;
    var aim = null;

    /* ---------- geometría ---------- */

    function X(km) {
      return (km * scale).toFixed(2);
    }

    // La física usa y hacia arriba; la pantalla, hacia abajo.
    function Y(km) {
      return (-km * scale).toFixed(2);
    }

    function polyline(points) {
      if (points.length < 4) return "";
      var d = "M" + X(points[0]) + " " + Y(points[1]);
      for (var i = 2; i < points.length; i += 2) d += "L" + X(points[i]) + " " + Y(points[i + 1]);
      return d;
    }

    // Camino completo de una trayectoria: la elipse exacta si orbita; si no, el
    // tramo de cónica hasta la superficie o hasta el borde del encuadre.
    function pathFor(state, el) {
      if (el.kind !== "orbit") return polyline(physics.trace(state, maxR));
      if (el.a * scale > ELLIPSE_MAX_PX) return polyline(physics.nearArc(el, maxR));
      var g = physics.ellipse(el);
      var arc = "A" + X(g.a) + " " + X(g.b) + " " + ((-g.rotation * 180) / Math.PI).toFixed(2) + " 1 0 ";
      var peri = X(g.peri.x) + " " + Y(g.peri.y);
      return "M" + peri + arc + X(g.apo.x) + " " + Y(g.apo.y) + arc + peri + "Z";
    }

    function readColors() {
      var css = window.getComputedStyle(document.documentElement);
      colors = ["--accent", "--cold", "--text"].map(function (token) {
        return css.getPropertyValue(token).trim();
      });
    }

    function layout() {
      var rect = view.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      w = rect.width;
      h = rect.height;
      scale = Math.min(w, h) / 2 / VIEW_KM;
      maxR = Math.sqrt(w * w + h * h) / 2 / scale + 400;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      var k = Math.max(0.72, Math.min(1, Math.min(w, h) / 440));
      probe = k < 1 ? " scale(" + k.toFixed(3) + ")" : "";

      // El viewBox va en píxeles con el origen en el centro: SVG y canvas comparten sistema.
      svg.setAttribute("viewBox", -w / 2 + " " + -h / 2 + " " + w + " " + h);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      plutoEl.setAttribute("transform", "scale(" + ((R * scale) / 52).toFixed(4) + ") translate(-60 -60)");
      scaleEl.style.setProperty("--w", (2000 * scale).toFixed(1) + "px");
      view.setAttribute("data-scale", scale.toFixed(6));

      refreshStatic();
      sats.forEach(place);
      draw();
    }

    function place(sat) {
      var s = sat.state;
      // Los paneles van perpendiculares al rumbo, como alas.
      var heading = (Math.atan2(-s.vy, s.vx) * 180) / Math.PI + 90;
      sat.node.setAttribute("transform", "translate(" + X(s.x) + " " + Y(s.y) + ") rotate(" + heading.toFixed(1) + ")" + probe);
    }

    /* ---------- estelas (canvas) ---------- */

    function spanOf(el) {
      return el.kind === "orbit" ? Math.min(el.period * 0.82, TRAIL_MAX) : TRAIL_LOOSE;
    }

    // La estela guarda [x, y, t, …] en km y segundos de vuelo; `start` salta lo ya caducado.
    function record(sat) {
      var pts = sat.trail.pts;
      var n = pts.length;
      var min = TRAIL_PX / scale;
      var dx = sat.state.x - pts[n - 3];
      var dy = sat.state.y - pts[n - 2];
      if (!n || dx * dx + dy * dy >= min * min) pts.push(sat.state.x, sat.state.y, simTime);
    }

    function trim(trail) {
      var pts = trail.pts;
      var limit = simTime - trail.span;
      while (trail.start < pts.length && pts[trail.start + 2] < limit) trail.start += 3;
      if (trail.start > 900) {
        trail.pts = pts.slice(trail.start);
        trail.start = 0;
      }
    }

    // Reconstruye la estela de un satélite restaurado integrando hacia atrás:
    // el leapfrog es reversible, así que el pasado sale del mismo integrador.
    function backfill(sat) {
      var s = physics.copyState(sat.state);
      var steps = Math.floor(sat.trail.span / STEP);
      var min = TRAIL_PX / scale;
      var back = [];
      var lx = s.x;
      var ly = s.y;
      for (var i = 1; i <= steps; i++) {
        physics.step(s, -STEP);
        var dx = s.x - lx;
        var dy = s.y - ly;
        if (dx * dx + dy * dy >= min * min) {
          back.push(s.x, s.y, simTime - i * STEP);
          lx = s.x;
          ly = s.y;
        }
      }
      var pts = [];
      for (var j = back.length - 3; j >= 0; j -= 3) pts.push(back[j], back[j + 1], back[j + 2]);
      pts.push(sat.state.x, sat.state.y, simTime);
      sat.trail.pts = pts;
      sat.trail.start = 0;
    }

    // La opacidad cae con la edad del tramo; se pinta en pocos escalones para no
    // lanzar un trazo por segmento.
    function drawTrail(trail, color, width, head) {
      var pts = trail.pts;
      var i = trail.start;
      if (i >= pts.length) return;
      var px = pts[i] * scale;
      var py = -pts[i + 1] * scale;
      var bucket = -1;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;

      for (i += 3; i <= pts.length; i += 3) {
        var last = i === pts.length; // el último tramo llega hasta el satélite
        if (last && !head) break;
        var x = (last ? head.x : pts[i]) * scale;
        var y = -(last ? head.y : pts[i + 1]) * scale;
        var fresh = 1 - (simTime - (last ? simTime : pts[i + 2])) / trail.span;
        var b = Math.max(0, Math.min(TRAIL_BUCKETS - 1, Math.floor(fresh * TRAIL_BUCKETS)));
        if (b !== bucket) {
          if (bucket >= 0) ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.globalAlpha = 0.05 + 0.9 * Math.pow((b + 1) / TRAIL_BUCKETS, 1.3);
          bucket = b;
        }
        ctx.lineTo(x, y);
        px = x;
        py = y;
      }
      if (bucket >= 0) ctx.stroke();
    }

    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, (w / 2) * dpr, (h / 2) * dpr);
      ctx.clearRect(-w / 2, -h / 2, w, h);
      if (reduced()) return;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      var i;
      for (i = 0; i < ghosts.length; i++) drawTrail(ghosts[i].trail, colors[ghosts[i].tint], 1.4, null);
      for (i = 0; i < sats.length; i++) {
        var sat = sats[i];
        drawTrail(sat.trail, colors[sat.tint], sat.id === selectedId ? 2 : 1.4, sat.state);
      }
      ctx.globalAlpha = 1;
    }

    /* ---------- lo que no cambia en cada frame ---------- */

    function byId(id) {
      for (var i = 0; i < sats.length; i++) if (sats[i].id === id) return sats[i];
      return null;
    }

    function summary(sat) {
      return { id: sat.id, n: sat.n, name: sat.name, tint: sat.tint, kind: sat.kind, el: sat.el };
    }

    function mark(label, xKm, yKm) {
      var x = xKm * scale;
      var y = -yKm * scale;
      // Un ápside fuera del encuadre no se rotula: el dato sigue en la telemetría.
      if (Math.abs(x) > w / 2 - 6 || Math.abs(y) > h / 2 - 6) return;
      var d = Math.sqrt(x * x + y * y) || 1;
      var cos = x / d;
      var sin = y / d;
      // El rótulo se aparta hacia fuera, lejos de Plutón y de la propia órbita;
      // si ahí se saldría del encuadre, pasa al lado de dentro.
      var half = label.length * 3.3;
      var lx = x + cos * (10 + half * Math.abs(cos));
      var ly = y + sin * 17;
      if (Math.abs(lx) + half > w / 2 - 6 || Math.abs(ly) + 8 > h / 2 - 6) {
        lx = x - cos * (10 + half * Math.abs(cos));
        ly = y - sin * 17;
      }
      var g = node("g", { class: "mark" }, marksLayer);
      node("circle", { class: "mark-dot", cx: x.toFixed(2), cy: y.toFixed(2), r: 3 }, g);
      var text = node("text", { class: "mark-text", x: lx.toFixed(2), y: ly.toFixed(2), "text-anchor": "middle", "dominant-baseline": "central" }, g);
      text.textContent = label;
    }

    // Órbita punteada y ápsides del satélite elegido, y las órbitas enteras que
    // sustituyen a las estelas con movimiento reducido.
    function refreshStatic() {
      var selected = byId(selectedId);
      var still = reduced();
      marksLayer.textContent = "";

      if (selected && !still) {
        selPath.setAttribute("d", pathFor(selected.origin, selected.el));
        selPath.removeAttribute("hidden");
      } else {
        selPath.setAttribute("hidden", "");
      }

      if (selected) {
        var el = selected.el;
        var cos = Math.cos(el.argp);
        var sin = Math.sin(el.argp);
        var bound = el.energy < 0;
        var showPeri = el.kind === "orbit" ? el.e >= 0.002 : el.kind === "escape" && el.rv < 0;
        var showApo = bound && (el.kind === "orbit" ? el.e >= 0.002 : el.rv >= 0);
        if (showPeri) mark("Pe " + fmt.km(el.periAlt), el.rp * cos, el.rp * sin);
        if (showApo) mark("Ap " + fmt.km(el.apoAlt), -el.ra * cos, -el.ra * sin);
      }

      sats.forEach(function (sat) {
        sat.node.classList.toggle("is-selected", sat.id === selectedId);
        if (!sat.orbitNode) return;
        sat.orbitNode.setAttribute("d", pathFor(sat.origin, sat.el));
        sat.orbitNode.classList.toggle("is-selected", sat.id === selectedId);
      });
    }

    /* ---------- satélites ---------- */

    function fadeIn(el) {
      el.classList.add("is-entering");
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          el.classList.remove("is-entering");
        });
      });
    }

    function fadeOut(el) {
      if (!el) return;
      el.classList.add("is-leaving");
      window.setTimeout(function () {
        el.remove();
      }, 320);
    }

    function make(state, n, tint) {
      var el = physics.elements(state);
      var sat = {
        id: "s" + n,
        n: n,
        name: fmt.satName(n),
        tint: tint,
        state: state,
        origin: physics.copyState(state),
        el: el,
        kind: el.kind,
        trail: { pts: [state.x, state.y, simTime], start: 0, span: spanOf(el) },
        node: null,
        orbitNode: null,
        timer: 0,
      };

      // Los colores van por clase (style.css) para que sigan al tema claro u oscuro.
      var g = node("g", { class: "sat tint-" + tint, "data-id": sat.id }, satsLayer);
      node("circle", { class: "sat-hit", r: 18 }, g);
      node("circle", { class: "sat-ring", r: 11 }, g);
      node("rect", { class: "sat-panel", x: -10.5, y: -1.75, width: 6, height: 3.5, rx: 0.8 }, g);
      node("rect", { class: "sat-panel", x: 4.5, y: -1.75, width: 6, height: 3.5, rx: 0.8 }, g);
      node("circle", { class: "sat-body", r: 3.6 }, g);
      sat.node = g;
      return sat;
    }

    // Movimiento reducido: la órbita entera hace de estela. Lo que no orbita
    // enseña su camino un momento y se retira con un fundido.
    function addStill(sat, animate) {
      sat.orbitNode = node("path", { class: "sat-orbit tint-" + sat.tint }, orbitsLayer);
      if (animate) fadeIn(sat.orbitNode);
      if (sat.kind !== "orbit") {
        sat.timer = window.setTimeout(function () {
          sat.timer = 0;
          retire(sat, sat.kind);
        }, RETIRE_MS);
      }
    }

    function detach(sat) {
      var index = sats.indexOf(sat);
      if (index !== -1) sats.splice(index, 1);
      if (sat.timer) window.clearTimeout(sat.timer);
      sat.timer = 0;
    }

    // Sale de la escena. Lo que cae o escapa deja su estela apagándose sola.
    function retire(sat, reason) {
      var wasSelected = sat.id === selectedId;
      detach(sat);
      if (reason === "impact" || reason === "escape") {
        if (!reduced()) ghosts.push({ trail: sat.trail, tint: sat.tint });
        if (wasSelected) selectedId = null;
      } else if (wasSelected) {
        selectedId = sats.length ? sats[sats.length - 1].id : null;
      }
      if (reason === "escape" && !reduced()) sat.node.remove();
      else fadeOut(sat.node);
      fadeOut(sat.orbitNode);
      refreshStatic();
      if (!raf) draw();
      if (reason === "impact" || reason === "escape") options.onRetire(summary(sat), reason, wasSelected);
      options.onChange();
    }

    function flash(xKm, yKm) {
      var ring = node("circle", { class: "flash", cx: X(xKm), cy: Y(yKm), r: 7 }, fxLayer);
      var fade = ring.animate(
        [
          { transform: "scale(0.5)", opacity: 1 },
          { transform: "scale(2)", opacity: 0.7, offset: 0.45 },
          { transform: "scale(2.8)", opacity: 0 },
        ],
        { duration: 760, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
      );
      fade.onfinish = function () {
        ring.remove();
      };
    }

    function crash(sat) {
      var s = sat.state;
      var k = R / Math.sqrt(s.x * s.x + s.y * s.y);
      sat.trail.pts.push(s.x * k, s.y * k, simTime);
      flash(s.x * k, s.y * k);
      retire(sat, "impact");
    }

    function launch(state) {
      var evicted = null;
      if (sats.length >= MAX_SATS) {
        evicted = summary(sats[0]);
        var oldest = sats[0];
        detach(oldest);
        fadeOut(oldest.node);
        fadeOut(oldest.orbitNode);
      }

      counter += 1;
      var sat = make(state, counter, (counter - 1) % TINTS);
      sats.push(sat);
      fadeIn(sat.node);
      if (reduced()) addStill(sat, true);
      selectedId = sat.id;
      place(sat);
      refreshStatic();
      start();
      if (!raf) draw();
      options.onChange();
      return { sat: summary(sat), evicted: evicted };
    }

    /* ---------- bucle ---------- */

    function outOfFrame(s) {
      return Math.abs(s.x) * scale > w / 2 + EXIT_PX || Math.abs(s.y) * scale > h / 2 + EXIT_PX;
    }

    // Paso fijo con acumulador: la física avanza igual a 30 que a 144 fps.
    function simulate(simDt) {
      acc += simDt;
      var n = Math.floor(acc / STEP);
      if (n > MAX_STEPS) {
        n = MAX_STEPS;
        acc = 0;
      } else {
        acc -= n * STEP;
      }
      if (!n) return;
      simTime += n * STEP;

      for (var i = sats.length - 1; i >= 0; i--) {
        var sat = sats[i];
        var s = sat.state;
        if (sat.kind === "impact") {
          var hit = false;
          for (var k = 0; k < n && !hit; k++) {
            physics.step(s, STEP);
            hit = s.x * s.x + s.y * s.y <= R * R && s.x * s.vx + s.y * s.vy < 0;
          }
          if (hit) {
            crash(sat);
            continue;
          }
        } else {
          physics.advance(s, n, STEP);
          if (sat.kind === "escape" && outOfFrame(s) && s.x * s.vx + s.y * s.vy > 0) {
            retire(sat, "escape");
            continue;
          }
        }
        record(sat);
        trim(sat.trail);
      }

      for (var j = ghosts.length - 1; j >= 0; j--) {
        trim(ghosts[j].trail);
        if (ghosts[j].trail.start >= ghosts[j].trail.pts.length) ghosts.splice(j, 1);
      }
    }

    function shouldRun() {
      return !paused && !reduced() && !document.hidden && (sats.length > 0 || ghosts.length > 0);
    }

    function frame(now) {
      var dt = Math.min(now - lastFrame, 100);
      lastFrame = now;
      simulate((dt / 1000) * BASE_RATE * speed);
      for (var i = 0; i < sats.length; i++) place(sats[i]);
      draw();
      if (now - lastTick >= 125) {
        lastTick = now;
        options.onTick(simTime);
      }
      raf = shouldRun() ? requestAnimationFrame(frame) : 0;
    }

    function start() {
      if (raf || !shouldRun()) return;
      lastFrame = performance.now();
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    // Cambia la preferencia de movimiento con la página abierta.
    function syncMotion() {
      var still = reduced();
      if (still) {
        stop();
        ghosts = [];
      }
      sats.slice().forEach(function (sat) {
        if (still && !sat.orbitNode) {
          addStill(sat, false);
        } else if (!still && sat.orbitNode) {
          sat.orbitNode.remove();
          sat.orbitNode = null;
          if (sat.timer) window.clearTimeout(sat.timer);
          sat.timer = 0;
          sat.trail.pts = [sat.state.x, sat.state.y, simTime];
          sat.trail.start = 0;
        }
      });
      refreshStatic();
      draw();
      start();
    }

    /* ---------- lanzamiento con puntero ---------- */

    function pointer(event) {
      var rect = view.getBoundingClientRect();
      return { x: event.clientX - rect.left - w / 2, y: event.clientY - rect.top - h / 2 };
    }

    function endAim() {
      if (!aim) return;
      if (view.hasPointerCapture && view.hasPointerCapture(aim.pointerId)) view.releasePointerCapture(aim.pointerId);
      aim = null;
      aimEl.setAttribute("hidden", "");
      stage.classList.remove("is-aiming");
      options.onAim(null);
    }

    function updateAim(event) {
      var p = pointer(event);
      var dx = p.x - aim.sx;
      var dy = p.y - aim.sy;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len < AIM_MIN_PX) {
        aim.state = null;
        aimEl.setAttribute("hidden", "");
        options.onAim(null);
        return;
      }

      var v = Math.min(len * V_PER_PX, V_MAX);
      var ux = dx / len;
      var uy = dy / len;
      var tx = aim.sx + (ux * v) / V_PER_PX;
      var ty = aim.sy + (uy * v) / V_PER_PX;
      aim.state = physics.makeState(aim.x, aim.y, ux * v, -uy * v);
      var el = physics.elements(aim.state);

      aimEl.setAttribute("data-kind", el.kind);
      aimPath.setAttribute("d", pathFor(aim.state, el));
      aimLine.setAttribute("x1", aim.sx.toFixed(1));
      aimLine.setAttribute("y1", aim.sy.toFixed(1));
      aimLine.setAttribute("x2", tx.toFixed(1));
      aimLine.setAttribute("y2", ty.toFixed(1));
      aimHead.setAttribute("transform", "translate(" + tx.toFixed(1) + " " + ty.toFixed(1) + ") rotate(" + ((Math.atan2(uy, ux) * 180) / Math.PI).toFixed(1) + ")");
      aimOrigin.setAttribute("cx", aim.sx.toFixed(1));
      aimOrigin.setAttribute("cy", aim.sy.toFixed(1));

      // La magnitud continúa la flecha; con el dedo quedaría bajo la mano, así que
      // pasa al otro extremo, detrás del punto de salida.
      var label = fmt.speed(v, 2);
      var half = label.length * 3.6;
      var touch = event.pointerType === "touch";
      var side = touch ? -1 : 1;
      var lx = (touch ? aim.sx : tx) + side * ux * (14 + half * Math.abs(ux));
      var ly = (touch ? aim.sy : ty) + side * uy * 20;
      lx = Math.max(-w / 2 + half + 6, Math.min(w / 2 - half - 6, lx));
      ly = Math.max(-h / 2 + 12, Math.min(h / 2 - 12, ly));
      aimLabel.setAttribute("x", lx.toFixed(1));
      aimLabel.setAttribute("y", ly.toFixed(1));
      aimLabel.textContent = label;

      aimEl.removeAttribute("hidden");
      options.onAim({ speed: v, el: el });
    }

    view.addEventListener("pointerdown", function (event) {
      if (aim || event.isPrimary === false) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      var target = event.target instanceof Element ? event.target.closest(".sat") : null;
      if (target) {
        select(target.getAttribute("data-id"));
        return;
      }

      var p = pointer(event);
      var x = p.x / scale;
      var y = -p.y / scale;
      var r = Math.sqrt(x * x + y * y);
      // Dentro del planeta no se puede salir: el lanzamiento arranca en la superficie.
      if (r < R) {
        if (r < 1) {
          x = R;
          y = 0;
        } else {
          x *= R / r;
          y *= R / r;
        }
      }
      aim = { pointerId: event.pointerId, x: x, y: y, sx: x * scale, sy: -y * scale, state: null };
      stage.classList.add("is-aiming");
      if (view.setPointerCapture) view.setPointerCapture(event.pointerId);
    });

    view.addEventListener("pointermove", function (event) {
      if (aim && event.pointerId === aim.pointerId) updateAim(event);
    });

    view.addEventListener("pointerup", function (event) {
      if (!aim || event.pointerId !== aim.pointerId) return;
      var state = aim.state;
      endAim();
      if (state) options.onPointerLaunch(launch(state));
    });

    view.addEventListener("pointercancel", endAim);
    view.addEventListener("lostpointercapture", endAim);

    window.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && aim) endAim();
    });

    /* ---------- API ---------- */

    function select(id) {
      if (!byId(id) || id === selectedId) return;
      selectedId = id;
      refreshStatic();
      if (!raf) draw();
      options.onChange();
    }

    function remove(id) {
      var sat = byId(id);
      if (sat) retire(sat, "removed");
    }

    function clear() {
      sats.slice().forEach(function (sat) {
        detach(sat);
        fadeOut(sat.node);
        fadeOut(sat.orbitNode);
      });
      ghosts = [];
      selectedId = null;
      counter = 0; // la numeración vuelve a SAT-01
      refreshStatic();
      stop();
      draw();
      options.onChange();
    }

    function restore(items, next) {
      items.forEach(function (item) {
        var sat = make(physics.makeState(item.x, item.y, item.vx, item.vy), item.n, item.tint);
        sats.push(sat);
        if (reduced()) addStill(sat, false);
        else backfill(sat);
        place(sat);
        counter = Math.max(counter, item.n);
      });
      counter = Math.max(counter, next || 0);
      if (sats.length) selectedId = sats[sats.length - 1].id;
      refreshStatic();
      start();
      if (!raf) draw();
      options.onChange();
    }

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop();
      else start();
    });

    document.addEventListener("pluton:themechange", function () {
      readColors();
      draw();
    });

    if (window.matchMedia) {
      var motion = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (motion.addEventListener) motion.addEventListener("change", syncMotion);
    }

    readColors();
    if (window.ResizeObserver) new ResizeObserver(layout).observe(view);
    else window.addEventListener("resize", layout);
    layout();

    return {
      max: MAX_SATS,
      launch: launch,
      // Lanzamiento con datos: cada uno sale de un punto distinto alrededor de Plutón.
      launchFrom: function (altitude, v, angle) {
        return launch(physics.fromLaunch(altitude, v, angle, Math.PI + counter * GOLDEN_ANGLE));
      },
      select: select,
      remove: remove,
      clear: clear,
      restore: restore,
      list: function () {
        return sats.map(summary);
      },
      selected: function () {
        var sat = byId(selectedId);
        return sat ? summary(sat) : null;
      },
      // Lectura en vivo del satélite elegido.
      live: function () {
        var sat = byId(selectedId);
        if (!sat) return null;
        var s = sat.state;
        return { altitude: Math.sqrt(s.x * s.x + s.y * s.y) - R, speed: Math.sqrt(s.vx * s.vx + s.vy * s.vy) };
      },
      time: function () {
        return simTime;
      },
      speed: function () {
        return speed;
      },
      setSpeed: function (value) {
        speed = value;
      },
      isPaused: function () {
        return paused;
      },
      setPaused: function (value) {
        paused = Boolean(value);
        if (paused) stop();
        else start();
      },
      // Solo se guardan los que siguen en órbita, con su estado en este instante.
      serialize: function () {
        var round = function (v) {
          return Math.round(v * 1e6) / 1e6;
        };
        return {
          next: counter,
          sats: sats
            .filter(function (sat) {
              return sat.kind === "orbit";
            })
            .map(function (sat) {
              var s = sat.state;
              return { n: sat.n, tint: sat.tint, x: round(s.x), y: round(s.y), vx: round(s.vx), vy: round(s.vy) };
            }),
        };
      },
    };
  };
})();
