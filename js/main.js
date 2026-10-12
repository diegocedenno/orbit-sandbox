/* Interfaz: formulario y lanzamientos predefinidos, lista de satélites, panel de
   telemetría, controles de tiempo y persistencia. */
(function () {
  "use strict";

  var App = window.OrbitSandbox;
  var physics = App.physics;
  var fmt = App.fmt;
  var STORE_KEY = "orbit-sandbox:v1";
  var SPEEDS = [1, 4, 16];
  var NBSP = " ";

  var FIELDS = {
    alt: { min: 0, max: 8000, step: 50, digits: 0, error: "altitud de 0 a 8000 km" },
    speed: { min: 0.01, max: 3, step: 0.05, digits: 2, error: "velocidad de 0,01 a 3 km/s" },
    angle: { min: -180, max: 180, step: 5, digits: 0, error: "ángulo de −180 a 180°" },
  };

  // Lanzamientos predefinidos, relativos a la velocidad circular (vc) y de escape (ve)
  // de la altitud elegida.
  var PRESETS = {
    circular: function (vc) {
      return { speed: vc, angle: 0 };
    },
    elliptic: function (vc) {
      return { speed: vc * 1.18, angle: 0 };
    },
    escape: function (vc, ve) {
      return { speed: ve * 1.08, angle: 0 };
    },
    suborbital: function (vc) {
      return { speed: vc * 0.62, angle: 50 };
    },
  };

  var els = {
    status: document.getElementById("status"),
    announce: document.getElementById("announce"),
    hint: document.getElementById("hint"),
    clock: document.getElementById("clock"),
    clockLine: document.getElementById("clock-line"),
    stillNote: document.getElementById("still-note"),
    pause: document.getElementById("pause"),
    pauseText: document.getElementById("pause-text"),
    speedSet: document.getElementById("speed"),
    clear: document.getElementById("clear"),
    reference: document.getElementById("reference"),
    presets: document.querySelector(".presets"),
    form: document.getElementById("launch-form"),
    alt: document.getElementById("alt"),
    speed: document.getElementById("speed-in"),
    angle: document.getElementById("angle"),
    launch: document.getElementById("launch"),
    count: document.getElementById("count"),
    fleet: document.getElementById("fleet"),
    fleetEmpty: document.getElementById("fleet-empty"),
    tmState: document.getElementById("tm-state"),
    tmName: document.getElementById("tm-name"),
    tmPe: document.getElementById("tm-pe"),
    tmAp: document.getElementById("tm-ap"),
    tmPeriod: document.getElementById("tm-period"),
    tmE: document.getElementById("tm-e"),
    tmA: document.getElementById("tm-a"),
    tmEnergy: document.getElementById("tm-energy"),
    tmAlt: document.getElementById("tm-alt"),
    tmSpeed: document.getElementById("tm-speed"),
  };

  var aiming = null; // datos de la puntería mientras se arrastra
  var lastReport = null; // último satélite elegido que cayó o escapó: su parte sigue a la vista
  var rows = {}; // filas de la lista por id de satélite

  /* ---------- persistencia ---------- */

  function load() {
    var empty = { speed: 1, next: 0, sats: [] };
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      var data = raw ? JSON.parse(raw) : null;
      if (!data || typeof data !== "object") return empty;
      var sats = (Array.isArray(data.sats) ? data.sats : [])
        .filter(function (item) {
          if (!item || typeof item !== "object") return false;
          var numbers = [item.x, item.y, item.vx, item.vy].every(function (v) {
            return typeof v === "number" && isFinite(v);
          });
          if (!numbers || !Number.isInteger(item.n) || item.n < 1 || item.n > 1e6) return false;
          if (item.x * item.x + item.y * item.y < physics.RADIUS * physics.RADIUS * 0.999) return false;
          // Solo vuelve lo que de verdad sigue en órbita.
          return physics.elements(item).kind === "orbit";
        })
        .slice(-scene.max)
        .map(function (item) {
          return { n: item.n, tint: [0, 1, 2].indexOf(item.tint) === -1 ? 0 : item.tint, x: item.x, y: item.y, vx: item.vx, vy: item.vy };
        });
      return {
        speed: SPEEDS.indexOf(data.speed) === -1 ? 1 : data.speed,
        next: Number.isInteger(data.next) && data.next > 0 && data.next < 1e6 ? data.next : 0,
        sats: sats,
      };
    } catch (err) {
      return empty;
    }
  }

  function save() {
    try {
      var data = scene.serialize();
      window.localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, speed: scene.speed(), next: data.next, sats: data.sats }));
    } catch (err) {
      /* almacenamiento no disponible: el sandbox sigue funcionando */
    }
  }

  /* ---------- vista ---------- */

  function setStatus(label, text, isError) {
    els.status.textContent = label + ": ";
    var strong = document.createElement("b");
    strong.textContent = text;
    els.status.appendChild(strong);
    els.status.classList.toggle("is-error", Boolean(isError));
  }

  // Línea de consola con trozos destacados: ["a ", ["600 km"], ": circular ", …]
  function setLine(el, parts, isError) {
    el.textContent = "";
    parts.forEach(function (part) {
      if (typeof part === "string") {
        el.append(part);
      } else {
        var strong = document.createElement("b");
        strong.textContent = part[0];
        el.appendChild(strong);
      }
    });
    el.classList.toggle("is-error", Boolean(isError));
  }

  function setValue(dd, text, note) {
    dd.textContent = "";
    if (note) {
      var small = document.createElement("small");
      small.textContent = note;
      dd.appendChild(small);
    }
    dd.append(text);
  }

  function renderLive() {
    var live = scene.live();
    els.tmAlt.textContent = live ? fmt.km(Math.max(0, live.altitude)) : "—";
    els.tmSpeed.textContent = live ? fmt.speed(live.speed) : "—";
    els.clock.textContent = fmt.duration(scene.time());
  }

  function renderTelemetry() {
    var sat = scene.selected();
    if (sat) lastReport = null;
    var retired = !sat && Boolean(lastReport);
    if (retired) sat = lastReport;

    if (!sat) {
      els.tmName.textContent = "Sin satélite";
      els.tmState.textContent = "sin datos";
      els.tmState.removeAttribute("data-kind");
      [els.tmPe, els.tmAp, els.tmPeriod, els.tmE, els.tmA, els.tmEnergy].forEach(function (dd) {
        dd.textContent = "—";
      });
      renderLive();
      return;
    }

    var el = sat.el;
    els.tmName.textContent = sat.name;
    if (retired) {
      var small = document.createElement("small");
      small.textContent = " · retirado";
      els.tmName.appendChild(small);
    }
    els.tmState.textContent = fmt.kinds[sat.kind];
    els.tmState.setAttribute("data-kind", sat.kind);
    setValue(els.tmPe, fmt.km(el.periAlt), el.periAlt < 0 ? "bajo la superficie" : "");
    setValue(els.tmAp, fmt.km(el.apoAlt));
    setValue(els.tmPeriod, fmt.duration(el.period));
    setValue(els.tmE, fmt.num(el.e, 3));
    setValue(els.tmA, fmt.km(el.a));
    setValue(els.tmEnergy, fmt.num(el.energy, 3) + NBSP + "km²/s²");
    renderLive();
  }

  // La invitación a arrastrar solo hace falta con la escena vacía; mientras se
  // apunta, la misma línea anticipa el resultado.
  function renderHint() {
    els.hint.textContent = aiming ? aimText(aiming) : "arrastra para lanzar";
    els.hint.hidden = !aiming && scene.list().length > 0;
  }

  function buildRow(sat) {
    var li = document.createElement("li");
    li.className = "sat-row tint-" + sat.tint;
    li.setAttribute("data-id", sat.id);

    var pick = document.createElement("button");
    pick.type = "button";
    pick.className = "sat-pick";
    [
      ["sat-dot", ""],
      ["sat-name", sat.name],
      ["sat-kind", fmt.kinds[sat.kind]],
      ["sat-extra", fmt.duration(sat.el.period)],
    ].forEach(function (part) {
      var span = document.createElement("span");
      span.className = part[0];
      span.textContent = part[1];
      pick.appendChild(span);
    });
    pick.querySelector(".sat-kind").setAttribute("data-kind", sat.kind);
    pick.querySelector(".sat-dot").setAttribute("aria-hidden", "true");

    var remove = document.createElement("button");
    remove.type = "button";
    remove.className = "sat-remove";
    remove.setAttribute("aria-label", "Quitar " + sat.name);
    remove.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/></svg>';

    li.appendChild(pick);
    li.appendChild(remove);
    return li;
  }

  // La lista se actualiza en el sitio: reconstruirla le quitaría el foco a quien
  // la recorre con el teclado.
  function renderFleet() {
    var list = scene.list();
    var selected = scene.selected();
    var seen = {};

    list.forEach(function (sat) {
      var row = rows[sat.id];
      if (!row) {
        row = rows[sat.id] = buildRow(sat);
        els.fleet.appendChild(row);
        row.classList.add("is-entering");
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            row.classList.remove("is-entering");
          });
        });
      }
      var isSelected = Boolean(selected) && selected.id === sat.id;
      row.classList.toggle("is-selected", isSelected);
      row.firstChild.setAttribute("aria-pressed", String(isSelected));
      seen[sat.id] = true;
    });

    Object.keys(rows).forEach(function (id) {
      if (seen[id]) return;
      rows[id].remove();
      delete rows[id];
    });

    renderHint();
    els.count.textContent = list.length + "/" + scene.max;
    els.fleetEmpty.hidden = list.length > 0;
    els.clear.disabled = list.length === 0;
  }

  /* ---------- formulario ---------- */

  function parse(input) {
    var raw = input.value.trim().replace(",", ".").replace("−", "-");
    return /^-?(\d+\.?\d*|\.\d+)$/.test(raw) ? parseFloat(raw) : NaN;
  }

  function readField(key) {
    var rule = FIELDS[key];
    var value = parse(els[key]);
    var ok = isFinite(value) && value >= rule.min && value <= rule.max;
    els[key].setAttribute("aria-invalid", String(!ok));
    return ok ? value : null;
  }

  function fieldError(key) {
    setLine(els.reference, [FIELDS[key].error], true);
    els.announce.textContent = "Dato no válido: " + FIELDS[key].error;
    els[key].focus();
  }

  // Junto a los presets: las dos velocidades que mandan a la altitud escrita.
  function renderReference() {
    var alt = readField("alt");
    if (alt === null) {
      setLine(els.reference, [FIELDS.alt.error], true);
      return;
    }
    var r = physics.RADIUS + alt;
    setLine(els.reference, ["circular ", [fmt.num(physics.circularSpeed(r), 3)], " · escape ", [fmt.speed(physics.escapeSpeed(r))]]);
  }

  function describe(sat) {
    if (sat.kind === "orbit") setStatus("status", sat.name + " en órbita · e " + fmt.num(sat.el.e, 2));
    else if (sat.kind === "impact") setStatus("status", sat.name + " en rumbo de impacto");
    else setStatus("status", sat.name + " en trayectoria de escape");
  }

  function report(result) {
    var sat = result.sat;
    var el = sat.el;
    describe(sat);

    var detail = sat.name + ": " + fmt.kinds[sat.kind] + ". ";
    if (sat.kind === "orbit") {
      detail += "Periapsis " + fmt.km(el.periAlt) + ", apoapsis " + fmt.km(el.apoAlt) + ", periodo " + fmt.duration(el.period) + ".";
    } else if (sat.kind === "impact") {
      detail += "El periapsis queda bajo la superficie.";
    } else {
      detail += "Supera la velocidad de escape.";
    }
    if (result.evicted) detail += " " + result.evicted.name + " se retira para hacerle sitio.";
    els.announce.textContent = detail;
    save();
  }

  els.form.addEventListener("submit", function (event) {
    event.preventDefault();
    var values = {};
    var keys = ["alt", "speed", "angle"];
    var bad = null;
    keys.forEach(function (key) {
      values[key] = readField(key);
      if (values[key] === null && !bad) bad = key;
    });
    if (bad) {
      fieldError(bad);
      return;
    }
    renderReference();
    report(scene.launchFrom(values.alt, values.speed, values.angle));
  });

  els.presets.addEventListener("click", function (event) {
    var button = event.target.closest("[data-preset]");
    if (!button) return;
    var alt = readField("alt");
    if (alt === null) {
      fieldError("alt");
      return;
    }
    var r = physics.RADIUS + alt;
    var shot = PRESETS[button.getAttribute("data-preset")](physics.circularSpeed(r), physics.escapeSpeed(r));
    // El formulario enseña los valores redondeados; el lanzamiento usa los exactos.
    els.speed.value = fmt.num(shot.speed, 3);
    els.angle.value = String(shot.angle);
    els.speed.setAttribute("aria-invalid", "false");
    els.angle.setAttribute("aria-invalid", "false");
    renderReference();
    report(scene.launchFrom(alt, shot.speed, shot.angle));
  });

  ["alt", "speed", "angle"].forEach(function (key) {
    var input = els[key];
    var rule = FIELDS[key];

    input.addEventListener("input", function () {
      var ok = readField(key) !== null;
      if (key === "alt" || ok) renderReference();
      else setLine(els.reference, [rule.error], true);
    });

    // Flechas arriba y abajo, como en un campo numérico nativo.
    input.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      var value = parse(input);
      if (!isFinite(value)) return;
      event.preventDefault();
      var next = value + (event.key === "ArrowUp" ? rule.step : -rule.step);
      next = Math.min(rule.max, Math.max(rule.min, Math.round(next / rule.step) * rule.step));
      input.value = fmt.num(next, rule.digits);
      readField(key);
      renderReference();
    });
  });

  /* ---------- escena ---------- */

  function aimText(info) {
    var el = info.el;
    var text = fmt.speed(info.speed, 2) + " · " + fmt.kinds[el.kind];
    if (el.kind === "orbit") text += " · Pe " + fmt.km(el.periAlt) + " · Ap " + fmt.km(el.apoAlt);
    else if (el.kind === "impact" && el.energy < 0) text += " · Ap " + fmt.km(el.apoAlt);
    else if (el.kind === "escape" && el.rv < 0) text += " · Pe " + fmt.km(el.periAlt);
    return text;
  }

  var scene = App.createScene({
    stage: document.getElementById("stage"),
    view: document.getElementById("view"),
    svg: document.getElementById("sky"),
    canvas: document.getElementById("trails"),
    scale: document.getElementById("scale"),
    onChange: function () {
      renderFleet();
      renderTelemetry();
    },
    onRetire: function (sat, reason, wasSelected) {
      if (wasSelected) lastReport = sat;
      setStatus("status", sat.name + (reason === "impact" ? " impactó en la superficie" : " escapó de Plutón"));
    },
    onTick: renderLive,
    onAim: function (info) {
      aiming = info;
      renderHint();
    },
    onPointerLaunch: report,
  });

  els.fleet.addEventListener("click", function (event) {
    var row = event.target.closest(".sat-row");
    if (!row) return;
    var id = row.getAttribute("data-id");

    if (!event.target.closest(".sat-remove")) {
      scene.select(id);
      if (scene.selected()) describe(scene.selected());
      return;
    }

    // Con teclado, el foco pasa a la fila vecina en vez de perderse.
    var neighbour = row.nextElementSibling || row.previousElementSibling;
    var name = row.querySelector(".sat-name").textContent;
    scene.remove(id);
    if (event.detail === 0) (neighbour ? neighbour.firstChild : els.launch).focus();
    setStatus("status", name + " retirado");
    save();
  });

  /* ---------- controles de tiempo ---------- */

  els.pause.addEventListener("click", function () {
    var paused = !scene.isPaused();
    scene.setPaused(paused);
    els.pause.setAttribute("aria-pressed", String(paused));
    els.pauseText.textContent = paused ? "reanudar" : "pausa";
    setStatus("status", paused ? "simulación en pausa" : "simulación ×" + scene.speed());
    if (paused) save();
  });

  els.speedSet.addEventListener("change", function (event) {
    var value = Number(event.target.value);
    if (SPEEDS.indexOf(value) === -1) return;
    scene.setSpeed(value);
    if (!scene.isPaused()) setStatus("status", "simulación ×" + value);
    save();
  });

  els.clear.addEventListener("click", function () {
    scene.clear();
    lastReport = null;
    renderTelemetry();
    setStatus("status", "órbitas despejadas");
    save();
  });

  // Con movimiento reducido no hay simulación continua que pausar o acelerar.
  function applyMotion() {
    var still = window.Pluton.reducedMotion();
    els.pause.disabled = still;
    els.speedSet.disabled = still;
    els.clockLine.hidden = still;
    els.stillNote.hidden = !still;
  }

  if (window.matchMedia) {
    var motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.addEventListener) motion.addEventListener("change", applyMotion);
  }

  /* ---------- arranque ---------- */

  var stored = load();
  scene.setSpeed(stored.speed);
  els.speedSet.querySelector('input[value="' + stored.speed + '"]').checked = true;
  scene.restore(stored.sats, stored.next);
  if (stored.sats.length) setStatus("status", stored.sats.length === 1 ? "1 satélite en órbita" : stored.sats.length + " satélites en órbita");

  applyMotion();
  renderReference();
  renderFleet();
  renderTelemetry();

  // Las órbitas siguen su curso: se guarda cada poco y al salir de la página.
  window.setInterval(function () {
    if (!document.hidden && !scene.isPaused() && scene.list().length) save();
  }, 3000);
  window.addEventListener("pagehide", save);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) save();
  });
})();
