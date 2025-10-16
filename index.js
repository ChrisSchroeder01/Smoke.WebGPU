// index.js
class Main {
    constructor() {
        this.canvas = document.querySelector('canvas');
        this.ctx = this.canvas.getContext('2d');

        this.gridSize = { x: 256, y: 256 };
        this.cellSize = 1.0;
        this.timestep = 0.016;
        this.viscosity = 0.0;
        this.buoyancy = 1.0;
        this.smokeDecay = 0.995;
        this.gsIterations = 40;

        this.mouseDown = false;
        this.mouseRight = false;
        this.mousePrev = null;
        this.radius = 8;
        this.brushStrength = 200.0;
        this.brushColor = [1.0, 0.6, 0.2, 1.0];

        this.initGrid();
        this.setupEvents();
        this.createMenu();
        this.resize();
        this.loop();
    }

    initGrid() {
        const W = this.gridSize.x, H = this.gridSize.y;
        this.velX = new Float32Array((W + 1) * H).fill(0);
        this.velY = new Float32Array(W * (H + 1)).fill(0);
        this.density = new Float32Array(W * H * 4).fill(0);
        this.pressure = new Float32Array(W * H).fill(0);
        this.divergence = new Float32Array(W * H).fill(0);
    }

    setupEvents() {
        window.addEventListener('resize', () => this.resize());

        this.canvas.addEventListener('mousemove', e => this.onMouseMove(e));
        this.canvas.addEventListener('mousedown', e => this.onMouseDown(e));
        this.canvas.addEventListener('mouseup', () => this.onMouseUp());
        this.canvas.addEventListener('mouseleave', () => { this.mouseDown = false; });
        this.canvas.oncontextmenu = e => e.preventDefault();

        this.canvas.addEventListener('wheel', e => {
            e.preventDefault();
            this.radius = Math.min(Math.max(this.radius - e.deltaY / 100, 1), 64);
        });

        // Drag & drop image
        this.canvas.addEventListener('dragover', e => e.preventDefault());
        this.canvas.addEventListener('drop', e => this.onDrop(e));
    }

    onDrop(e) {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (!file) return;
        const img = new Image();
        img.onload = () => this.loadImageToGrid(img);
        img.src = URL.createObjectURL(file);
    }

    loadImageToGrid(img) {
        const W = this.gridSize.x, H = this.gridSize.y;
        // compute scale to fit inside grid
        const scale = Math.min(W / img.width, H / img.height);
        const offX = Math.floor((W - img.width * scale) / 2);
        const offY = Math.floor((H - img.height * scale) / 2);

        // draw to temporary canvas
        const tmp = document.createElement('canvas');
        tmp.width = W;
        tmp.height = H;
        const tmpCtx = tmp.getContext('2d');
        tmpCtx.fillStyle = 'black';
        tmpCtx.fillRect(0, 0, W, H);
        tmpCtx.drawImage(img, 0, 0, img.width, img.height,
            offX, offY, img.width * scale, img.height * scale);

        const data = tmpCtx.getImageData(0, 0, W, H).data;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const idx = (y * W + x) * 4;
                this.density[idx + 0] = data[idx + 0] / 255;
                this.density[idx + 1] = data[idx + 1] / 255;
                this.density[idx + 2] = data[idx + 2] / 255;
                this.density[idx + 3] = data[idx + 3] / 255;
            }
        }
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.cellScreenX = this.canvas.width / this.gridSize.x;
        this.cellScreenY = this.canvas.height / this.gridSize.y;
    }

    onMouseMove(e) {
        const gx = Math.floor(e.offsetX / this.cellScreenX);
        const gy = Math.floor(e.offsetY / this.cellScreenY);
        const curr = { x: gx, y: gy };

        if (this.mouseDown && this.mousePrev) {
            this.mouseVel = { x: curr.x - this.mousePrev.x, y: curr.y - this.mousePrev.y };
        } else {
            this.mouseVel = { x: 0, y: 0 };
        }

        this.gridCoord = curr;
        this.mousePrev = curr;
    }

    onMouseDown(e) {
        this.mouseDown = true;
        this.mouseRight = (e.button === 2);
    }

    onMouseUp() {
        this.mouseDown = false;
        this.mousePrev = null;
    }

    applyBrush() {
        if (!this.mouseDown || !this.gridCoord) return;
        const { x: gx, y: gy } = this.gridCoord;
        const r2 = this.radius * this.radius;

        for (let y = -this.radius; y <= this.radius; y++) {
            for (let x = -this.radius; x <= this.radius; x++) {
                if (x*x + y*y > r2) continue;
                const px = gx + x;
                const py = gy + y;
                if (px < 0 || py < 0 || px >= this.gridSize.x || py >= this.gridSize.y) continue;

                const idx = (py * this.gridSize.x + px) * 4;

                if (!this.mouseRight) { // left click → add smoke
                    this.density[idx + 0] = this.brushColor[0];
                    this.density[idx + 1] = this.brushColor[1];
                    this.density[idx + 2] = this.brushColor[2];
                    this.density[idx + 3] = this.brushColor[3];
                }

                const vxIdx = py * (this.gridSize.x + 1) + px;
                const vyIdx = py * this.gridSize.x + px;
                // right click (or left if drag?) only changes velocity
                const strength = this.mouseRight ? 1 : 1;
                this.velX[vxIdx] += this.mouseVel?.x * this.brushStrength * 0.01 || 0;
                this.velY[vyIdx] += this.mouseVel?.y * this.brushStrength * 0.01 || 0;
            }
        }
    }

    advectDensity() {
        const W = this.gridSize.x, H = this.gridSize.y;
        const newDensity = new Float32Array(this.density.length);

        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const idx = (y * W + x) * 4;
                let u = x - this.velX[y * (W + 1) + x] * this.timestep;
                let v = y - this.velY[y * W + x] * this.timestep;
                u = Math.max(0, Math.min(W - 1, u));
                v = Math.max(0, Math.min(H - 1, v));

                const i0 = Math.floor(u), j0 = Math.floor(v);
                const i1 = Math.min(i0 + 1, W - 1);
                const j1 = Math.min(j0 + 1, H - 1);
                const s1 = u - i0, s0 = 1 - s1;
                const t1 = v - j0, t0 = 1 - t1;

                const idx00 = (j0 * W + i0) * 4;
                const idx10 = (j0 * W + i1) * 4;
                const idx01 = (j1 * W + i0) * 4;
                const idx11 = (j1 * W + i1) * 4;

                for (let k = 0; k < 4; k++) {
                    newDensity[idx + k] =
                        s0 * (t0 * this.density[idx00 + k] + t1 * this.density[idx01 + k]) +
                        s1 * (t0 * this.density[idx10 + k] + t1 * this.density[idx11 + k]);
                }
            }
        }

        this.density = newDensity;
    }

    advectVelocity() {
        const W = this.gridSize.x, H = this.gridSize.y;
        const newVelX = new Float32Array(this.velX.length);
        const newVelY = new Float32Array(this.velY.length);

        // VelX
        for (let y = 0; y < H; y++) {
            for (let x = 0; x <= W; x++) {
                const idx = y * (W + 1) + x;
                let px = x - this.velX[idx] * this.timestep;
                let py = y - this.velY[y * W + Math.min(x, W - 1)] * this.timestep;
                px = Math.max(0, Math.min(W, px));
                py = Math.max(0, Math.min(H - 1, py));

                const i0 = Math.floor(px), j0 = Math.floor(py);
                const i1 = Math.min(i0 + 1, W);
                const j1 = Math.min(j0 + 1, H - 1);
                const sx = px - i0, sy = py - j0;

                const idx00 = j0 * (W + 1) + i0;
                const idx10 = j0 * (W + 1) + i1;
                const idx01 = j1 * (W + 1) + i0;
                const idx11 = j1 * (W + 1) + i1;

                newVelX[idx] =
                    (1 - sx) * ((1 - sy) * this.velX[idx00] + sy * this.velX[idx01]) +
                    sx * ((1 - sy) * this.velX[idx10] + sy * this.velX[idx11]);
            }
        }

        // VelY
        for (let y = 0; y <= H; y++) {
            for (let x = 0; x < W; x++) {
                const idx = y * W + x;
                let px = x - this.velX[Math.min(y, H - 1) * (W + 1) + x] * this.timestep;
                let py = y - this.velY[idx] * this.timestep;
                px = Math.max(0, Math.min(W - 1, px));
                py = Math.max(0, Math.min(H, py));

                const i0 = Math.floor(px), j0 = Math.floor(py);
                const i1 = Math.min(i0 + 1, W - 1);
                const j1 = Math.min(j0 + 1, H);
                const sx = px - i0, sy = py - j0;

                const idx00 = j0 * W + i0;
                const idx10 = j0 * W + i1;
                const idx01 = j1 * W + i0;
                const idx11 = j1 * W + i1;

                newVelY[idx] =
                    (1 - sx) * ((1 - sy) * this.velY[idx00] + sy * this.velY[idx01]) +
                    sx * ((1 - sy) * this.velY[idx10] + sy * this.velY[idx11]);
            }
        }

        this.velX = newVelX;
        this.velY = newVelY;
    }

    computeDivergence() {
        const W = this.gridSize.x, H = this.gridSize.y;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const vxL = this.velX[y * (W + 1) + x];
                const vxR = this.velX[y * (W + 1) + x + 1];
                const vyB = this.velY[y * W + x];
                const vyT = this.velY[(y + 1) * W + x];
                this.divergence[y * W + x] = (vxR - vxL + vyT - vyB) / this.cellSize;
            }
        }
    }

    gaussSeidelPressure() {
        const W = this.gridSize.x, H = this.gridSize.y;
        const p = this.pressure;
        const div = this.divergence;

        for (let it = 0; it < this.gsIterations; it++) {
            for (let y = 1; y < H - 1; y++) {
                for (let x = 1; x < W - 1; x++) {
                    const idx = y * W + x;
                    p[idx] = (p[idx - 1] + p[idx + 1] + p[idx - W] + p[idx + W] - div[idx]) / 4;
                }
            }
        }
    }

    subtractGradient() {
        const W = this.gridSize.x, H = this.gridSize.y;
        const p = this.pressure;

        // VelX
        for (let y = 0; y < H; y++) {
            for (let x = 0; x <= W; x++) {
                const idx = y * (W + 1) + x;
                const i0 = Math.max(0, x - 1);
                const i1 = Math.min(W - 1, x);
                this.velX[idx] -= (p[y * W + i1] - p[y * W + i0]) / this.cellSize;
            }
        }

        // VelY
        for (let y = 0; y <= H; y++) {
            for (let x = 0; x < W; x++) {
                const idx = y * W + x;
                const j0 = Math.max(0, y - 1);
                const j1 = Math.min(H - 1, y);
                this.velY[idx] -= (p[j1 * W + x] - p[j0 * W + x]) / this.cellSize;
            }
        }
    }

    decayDensity() {
        for (let i = 0; i < this.density.length; i++) this.density[i] *= this.smokeDecay;
    }

    renderGrid() {
        const W = this.gridSize.x, H = this.gridSize.y;
        const img = this.ctx.createImageData(W, H);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const idx = (y * W + x) * 4;
                img.data[idx + 0] = Math.min(255, this.density[idx + 0] * 255);
                img.data[idx + 1] = Math.min(255, this.density[idx + 1] * 255);
                img.data[idx + 2] = Math.min(255, this.density[idx + 2] * 255);
                img.data[idx + 3] = 255;
            }
        }

        this.ctx.putImageData(img, 0, 0);
        this.ctx.drawImage(this.canvas, 0, 0, W, H, 0, 0, this.canvas.width, this.canvas.height);
    }

    step() {
        this.applyBrush();
        this.advectVelocity();
        this.advectDensity();
        this.computeDivergence();
        this.gaussSeidelPressure();
        this.subtractGradient();
        this.decayDensity();
        this.renderGrid();
    }

    loop() {
        requestAnimationFrame(() => {
            this.step();
            this.loop();
        });
    }

    createMenu() {
        const menu = document.getElementById('menu');
        const toggle = document.getElementById('toggleMenu');
        toggle?.addEventListener('click', () => menu.classList.toggle('open'));

        const sliders = [
            { id: 'decay', prop: 'smokeDecay', step: 0.001 },
            { id: 'timestep', prop: 'timestep', step: 0.001 },
            { id: 'viscosity', prop: 'viscosity', step: 0.001 },
            { id: 'buoyancy', prop: 'buoyancy', step: 0.01 },
            { id: 'gsIterations', prop: 'gsIterations', step: 1 },
            { id: 'radius', prop: 'radius', step: 1 }
        ];

        sliders.forEach(s => {
            const slider = document.getElementById(s.id);
            const val = document.getElementById(s.id + 'Val');
            slider?.addEventListener('input', e => {
                const v = parseFloat(e.target.value);
                this[s.prop] = (s.prop === 'gsIterations' || s.prop === 'radius') ? parseInt(v) : v;
                val.textContent = v;
            });
        });

        const colorPicker = document.getElementById('brushColor');
        colorPicker?.addEventListener('input', e => {
            const hex = e.target.value;
            this.brushColor = [
                parseInt(hex.substr(1, 2), 16) / 255,
                parseInt(hex.substr(3, 2), 16) / 255,
                parseInt(hex.substr(5, 2), 16) / 255,
                1.0
            ];
        });
    }
}

const app = new Main();
