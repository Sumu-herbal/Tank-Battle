/**
 * 粒子系统 — 爆炸/火花/烟雾/弹片/文字
 */
class ParticleSystem {
  constructor() {
    this.particles = [];
    this._pool = [];
    this._smokeGradCache = new Map(); // 缓存烟雾渐变，避免每帧创建
  }

  // 从对象池取粒子
  _acquire() {
    return this._pool.length ? this._pool.pop() : {};
  }

  // 归还到池
  _release(p) {
    this._pool.push(p);
  }

  // 爆炸粒子群
  explode(x, y, count = 20, opts = {}) {
    const { colors = ['#f44','#f80','#fd0','#fff'], speed = 3, life = 30 } = opts;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        life: life * (0.4 + Math.random() * 0.6),
        maxLife: life,
        color: colors[Math.random() * colors.length | 0],
        size: 1 + Math.random() * 3,
        gravity: 0.02 + Math.random() * 0.03,
        friction: 0.98,
        type: 'circle',
      });
    }
  }

  // 火花粒子（射击/碰撞）
  spark(x, y, angle, count = 5) {
    for (let i = 0; i < count; i++) {
      const spread = angle + (Math.random() - 0.5) * 1.2;
      const spd = 2 + Math.random() * 3;
      this.particles.push({
        x, y,
        vx: Math.cos(spread) * spd,
        vy: Math.sin(spread) * spd,
        life: 6 + Math.random() * 8,
        maxLife: 14,
        color: '#ffdd44',
        size: 1 + Math.random() * 2,
        gravity: 0,
        friction: 0.9,
        type: 'square',
      });
    }
  }

  // 烟雾（引擎/废墟）
  smoke(x, y, count = 3) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 8,
        y: y + (Math.random() - 0.5) * 8,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -1 - Math.random() * 1.5,
        life: 20 + Math.random() * 20,
        maxLife: 40,
        color: 'rgba(150,150,150,',
        size: 3 + Math.random() * 5,
        gravity: -0.01,
        friction: 1.02,
        type: 'smoke',
      });
    }
  }

  // 弹片（坦克毁坏）
  debris(x, y, count = 8) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 2 + Math.random() * 5;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 2,
        life: 15 + Math.random() * 25,
        maxLife: 40,
        color: ['#666','#888','#aaa','#555'][Math.random()*4|0],
        size: 2 + Math.random() * 4,
        gravity: 0.15,
        friction: 0.95,
        type: 'square',
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.3,
      });
    }
  }

  // 文字弹出（得分/+100等）
  textPopup(x, y, text, color = '#ffdd44') {
    this.particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 0.5,
      vy: -2 - Math.random() * 1,
      life: 40,
      maxLife: 40,
      color,
      size: 12,
      gravity: 0,
      friction: 1,
      type: 'text',
      text,
    });
  }

  // 轨道炮预警圈
  addOrbitalMarker(x, y) {
    this.particles.push({
      x, y,
      vx: 0, vy: 0,
      life: 100, // 3秒≈100帧
      maxLife: 100,
      color: '#ff2244',
      size: TILE_SIZE * 3,
      gravity: 0, friction: 1,
      type: 'orbital',
    });
  }

  update() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity || 0;
      p.vx *= (p.friction || 1);
      p.vy *= (p.friction || 1);
      if (p.rotSpeed) p.rotation = (p.rotation || 0) + p.rotSpeed;
      p.life--;
      if (p.life <= 0) {
        this._release(p);
        this.particles.splice(i, 1);
      }
    }
  }

  render(ctx) {
    for (const p of this.particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;

      switch (p.type) {
        case 'circle':
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
          ctx.fill();
          break;

        case 'square':
          ctx.fillStyle = p.color;
          if (p.rotation) {
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
          } else {
            ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
          }
          break;

        case 'smoke': {
          const r = p.size * (1 - alpha * 0.5);
          const rKey = (r * 10) | 0; // 按半径分桶缓存
          if (!this._smokeGradCache.has(rKey)) {
            // 创建模板渐变（以原点为中心，使用时 translate）
            const tmpl = document.createElement('canvas');
            tmpl.width = r * 2; tmpl.height = r * 2;
            const tctx = tmpl.getContext('2d');
            const grad = tctx.createRadialGradient(r, r, 0, r, r, r);
            grad.addColorStop(0, 'rgba(150,150,150,1)');
            grad.addColorStop(1, 'rgba(150,150,150,0)');
            tctx.fillStyle = grad;
            tctx.beginPath();
            tctx.arc(r, r, r, 0, Math.PI * 2);
            tctx.fill();
            this._smokeGradCache.set(rKey, tmpl);
          }
          ctx.globalAlpha = alpha * 0.4;
          ctx.drawImage(this._smokeGradCache.get(rKey), p.x - r, p.y - r);
          break;
        }

        case 'text':
          ctx.fillStyle = p.color;
          ctx.font = 'bold 12px Orbitron, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(p.text, p.x, p.y);
          break;

        case 'orbital':
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          const pr = p.life / p.maxLife;
          ctx.arc(p.x, p.y, p.size * (1 - pr * 0.3), 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          // 内圈
          ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.5})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 0.2 * (1 - pr), 0, Math.PI * 2);
          ctx.stroke();
          break;
      }
      ctx.restore();
    }
  }

  clear() {
    this.particles.length = 0;
  }
}
