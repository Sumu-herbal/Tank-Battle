/**
 * 素材生成器 + 预加载器
 * 程序化生成所有游戏贴图到离屏 Canvas，模拟 spritesheet
 */
const Sprites = {
  ready: false,
  _cache: {},

  // 尺寸规格
  TILE: 24,        // 瓦片
  TANK_W: 22,      // 坦克宽
  TANK_H: 22,      // 坦克高
  BULLET: 8,       // 子弹
  EXPLOSION: 48,   // 爆炸帧
  POWERUP: 20,     // 道具

  // 预加载入口
  preload() {
    if (this.ready) return Promise.resolve();
    console.log('🎨 生成游戏素材...');

    this._genTiles();
    this._genTanks();
    this._genBullets();
    this._genExplosionFrames();
    this._genPowerups();
    this._genBase();

    this.ready = true;
    console.log('✅ 素材就绪 (' + Object.keys(this._cache).length + ' 张贴图)');
    return Promise.resolve();
  },

  // 获取坦克贴图（仅朝上帧，渲染时旋转）
  getTank(colorKey, frame = 0) {
    const key = `tank_${colorKey}_${frame}`;
    return this._cache[key] || this._cache['tank_player1_0'];
  },

  // 运动时履带帧切换
  getTankFrame(isMoving, frameCount) {
    return isMoving ? ((frameCount >> 2) & 1) : 0;
  },

  getTile(type) { return this._cache[`tile_${type}`]; },
  getBullet(isPlayer) { return this._cache[`bullet_${isPlayer ? 'p' : 'e'}`]; },
  getExplosion(frame) { return this._cache[`explosion_${frame}`]; },
  getPowerup(type) { return this._cache[`powerup_${type}`]; },
  getBase() { return this._cache['base']; },

  // ============ 生成器 ============

  _canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  },

  _cacheSet(key, canvas) {
    this._cache[key] = canvas;
  },

  _genTiles() {
    const T = this.TILE;

    // 砖块
    const brick = this._canvas(T, T);
    const bc = brick.getContext('2d');
    bc.fillStyle = '#8b4513'; bc.fillRect(0, 0, T, T);
    bc.fillStyle = '#a0522d';
    for (let r = 0; r < T; r += 6) {
      bc.fillRect(0, r, T, 3);
      for (let col = 0; col < T; col += 8) {
        bc.fillStyle = (r / 6 + col / 8) % 2 ? '#b5651d' : '#8b4513';
        bc.fillRect(col + 4, r, 4, 3);
      }
    }
    this._cacheSet('tile_1', brick);

    // 钢铁
    const steel = this._canvas(T, T);
    const sc = steel.getContext('2d');
    sc.fillStyle = '#555'; sc.fillRect(0, 0, T, T);
    sc.fillStyle = '#888'; sc.fillRect(2, 2, T - 4, T - 4);
    sc.fillStyle = '#aaa'; sc.fillRect(4, 4, T - 8, T - 8);
    sc.fillStyle = '#ccc';
    [[4, 4], [T - 7, 4], [4, T - 7], [T - 7, T - 7]].forEach(([x, y]) => sc.fillRect(x, y, 3, 3));
    this._cacheSet('tile_2', steel);

    // 水域
    const water = this._canvas(T, T);
    const wc = water.getContext('2d');
    wc.fillStyle = '#0a2a4a'; wc.fillRect(0, 0, T, T);
    wc.fillStyle = '#1a4a7a';
    for (let i = 0; i < T; i += 4) wc.fillRect(0, i, T, 2);
    this._cacheSet('tile_3', water);

    // 森林
    const forest = this._canvas(T, T);
    const fc = forest.getContext('2d');
    fc.fillStyle = '#0a2a0a'; fc.fillRect(0, 0, T, T);
    fc.fillStyle = '#1a4a12';
    fc.fillRect(4, 4, 6, 6);
    fc.fillRect(14, 4, 6, 6);
    fc.fillRect(8, 12, 8, 8);
    fc.fillStyle = '#2a5a1e';
    fc.fillRect(6, 6, 4, 3);
    fc.fillRect(16, 6, 4, 3);
    this._cacheSet('tile_4', forest);

    // 泥泞
    const mud = this._canvas(T, T);
    const mc = mud.getContext('2d');
    mc.fillStyle = '#2a1a0a'; mc.fillRect(0, 0, T, T);
    mc.fillStyle = '#4a2a10';
    mc.fillRect(2, 4, 8, 4); mc.fillRect(12, 14, 10, 4);
    mc.fillRect(4, 18, 6, 3);
    mc.fillStyle = 'rgba(100,60,20,0.5)';
    mc.fillRect(1, 1, T - 2, T - 2);
    this._cacheSet('tile_6', mud);

    // 冰面
    const ice = this._canvas(T, T);
    const ic = ice.getContext('2d');
    ic.fillStyle = '#0a2a3a'; ic.fillRect(0, 0, T, T);
    ic.fillStyle = '#b8e0f0'; ic.fillRect(3, 3, T - 6, T - 6);
    ic.strokeStyle = 'rgba(255,255,255,0.5)';
    ic.lineWidth = 0.5;
    ic.beginPath(); ic.moveTo(4, T - 4); ic.lineTo(T - 4, 4); ic.stroke();
    this._cacheSet('tile_7', ice);

    // 草丛
    const grass = this._canvas(T, T);
    const gc = grass.getContext('2d');
    gc.fillStyle = '#051a05'; gc.fillRect(0, 0, T, T);
    gc.fillStyle = '#0f3a0a';
    gc.fillRect(3, 4, 5, 5); gc.fillRect(16, 3, 5, 6);
    gc.fillRect(8, 14, 8, 6); gc.fillRect(2, 18, 5, 4);
    gc.fillStyle = '#1a5a12';
    gc.fillRect(4, 6, 3, 2); gc.fillRect(17, 4, 3, 2);
    this._cacheSet('tile_8', grass);
  },

  _genTanks() {
    const W = this.TANK_W, H = this.TANK_H;
    const colors = {
      player1:  ['#00e5ff','#003344','#80f0ff','#004466'],
      player2:  ['#ff3366','#330810','#ff8899','#661020'],
      player3:  ['#39ff14','#083004','#80ff60','#106010'],
      player4:  ['#ffdd00','#332b00','#ffee80','#665800'],
      player5:  ['#ff6b35','#331508','#ffaa80','#802a10'],
      player6:  ['#e040fb','#300833','#f090ff','#601080'],
      player7:  ['#00e676','#002e18','#60ffa0','#005020'],
      player8:  ['#ffab00','#332200','#ffcc80','#805500'],
      shield:   ['#4488ff','#0c1a33','#88bbff','#1a3366'],
      assassin: ['#cc44ff','#280833','#e088ff','#501a66'],
      engineer: ['#ff8822','#331a06','#ffbb77','#663310'],
      artillery:['#ff2244','#33060d','#ff6677','#660a18'],
    };

    for (const [key, [body, dark, light, track]] of Object.entries(colors)) {
      // 只生成朝上(UP)帧，渲染时通过 ctx.rotate() 处理方向
      for (let frame = 0; frame < 2; frame++) {
        const c = this._canvas(W, H);
        const ctx = c.getContext('2d');
        const cx = W / 2, cy = H / 2;

        ctx.save();
        ctx.translate(cx, cy);
        // 朝上 = 炮管指向上方 (canvas 中为 -y)，不需要旋转

        const hw = W / 2, hh = H / 2;

        // === 车体阴影 ===
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(-hw + 2, -hh + 2, hw * 2 - 4, hh * 2 - 4);

        // === 履带外框 ===
        ctx.fillStyle = '#111';
        ctx.fillRect(-hw + 1, -hh + 1, hw - 2, hh * 2 - 2);
        ctx.fillRect(hw - (hw - 1), -hh + 1, hw - 2, hh * 2 - 2);

        // === 履带纹路（两帧交替） ===
        const treadOffset = frame * 2;
        ctx.fillStyle = track;
        for (let i = -hh + 3 + treadOffset; i < hh; i += 4) {
          const ty = ((i % (hh * 2)) + hh * 2) % (hh * 2) - hh;
          ctx.fillRect(-hw + 2, ty, hw - 3, 2);
          ctx.fillRect(hw - (hw - 1) + 1, ty, hw - 3, 2);
        }
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(-hw + 2, -hh + 1, hw - 3, 1);
        ctx.fillRect(hw - (hw - 1) + 1, -hh + 1, hw - 3, 1);

        // === 车身主体 ===
        const bx = -hw + 3, by = -hh + 3, bw = hw * 2 - 6, bh = hh * 2 - 6;
        ctx.fillStyle = dark;
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = body;
        ctx.fillRect(bx + 1, by + 1, bw - 2, bh - 2);
        ctx.fillStyle = light;
        ctx.fillRect(bx + 2, by + 1, bw - 4, bh * 0.45);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(bx + 3, by + 2, bw - 6, 2);

        // === 发动机舱 ===
        ctx.fillStyle = dark;
        ctx.fillRect(bx + 2, by + bh * 0.55, bw - 4, bh * 0.35);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        for (let g = 0; g < 3; g++) {
          ctx.fillRect(bx + 3 + g * (bw - 8) / 3, by + bh * 0.58, (bw - 10) / 3, 1.5);
        }

        // === 炮塔座圈 ===
        const tr = hw * 0.55;
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.arc(0, 0, tr + 1, 0, Math.PI * 2);
        ctx.fill();

        // === 炮塔（八边形） ===
        ctx.fillStyle = body;
        ctx.beginPath();
        const sides = 8;
        for (let s = 0; s < sides; s++) {
          const a = (Math.PI * 2 * s) / sides - Math.PI / 2;
          const px = Math.cos(a) * tr, py = Math.sin(a) * tr;
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.beginPath();
        ctx.arc(0, -tr * 0.2, tr * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.arc(0, 0, 2, 0, Math.PI * 2);
        ctx.fill();

        // === 炮管（指向上方） ===
        const barrelW = 3.5, barrelH = hh * 1.6;
        ctx.fillStyle = dark;
        ctx.fillRect(-barrelW - 0.5, -barrelH - 0.5, barrelW * 2 + 1, barrelH + 1);
        const grad = ctx.createLinearGradient(-barrelW, 0, barrelW, 0);
        grad.addColorStop(0, dark);
        grad.addColorStop(0.4, light);
        grad.addColorStop(0.6, light);
        grad.addColorStop(1, dark);
        ctx.fillStyle = grad;
        ctx.fillRect(-barrelW, -barrelH, barrelW * 2, barrelH);
        // 炮口制退器
        ctx.fillStyle = light;
        ctx.fillRect(-barrelW - 1, -barrelH, barrelW * 2 + 2, 4);
        ctx.fillStyle = dark;
        ctx.fillRect(-barrelW - 1.5, -barrelH, 1.5, 4);
        ctx.fillRect(barrelW, -barrelH, 1.5, 4);

        ctx.restore();
        this._cacheSet(`tank_${key}_${frame}`, c);
      }
    }
  },

  _genBullets() {
    const S = this.BULLET;
    // 玩家子弹（亮黄）
    const bp = this._canvas(S, S);
    const bpc = bp.getContext('2d');
    bpc.fillStyle = '#ffee00';
    bpc.fillRect(1, 1, S - 2, S - 2);
    bpc.fillStyle = 'rgba(255,255,200,0.6)';
    bpc.fillRect(0, 0, S, S);
    this._cacheSet('bullet_p', bp);

    // 敌人子弹（红）
    const be = this._canvas(S, S);
    const bec = be.getContext('2d');
    bec.fillStyle = '#ff3344';
    bec.fillRect(1, 1, S - 2, S - 2);
    bec.fillStyle = 'rgba(255,50,50,0.6)';
    bec.fillRect(0, 0, S, S);
    this._cacheSet('bullet_e', be);
  },

  _genExplosionFrames() {
    // 8帧爆炸动画
    const S = this.EXPLOSION;
    for (let f = 0; f < 8; f++) {
      const c = this._canvas(S, S);
      const ctx = c.getContext('2d');
      const cx = S / 2, cy = S / 2;
      const progress = f / 7;
      const radius = S * (0.2 + progress * 0.45);

      // 光晕
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      gradient.addColorStop(0, progress < 0.4 ? '#ffffff' : '#ffdd44');
      gradient.addColorStop(0.3, '#ff8822');
      gradient.addColorStop(0.6, '#ff3311');
      gradient.addColorStop(1, 'rgba(255,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();

      // 碎片
      ctx.fillStyle = progress < 0.5 ? '#ffcc44' : '#ff6622';
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI * 2 * i) / 6 + progress * 2;
        const d = radius * (0.5 + progress * 0.5);
        ctx.save();
        ctx.translate(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
        ctx.rotate(a);
        ctx.fillRect(-3, -1, 6, 2);
        ctx.restore();
      }

      this._cacheSet(`explosion_${f}`, c);
    }
  },

  _genPowerups() {
    const S = this.POWERUP;
    const types = {
      timeFreeze:    { bg: '#00bfff', icon: '❄' },
      terrainEditor: { bg: '#ff8c00', icon: '🔧' },
      shield:        { bg: '#ffd700', icon: '🛡' },
      rapidFire:     { bg: '#ff4444', icon: '⚡' },
      mine:          { bg: '#ff1493', icon: '💣' },
      ricochet:      { bg: '#ff00ff', icon: '💫' },
      tripleShot:    { bg: '#00ff88', icon: '🔱' },
    };

    for (const [type, { bg, icon }] of Object.entries(types)) {
      const c = this._canvas(S, S);
      const ctx = c.getContext('2d');
      // 圆角背景
      ctx.fillStyle = bg;
      ctx.beginPath();
      const r = 4;
      ctx.moveTo(r, 0); ctx.lineTo(S - r, 0);
      ctx.quadraticCurveTo(S, 0, S, r);
      ctx.lineTo(S, S - r);
      ctx.quadraticCurveTo(S, S, S - r, S);
      ctx.lineTo(r, S);
      ctx.quadraticCurveTo(0, S, 0, S - r);
      ctx.lineTo(0, r);
      ctx.quadraticCurveTo(0, 0, r, 0);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // 图标
      ctx.fillStyle = '#fff';
      ctx.font = '12px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(icon, S / 2, S / 2);
      this._cacheSet(`powerup_${type}`, c);
    }
  },

  _genBase() {
    const S = this.TILE;
    const c = this._canvas(S, S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, S, S);
    // 旗帜
    ctx.fillStyle = '#e04040';
    ctx.fillRect(3, 3, S - 6, S - 8);
    // 鹰标
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(S / 2 - 2, 4, 4, S - 8);
    ctx.fillRect(S / 2 - 6, 7, 4, 3);
    ctx.fillRect(S / 2 + 2, 7, 4, 3);
    this._cacheSet('base', c);
  }
};
