const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class ClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  toggle(name, force) {
    if (force === true) {
      this.values.add(name);
      return true;
    }
    if (force === false) {
      this.values.delete(name);
      return false;
    }
    if (this.values.has(name)) {
      this.values.delete(name);
      return false;
    }
    this.values.add(name);
    return true;
  }
}

class MockElement {
  constructor(id = "") {
    this.id = id;
    this.value = "";
    this.textContent = "";
    this.hidden = false;
    this.checked = false;
    this.disabled = false;
    this.dataset = {};
    this.children = [];
    this.listeners = {};
    this.classList = new ClassList();
    this.isContentEditable = false;
    this.style = {
      values: {},
      setProperty: (key, value) => {
        this.style.values[key] = value;
      },
    };
  }

  addEventListener(name, listener) {
    (this.listeners[name] ||= []).push(listener);
  }

  emit(name, event = {}) {
    event.target ??= this;
    event.preventDefault ??= () => {
      event.defaultPrevented = true;
    };
    for (const listener of this.listeners[name] || []) {
      listener(event);
    }
    return event;
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  append(...items) {
    this.children.push(...items);
  }

  replaceChildren(...items) {
    this.children = items;
  }

  getBoundingClientRect() {
    return {
      left: 18,
      top: 18,
      right: 354,
      bottom: 780,
      width: 336,
      height: 762,
    };
  }
}

class MockInput extends MockElement {}
class MockTextArea extends MockElement {}
class MockSelect extends MockElement {}
class MockButton extends MockElement {}

class MockCanvas extends MockElement {
  constructor(id, context, rect) {
    super(id);
    this.context = context;
    this.rect = rect;
    this.captured = new Set();
    this.width = rect.width;
    this.height = rect.height;
  }

  getContext() {
    return this.context;
  }

  getBoundingClientRect() {
    return {
      ...this.rect,
      right: this.rect.left + this.rect.width,
      bottom: this.rect.top + this.rect.height,
    };
  }

  setPointerCapture(id) {
    this.captured.add(id);
  }

  releasePointerCapture(id) {
    this.captured.delete(id);
  }

  hasPointerCapture(id) {
    return this.captured.has(id);
  }
}

function makeContext(textLog) {
  return new Proxy(
    {
      measureText: (text) => ({ width: String(text).length * 7 }),
      fillText: (text, x, y) => {
        textLog.push({ text: String(text), x, y });
      },
    },
    {
      get(target, key) {
        if (!(key in target)) target[key] = () => {};
        return target[key];
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    },
  );
}

function createHarness() {
  const mainText = [];
  const miniText = [];
  const mainContext = makeContext(mainText);
  const miniContext = makeContext(miniText);
  const ids = [
    "pauseButton", "playbackButton", "stepButton",
    "simulationStatus", "timeScaleSlider", "timeScaleValue",
    "gravitySlider", "gravityValue", "massSlider", "massValue",
    "speedSlider", "speedValue", "mapWidthSlider",
    "mapWidthValue", "mapHeightSlider", "mapHeightValue",
    "mapSizeValue", "minimapSize", "fitGraphButton",
    "centerSelectedButton", "followSelectedToggle", "editingHint",
    "trailsToggle", "clearTrailsButton", "resetCameraButton",
    "selectionTitle", "selectionEmpty", "selectionDetails",
    "selectedMass", "selectedSpeed", "selectedAcceleration",
    "selectedPosition", "influenceList", "deletePointButton",
    "zoomIndicator", "modeIndicator", "timeIndicator",
  ];
  const inputIds = new Set([
    "timeScaleSlider", "gravitySlider", "massSlider",
    "speedSlider", "mapWidthSlider", "mapHeightSlider",
    "followSelectedToggle", "trailsToggle",
  ]);
  const buttonIds = new Set([
    "pauseButton", "playbackButton", "stepButton",
    "fitGraphButton", "centerSelectedButton", "clearTrailsButton",
    "resetCameraButton", "deletePointButton",
  ]);
  const elements = Object.fromEntries(ids.map((id) => [
    id,
    inputIds.has(id)
      ? new MockInput(id)
      : buttonIds.has(id)
        ? new MockButton(id)
        : new MockElement(id),
  ]));

  Object.assign(elements.timeScaleSlider, {
    value: "1", min: "0.1", max: "3",
  });
  Object.assign(elements.gravitySlider, {
    value: "50", min: "0", max: "200",
  });
  Object.assign(elements.massSlider, {
    value: "20", min: "1", max: "300",
  });
  Object.assign(elements.speedSlider, {
    value: "3", min: "0", max: "15",
  });
  Object.assign(elements.mapWidthSlider, {
    value: "2600", min: "1000", max: "10000",
  });
  Object.assign(elements.mapHeightSlider, {
    value: "1600", min: "800", max: "7000",
  });
  elements.trailsToggle.checked = true;

  const modeButtons = [
    "connections", "attraction", "velocity", "acceleration",
  ].map((mode) => {
    const button = new MockButton();
    button.dataset.mode = mode;
    return button;
  });
  const selectionCard = new MockElement();
  const controlPanel = new MockElement();
  const canvas = new MockCanvas(
    "myCanvas",
    mainContext,
    { left: 0, top: 0, width: 1200, height: 800 },
  );
  const minimap = new MockCanvas(
    "minimapCanvas",
    miniContext,
    { left: 938, top: 64, width: 244, height: 154 },
  );
  elements.myCanvas = canvas;
  elements.minimapCanvas = minimap;

  const document = {
    getElementById: (id) => elements[id],
    querySelectorAll: (selector) => (
      selector === ".mode-button" ? modeButtons : []
    ),
    querySelector: (selector) => (
      selector === ".selection-card"
        ? selectionCard
        : selector === ".control-panel"
          ? controlPanel
          : null
    ),
    createDocumentFragment: () => new MockElement("fragment"),
    createElement: () => new MockElement(),
  };
  const windowListeners = {};
  let animationFrame = null;
  let now = 0;
  const window = {
    innerWidth: 1200,
    innerHeight: 800,
    devicePixelRatio: 1,
    addEventListener(name, listener) {
      (windowListeners[name] ||= []).push(listener);
    },
  };
  const sandbox = {
    console,
    Math,
    Object,
    document,
    window,
    HTMLInputElement: MockInput,
    HTMLTextAreaElement: MockTextArea,
    HTMLSelectElement: MockSelect,
    HTMLButtonElement: MockButton,
    performance: { now: () => now },
    requestAnimationFrame(listener) {
      animationFrame = listener;
      return 1;
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8"),
    sandbox,
  );

  return {
    app: window.__graphApp,
    canvas,
    minimap,
    elements,
    mainText,
    setNow(value) {
      now = value;
    },
    runFrame(timestamp) {
      now = timestamp;
      const callback = animationFrame;
      callback(timestamp);
    },
  };
}

function approximately(first, second, epsilon = 1e-7) {
  return Math.abs(first - second) <= epsilon;
}

function pointer(target, name, properties = {}) {
  return target.emit(name, {
    button: 0,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    shiftKey: false,
    ...properties,
  });
}

test("large map, camera, minimap, and time controls", () => {
  const harness = createHarness();
  const {
    app, canvas, minimap, elements, mainText,
  } = harness;
  let state = app.getState();

  assert.equal(state.world.width, 2600);
  assert.equal(state.world.height, 1600);
  assert.equal(state.viewport.width, 1200);
  assert.equal(state.viewport.height, 800);
  assert.ok(state.camera.zoom < 0.5 && state.camera.zoom >= 0.05);
  assert.match(elements.mapSizeValue.textContent, /2600.*1600/);

  const expandedBefore = state.points.map((point) => ({
    id: point.id,
    x: point.x,
    y: point.y,
  }));
  app.setWorldSize(10000, 7000);
  state = app.getState();
  assert.equal(state.world.width, 10000);
  assert.equal(state.world.height, 7000);
  assert.ok(expandedBefore.every((before) => {
    const after = state.points.find((point) => point.id === before.id);
    return approximately(after.x, before.x) &&
      approximately(after.y, before.y);
  }));
  assert.equal(elements.mapWidthValue.textContent, "10000");
  assert.equal(elements.mapHeightValue.textContent, "7000");

  app.resetCamera();
  state = app.getState();
  const worldStart = app.worldToScreen({ x: 0, y: 0 });
  const worldEnd = app.worldToScreen({ x: 10000, y: 7000 });
  assert.ok(state.camera.zoom < 0.28 && state.camera.zoom >= 0.05);
  assert.ok(worldStart.x >= 350 && worldEnd.x <= 1200);
  assert.ok(worldStart.y >= -1 && worldEnd.y <= 801);

  const mapZoom = state.camera.zoom;
  app.fitGraph();
  state = app.getState();
  assert.ok(state.camera.zoom > mapZoom);
  assert.ok(state.points.every((point) => {
    const screen = app.worldToScreen(point);
    return screen.x >= 370 && screen.x <= 1202 &&
      screen.y >= -2 && screen.y <= 802;
  }));

  app.setWorldSize(1000, 800);
  state = app.getState();
  assert.ok(state.points.every((point) => (
    point.x >= point.radius &&
    point.x <= 1000 - point.radius &&
    point.y >= point.radius &&
    point.y <= 800 - point.radius
  )));
  assert.ok(state.points.every((point) => point.trailLength === 1));

  app.selectPoint(1);
  app.centerSelected();
  state = app.getState();
  let selected = state.points.find((point) => point.id === 1);
  let selectedScreen = app.worldToScreen(selected);
  assert.ok(approximately(selectedScreen.x, 786, 1e-6));
  assert.ok(approximately(selectedScreen.y, 400, 1e-6));
  app.setFollowSelected(true);
  assert.equal(app.getState().followSelected, true);
  assert.equal(elements.followSelectedToggle.checked, true);

  app.setPaused(true);
  state = app.getState();
  const pausedPositions = state.points.map((point) => ({
    id: point.id,
    x: point.x,
    y: point.y,
    trailLength: point.trailLength,
  }));
  harness.runFrame(100);
  harness.runFrame(116.67);
  harness.runFrame(133.34);
  state = app.getState();
  assert.ok(pausedPositions.every((before) => {
    const after = state.points.find((point) => point.id === before.id);
    return approximately(after.x, before.x) &&
      approximately(after.y, before.y) &&
      after.trailLength === before.trailLength;
  }));
  assert.equal(elements.stepButton.disabled, false);
  assert.equal(elements.simulationStatus.textContent, "пауза");

  const beforeStep = state.points.map((point) => ({
    id: point.id, x: point.x, y: point.y,
  }));
  app.singleStep();
  state = app.getState();
  assert.ok(state.points.some((after) => {
    const before = beforeStep.find((point) => point.id === after.id);
    return !approximately(after.x, before.x) ||
      !approximately(after.y, before.y);
  }));
  const afterStep = state.points.map((point) => ({
    id: point.id, x: point.x, y: point.y,
  }));
  harness.runFrame(150);
  harness.runFrame(166.67);
  state = app.getState();
  assert.ok(afterStep.every((before) => {
    const after = state.points.find((point) => point.id === before.id);
    return approximately(after.x, before.x) &&
      approximately(after.y, before.y);
  }));

  app.setTimeScale(2);
  assert.equal(app.getState().timeScale, 2);
  assert.equal(elements.timeScaleValue.textContent, "2.0×");
  elements.gravitySlider.value = "0";
  elements.gravitySlider.emit("input");
  const velocityPointId = app.addPoint(500, 400);
  elements.speedSlider.value = "1";
  elements.speedSlider.emit("input");
  state = app.getState();
  const velocityPoint = state.points.find(
    (point) => point.id === velocityPointId,
  );
  harness.setNow(200);
  app.setPaused(false);
  harness.runFrame(216.6666667);
  state = app.getState();
  const movedPoint = state.points.find(
    (point) => point.id === velocityPoint.id,
  );
  assert.ok(
    Math.abs(
      movedPoint.x - velocityPoint.x -
      velocityPoint.xVelocity * 2
    ) < 1e-4,
  );
  app.setPaused(true);

  app.selectPoint(1);
  app.setFollowSelected(true);
  canvas.emit("wheel", {
    clientX: 850,
    clientY: 420,
    deltaY: -80,
    deltaMode: 0,
    preventDefault() {},
  });
  assert.equal(app.getState().followSelected, false);

  app.setWorldSize(10000, 7000);
  app.resetCamera();
  const miniLayout = app.getMinimapLayout();
  assert.ok(
    Number.isFinite(miniLayout.metrics.scale) &&
    miniLayout.metrics.scale > 0,
  );
  const targetWorld = { x: 8500, y: 5200 };
  const miniX = 938 + miniLayout.metrics.offsetX +
    targetWorld.x * miniLayout.metrics.scale;
  const miniY = 64 + miniLayout.metrics.offsetY +
    targetWorld.y * miniLayout.metrics.scale;
  pointer(minimap, "pointerdown", {
    pointerId: 31, clientX: miniX, clientY: miniY,
  });
  pointer(minimap, "pointerup", {
    pointerId: 31, clientX: miniX, clientY: miniY,
  });
  const centerWorld = app.screenToWorld({ x: 786, y: 400 });
  assert.ok(
    Math.hypot(
      centerWorld.x - targetWorld.x,
      centerWorld.y - targetWorld.y,
    ) < 1e-5,
  );

  mainText.length = 0;
  app.render();
  const numericLabels = mainText.filter(
    (entry) => /^[\d\s]+$/.test(entry.text),
  );
  assert.ok(numericLabels.length > 0 && numericLabels.length < 80);
  assert.ok(numericLabels.every(
    (entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y),
  ));

  state = app.getState();
  assert.ok(state.points.every((point) => [
    point.x,
    point.y,
    point.xVelocity,
    point.yVelocity,
    point.xAcceleration,
    point.yAcceleration,
  ].every(Number.isFinite)));
});
