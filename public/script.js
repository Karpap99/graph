const canvas = document.getElementById("myCanvas");
const ctx = canvas.getContext("2d");

const ui = {
  gravitySlider: document.getElementById("gravitySlider"),
  gravityValue: document.getElementById("gravityValue"),
  massSlider: document.getElementById("massSlider"),
  massValue: document.getElementById("massValue"),
  speedSlider: document.getElementById("speedSlider"),
  speedValue: document.getElementById("speedValue"),
  editingHint: document.getElementById("editingHint"),
  modeButtons: [...document.querySelectorAll(".mode-button")],
  trailsToggle: document.getElementById("trailsToggle"),
  clearTrailsButton: document.getElementById("clearTrailsButton"),
  resetCameraButton: document.getElementById("resetCameraButton"),
  selectionCard: document.querySelector(".selection-card"),
  selectionTitle: document.getElementById("selectionTitle"),
  selectionEmpty: document.getElementById("selectionEmpty"),
  selectionDetails: document.getElementById("selectionDetails"),
  selectedMass: document.getElementById("selectedMass"),
  selectedSpeed: document.getElementById("selectedSpeed"),
  selectedAcceleration: document.getElementById("selectedAcceleration"),
  selectedPosition: document.getElementById("selectedPosition"),
  influenceList: document.getElementById("influenceList"),
  deletePointButton: document.getElementById("deletePointButton"),
  zoomIndicator: document.getElementById("zoomIndicator"),
  modeIndicator: document.getElementById("modeIndicator"),
};

const BASE_RADIUS = 4;
const WALL_RESTITUTION = 1;
const COLLISION_RESTITUTION = 1;
const GRAVITY_SOFTENING = 12;
const PHYSICS_SUBSTEPS = 2;
const MAX_TRAIL_POINTS = 180;
const MIN_ZOOM = 0.28;
const MAX_ZOOM = 3.5;
const DOUBLE_CLICK_DELAY = 360;
const DRAG_THRESHOLD = 4;

const MODE_NAMES = {
  connections: "связи",
  attraction: "притяжение",
  velocity: "скорость",
  acceleration: "ускорение",
};

const state = {
  points: [],
  selectedPoint: null,
  nextPointId: 1,
  gravity: Number(ui.gravitySlider.value),
  defaultMass: Number(ui.massSlider.value),
  defaultSpeed: Number(ui.speedSlider.value),
  mode: "connections",
  showTrails: ui.trailsToggle.checked,
  dpr: 1,
  viewport: {
    width: window.innerWidth,
    height: window.innerHeight,
  },
  world: {
    width: Math.max(window.innerWidth, 1100),
    height: Math.max(window.innerHeight, 750),
  },
  camera: {
    x: 0,
    y: 0,
    zoom: 1,
  },
  interaction: {
    type: "idle",
    pointerId: null,
    point: null,
    downScreen: null,
    downWorld: null,
    pointStart: null,
    cameraStart: null,
    moved: false,
  },
  lastBlankTap: null,
  lastFrameTime: performance.now(),
  lastTrailTime: performance.now(),
  lastUiTime: 0,
};

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function radiusForMass(mass) {
  return BASE_RADIUS + Math.sqrt(mass) * 0.95;
}

function resizeCanvas() {
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  state.viewport.width = window.innerWidth;
  state.viewport.height = window.innerHeight;

  canvas.width = Math.round(state.viewport.width * state.dpr);
  canvas.height = Math.round(state.viewport.height * state.dpr);

  state.world.width = Math.max(state.world.width, state.viewport.width);
  state.world.height = Math.max(state.world.height, state.viewport.height);
}

function resetCamera() {
  const fitZoom = Math.min(
    1,
    state.viewport.width / state.world.width,
    state.viewport.height / state.world.height,
  );

  state.camera.zoom = fitZoom;
  state.camera.x =
    (state.viewport.width - state.world.width * fitZoom) / 2;
  state.camera.y =
    (state.viewport.height - state.world.height * fitZoom) / 2;
  updateCameraUi();
}

function worldToScreen(point) {
  return {
    x: point.x * state.camera.zoom + state.camera.x,
    y: point.y * state.camera.zoom + state.camera.y,
  };
}

function screenToWorld(point) {
  return {
    x: (point.x - state.camera.x) / state.camera.zoom,
    y: (point.y - state.camera.y) / state.camera.zoom,
  };
}

function getScreenPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function clampPointToWorld(point) {
  point.x = clamp(
    point.x,
    point.radius,
    state.world.width - point.radius,
  );
  point.y = clamp(
    point.y,
    point.radius,
    state.world.height - point.radius,
  );
}

function findAvailablePosition(x, y, radius) {
  const initial = {
    x: clamp(x, radius, state.world.width - radius),
    y: clamp(y, radius, state.world.height - radius),
  };

  for (let ring = 0; ring <= 8; ring++) {
    const distance = ring * (radius * 1.7 + 8);
    const attempts = ring === 0 ? 1 : 12 + ring * 3;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const angle = attempt / attempts * Math.PI * 2;
      const candidate = {
        x: clamp(
          initial.x + Math.cos(angle) * distance,
          radius,
          state.world.width - radius,
        ),
        y: clamp(
          initial.y + Math.sin(angle) * distance,
          radius,
          state.world.height - radius,
        ),
      };

      const overlaps = state.points.some((point) => (
        Math.hypot(point.x - candidate.x, point.y - candidate.y) <
        point.radius + radius + 3
      ));

      if (!overlaps) return candidate;
    }
  }

  return initial;
}

function createPoint(x, y, options = {}) {
  const mass = clamp(
    options.mass ?? state.defaultMass,
    Number(ui.massSlider.min),
    Number(ui.massSlider.max),
  );
  const speed = clamp(
    options.speed ?? state.defaultSpeed,
    Number(ui.speedSlider.min),
    Number(ui.speedSlider.max),
  );
  const radius = radiusForMass(mass);
  const position = findAvailablePosition(x, y, radius);
  const angle = options.angle ?? Math.random() * Math.PI * 2;

  const point = {
    id: state.nextPointId,
    mass,
    radius,
    x: position.x,
    y: position.y,
    xVelocity: Math.cos(angle) * speed,
    yVelocity: Math.sin(angle) * speed,
    xAcceleration: 0,
    yAcceleration: 0,
    trail: [{ x: position.x, y: position.y }],
  };

  state.nextPointId += 1;
  state.points.push(point);
  return point;
}

function seedPoints() {
  const { width, height } = state.world;
  const seeds = [
    { x: width * 0.41, y: height * 0.22, mass: 12, angle: 0.38 },
    { x: width * 0.67, y: height * 0.22, mass: 18, angle: 2.2 },
    { x: width * 0.54, y: height * 0.43, mass: 25, angle: 4.7 },
    { x: width * 0.82, y: height * 0.55, mass: 9, angle: 3.55 },
    { x: width * 0.41, y: height * 0.72, mass: 32, angle: 5.5 },
    { x: width * 0.69, y: height * 0.74, mass: 120, angle: 3.05 },
  ];

  for (const seed of seeds) {
    createPoint(seed.x, seed.y, {
      mass: seed.mass,
      speed: state.defaultSpeed,
      angle: seed.angle,
    });
  }
}

function setSelectedPoint(point, syncControls = true) {
  state.selectedPoint = point;
  if (point) state.lastBlankTap = null;

  if (point && syncControls) {
    const speed = Math.hypot(point.xVelocity, point.yVelocity);
    state.defaultMass = point.mass;
    state.defaultSpeed = speed;
    ui.massSlider.value = String(Math.round(point.mass));
    ui.speedSlider.value = String(speed.toFixed(1));
    updateRangeControl(ui.massSlider, ui.massValue, point.mass, 0);
    updateRangeControl(ui.speedSlider, ui.speedValue, speed, 1);
  }

  updateSelectionPanel(true);
}

function deleteSelectedPoint() {
  const point = state.selectedPoint;
  if (!point) return;

  cancelInteraction();
  state.points = state.points.filter((candidate) => candidate !== point);
  setSelectedPoint(null, false);
}

function findPointAtScreen(screenPoint) {
  const worldPoint = screenToWorld(screenPoint);
  let hit = null;
  let smallestScreenDistance = Infinity;

  const drawOrder = state.selectedPoint
    ? [
        ...state.points.filter((point) => point !== state.selectedPoint),
        state.selectedPoint,
      ]
    : state.points;

  for (let index = drawOrder.length - 1; index >= 0; index--) {
    const point = drawOrder[index];
    const distance = Math.hypot(
      worldPoint.x - point.x,
      worldPoint.y - point.y,
    );
    const hitRadius = point.radius + 7 / state.camera.zoom;
    const screenDistance = distance * state.camera.zoom;

    if (
      distance <= hitRadius &&
      screenDistance < smallestScreenDistance
    ) {
      hit = point;
      smallestScreenDistance = screenDistance;
    }
  }

  return hit;
}

function createConnections(count = 3) {
  const connections = [];
  const existingConnections = new Set();

  for (let i = 0; i < state.points.length; i++) {
    const nearest = [];

    for (let j = 0; j < state.points.length; j++) {
      if (i === j) continue;

      const dx = state.points[j].x - state.points[i].x;
      const dy = state.points[j].y - state.points[i].y;
      const distanceSquared = dx * dx + dy * dy;

      nearest.push({ index: j, distanceSquared });
      nearest.sort((first, second) => (
        first.distanceSquared - second.distanceSquared
      ));

      if (nearest.length > count) nearest.pop();
    }

    for (const neighbor of nearest) {
      const from = Math.min(i, neighbor.index);
      const to = Math.max(i, neighbor.index);
      const key = `${from}-${to}`;

      if (existingConnections.has(key)) continue;
      existingConnections.add(key);
      connections.push([
        state.points[i],
        state.points[neighbor.index],
      ]);
    }
  }

  return connections;
}

function getAttractionContributions(point) {
  const softeningSquared = GRAVITY_SOFTENING * GRAVITY_SOFTENING;
  const contributions = [];
  let totalAttraction = 0;

  for (const otherPoint of state.points) {
    if (otherPoint === point) continue;

    const dx = otherPoint.x - point.x;
    const dy = otherPoint.y - point.y;
    const softenedDistanceSquared =
      dx * dx + dy * dy + softeningSquared;
    const softenedDistance = Math.sqrt(softenedDistanceSquared);
    const gravityScale =
      state.gravity /
      (softenedDistanceSquared * softenedDistance);
    const xAcceleration = dx * gravityScale * otherPoint.mass;
    const yAcceleration = dy * gravityScale * otherPoint.mass;
    const attraction = Math.hypot(xAcceleration, yAcceleration);

    totalAttraction += attraction;
    contributions.push({
      point: otherPoint,
      dx,
      dy,
      distance: Math.hypot(dx, dy),
      xAcceleration,
      yAcceleration,
      attraction,
      percentage: 0,
    });
  }

  for (const contribution of contributions) {
    contribution.percentage =
      totalAttraction === 0
        ? 0
        : contribution.attraction / totalAttraction * 100;
  }

  return contributions;
}

function getSortedContributions(point) {
  return getAttractionContributions(point)
    .sort((first, second) => second.attraction - first.attraction);
}

function getDependencyStyle(percentage) {
  const strength = Math.sqrt(clamp(percentage / 100, 0, 1));
  return {
    lineWidth: 1 + 5 * strength,
    alpha: 0.18 + 0.82 * strength,
  };
}

function setWorldTransform() {
  const scale = state.dpr * state.camera.zoom;
  ctx.setTransform(
    scale,
    0,
    0,
    scale,
    state.dpr * state.camera.x,
    state.dpr * state.camera.y,
  );
}

function screenPixels(value) {
  return value / state.camera.zoom;
}

function drawGrid() {
  const topLeft = screenToWorld({ x: 0, y: 0 });
  const bottomRight = screenToWorld({
    x: state.viewport.width,
    y: state.viewport.height,
  });
  const gridSize = 70;
  const startX = Math.floor(topLeft.x / gridSize) * gridSize;
  const endX = Math.ceil(bottomRight.x / gridSize) * gridSize;
  const startY = Math.floor(topLeft.y / gridSize) * gridSize;
  const endY = Math.ceil(bottomRight.y / gridSize) * gridSize;

  ctx.save();
  ctx.lineWidth = screenPixels(1);
  ctx.strokeStyle = "rgba(28, 62, 49, 0.055)";
  ctx.beginPath();

  for (let x = startX; x <= endX; x += gridSize) {
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
  }

  for (let y = startY; y <= endY; y += gridSize) {
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
  }

  ctx.stroke();

  ctx.lineWidth = screenPixels(1.5);
  ctx.strokeStyle = "rgba(28, 62, 49, 0.13)";
  ctx.setLineDash([screenPixels(7), screenPixels(7)]);
  ctx.strokeRect(0, 0, state.world.width, state.world.height);
  ctx.restore();
}

function drawTrails() {
  if (!state.showTrails) return;

  for (const point of state.points) {
    if (point.trail.length < 2) continue;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(point.trail[0].x, point.trail[0].y);

    for (let index = 1; index < point.trail.length; index++) {
      ctx.lineTo(point.trail[index].x, point.trail[index].y);
    }

    ctx.lineWidth = screenPixels(
      point === state.selectedPoint ? 2.2 : 1.2,
    );
    ctx.strokeStyle =
      point === state.selectedPoint
        ? "rgba(232, 101, 60, 0.42)"
        : "rgba(23, 107, 82, 0.18)";
    ctx.stroke();
    ctx.restore();
  }
}

function drawConnections() {
  ctx.save();
  ctx.lineWidth = screenPixels(1.25);
  ctx.strokeStyle = "rgba(23, 55, 43, 0.25)";
  ctx.beginPath();

  for (const [point, neighbor] of createConnections(3)) {
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(neighbor.x, neighbor.y);
  }

  ctx.stroke();
  ctx.restore();
}

function drawArrow(fromX, fromY, toX, toY, arrowSize = 10) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const size = screenPixels(arrowSize);
  const arrowAngle = Math.PI / 7;

  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - size * Math.cos(angle - arrowAngle),
    toY - size * Math.sin(angle - arrowAngle),
  );
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - size * Math.cos(angle + arrowAngle),
    toY - size * Math.sin(angle + arrowAngle),
  );
  ctx.stroke();
}

function drawLabel(text, x, y, options = {}) {
  const fontSize = screenPixels(options.fontSize ?? 11);
  const paddingX = screenPixels(6);
  const height = screenPixels(20);

  ctx.save();
  ctx.font = `${options.weight ?? 750} ${fontSize}px Inter, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const width = ctx.measureText(text).width + paddingX * 2;
  ctx.fillStyle = options.background ?? "rgba(251, 252, 247, 0.92)";
  ctx.fillRect(x - width / 2, y - height / 2, width, height);
  ctx.fillStyle = options.color ?? "#71402f";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawAttractionDependencies() {
  const selectedPoint = state.selectedPoint;
  if (!selectedPoint) return;

  const contributions = getSortedContributions(selectedPoint);

  for (let index = 0; index < contributions.length; index++) {
    const contribution = contributions[index];
    if (contribution.distance === 0) continue;

    const directionX = contribution.dx / contribution.distance;
    const directionY = contribution.dy / contribution.distance;
    const startOffset =
      selectedPoint.radius + screenPixels(6);
    const endOffset =
      contribution.point.radius + screenPixels(9);
    const startX = selectedPoint.x + directionX * startOffset;
    const startY = selectedPoint.y + directionY * startOffset;
    const endX = contribution.point.x - directionX * endOffset;
    const endY = contribution.point.y - directionY * endOffset;

    if (
      Math.hypot(endX - startX, endY - startY) <
      screenPixels(18)
    ) {
      continue;
    }

    const style = getDependencyStyle(contribution.percentage);
    const labelOffset = screenPixels(index % 2 === 0 ? 9 : -9);
    const labelX =
      startX + (endX - startX) * 0.56 - directionY * labelOffset;
    const labelY =
      startY + (endY - startY) * 0.56 + directionX * labelOffset;

    ctx.save();
    ctx.lineWidth = screenPixels(style.lineWidth);
    ctx.strokeStyle = `rgba(232, 101, 60, ${style.alpha})`;
    ctx.setLineDash([screenPixels(7), screenPixels(5)]);
    drawArrow(startX, startY, endX, endY, 10);
    ctx.restore();

    drawLabel(
      `#${contribution.point.id} · ${contribution.percentage.toFixed(1)}%`,
      labelX,
      labelY,
      {
        color: "#9e3d24",
        background: "rgba(255, 248, 240, 0.93)",
      },
    );
  }

  drawResultantAttraction(selectedPoint, contributions);
}

function drawResultantAttraction(point, contributions) {
  const result = contributions.reduce(
    (sum, contribution) => ({
      x: sum.x + contribution.xAcceleration,
      y: sum.y + contribution.yAcceleration,
    }),
    { x: 0, y: 0 },
  );
  const magnitude = Math.hypot(result.x, result.y);

  if (magnitude < 1e-9) return;

  const directionX = result.x / magnitude;
  const directionY = result.y / magnitude;
  const visualLength = screenPixels(
    clamp(Math.sqrt(magnitude) * 54, 34, 135),
  );
  const startOffset = point.radius + screenPixels(7);
  const startX = point.x + directionX * startOffset;
  const startY = point.y + directionY * startOffset;
  const endX = startX + directionX * visualLength;
  const endY = startY + directionY * visualLength;

  ctx.save();
  ctx.lineWidth = screenPixels(3.5);
  ctx.strokeStyle = "#0b8f80";
  ctx.shadowColor = "rgba(11, 143, 128, 0.24)";
  ctx.shadowBlur = screenPixels(7);
  drawArrow(startX, startY, endX, endY, 12);
  ctx.restore();

  drawLabel("Σ притяжения", endX, endY - screenPixels(16), {
    color: "#08665d",
    background: "rgba(235, 252, 247, 0.94)",
    fontSize: 10,
  });
}

function drawMotionVectors(type) {
  const isVelocity = type === "velocity";

  for (const point of state.points) {
    const vectorX = isVelocity
      ? point.xVelocity
      : point.xAcceleration;
    const vectorY = isVelocity
      ? point.yVelocity
      : point.yAcceleration;
    const magnitude = Math.hypot(vectorX, vectorY);

    if (magnitude < 1e-9) continue;

    const directionX = vectorX / magnitude;
    const directionY = vectorY / magnitude;
    const visualLength = screenPixels(
      isVelocity
        ? clamp(magnitude * 8, 16, 110)
        : clamp(Math.sqrt(magnitude) * 52, 16, 110),
    );
    const startOffset = point.radius + screenPixels(5);
    const startX = point.x + directionX * startOffset;
    const startY = point.y + directionY * startOffset;
    const endX = startX + directionX * visualLength;
    const endY = startY + directionY * visualLength;
    const isSelected = point === state.selectedPoint;

    ctx.save();
    ctx.lineWidth = screenPixels(isSelected ? 3 : 2);
    ctx.strokeStyle = isVelocity
      ? isSelected
        ? "#176b9b"
        : "rgba(28, 119, 168, 0.72)"
      : isSelected
        ? "#844ec2"
        : "rgba(132, 78, 194, 0.68)";
    drawArrow(startX, startY, endX, endY, isSelected ? 11 : 9);
    ctx.restore();

    if (isSelected) {
      drawLabel(
        `${isVelocity ? "v" : "a"} ${magnitude.toFixed(isVelocity ? 1 : 2)}`,
        endX,
        endY - screenPixels(15),
        {
          color: isVelocity ? "#115c86" : "#68359e",
          background: isVelocity
            ? "rgba(238, 248, 253, 0.94)"
            : "rgba(247, 241, 253, 0.94)",
        },
      );
    }
  }
}

function drawPoints() {
  const selectedPoint = state.selectedPoint;
  const orderedPoints = [
    ...state.points.filter((point) => point !== selectedPoint),
    ...(selectedPoint ? [selectedPoint] : []),
  ];

  for (const point of orderedPoints) {
    const isSelected = point === selectedPoint;
    const isHeavy = point.mass >= 80;

    ctx.save();

    if (isSelected) {
      ctx.beginPath();
      ctx.arc(
        point.x,
        point.y,
        point.radius + screenPixels(6),
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = "rgba(232, 101, 60, 0.15)";
      ctx.fill();

      ctx.lineWidth = screenPixels(2.5);
      ctx.strokeStyle = "#e8653c";
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
    ctx.fillStyle = isSelected
      ? "#e8653c"
      : isHeavy
        ? "#176b52"
        : "#243f35";
    ctx.shadowColor = isSelected
      ? "rgba(232, 101, 60, 0.34)"
      : "rgba(24, 48, 39, 0.2)";
    ctx.shadowBlur = screenPixels(isSelected ? 10 : 5);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = isSelected ? "#9e3d24" : "#56645e";
    ctx.font = `750 ${screenPixels(10)}px Inter, Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      `#${point.id}`,
      point.x,
      point.y - point.radius - screenPixels(6),
    );
    ctx.restore();
  }
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#edf0e8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  setWorldTransform();
  drawGrid();
  drawTrails();

  if (state.mode === "connections") {
    drawConnections();
  } else if (state.mode === "attraction") {
    drawAttractionDependencies();
  } else if (state.mode === "velocity") {
    drawMotionVectors("velocity");
  } else if (state.mode === "acceleration") {
    drawMotionVectors("acceleration");
  }

  drawPoints();
}

function keepInsideWorld(point) {
  if (point.x - point.radius < 0) {
    point.x = point.radius;
    point.xVelocity =
      Math.abs(point.xVelocity) * WALL_RESTITUTION;
  } else if (point.x + point.radius > state.world.width) {
    point.x = state.world.width - point.radius;
    point.xVelocity =
      -Math.abs(point.xVelocity) * WALL_RESTITUTION;
  }

  if (point.y - point.radius < 0) {
    point.y = point.radius;
    point.yVelocity =
      Math.abs(point.yVelocity) * WALL_RESTITUTION;
  } else if (point.y + point.radius > state.world.height) {
    point.y = state.world.height - point.radius;
    point.yVelocity =
      -Math.abs(point.yVelocity) * WALL_RESTITUTION;
  }
}

function resolveCollision(first, second) {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const distanceSquared = dx * dx + dy * dy;
  const minimumDistance = first.radius + second.radius;

  if (distanceSquared >= minimumDistance * minimumDistance) return;

  const distance = Math.sqrt(distanceSquared);
  const normalX = distance === 0 ? 1 : dx / distance;
  const normalY = distance === 0 ? 0 : dy / distance;
  const overlap = minimumDistance - distance;
  const firstInverseMass = 1 / first.mass;
  const secondInverseMass = 1 / second.mass;
  const inverseMassSum = firstInverseMass + secondInverseMass;

  const firstCorrection =
    overlap * firstInverseMass / inverseMassSum;
  const secondCorrection =
    overlap * secondInverseMass / inverseMassSum;

  first.x -= normalX * firstCorrection;
  first.y -= normalY * firstCorrection;
  second.x += normalX * secondCorrection;
  second.y += normalY * secondCorrection;

  const relativeVelocityX =
    second.xVelocity - first.xVelocity;
  const relativeVelocityY =
    second.yVelocity - first.yVelocity;
  const velocityAlongNormal =
    relativeVelocityX * normalX + relativeVelocityY * normalY;

  if (velocityAlongNormal >= 0) return;

  const impulse =
    (-(1 + COLLISION_RESTITUTION) * velocityAlongNormal) /
    inverseMassSum;
  const impulseX = impulse * normalX;
  const impulseY = impulse * normalY;

  first.xVelocity -= impulseX * firstInverseMass;
  first.yVelocity -= impulseY * firstInverseMass;
  second.xVelocity += impulseX * secondInverseMass;
  second.yVelocity += impulseY * secondInverseMass;
}

function applyGravity() {
  for (const point of state.points) {
    point.xAcceleration = 0;
    point.yAcceleration = 0;
  }

  const softeningSquared = GRAVITY_SOFTENING * GRAVITY_SOFTENING;

  for (let i = 0; i < state.points.length - 1; i++) {
    const first = state.points[i];

    for (let j = i + 1; j < state.points.length; j++) {
      const second = state.points[j];
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const softenedDistanceSquared =
        dx * dx + dy * dy + softeningSquared;
      const softenedDistance = Math.sqrt(softenedDistanceSquared);
      const gravityScale =
        state.gravity /
        (softenedDistanceSquared * softenedDistance);

      first.xAcceleration += dx * gravityScale * second.mass;
      first.yAcceleration += dy * gravityScale * second.mass;
      second.xAcceleration -= dx * gravityScale * first.mass;
      second.yAcceleration -= dy * gravityScale * first.mass;
    }
  }
}

function getDraggedPoint() {
  return state.interaction.type === "node-drag"
    ? state.interaction.point
    : null;
}

function stepPhysics(frameScale = 1) {
  const draggedPoint = getDraggedPoint();
  const timeStep = frameScale / PHYSICS_SUBSTEPS;

  for (let step = 0; step < PHYSICS_SUBSTEPS; step++) {
    applyGravity();

    for (const point of state.points) {
      if (point === draggedPoint) continue;

      point.xVelocity += point.xAcceleration * timeStep;
      point.yVelocity += point.yAcceleration * timeStep;
      point.x += point.xVelocity * timeStep;
      point.y += point.yVelocity * timeStep;
      keepInsideWorld(point);
    }

    for (let i = 0; i < state.points.length - 1; i++) {
      for (let j = i + 1; j < state.points.length; j++) {
        if (
          state.points[i] === draggedPoint ||
          state.points[j] === draggedPoint
        ) {
          continue;
        }
        resolveCollision(state.points[i], state.points[j]);
      }
    }

    for (const point of state.points) {
      keepInsideWorld(point);
    }
  }
}

function sampleTrails(timestamp) {
  if (timestamp - state.lastTrailTime < 50) return;
  state.lastTrailTime = timestamp;

  for (const point of state.points) {
    const last = point.trail[point.trail.length - 1];
    const distance = last
      ? Math.hypot(point.x - last.x, point.y - last.y)
      : Infinity;

    if (distance < 1.2) continue;
    point.trail.push({ x: point.x, y: point.y });

    if (point.trail.length > MAX_TRAIL_POINTS) {
      point.trail.splice(
        0,
        point.trail.length - MAX_TRAIL_POINTS,
      );
    }
  }
}

function clearTrails() {
  for (const point of state.points) {
    point.trail = [{ x: point.x, y: point.y }];
  }
}

function updateRangeControl(input, output, value, decimals = 0) {
  const minimum = Number(input.min);
  const maximum = Number(input.max);
  const progress = (Number(input.value) - minimum) /
    (maximum - minimum) * 100;

  input.style.setProperty("--range-progress", `${progress}%`);
  output.value = Number(value).toFixed(decimals);
  output.textContent = Number(value).toFixed(decimals);
}

function updateCameraUi() {
  ui.zoomIndicator.textContent =
    `${Math.round(state.camera.zoom * 100)}%`;
}

function updateModeUi() {
  for (const button of ui.modeButtons) {
    const isActive = button.dataset.mode === state.mode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }

  ui.modeIndicator.textContent =
    `Режим: ${MODE_NAMES[state.mode]}`;
}

function updateSelectionPanel(force = false) {
  const point = state.selectedPoint;

  if (!point) {
    ui.selectionCard.classList.remove("has-selection");
    ui.selectionTitle.textContent = "Нет вершины";
    ui.selectionEmpty.hidden = false;
    ui.selectionDetails.hidden = true;
    ui.editingHint.textContent = "для новой вершины";
    if (force) ui.influenceList.replaceChildren();
    return;
  }

  ui.selectionCard.classList.add("has-selection");
  ui.selectionTitle.textContent = `Вершина #${point.id}`;
  ui.selectionEmpty.hidden = true;
  ui.selectionDetails.hidden = false;
  ui.editingHint.textContent = `вершина #${point.id}`;
  ui.selectedMass.textContent = point.mass.toFixed(1);
  ui.selectedSpeed.textContent =
    Math.hypot(point.xVelocity, point.yVelocity).toFixed(2);
  ui.selectedAcceleration.textContent =
    Math.hypot(
      point.xAcceleration,
      point.yAcceleration,
    ).toFixed(3);
  ui.selectedPosition.textContent =
    `${point.x.toFixed(0)}, ${point.y.toFixed(0)}`;

  const contributions = getSortedContributions(point);
  const fragment = document.createDocumentFragment();

  if (contributions.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "empty-state";
    emptyItem.textContent = "Нет других вершин";
    fragment.append(emptyItem);
  } else {
    contributions.forEach((contribution, index) => {
      const item = document.createElement("li");
      item.className = "influence-item";
      item.style.setProperty(
        "--influence",
        `${Math.max(2, contribution.percentage)}%`,
      );

      const bar = document.createElement("span");
      bar.className = "influence-bar";

      const rank = document.createElement("span");
      rank.className = "influence-rank";
      rank.textContent = `${index + 1}.`;

      const name = document.createElement("span");
      name.className = "influence-name";
      name.textContent = `Вершина #${contribution.point.id}`;

      const value = document.createElement("span");
      value.className = "influence-value";
      value.textContent =
        `${contribution.percentage.toFixed(1)}%`;

      item.append(bar, rank, name, value);
      fragment.append(item);
    });
  }

  ui.influenceList.replaceChildren(fragment);
}

function setMode(mode) {
  if (!Object.prototype.hasOwnProperty.call(MODE_NAMES, mode)) return;
  state.mode = mode;
  updateModeUi();
}

function handleGravityInput() {
  state.gravity = Number(ui.gravitySlider.value);
  updateRangeControl(
    ui.gravitySlider,
    ui.gravityValue,
    state.gravity,
    0,
  );
}

function handleMassInput() {
  const mass = Number(ui.massSlider.value);
  state.defaultMass = mass;

  if (state.selectedPoint) {
    state.selectedPoint.mass = mass;
    state.selectedPoint.radius = radiusForMass(mass);
    clampPointToWorld(state.selectedPoint);
  }

  updateRangeControl(ui.massSlider, ui.massValue, mass, 0);
  updateSelectionPanel(true);
}

function handleSpeedInput() {
  const speed = Number(ui.speedSlider.value);
  state.defaultSpeed = speed;

  if (state.selectedPoint) {
    const currentSpeed = Math.hypot(
      state.selectedPoint.xVelocity,
      state.selectedPoint.yVelocity,
    );
    const directionX = currentSpeed > 1e-9
      ? state.selectedPoint.xVelocity / currentSpeed
      : 1;
    const directionY = currentSpeed > 1e-9
      ? state.selectedPoint.yVelocity / currentSpeed
      : 0;

    state.selectedPoint.xVelocity = directionX * speed;
    state.selectedPoint.yVelocity = directionY * speed;
  }

  updateRangeControl(ui.speedSlider, ui.speedValue, speed, 1);
  updateSelectionPanel(true);
}

function resetInteractionState() {
  state.interaction.type = "idle";
  state.interaction.pointerId = null;
  state.interaction.point = null;
  state.interaction.downScreen = null;
  state.interaction.downWorld = null;
  state.interaction.pointStart = null;
  state.interaction.cameraStart = null;
  state.interaction.moved = false;
  canvas.classList.remove("is-dragging");
}

function cancelInteraction() {
  if (
    state.interaction.pointerId !== null &&
    canvas.hasPointerCapture?.(state.interaction.pointerId)
  ) {
    canvas.releasePointerCapture(state.interaction.pointerId);
  }

  if (
    state.interaction.type === "node-drag" &&
    state.interaction.point
  ) {
    state.interaction.point.xVelocity = 0;
    state.interaction.point.yVelocity = 0;
  }

  resetInteractionState();
}

function beginInteraction(event) {
  if (state.interaction.type !== "idle") return;
  if (![0, 1, 2].includes(event.button)) return;

  const screenPoint = getScreenPoint(event);
  const worldPoint = screenToWorld(screenPoint);
  const wantsPan =
    event.button === 1 ||
    event.button === 2 ||
    (event.button === 0 && event.shiftKey);

  state.interaction.pointerId = event.pointerId;
  state.interaction.downScreen = screenPoint;
  state.interaction.downWorld = worldPoint;
  state.interaction.moved = false;

  if (wantsPan) {
    state.interaction.type = "pan-press";
    state.interaction.cameraStart = {
      x: state.camera.x,
      y: state.camera.y,
    };
    state.lastBlankTap = null;
  } else {
    const point = findPointAtScreen(screenPoint);

    if (point) {
      state.interaction.type = "node-press";
      state.interaction.point = point;
      state.interaction.pointStart = {
        x: point.x,
        y: point.y,
      };
      setSelectedPoint(point);
    } else {
      state.interaction.type = "blank-press";
      setSelectedPoint(null, false);
    }
  }

  canvas.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function moveInteraction(event) {
  const interaction = state.interaction;

  if (
    interaction.type === "idle" ||
    event.pointerId !== interaction.pointerId
  ) {
    if (interaction.type === "idle") {
      const hoverPoint = findPointAtScreen(getScreenPoint(event));
      canvas.classList.toggle("is-hovering-point", Boolean(hoverPoint));
    }
    return;
  }

  const screenPoint = getScreenPoint(event);
  const distance = Math.hypot(
    screenPoint.x - interaction.downScreen.x,
    screenPoint.y - interaction.downScreen.y,
  );

  if (distance > DRAG_THRESHOLD) {
    interaction.moved = true;
  }

  if (
    interaction.type === "node-press" &&
    interaction.moved
  ) {
    interaction.type = "node-drag";
    interaction.point.trail = [{
      x: interaction.point.x,
      y: interaction.point.y,
    }];
    canvas.classList.add("is-dragging");
  }

  if (interaction.type === "node-drag") {
    const worldPoint = screenToWorld(screenPoint);
    const deltaX = worldPoint.x - interaction.downWorld.x;
    const deltaY = worldPoint.y - interaction.downWorld.y;

    interaction.point.x = interaction.pointStart.x + deltaX;
    interaction.point.y = interaction.pointStart.y + deltaY;
    interaction.point.xVelocity = 0;
    interaction.point.yVelocity = 0;
    interaction.point.xAcceleration = 0;
    interaction.point.yAcceleration = 0;
    clampPointToWorld(interaction.point);
  }

  if (
    interaction.type === "pan-press" &&
    interaction.moved
  ) {
    interaction.type = "pan";
    canvas.classList.add("is-dragging");
  }

  if (interaction.type === "pan") {
    state.camera.x =
      interaction.cameraStart.x +
      screenPoint.x -
      interaction.downScreen.x;
    state.camera.y =
      interaction.cameraStart.y +
      screenPoint.y -
      interaction.downScreen.y;
  }

  event.preventDefault();
}

function handleBlankTap(screenPoint) {
  const now = performance.now();
  const previousTap = state.lastBlankTap;

  if (
    previousTap &&
    now - previousTap.time <= DOUBLE_CLICK_DELAY &&
    Math.hypot(
      screenPoint.x - previousTap.screen.x,
      screenPoint.y - previousTap.screen.y,
    ) <= 14
  ) {
    const worldPoint = screenToWorld(screenPoint);

    if (
      worldPoint.x >= 0 &&
      worldPoint.x <= state.world.width &&
      worldPoint.y >= 0 &&
      worldPoint.y <= state.world.height &&
      !findPointAtScreen(screenPoint)
    ) {
      const point = createPoint(worldPoint.x, worldPoint.y);
      setSelectedPoint(point);
    }

    state.lastBlankTap = null;
  } else {
    state.lastBlankTap = {
      time: now,
      screen: screenPoint,
    };
  }
}

function endInteraction(event) {
  const interaction = state.interaction;

  if (
    interaction.type === "idle" ||
    event.pointerId !== interaction.pointerId
  ) {
    return;
  }

  const screenPoint = getScreenPoint(event);

  if (interaction.type === "blank-press" && !interaction.moved) {
    handleBlankTap(screenPoint);
  }

  if (
    interaction.type === "node-drag" &&
    interaction.point
  ) {
    interaction.point.xVelocity = 0;
    interaction.point.yVelocity = 0;
    interaction.point.trail = [{
      x: interaction.point.x,
      y: interaction.point.y,
    }];
  }

  if (canvas.hasPointerCapture?.(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }

  resetInteractionState();
  event.preventDefault();
}

function handleWheel(event) {
  if (state.interaction.type !== "idle") return;

  const screenPoint = getScreenPoint(event);
  const worldPoint = screenToWorld(screenPoint);
  const delta =
    event.deltaMode === 1
      ? event.deltaY * 16
      : event.deltaMode === 2
        ? event.deltaY * state.viewport.height
        : event.deltaY;
  const nextZoom = clamp(
    state.camera.zoom * Math.exp(-delta * 0.0012),
    MIN_ZOOM,
    MAX_ZOOM,
  );

  state.camera.zoom = nextZoom;
  state.camera.x = screenPoint.x - worldPoint.x * nextZoom;
  state.camera.y = screenPoint.y - worldPoint.y * nextZoom;
  updateCameraUi();
  event.preventDefault();
}

function isEditableTarget(target) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable
  );
}

function handleKeyDown(event) {
  if (
    (event.key === "Delete" || event.key === "Backspace") &&
    !isEditableTarget(event.target) &&
    state.selectedPoint
  ) {
    event.preventDefault();
    deleteSelectedPoint();
  }
}

function animate(timestamp) {
  const delta = Math.min(
    30,
    Math.max(0, timestamp - state.lastFrameTime),
  );
  const frameScale = delta / (1000 / 60);

  state.lastFrameTime = timestamp;
  stepPhysics(frameScale);
  sampleTrails(timestamp);
  render();

  if (timestamp - state.lastUiTime >= 120) {
    updateSelectionPanel();
    updateCameraUi();
    state.lastUiTime = timestamp;
  }

  requestAnimationFrame(animate);
}

ui.gravitySlider.addEventListener("input", handleGravityInput);
ui.massSlider.addEventListener("input", handleMassInput);
ui.speedSlider.addEventListener("input", handleSpeedInput);

for (const button of ui.modeButtons) {
  button.addEventListener("click", () => {
    setMode(button.dataset.mode);
  });
}

ui.trailsToggle.addEventListener("change", () => {
  state.showTrails = ui.trailsToggle.checked;
});
ui.clearTrailsButton.addEventListener("click", clearTrails);
ui.resetCameraButton.addEventListener("click", resetCamera);
ui.deletePointButton.addEventListener("click", deleteSelectedPoint);

canvas.addEventListener("pointerdown", beginInteraction);
canvas.addEventListener("pointermove", moveInteraction);
canvas.addEventListener("pointerup", endInteraction);
canvas.addEventListener("pointercancel", cancelInteraction);
canvas.addEventListener("lostpointercapture", () => {
  if (state.interaction.type !== "idle") cancelInteraction();
});
canvas.addEventListener("wheel", handleWheel, { passive: false });
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
canvas.addEventListener("dblclick", (event) => event.preventDefault());

window.addEventListener("keydown", handleKeyDown);
window.addEventListener("blur", cancelInteraction);
window.addEventListener("resize", resizeCanvas);

resizeCanvas();
resetCamera();
seedPoints();
handleGravityInput();
handleMassInput();
handleSpeedInput();
updateModeUi();
updateSelectionPanel(true);

window.__graphApp = Object.freeze({
  getState() {
    return {
      pointCount: state.points.length,
      selectedPointId: state.selectedPoint?.id ?? null,
      gravity: state.gravity,
      defaultMass: state.defaultMass,
      defaultSpeed: state.defaultSpeed,
      mode: state.mode,
      showTrails: state.showTrails,
      camera: { ...state.camera },
      world: { ...state.world },
      points: state.points.map((point) => ({
        id: point.id,
        mass: point.mass,
        radius: point.radius,
        x: point.x,
        y: point.y,
        xVelocity: point.xVelocity,
        yVelocity: point.yVelocity,
        xAcceleration: point.xAcceleration,
        yAcceleration: point.yAcceleration,
        trailLength: point.trail.length,
      })),
    };
  },
  worldToScreen,
  screenToWorld,
  getAttractionContributions(pointId) {
    const point = state.points.find(
      (candidate) => candidate.id === pointId,
    );
    if (!point) return [];

    return getSortedContributions(point).map((contribution) => ({
      pointId: contribution.point.id,
      attraction: contribution.attraction,
      percentage: contribution.percentage,
      xAcceleration: contribution.xAcceleration,
      yAcceleration: contribution.yAcceleration,
    }));
  },
  getDependencyStyle,
  setMode,
  selectPoint(pointId) {
    const point = state.points.find(
      (candidate) => candidate.id === pointId,
    );
    setSelectedPoint(point ?? null);
  },
  addPoint(x, y) {
    const point = createPoint(x, y);
    setSelectedPoint(point);
    return point.id;
  },
  deleteSelectedPoint,
  clearTrails,
  resetCamera,
  stepPhysics,
});

requestAnimationFrame(animate);
